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
  const isCallerAdmin = callerProfile?.role === 'admin' || callerProfile?.role === 'superadmin' || (Array.isArray(callerProfile?.roles) && (callerProfile.roles.includes('admin') || callerProfile.roles.includes('superadmin')))
  if (!isCallerAdmin) return json({ error: 'Solo un administrador de la institución puede crear accesos directos.' }, 403)

  let body: { email?: unknown; displayName?: unknown; password?: unknown; institutionId?: unknown }
  try {
    body = await request.json()
  } catch {
    return json({ error: 'El cuerpo de la solicitud no es válido.' }, 400)
  }

  const email = String(body.email ?? '').trim().toLowerCase()
  const displayName = String(body.displayName ?? '').trim()
  const password = String(body.password ?? '').trim()
  const requestedInstId = typeof body.institutionId === 'string' && body.institutionId.trim() ? body.institutionId.trim() : null

  if (!email || !/^\S+@\S+\.\S+$/.test(email)) return json({ error: 'Escribe un correo electrónico válido.' }, 400)
  if (displayName.length < 2) return json({ error: 'Escribe el nombre del profesor (mínimo 2 letras).' }, 400)
  if (password.length < 8) return json({ error: 'La contraseña asignada debe tener al menos 8 caracteres.' }, 400)

  // Verificar alcance institucional del actor
  const isExplicitSuperadmin =
    callerProfile?.role === 'superadmin' ||
    callerProfile?.role === 'platform_admin' ||
    (Array.isArray(callerProfile?.roles) && (callerProfile.roles.includes('superadmin') || callerProfile.roles.includes('platform_admin')))

  let targetInstitutionId = requestedInstId
  if (!isExplicitSuperadmin) {
    const { data: callerMems, error: membershipScopeError } = await adminClient
      .from('institution_memberships')
      .select('institution_id, role, status')
      .eq('user_id', authData.user.id)

    const activeDirInsts = ((callerMems ?? []) as Array<Record<string, unknown>>)
      .filter((m) => m.role === 'admin' && m.status === 'active')
      .map((m) => String(m.institution_id))

    if (membershipScopeError || activeDirInsts.length === 0) return json({ error: "No hay un ámbito institucional activo autorizado." }, 403)

    if (activeDirInsts.length > 0) {
      if (targetInstitutionId && !activeDirInsts.includes(targetInstitutionId)) {
        return json({ error: 'No tienes permisos para crear docentes en una institución ajena.' }, 403)
      }
      if (!targetInstitutionId) {
        targetInstitutionId = activeDirInsts[0]
      }
    }
  }

  // Comprobar si el usuario ya existe en Supabase Auth
  const { data: userList, error: listError } = await adminClient.auth.admin.listUsers({ page: 1, perPage: 1000 })
  if (listError) return json({ error: 'No se pudo consultar el padrón de usuarios.' }, 500)

  const existingUser = userList.users.find((u) => u.email?.toLowerCase() === email)

  // Protección de cuentas existentes: prohibir sobreescritura de contraseñas y conversión forzosa de rol
  if (existingUser) {
    return json({ error: 'Ya existe una cuenta de usuario registrada con este correo electrónico.' }, 409)
  }

  // Si aplica ámbito institucional, reservar plaza primero para no crear cuenta fantasma sin cupo
  if (targetInstitutionId) {
    const { data: quotaRes, error: quotaErr } = await callerClient.rpc('assign_institution_license', {
      p_institution_id: targetInstitutionId,
      p_email: email,
      p_display_name: displayName,
      p_role: 'teacher',
      p_user_id: null,
    })
    if (quotaErr) {
      return json({ error: quotaErr.message }, 403)
    }
    const qObj = quotaRes as Record<string, unknown> | null
    if (qObj && qObj.ok === false) {
      return json({ error: String(qObj.message ?? 'No hay cupos disponibles en la institución.'), code: qObj.error }, 409)
    }
  }

  // Crear nuevo usuario directo docente
  const { data: newUser, error: createError } = await adminClient.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { display_name: displayName },
  })
  if (createError || !newUser.user) return json({ error: createError?.message ?? 'No se pudo crear la credencial docente.' }, 400)
  const userId = newUser.user.id

  // Confirmar membresía institucional como 'active' vinculada al userId creado
  if (targetInstitutionId) {
    await callerClient.rpc('assign_institution_license', {
      p_institution_id: targetInstitutionId,
      p_email: email,
      p_display_name: displayName,
      p_role: 'teacher',
      p_user_id: userId,
    })
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
      error: 'Se creó la credencial, pero ocurrió un problema al registrar el perfil docente.',
      detail: profileUpsertError.message,
      userId,
      email,
    }, 500)
  }

  // Registrar evento administrativo en el Libro Digital de Auditoría
  // RC-FIX-01 (LAB-RC-001): PostgrestBuilder no expone .catch(); se inspecciona el error devuelto.
  const { error: auditError } = await adminClient.from('audit_events').insert({
    actor_id: authData.user.id,
    event_type: 'teacher_created',
    entity_type: 'user',
    entity_id: userId,
    metadata: {
      email,
      teacherName: displayName,
      institution_id: targetInstitutionId,
      createdDirectly: true,
      timestamp: new Date().toISOString(),
    },
  })
  if (auditError) console.warn('audit_events insert failed', auditError.message)

  return json({
    ok: true,
    userId,
    email,
    displayName,
    institutionId: targetInstitutionId,
    status: 'active',
    role: 'teacher',
    mode: 'created',
    message: `Cuenta docente creada exitosamente para ${displayName}.`,
  }, 201)
})
