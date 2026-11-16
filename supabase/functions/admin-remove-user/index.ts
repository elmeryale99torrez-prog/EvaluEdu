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

  const isCallerAdmin = profile?.role === 'admin' || profile?.role === 'superadmin' || (Array.isArray(profile?.roles) && (profile.roles.includes('admin') || profile.roles.includes('superadmin')))
  if (!isCallerAdmin) return json({ error: 'Solo un administrador de la institución puede modificar el estado de usuarios.' }, 403)

  const body = (await request.json().catch(() => ({}))) as { userId?: string; action?: 'disable' | 'enable'; institutionId?: string }
  if (!body.userId || body.userId === authData.user.id) return json({ error: 'No puedes modificar tu propia cuenta.' }, 400)

  const { data: targetProfile } = await admin.from('profiles').select('id, display_name, role, roles').eq('id', body.userId).maybeSingle()
  const isTargetAdmin = targetProfile?.role === 'admin' || targetProfile?.role === 'superadmin' || (Array.isArray(targetProfile?.roles) && (targetProfile.roles.includes('admin') || targetProfile.roles.includes('superadmin')))
  if (isTargetAdmin) return json({ error: 'Las cuentas directivas deben conservarse.' }, 400)

  const action = body.action === 'enable' ? 'enable' : 'disable'

  // Verificar alcance institucional si el llamador es director local
  const isExplicitSuperadmin =
    profile?.role === 'superadmin' ||
    profile?.role === 'platform_admin' ||
    (Array.isArray(profile?.roles) && (profile.roles.includes('superadmin') || profile.roles.includes('platform_admin')))

  const { data: targetMems } = await admin
    .from('institution_memberships')
    .select('id, institution_id, role, status')
    .eq('user_id', body.userId)

  const allTargetMems = (targetMems ?? []) as Array<Record<string, unknown>>

  if (!isExplicitSuperadmin) {
    const { data: callerMems, error: membershipScopeError } = await admin
      .from('institution_memberships')
      .select('institution_id, role, status')
      .eq('user_id', authData.user.id)

    const activeDirInsts = ((callerMems ?? []) as Array<Record<string, unknown>>)
      .filter((m) => m.role === 'admin' && m.status === 'active')
      .map((m) => String(m.institution_id))

    if (membershipScopeError || activeDirInsts.length === 0) return json({ error: "No hay un ámbito institucional activo autorizado." }, 403)

    if (activeDirInsts.length > 0) {
      const matchingMems = allTargetMems.filter((m) => activeDirInsts.includes(String(m.institution_id)))
      if (matchingMems.length === 0) {
        return json({ error: 'No tienes permisos para alterar un docente de otra institución.' }, 403)
      }
      // Aplicar toggle transaccional de membresía en la institución del director
      for (const m of matchingMems) {
        const { data: toggleRes, error: toggleErr } = await caller.rpc('toggle_institution_membership_status', {
          p_membership_id: String(m.id),
          p_action: action,
        })
        if (toggleErr) return json({ error: toggleErr.message }, 403)
        const tObj = toggleRes as Record<string, unknown> | null
        if (tObj && tObj.ok === false) {
          return json({ error: String(tObj.message ?? 'No se pudo cambiar el estado de la membresía.'), code: tObj.error }, 409)
        }
      }
    }
  } else if (allTargetMems.length > 0) {
    const filteredMems = body.institutionId
      ? allTargetMems.filter((m) => String(m.institution_id) === body.institutionId)
      : allTargetMems
    for (const m of filteredMems) {
      const { data: toggleRes, error: toggleErr } = await caller.rpc('toggle_institution_membership_status', {
        p_membership_id: String(m.id),
        p_action: action,
      })
      if (toggleErr) return json({ error: toggleErr.message }, 403)
      const tObj = toggleRes as Record<string, unknown> | null
      if (tObj && tObj.ok === false) {
        return json({ error: String(tObj.message ?? 'No se pudo cambiar el estado de la membresía.'), code: tObj.error }, 409)
      }
    }
  }

  // No banear globalmente si el usuario aún mantiene membresías activas en otra institución
  let shouldUpdateGlobalBan = true
  if (action === 'disable' && allTargetMems.length > 1) {
    const { data: remainingActive } = await admin
      .from('institution_memberships')
      .select('id')
      .eq('user_id', body.userId)
      .eq('status', 'active')
    if (remainingActive && remainingActive.length > 0) {
      shouldUpdateGlobalBan = false
    }
  }

  if (shouldUpdateGlobalBan) {
    const banDuration = action === 'enable' ? 'none' : '876000h'
    const { error: banError } = await admin.auth.admin.updateUserById(body.userId, { ban_duration: banDuration })
    if (banError) return json({ error: banError.message }, 500)
  }

  // Registrar evento administrativo en el Libro Digital de Auditoría
  // RC-FIX-01 (LAB-RC-001): PostgrestBuilder no expone .catch(); se inspecciona el error devuelto.
  const { error: auditError } = await admin.from('audit_events').insert({
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
  })
  if (auditError) console.warn('audit_events insert failed', auditError.message)

  return json({
    ok: true,
    userId: body.userId,
    status: action === 'enable' ? 'active' : 'disabled',
    message: action === 'enable'
      ? `Acceso restablecido para ${targetProfile?.display_name ?? 'el docente'}.`
      : `Acceso pausado para ${targetProfile?.display_name ?? 'el docente'}. Sus datos e historial se conservaron.`,
  })
})
