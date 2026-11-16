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
  rpcCalls: Array<{ fn: string; args: any }>
}

export function createMockDbStore(): MockDbStore {
  return {
    rooms: new Map(),
    roomActivities: new Map(),
    activities: new Map(),
    participants: new Map(),
    attempts: new Map(),
    attemptAnswers: [],
    rpcCalls: [],
  }
}

let activeMockStore: MockDbStore | null = null
let activeAuthUser: any = null

// Guard contra tráfico de red no autorizado
const originalFetch = globalThis.fetch
let networkGuardInstalled = false

export function installNetworkGuard() {
  if (networkGuardInstalled) return
  networkGuardInstalled = true
  globalThis.fetch = ((input: any, init?: any) => {
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
      throw new Error(`RED NO AUTORIZADA: URL no parseable o malformada "${rawUrl}" en arnés de Fase B.`)
    }

    const hostname = parsed.hostname.toLowerCase()
    const isLocalhost = hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1'

    if (!isLocalhost) {
      throw new Error(`RED NO AUTORIZADA: Intento de fetch externo detectado hacia host no local "${parsed.hostname}" (URL: "${rawUrl}") en el arnés de Fase B.`)
    }

    // Aislamiento absoluto: el arnés de Fase B prohíbe conexiones TCP reales incluso a localhost.
    // Todas las invocaciones a Edge Functions se ejecutan directamente en memoria invocando los handlers capturados.
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
    },
    rpc: vi.fn(async (fnName: string, args: any) => {
      store.rpcCalls.push({ fn: fnName, args })
      return { data: { ok: true, attemptId: crypto.randomUUID() }, error: null }
    }),
    from: (table: string) => {
      let currentTable = table
      let filterEq: Record<string, any> = {}
      let filterIn: Record<string, any[]> = {}
      let filterGt: Record<string, any> = {}
      let filterNeq: Record<string, any> = {}
      let orderCol: string | null = null
      let orderAsc = true
      let isCountHead = false

      const queryBuilder: any = {
        select: vi.fn((fields?: string, opts?: any) => {
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
        in: vi.fn((col: string, vals: any[]) => {
          filterIn[col] = vals
          return queryBuilder
        }),
        order: vi.fn((col: string, opts?: { ascending?: boolean }) => {
          orderCol = col
          orderAsc = opts?.ascending !== false
          return queryBuilder
        }),
        single: vi.fn(() => {
          return queryBuilder.then
            ? queryBuilder
            : Promise.resolve(queryBuilder.execute())
        }),
        maybeSingle: vi.fn(() => {
          return queryBuilder.then
            ? queryBuilder
            : Promise.resolve(queryBuilder.execute())
        }),
        insert: vi.fn((data: any) => {
          if (table === 'room_participants') {
            const row = {
              id: data.id ?? crypto.randomUUID(),
              ...data,
              joined_at: new Date().toISOString(),
              last_seen_at: new Date().toISOString(),
              guest_token_expires_at: data.guest_token_expires_at ?? new Date(Date.now() + 6 * 3600 * 1000).toISOString(),
            }
            store.participants.set(row.id, row)
            return {
              select: () => ({
                single: async () => ({ data: row, error: null }),
              }),
            }
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
          return queryBuilder
        }),
        update: vi.fn((data: any) => ({
          eq: (col: string, val: any) => {
            if (table === 'room_participants' && col === 'id') {
              const existing = store.participants.get(val)
              if (existing) {
                Object.assign(existing, data)
              }
            }
            return Promise.resolve({ error: null })
          },
        })),
        delete: vi.fn(() => ({
          eq: (col: string, val: any) => {
            if (table === 'attempts' && col === 'id') {
              store.attempts.delete(val)
            }
            return Promise.resolve({ error: null })
          },
        })),

        execute: () => {
          if (currentTable === 'rooms') {
            const code = filterEq['code']
            const id = filterEq['id']
            let room: any = null
            if (code) {
              room = Array.from(store.rooms.values()).find((r) => r.code === code)
            } else if (id) {
              room = store.rooms.get(id)
            }
            return { data: room, error: null }
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
            return { data: result, error: null }
          }

          if (currentTable === 'room_participants') {
            let list = Array.from(store.participants.values())
            for (const [col, val] of Object.entries(filterEq)) {
              list = list.filter((p) => p[col] === val)
            }
            for (const [col, val] of Object.entries(filterNeq)) {
              list = list.filter((p) => p[col] !== val)
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
            return { data: list[0] ?? null, error: null }
          }

          if (currentTable === 'attempts') {
            const partId = filterEq['participant_id']
            const attempt = Array.from(store.attempts.values()).find((a) => a.participant_id === partId)
            return { data: attempt ?? null, error: null }
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

export async function loadRealEdgeFunctions(): Promise<{
  guestHandler: RequestHandler
  syncHandler: RequestHandler
}> {
  if (capturedGuestHandler && capturedSyncHandler) {
    return { guestHandler: capturedGuestHandler, syncHandler: capturedSyncHandler }
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

  if (!capturedGuestHandler || !capturedSyncHandler) {
    throw new Error('No se pudieron capturar los handlers reales de las Edge Functions.')
  }

  return { guestHandler: capturedGuestHandler, syncHandler: capturedSyncHandler }
}

export function setActiveMockDbStore(store: MockDbStore, authUser: any = null) {
  activeMockStore = store
  activeAuthUser = authUser
}

/**
 * Helper para ejecutar un ciclo completo de join + submit_attempt en student-room-guest
 */
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
  // 1. Join
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

  // 2. Submit
  const submitReq = new Request('http://localhost/student-room-guest', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-forwarded-for': clientIp },
    body: JSON.stringify({
      action: 'submit_attempt',
      code: room.code,
      participantId: joinData.participant.id,
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

/**
 * Helper para ejecutar un ciclo completo de join + submit_attempt en student-room-sync
 */
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

  // 1. Join
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

  // 2. Submit
  const submitReq = new Request('http://localhost/student-room-sync', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer mock-anon-jwt-token',
    },
    body: JSON.stringify({
      action: 'submit_attempt',
      code: room.code,
      participantId: joinData.participant.id,
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
