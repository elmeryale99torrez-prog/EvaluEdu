import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') return json({ error: 'Método no permitido.' }, 405)

  const authorization = request.headers.get('Authorization')
  const token = authorization?.replace(/^Bearer\s+/i, '')
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
  const publishableKey = Deno.env.get('SUPABASE_PUBLISHABLE_KEY') ?? Deno.env.get('SUPABASE_ANON_KEY') ?? ''
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

  if (!token || !supabaseUrl || !publishableKey || !serviceRoleKey) {
    return json({ error: 'Configuración de servidor incompleta.' }, 500)
  }

  const callerClient = createClient(supabaseUrl, publishableKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  })
  const { data: authData, error: authError } = await callerClient.auth.getUser(token)
  if (authError || !authData.user) return json({ error: 'Sesión no válida.' }, 401)

  const adminClient = createClient(supabaseUrl, serviceRoleKey)
  const { data: callerProfile, error: profileError } = await adminClient
    .from('profiles')
    .select('role, roles, display_name')
    .eq('id', authData.user.id)
    .maybeSingle()
  if (profileError) return json({ error: profileError.message }, 500)
  const isCallerAdmin = callerProfile?.role === 'admin' || (Array.isArray(callerProfile?.roles) && callerProfile.roles.includes('admin'))
  if (!isCallerAdmin) return json({ error: 'Solo un administrador de la institución puede crear accesos directos.' }, 403)

  let body: { email?: unknown; displayName?: unknown; password?: unknown }
  try {
    body = await request.json()
  } catch {
    return json({ error: 'El cuerpo de la solicitud no es válido.' }, 400)
  }

  const email = String(body.email ?? '').trim().toLowerCase()
  const displayName = String(body.displayName ?? '').trim()
  const password = String(body.password ?? '').trim()

  if (!email || !/^\S+@\S+\.\S+$/.test(email)) return json({ error: 'Escribe un correo electrónico válido.' }, 400)
  if (displayName.length < 2) return json({ error: 'Escribe el nombre del profesor (mínimo 2 letras).' }, 400)
  if (password.length < 8) return json({ error: 'La contraseña asignada debe tener al menos 8 caracteres.' }, 400)

  // Comprobar si el usuario ya existe en Supabase Auth
  const { data: userList, error: listError } = await adminClient.auth.admin.listUsers({ page: 1, perPage: 1000 })
  if (listError) return json({ error: 'No se pudo consultar el padrón de usuarios.' }, 500)

  const existingUser = userList.users.find((u) => u.email?.toLowerCase() === email)

  let userId: string
  let mode: 'created' | 'activated' = 'created'

  if (existingUser) {
    userId = existingUser.id
    mode = 'activated'
    // Actualizar contraseña y desbanear si estaba bloqueado
    const { error: updateError } = await adminClient.auth.admin.updateUserById(userId, {
      password,
      email_confirm: true,
      ban_duration: 'none',
      user_metadata: { ...(existingUser.user_metadata ?? {}), display_name: displayName },
    })
    if (updateError) return json({ error: updateError.message }, 400)
  } else {
    // Crear nuevo usuario directo
    const { data: newUser, error: createError } = await adminClient.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { display_name: displayName },
    })
    if (createError || !newUser.user) return json({ error: createError?.message ?? 'No se pudo crear la credencial docente.' }, 400)
    userId = newUser.user.id
  }

  // Asegurar perfil docente en public.profiles
  const { error: profileUpsertError } = await adminClient.from('profiles').upsert({
    id: userId,
    display_name: displayName,
    role: 'teacher',
    roles: ['teacher'],
    updated_at: new Date().toISOString(),
  })

  if (profileUpsertError) {
    return json({
      error: 'Se asignó la contraseña, pero ocurrió un detalle al vincular el perfil docente.',
      detail: profileUpsertError.message,
      userId,
      email,
    }, 500)
  }

  // Registrar evento administrativo en el Libro Digital de Auditoría
  await adminClient.from('audit_events').insert({
    actor_id: authData.user.id,
    event_type: mode === 'created' ? 'teacher_created' : 'teacher_credential_updated',
    entity_type: 'user',
    entity_id: userId,
    metadata: {
      action: mode === 'created' ? 'direct_credential_created' : 'direct_credential_updated',
      email,
      displayName,
      performedBy: callerProfile?.display_name ?? 'Dirección',
      timestamp: new Date().toISOString(),
    },
  }).catch(() => {})

  return json({
    ok: true,
    userId,
    email,
    displayName,
    mode,
    message: mode === 'activated'
      ? `Acceso reactivado con éxito para ${displayName}.`
      : `Profesor ${displayName} dado de alta con credencial directa.`,
  }, 201)
})
