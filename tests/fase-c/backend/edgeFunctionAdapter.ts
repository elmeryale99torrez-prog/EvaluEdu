import { vi } from 'vitest'
import crypto from 'crypto'

export type RequestHandler = (request: Request) => Promise<Response>

export interface MockDbStore {
  rooms: Map<string, any>
  roomActivities: Map<string, any[]>
  activities: Map<string, any>
  participants: Map<string, any>
  attempts: Map<string, any>
  attemptAnswers: any[]
  profiles: Map<string, any>
  auditEvents: any[]
  evaluationTemplates: Map<string, any>
  authUsers: any[]
  rpcCalls: Array<{ fn: string; args: any }>
  failSnapshotUpdate?: boolean | ((participantId: string) => boolean)
  onBeforeSnapshotUpdate?: (participantId: string, candidateSnapshot: any) => void
}

export function createMockDbStore(): MockDbStore {
  return {
    rooms: new Map(),
    roomActivities: new Map(),
    activities: new Map(),
    participants: new Map(),
    attempts: new Map(),
    attemptAnswers: [],
    profiles: new Map(),
    auditEvents: [],
    evaluationTemplates: new Map(),
    authUsers: [],
    rpcCalls: [],
    failSnapshotUpdate: false,
    onBeforeSnapshotUpdate: undefined,
  }
}

let activeMockStore: MockDbStore | null = null
let activeAuthUser: any = null

export const VALID_ROOM_PARTICIPANT_STATUSES = new Set([
  'joined',
  'in_progress',
  'completed',
  'abandoned',
])

function buildRoomParticipantsStatusCheckError() {
  return {
    code: '23514',
    message:
      'new row for relation "room_participants" violates check constraint "room_participants_status_check"',
  }
}

// Guard contra tráfico de red no autorizado
const originalFetch = globalThis.fetch
let networkGuardInstalled = false

export function installNetworkGuard() {
  if (networkGuardInstalled) return
  networkGuardInstalled = true
  globalThis.fetch = ((input: any, _init?: any) => {
    let rawUrl: string
    if (typeof input === 'string') {
      rawUrl = input
    } else if (input instanceof URL) {
      rawUrl = input.href
    } else if (typeof Request !== 'undefined' && input instanceof Request) {
      rawUrl = input.url
    } else {
      rawUrl = String(input?.url ?? input)
    }

    let parsed: URL
    try {
      parsed = new URL(rawUrl)
    } catch {
      throw new Error(`RED NO AUTORIZADA: URL no parseable o malformada "${rawUrl}" en arnés de Fase C.`)
    }

    const hostname = parsed.hostname.toLowerCase()
    const isLocalhost = hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1'

    if (!isLocalhost) {
      throw new Error(`RED NO AUTORIZADA: Intento de fetch externo detectado hacia host no local "${parsed.hostname}" (URL: "${rawUrl}") en el arnés de Fase C.`)
    }

    throw new Error(`RED NO AUTORIZADA: Conexión de red no simulada interceptada hacia "${rawUrl}". Toda prueba debe ejecutarse en memoria.`)
  }) as typeof globalThis.fetch
}

export function restoreNetworkGuard() {
  if (!networkGuardInstalled) return
  networkGuardInstalled = false
  globalThis.fetch = originalFetch
}

