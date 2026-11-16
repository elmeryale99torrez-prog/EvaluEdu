import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

type AnyRecord = Record<string, any>

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function roles(value: unknown, primaryRole: string) {
  const available = Array.isArray(value) ? value.filter((item): item is string => item === 'admin' || item === 'teacher') : []
  return Array.from(new Set([primaryRole, ...available].filter((item) => item === 'admin' || item === 'teacher')))
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') return json({ error: 'Método no permitido.' }, 405)

  const authorization = request.headers.get('Authorization')
  const token = authorization?.replace(/^Bearer\s+/i, '')
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
  const publishableKey = Deno.env.get('SUPABASE_PUBLISHABLE_KEY') ?? Deno.env.get('SUPABASE_ANON_KEY') ?? ''
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  if (!token || !supabaseUrl || !publishableKey || !serviceRoleKey) return json({ error: 'Configuración de servidor incompleta.' }, 500)

  const callerClient = createClient(supabaseUrl, publishableKey, { global: { headers: { Authorization: `Bearer ${token}` } } })
  const { data: authData, error: authError } = await callerClient.auth.getUser(token)
  if (authError || !authData.user) return json({ error: 'Sesión no válida.' }, 401)

  const adminClient = createClient(supabaseUrl, serviceRoleKey)
  const { data: callerProfile, error: profileError } = await adminClient.from('profiles').select('role, roles').eq('id', authData.user.id).maybeSingle()
  if (profileError) return json({ error: profileError.message }, 500)
  const isCallerAdmin = callerProfile?.role === 'admin' || callerProfile?.role === 'superadmin' || roles(callerProfile?.roles, callerProfile?.role ?? '').includes('admin')
  if (!isCallerAdmin) {
    return json({ error: 'Solo un administrador puede consultar estos datos.' }, 403)
  }

  // Determinar si el llamador está restringido a ámbitos institucionales (Director) o es Superadmin SaaS
  const isExplicitSuperadmin =
    callerProfile?.role === 'superadmin' ||
    callerProfile?.role === 'platform_admin' ||
    (Array.isArray(callerProfile?.roles) && (callerProfile.roles.includes('superadmin') || callerProfile.roles.includes('platform_admin')))

  let allowedInstitutionIds: string[] | null = null
  let scopedUserIds: Set<string> | null = null

  if (!isExplicitSuperadmin) {
    const { data: callerMemberships, error: membershipScopeError } = await adminClient
      .from('institution_memberships')
      .select('institution_id, role, status')
      .eq('user_id', authData.user.id)

    const activeDirectorInsts = ((callerMemberships ?? []) as AnyRecord[])
      .filter((m) => m.role === 'admin' && m.status === 'active')
      .map((m) => String(m.institution_id))

    if (membershipScopeError || activeDirectorInsts.length === 0) return json({ error: "No hay un ámbito institucional activo autorizado." }, 403)

    if (activeDirectorInsts.length > 0) {
      allowedInstitutionIds = activeDirectorInsts
      const { data: instMembers } = await adminClient
        .from('institution_memberships')
        .select('user_id, email, institution_id')
        .in('institution_id', allowedInstitutionIds)

      scopedUserIds = new Set<string>([authData.user.id])
      for (const m of (instMembers ?? []) as AnyRecord[]) {
        if (m.user_id) scopedUserIds.add(String(m.user_id))
      }
    }
  }

  // Consultas estrictamente agregadas e institucionales (sin espionaje del aula: no se consultan attempt_answers individuales)
  const [authUsersResult, profileResult, roomCountResult, activityCountResult, templateCountResult, attemptCountResult, auditResult] = await Promise.all([
    adminClient.auth.admin.listUsers({ page: 1, perPage: 1000 }),
    adminClient.from('profiles').select('id, display_name, role, roles, created_at, updated_at'),
    adminClient.from('rooms').select('id, status, owner_id', { count: 'exact' }),
    adminClient.from('activities').select('id', { count: 'exact', head: true }),
    adminClient.from('evaluation_templates').select('id', { count: 'exact', head: true }),
    adminClient.from('attempts').select('id', { count: 'exact', head: true }),
    adminClient.from('audit_events').select('id, actor_id, event_type, entity_type, entity_id, metadata, created_at').order('created_at', { ascending: false }).limit(100),
  ])

  const firstError = [profileResult, roomCountResult, activityCountResult, templateCountResult, attemptCountResult, auditResult].find((result) => result.error)?.error
  if (firstError || authUsersResult.error) return json({ error: firstError?.message ?? authUsersResult.error?.message ?? 'No pudimos cargar los datos administrativos.' }, 500)

  const allProfiles = (profileResult.data ?? []) as AnyRecord[]
  const profiles = scopedUserIds ? allProfiles.filter((p) => scopedUserIds!.has(String(p.id))) : allProfiles
  const profileById = new Map(allProfiles.map((profile) => [profile.id, profile]))

  const authUserById = new Map((authUsersResult.data.users ?? []).map((user) => [user.id, user]))
  const users = profiles.map((profile) => {
    const authUser = authUserById.get(profile.id)
    return {
      id: profile.id,
      email: authUser?.email ?? '',
      displayName: profile.display_name,
      role: profile.role,
      roles: roles(profile.roles, profile.role),
      status: authUser?.banned_until ? 'Bloqueado' : authUser?.email_confirmed_at ? 'Activo' : 'Pendiente',
      createdAt: profile.created_at,
      lastSignInAt: authUser?.last_sign_in_at ?? null,
    }
  })

  const allRawRooms = (roomCountResult.data ?? []) as AnyRecord[]
  const rawRooms = scopedUserIds ? allRawRooms.filter((r) => scopedUserIds!.has(String(r.owner_id))) : allRawRooms
  const activeRooms = rawRooms.filter((r) => r.status === 'active').length
  const totalRooms = scopedUserIds ? rawRooms.length : (roomCountResult.count ?? rawRooms.length)

  // Eventos de auditoría filtrados por ámbito si corresponde (sin calificaciones individuales)
  const rawAudits = (auditResult.data ?? []) as AnyRecord[]
  const scopedAudits = allowedInstitutionIds
    ? rawAudits.filter((ev) => {
        const metaInst = ev.metadata?.institution_id ? String(ev.metadata.institution_id) : null
        if (metaInst && allowedInstitutionIds!.includes(metaInst)) return true
        if (scopedUserIds && ev.actor_id && scopedUserIds.has(String(ev.actor_id))) return true
        return false
      })
    : rawAudits

  const normalizedAudit = scopedAudits.map((event) => ({
    id: event.id,
    eventType: event.event_type,
    actorName: profileById.get(event.actor_id)?.display_name ?? 'Sistema',
    createdAt: event.created_at,
    metadata: event.metadata ?? {},
  }))

  return json({
    ok: true,
    loadedAt: new Date().toISOString(),
    scope: allowedInstitutionIds ? 'institution' : 'platform',
    institutionIds: allowedInstitutionIds,
    users,
    // Cero espionaje de aula: no se retornan respuestas ni notas individuales
    attempts: [],
    rooms: [],
    auditEvents: normalizedAudit,
    metrics: {
      users: users.length,
      totalRooms,
      activeRooms,
      publishedActivities: activityCountResult.count ?? 0,
      templates: templateCountResult.count ?? 0,
      totalAttempts: attemptCountResult.count ?? 0,
    },
  })
})
