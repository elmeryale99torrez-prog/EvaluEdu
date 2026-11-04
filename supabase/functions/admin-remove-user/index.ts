import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (payload: unknown, status = 200) =>
  new Response(JSON.stringify(payload), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') return json({ error: 'Método no permitido.' }, 405)

  const token = request.headers.get('Authorization')?.replace(/^Bearer\s+/i, '')
  const url = Deno.env.get('SUPABASE_URL') ?? ''
  const publishableKey = Deno.env.get('SUPABASE_PUBLISHABLE_KEY') ?? Deno.env.get('SUPABASE_ANON_KEY') ?? ''
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

  if (!token || !url || !publishableKey || !serviceRoleKey) return json({ error: 'Configuración de servidor incompleta.' }, 500)

  const caller = createClient(url, publishableKey, { global: { headers: { Authorization: `Bearer ${token}` } } })
  const { data: authData, error: authError } = await caller.auth.getUser(token)
  if (authError || !authData.user) return json({ error: 'Sesión no válida.' }, 401)

  const admin = createClient(url, serviceRoleKey)
  const { data: profile, error: profileError } = await admin
    .from('profiles')
    .select('role, roles, display_name')
    .eq('id', authData.user.id)
    .maybeSingle()
  if (profileError) return json({ error: profileError.message }, 500)

  const isCallerAdmin = profile?.role === 'admin' || (Array.isArray(profile?.roles) && profile.roles.includes('admin'))
  if (!isCallerAdmin) return json({ error: 'Solo un administrador de la institución puede modificar el estado de usuarios.' }, 403)

  const body = (await request.json().catch(() => ({}))) as { userId?: string; action?: 'disable' | 'enable' }
  if (!body.userId || body.userId === authData.user.id) return json({ error: 'No puedes modificar tu propia cuenta.' }, 400)

  const { data: targetProfile } = await admin.from('profiles').select('id, display_name, role').eq('id', body.userId).maybeSingle()
  if (targetProfile?.role === 'admin') return json({ error: 'Las cuentas directivas deben conservarse.' }, 400)

  const action = body.action === 'enable' ? 'enable' : 'disable'
  const banDuration = action === 'enable' ? 'none' : '876000h'

  const { error: banError } = await admin.auth.admin.updateUserById(body.userId, { ban_duration: banDuration })
  if (banError) return json({ error: banError.message }, 500)

  // Registrar evento administrativo en el Libro Digital de Auditoría
  await admin.from('audit_events').insert({
    actor_id: authData.user.id,
    event_type: action === 'enable' ? 'teacher_reactivated' : 'teacher_suspended',
    entity_type: 'user',
    entity_id: body.userId,
    metadata: {
      action: action === 'enable' ? 'access_reactivated' : 'access_suspended',
      teacherName: targetProfile?.display_name ?? 'Docente',
      performedBy: profile?.display_name ?? 'Dirección',
      timestamp: new Date().toISOString(),
    },
  }).catch(() => {})

  return json({
    ok: true,
    userId: body.userId,
    status: action === 'enable' ? 'active' : 'disabled',
    message: action === 'enable'
      ? `Acceso restablecido para ${targetProfile?.display_name ?? 'el docente'}.`
      : `Acceso pausado para ${targetProfile?.display_name ?? 'el docente'}. Sus datos e historial se conservaron.`,
  })
})