export function buildMockSupabaseClient(store: MockDbStore, authUser: any = null) {
  return {
    auth: {
      getUser: vi.fn(async (token: string) => {
        if (!token) return { data: { user: null }, error: { message: 'Token requerido' } }
        return { data: { user: authUser ?? { id: '550e8400-e29b-41d4-a716-446655440099', is_anonymous: true } }, error: null }
      }),
      admin: {
        listUsers: vi.fn(async () => {
          return { data: { users: store.authUsers }, error: null }
        }),
        createUser: vi.fn(async (payload: any) => {
          const newUser = {
            id: crypto.randomUUID(),
            email: payload.email,
            email_confirmed_at: new Date().toISOString(),
            user_metadata: payload.user_metadata ?? {},
          }
          store.authUsers.push(newUser)
          return { data: { user: newUser }, error: null }
        }),
        updateUserById: vi.fn(async (id: string, updates: any) => {
          const user = store.authUsers.find((u) => u.id === id)
          if (user) {
            Object.assign(user, updates)
            return { data: { user }, error: null }
          }
          return { data: null, error: { message: 'Usuario no encontrado' } }
        }),
      },
    },
    rpc: vi.fn(async (fnName: string, args: any) => {
      store.rpcCalls.push({ fn: fnName, args })
      if (fnName === 'submit_student_attempt_atomic') {
        const participantId = String(args.p_participant_id ?? '')
        const existing = store.attempts.get(participantId)
        if (existing) {
          return {
            data: {
              ok: true,
              attemptId: existing.id,
              alreadySaved: true,
              score: existing.score,
              maxScore: existing.max_score,
              answeredCount: existing.answered_count,
              omittedCount: existing.omitted_count,
              correctCount: existing.correct_count,
            },
            error: null,
          }
        }
        const newAttemptId = crypto.randomUUID()
        store.attempts.set(participantId, {
          id: newAttemptId,
          room_id: args.p_room_id,
          participant_id: participantId,
          score: Number(args.p_score ?? 0),
          max_score: Number(args.p_max_score ?? 0),
          total_questions: Number(args.p_total_questions ?? 0),
          answered_count: Number(args.p_answered_count ?? 0),
          omitted_count: Number(args.p_omitted_count ?? 0),
          correct_count: Number(args.p_correct_count ?? 0),
          status: args.p_status,
        })
        return {
          data: {
            ok: true,
            attemptId: newAttemptId,
            alreadySaved: false,
            score: args.p_score,
            maxScore: args.p_max_score,
            answeredCount: args.p_answered_count,
            omittedCount: args.p_omitted_count,
            correctCount: args.p_correct_count,
          },
          error: null,
        }
      }
      return { data: { ok: true, attemptId: crypto.randomUUID() }, error: null }
    }),
    from: (table: string) => {
      let currentTable = table
      let filterEq: Record<string, any> = {}
      let filterIn: Record<string, any[]> = {}
      let filterGt: Record<string, any> = {}
      let filterNeq: Record<string, any> = {}
      let filterIs: Record<string, any> = {}
      let orderCol: string | null = null
      let orderAsc = true
      let isCountHead = false
      let queryLimit: number | null = null

      const queryBuilder: any = {
        select: vi.fn((_fields?: string, opts?: any) => {
          if (opts?.head && opts?.count === 'exact') {
            isCountHead = true
          }
          return queryBuilder
        }),
        eq: vi.fn((col: string, val: any) => {
          filterEq[col] = val
          return queryBuilder
        }),
        gt: vi.fn((col: string, val: any) => {
          filterGt[col] = val
          return queryBuilder
        }),
        neq: vi.fn((col: string, val: any) => {
          filterNeq[col] = val
          return queryBuilder
        }),
        is: vi.fn((col: string, val: any) => {
          filterIs[col] = val
          return queryBuilder
        }),
        in: vi.fn((col: string, vals: any[]) => {
          filterIn[col] = vals
          return queryBuilder
        }),
        limit: vi.fn((num: number) => {
          queryLimit = num
          return queryBuilder
        }),
        order: vi.fn((col: string, opts?: { ascending?: boolean }) => {
          orderCol = col
          orderAsc = opts?.ascending !== false
          return queryBuilder
        }),
        single: vi.fn(() => {
          return queryBuilder.then ? queryBuilder : Promise.resolve(queryBuilder.execute())
        }),
        maybeSingle: vi.fn(() => {
          return queryBuilder.then ? queryBuilder : Promise.resolve(queryBuilder.execute())
        }),
        upsert: vi.fn((data: any) => {
          if (table === 'profiles') {
            const existing = store.profiles.get(data.id) ?? {}
            const merged = { ...existing, ...data }
            store.profiles.set(data.id, merged)
            return Promise.resolve({ data: merged, error: null })
          }
          return Promise.resolve({ data, error: null })
        }),
        insert: vi.fn((data: any) => {
          if (table === 'room_participants') {
            const effectiveStatus = data.status ?? 'joined'
            if (typeof effectiveStatus !== 'string' || !VALID_ROOM_PARTICIPANT_STATUSES.has(effectiveStatus)) {
              const errResult = { data: null, error: buildRoomParticipantsStatusCheckError() }
              const errBuilder: any = {
                select: () => errBuilder,
                single: async () => errResult,
                maybeSingle: async () => errResult,
                then: (resolve: any, reject: any) => Promise.resolve(errResult).then(resolve, reject),
              }
              return errBuilder
            }
            const row = {
              id: data.id ?? crypto.randomUUID(),
              ...data,
              status: effectiveStatus,
              joined_at: new Date().toISOString(),
              last_seen_at: new Date().toISOString(),
              guest_token_expires_at: data.guest_token_expires_at ?? new Date(Date.now() + 6 * 3600 * 1000).toISOString(),
            }
            store.participants.set(row.id, row)
            const okResult = { data: { ...row }, error: null }
            const okBuilder: any = {
              select: () => okBuilder,
              single: async () => okResult,
              maybeSingle: async () => okResult,
              then: (resolve: any, reject: any) => Promise.resolve(okResult).then(resolve, reject),
            }
            return okBuilder
          }
          if (table === 'attempts') {
            const row = {
              id: data.id ?? crypto.randomUUID(),
              ...data,
            }
            store.attempts.set(row.id, row)
            return {
              select: () => ({
                single: async () => ({ data: row, error: null }),
              }),
            }
          }
          if (table === 'attempt_answers') {
            if (Array.isArray(data)) {
              store.attemptAnswers.push(...data)
            } else {
              store.attemptAnswers.push(data)
            }
            return Promise.resolve({ data, error: null })
          }
          if (table === 'audit_events') {
            const row = { id: crypto.randomUUID(), ...data, created_at: new Date().toISOString() }
            store.auditEvents.push(row)
            return Promise.resolve({ data: row, error: null })
          }
          return queryBuilder
        }),
        update: vi.fn((data: any) => {
          const updateEq: Record<string, any> = {}
          const updateIs: Record<string, any> = {}
          let cachedUpdateResult: { data: any; error: any } | null = null

          const executeUpdate = (): { data: any; error: any } => {
            if (cachedUpdateResult) return cachedUpdateResult

            if (table === 'room_participants') {
              if (
                'status' in data &&
                (typeof data.status !== 'string' || !VALID_ROOM_PARTICIPANT_STATUSES.has(data.status))
              ) {
                cachedUpdateResult = {
                  data: null,
                  error: buildRoomParticipantsStatusCheckError(),
                }
                return cachedUpdateResult
              }

              const targetId = String(updateEq['id'] ?? '')
              if ('activities_snapshot' in data) {
                store.onBeforeSnapshotUpdate?.(targetId, data.activities_snapshot)
                const shouldFail =
                  typeof store.failSnapshotUpdate === 'function'
                    ? store.failSnapshotUpdate(targetId)
                    : Boolean(store.failSnapshotUpdate)
                if (shouldFail) {
                  cachedUpdateResult = {
                    data: null,
                    error: { message: 'Error simulado al persistir activities_snapshot' },
                  }
                  return cachedUpdateResult
                }
              }

              let list = Array.from(store.participants.values())
              for (const [col, val] of Object.entries(updateEq)) {
                list = list.filter((row) => row[col] === val)
              }
              for (const [col, val] of Object.entries(updateIs)) {
                if (val === null) {
                  list = list.filter((row) => row[col] === null || row[col] === undefined)
                } else {
                  list = list.filter((row) => row[col] === val)
                }
              }

              if (list.length > 0) {
                for (const row of list) {
                  Object.assign(row, data)
                }
                cachedUpdateResult = { data: { ...list[0] }, error: null }
                return cachedUpdateResult
              }
            }

            cachedUpdateResult = { data: null, error: null }
            return cachedUpdateResult
          }

          const updateObj: any = {
            eq: vi.fn((col: string, val: any) => {
              updateEq[col] = val
              return updateObj
            }),
            is: vi.fn((col: string, val: any) => {
              updateIs[col] = val
              return updateObj
            }),
            select: vi.fn(() => updateObj),
            single: vi.fn(() => Promise.resolve(executeUpdate())),
            maybeSingle: vi.fn(() => Promise.resolve(executeUpdate())),
          }
          updateObj.then = (resolve: any, reject: any) => {
            try {
              resolve(executeUpdate())
            } catch (err) {
              reject?.(err)
            }
          }
          return updateObj
        }),
        delete: vi.fn(() => ({
          eq: (col: string, val: any) => {
            if (table === 'attempts' && col === 'id') {
              store.attempts.delete(val)
            }
            if (table === 'room_participants' && col === 'id') {
              store.participants.delete(val)
            }
            return Promise.resolve({ error: null })
          },
        })),

        execute: () => {
          if (currentTable === 'rooms') {
            const code = filterEq['code']
            const id = filterEq['id']
            if (code) {
              const room = Array.from(store.rooms.values()).find((r) => r.code === code)
              return { data: room ?? null, error: null }
            }
            if (id) {
              const room = store.rooms.get(id)
              return { data: room ?? null, error: null }
            }
            const allRooms = Array.from(store.rooms.values())
            return { data: allRooms, count: allRooms.length, error: null }
          }

          if (currentTable === 'room_activities') {
            const roomId = filterEq['room_id']
            let links = [...(store.roomActivities.get(roomId) ?? [])]
            if (orderCol) {
              links.sort((a, b) => {
                const valA = a[orderCol!]
                const valB = b[orderCol!]
                return orderAsc ? (valA > valB ? 1 : valA < valB ? -1 : 0) : (valA < valB ? 1 : valA > valB ? -1 : 0)
              })
            }
            return { data: links, error: null }
          }

          if (currentTable === 'activities') {
            const inIds = filterIn['id']
            let result: any[] = []
            if (inIds) {
              result = inIds.map((id) => store.activities.get(id)).filter(Boolean)
            } else {
              result = Array.from(store.activities.values())
            }
            if (isCountHead) {
              return { count: result.length, error: null }
            }
            return { data: result, count: result.length, error: null }
          }

          if (currentTable === 'evaluation_templates') {
            const result = Array.from(store.evaluationTemplates.values())
            if (isCountHead) {
              return { count: result.length, error: null }
            }
            return { data: result, count: result.length, error: null }
          }

          if (currentTable === 'profiles') {
            const id = filterEq['id']
            if (id) {
              const profile = store.profiles.get(id)
              return { data: profile ?? null, error: null }
            }
            const allProfiles = Array.from(store.profiles.values())
            return { data: allProfiles, error: null }
          }

          if (currentTable === 'audit_events') {
            let list = [...store.auditEvents]
            if (queryLimit && list.length > queryLimit) {
              list = list.slice(0, queryLimit)
            }
            return { data: list, error: null }
          }

          if (currentTable === 'room_participants') {
            let list = Array.from(store.participants.values())
            for (const [col, val] of Object.entries(filterEq)) {
              list = list.filter((p) => p[col] === val)
            }
            for (const [col, val] of Object.entries(filterNeq)) {
              list = list.filter((p) => p[col] !== val)
            }
            for (const [col, val] of Object.entries(filterIs)) {
              if (val === null) {
                list = list.filter((p) => p[col] === null || p[col] === undefined)
              } else {
                list = list.filter((p) => p[col] === val)
              }
            }
            for (const [col, val] of Object.entries(filterGt)) {
              list = list.filter((p) => {
                const pVal = p[col]
                if (!pVal) return false
                const timeP = Date.parse(pVal)
                const timeVal = Date.parse(val)
                if (!isNaN(timeP) && !isNaN(timeVal)) {
                  return timeP > timeVal
                }
                return pVal > val
              })
            }
            if (isCountHead) {
              return { count: list.length, error: null }
            }
            return { data: list[0] ? { ...list[0] } : null, error: null }
          }

          if (currentTable === 'attempts') {
            const partId = filterEq['participant_id']
            if (partId) {
              const attempt = Array.from(store.attempts.values()).find((a) => a.participant_id === partId)
              return { data: attempt ?? null, error: null }
            }
            const allAttempts = Array.from(store.attempts.values())
            if (isCountHead) {
              return { count: allAttempts.length, error: null }
            }
            return { data: allAttempts, count: allAttempts.length, error: null }
          }

          return { data: null, error: null }
        },
      }

      queryBuilder.then = (resolve: any, reject: any) => {
        try {
          resolve(queryBuilder.execute())
        } catch (e) {
          reject(e)
        }
      }

      return queryBuilder
    },
  }
}

