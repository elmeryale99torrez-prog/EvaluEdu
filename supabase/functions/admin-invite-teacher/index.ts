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

function validateRedirectTo(value: unknown): string | undefined | null {
  if (typeof value !== 'string' || !value.trim()) return undefined
  try {
    const target = new URL(value.trim())
    if (!['http:', 'https:'].includes(target.protocol)) return null
    const configuredAppUrl = Deno.env.get('APP_URL')?.trim()
    if (configuredAppUrl) {
      const configured = new URL(configuredAppUrl)
      return target.origin === configured.origin ? target.toString() : null
    }
    const productionOrigin = 'https://elmeryale99torrez-prog.github.io'
    if (target.origin === productionOrigin) return target.toString()
    if (target.origin === 'https://evaluedu.elmer-yale99-torrez.chatgpt.site') return target.toString()
    const isLocalHost = ['localhost', '127.0.0.1'].includes(target.hostname)
    const isPrivateLan = target.hostname.startsWith('192.168.') || target.hostname.startsWith('10.') || target.hostname.startsWith('172.16.') || target.hostname.startsWith('172.17.') || target.hostname.startsWith('172.18.') || target.hostname.startsWith('172.19.') || target.hostname.startsWith('172.2') || target.hostname.startsWith('172.30.') || target.hostname.startsWith('172.31.')
    return (isLocalHost || isPrivateLan) ? target.toString() : null
  } catch {
    return null
  }
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

  const { data: callerProfile, error: profileError } = await callerClient
    .from('profiles')
    .select('role, roles')
    .eq('id', authData.user.id)
    .maybeSingle()
  if (profileError) return json({ error: profileError.message }, 500)
  const isCallerAdmin = callerProfile?.role === 'admin' || callerProfile?.role === 'superadmin' || (Array.isArray(callerProfile?.roles) && (callerProfile.roles.includes('admin') || callerProfile.roles.includes('superadmin')))
  if (!isCallerAdmin) return json({ error: 'Solo un administrador puede invitar usuarios.' }, 403)

  let body: { email?: unknown; displayName?: unknown; redirectTo?: unknown; institutionId?: unknown }
  try {
    body = await request.json()
  } catch {
    return json({ error: 'El cuerpo de la solicitud no es válido.' }, 400)
  }

  const email = String(body.email ?? '').trim().toLowerCase()
  const displayName = String(body.displayName ?? '').trim()
  const redirectTo = validateRedirectTo(body.redirectTo)
  const requestedInstId = typeof body.institutionId === 'string' && body.institutionId.trim() ? body.institutionId.trim() : null

  if (!email || !/^\S+@\S+\.\S+$/.test(email)) return json({ error: 'Escribe un correo electrónico válido.' }, 400)
  if (displayName.length < 2) return json({ error: 'Escribe el nombre visible del docente.' }, 400)
  if (redirectTo === null) return json({ error: 'La dirección de acceso no está permitida. Configura APP_URL o usa la URL local de EvaluEdu.' }, 400)

  const adminClient = createClient(supabaseUrl, serviceRoleKey)

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
        return json({ error: 'No tienes permisos para invitar docentes en una institución ajena.' }, 403)
      }
      if (!targetInstitutionId) {
        targetInstitutionId = activeDirInsts[0]
      }
    }
  }

  // Si aplica ámbito institucional, verificar/reservar cupo antes de emitir invitación Auth
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

  const { data: invitation, error: invitationError } = await adminClient.auth.admin.inviteUserByEmail(email, {
    ...(redirectTo ? { redirectTo } : {}),
    data: { display_name: displayName },
  })
  if (invitationError || !invitation.user) {
    return json({ error: invitationError?.message ?? 'No se pudo enviar la invitación.' }, 400)
  }

  const { error: invitationStateError } = await adminClient.auth.admin.updateUserById(invitation.user.id, {
    app_metadata: { ...(invitation.user.app_metadata ?? {}), invitation_pending: true },
  })
  if (invitationStateError) {
    return json({ error: 'La invitación fue enviada, pero no se pudo marcar como pendiente de activación.', detail: invitationStateError.message }, 500)
  }

  const { error: insertError } = await adminClient.from('profiles').insert({
    id: invitation.user.id,
    display_name: displayName,
    role: 'teacher',
    roles: ['teacher'],
  })

  if (insertError) {
    return json({
      error: 'La invitación fue enviada, pero no se pudo crear el perfil docente.',
      detail: insertError.message,
      userId: invitation.user.id,
      profileCreated: false,
    }, 500)
  }

  // Registrar evento administrativo en el Libro Digital de Auditoría
  // RC-FIX-01 (LAB-RC-001): PostgrestBuilder no expone .catch(); se inspecciona el error devuelto.
  const { error: auditError } = await adminClient.from('audit_events').insert({
    actor_id: authData.user.id,
    event_type: 'teacher_invited',
    entity_type: 'user',
    entity_id: invitation.user.id,
    metadata: {
      action: 'teacher_invitation_sent',
      email,
      displayName,
      institution_id: targetInstitutionId,
      timestamp: new Date().toISOString(),
    },
  })
  if (auditError) console.warn('audit_events insert failed', auditError.message)

  return json({ ok: true, userId: invitation.user.id, email, institutionId: targetInstitutionId, status: 'reserved', profileCreated: true }, 201)
})