vi.mock('@supabase/supabase-js', () => {
  return {
    createClient: () => {
      const store = activeMockStore ?? createMockDbStore()
      return buildMockSupabaseClient(store, activeAuthUser)
    },
  }
})

let capturedGuestHandler: RequestHandler | null = null
let capturedSyncHandler: RequestHandler | null = null
let capturedPlatformDataHandler: RequestHandler | null = null
let capturedCreatePilotTeacherHandler: RequestHandler | null = null
let capturedRemoveUserHandler: RequestHandler | null = null

export async function loadPhaseCEdgeFunctions(): Promise<{
  guestHandler: RequestHandler
  syncHandler: RequestHandler
  platformDataHandler: RequestHandler
  createPilotTeacherHandler: RequestHandler
  removeUserHandler: RequestHandler
}> {
  if (capturedGuestHandler && capturedSyncHandler && capturedPlatformDataHandler && capturedCreatePilotTeacherHandler && capturedRemoveUserHandler) {
    return {
      guestHandler: capturedGuestHandler,
      syncHandler: capturedSyncHandler,
      platformDataHandler: capturedPlatformDataHandler,
      createPilotTeacherHandler: capturedCreatePilotTeacherHandler,
      removeUserHandler: capturedRemoveUserHandler,
    }
  }

  let currentServeCallback: ((handler: RequestHandler) => void) | null = null

  ;(globalThis as any).Deno = {
    serve: (handler: RequestHandler) => {
      if (currentServeCallback) {
        currentServeCallback(handler)
      }
    },
    env: {
      get: (key: string) => {
        if (key === 'SUPABASE_URL') return 'https://mock-test.supabase.co'
        if (key === 'SUPABASE_SERVICE_ROLE_KEY') return 'mock-service-role-key-secret'
        if (key === 'SUPABASE_ANON_KEY' || key === 'SUPABASE_PUBLISHABLE_KEY') return 'mock-anon-key'
        return ''
      },
    },
  }

  // Cargar student-room-guest
  await new Promise<void>((resolve, reject) => {
    currentServeCallback = (handler) => {
      capturedGuestHandler = handler
      resolve()
    }
    import('../../../supabase/functions/student-room-guest/index.ts').catch(reject)
  })

  // Cargar student-room-sync
  await new Promise<void>((resolve, reject) => {
    currentServeCallback = (handler) => {
      capturedSyncHandler = handler
      resolve()
    }
    import('../../../supabase/functions/student-room-sync/index.ts').catch(reject)
  })

  // Cargar admin-platform-data
  await new Promise<void>((resolve, reject) => {
    currentServeCallback = (handler) => {
      capturedPlatformDataHandler = handler
      resolve()
    }
    import('../../../supabase/functions/admin-platform-data/index.ts').catch(reject)
  })

  // Cargar admin-create-pilot-teacher
  await new Promise<void>((resolve, reject) => {
    currentServeCallback = (handler) => {
      capturedCreatePilotTeacherHandler = handler
      resolve()
    }
    import('../../../supabase/functions/admin-create-pilot-teacher/index.ts').catch(reject)
  })

  // Cargar admin-remove-user
  await new Promise<void>((resolve, reject) => {
    currentServeCallback = (handler) => {
      capturedRemoveUserHandler = handler
      resolve()
    }
    import('../../../supabase/functions/admin-remove-user/index.ts').catch(reject)
  })

  return {
    guestHandler: capturedGuestHandler!,
    syncHandler: capturedSyncHandler!,
    platformDataHandler: capturedPlatformDataHandler!,
    createPilotTeacherHandler: capturedCreatePilotTeacherHandler!,
    removeUserHandler: capturedRemoveUserHandler!,
  }
}

export function setActiveMockDbStore(store: MockDbStore, authUser: any = null) {
  activeMockStore = store
  activeAuthUser = authUser
}

export async function executeGuestSubmission(
  guestHandler: RequestHandler,
  room: any,
  responses: any[],
  clientIp = '192.168.1.100',
  displayName = 'Estudiante Guest'
): Promise<{
  joinStatus: number
  joinData: any
  submitStatus: number
  submitData: any
  lastRpc: any
}> {
  const joinReq = new Request('http://localhost/student-room-guest', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-forwarded-for': clientIp },
    body: JSON.stringify({
      action: 'join',
      code: room.code,
      displayName,
    }),
  })
  const joinRes = await guestHandler(joinReq)
  const joinStatus = joinRes.status
  const joinData = await joinRes.json()

  if (!joinData.ok) {
    return { joinStatus, joinData, submitStatus: 0, submitData: null, lastRpc: null }
  }

  const submitReq = new Request('http://localhost/student-room-guest', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-forwarded-for': clientIp },
    body: JSON.stringify({
      action: 'submit_attempt',
      code: room.code,
      roomId: room.id,
      participantId: joinData.participant?.id ?? joinData.participantId,
      guestToken: joinData.guestToken,
      attempt: {
        startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
      },
      responses,
    }),
  })
  const submitRes = await guestHandler(submitReq)
  const submitStatus = submitRes.status
  const submitData = await submitRes.json()

  const lastRpc = activeMockStore?.rpcCalls.find((c) => c.fn === 'submit_student_attempt_atomic')

  return { joinStatus, joinData, submitStatus, submitData, lastRpc }
}

export async function executeSyncSubmission(
  syncHandler: RequestHandler,
  room: any,
  responses: any[],
  authUser = { id: '550e8400-e29b-41d4-a716-446655440099', is_anonymous: true },
  displayName = 'Estudiante Sync'
): Promise<{
  joinStatus: number
  joinData: any
  submitStatus: number
  submitData: any
  lastRpc: any
}> {
  setActiveMockDbStore(activeMockStore!, authUser)

  const joinReq = new Request('http://localhost/student-room-sync', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer mock-anon-jwt-token',
    },
    body: JSON.stringify({
      action: 'join',
      code: room.code,
      displayName,
    }),
  })
  const joinRes = await syncHandler(joinReq)
  const joinStatus = joinRes.status
  const joinData = await joinRes.json()

  if (!joinData.ok) {
    return { joinStatus, joinData, submitStatus: 0, submitData: null, lastRpc: null }
  }

  const submitReq = new Request('http://localhost/student-room-sync', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer mock-anon-jwt-token',
    },
    body: JSON.stringify({
      action: 'submit_attempt',
      code: room.code,
      roomId: room.id,
      participantId: joinData.participant?.id ?? joinData.participantId,
      attempt: {
        startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
      },
      responses,
    }),
  })
  const submitRes = await syncHandler(submitReq)
  const submitStatus = submitRes.status
  const submitData = await submitRes.json()

  const lastRpc = activeMockStore?.rpcCalls.find((c) => c.fn === 'submit_student_attempt_atomic')

  return { joinStatus, joinData, submitStatus, submitData, lastRpc }
}
