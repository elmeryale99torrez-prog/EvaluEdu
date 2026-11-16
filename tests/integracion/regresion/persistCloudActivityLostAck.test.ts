/**
 * LAB-DE-001 R3-1 · Regresión de pérdida de acuse tras insertar una actividad docente.
 *
 * Invoca la implementación REAL: extrae con el compilador de TypeScript las funciones
 * `queueSync`, `persistCloudActivity`, `persistCloudRoom` y `flushSyncQueue` de
 * `src/App.tsx` y usa `src/lib/sync.ts` real. Solo el almacenamiento y la red (adaptador
 * Supabase en memoria que respeta unicidad de clave primaria y filtros) son controlados.
 * No ejecuta React, navegador ni PostgreSQL; no acredita el esquema productivo.
 *
 * `APP_SOURCE_PATH` permite apuntar a otra versión de App.tsx (p. ej. a273d13) para
 * demostrar sensibilidad: estas pruebas deben fallar sobre a273d13.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import ts from 'typescript'
import * as sync from '../../../src/lib/sync'

const APP_PATH = process.env.APP_SOURCE_PATH ?? new URL('../../../src/App.tsx', import.meta.url)
const source = readFileSync(APP_PATH, 'utf8')
const sf = ts.createSourceFile('App.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
const decls = new Map<string, string>()
const walk = (n: ts.Node) => {
  if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name)) decls.set(n.name.text, `const ${n.getText(sf)};`)
  if (ts.isFunctionDeclaration(n) && n.name && !decls.has(n.name.text)) decls.set(n.name.text, n.getText(sf))
  ts.forEachChild(n, walk)
}
walk(sf)

type Row = Record<string, unknown>
type Ctx = Record<string, unknown>
const storage = new Map<string, string>()

function compile(names: string[], ctx: Ctx): Record<string, (...args: unknown[]) => Promise<unknown>> {
  const src = names.map((n) => {
    const d = decls.get(n)
    if (!d) throw new Error(`Declaración ${n} no encontrada en App.tsx`)
    return d
  }).join('\n')
  const js = ts.transpileModule(src, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText
  return new Function('ctx', `with(ctx){${js};return {${names.join(',')}}}`)(ctx)
}

type Fault = { table: string; mode: 'loseAck' | 'rejectBeforeSave' }

function createServer() {
  const tables: Record<string, Row[]> = { activities: [], rooms: [], room_activities: [] }
  const faults: Fault[] = []
  const insertCalls: Record<string, number> = {}
  const client = {
    from(table: string) {
      const filters: [string, unknown][] = []
      let op: 'select' | 'insert' | 'delete' = 'select'
      let payload: Row | Row[] | null = null
      const rows = () => tables[table] ?? (tables[table] = [])
      const match = (r: Row) => filters.every(([k, v]) => r[k] === v)
      const runInsert = () => {
        insertCalls[table] = (insertCalls[table] ?? 0) + 1
        const items = (Array.isArray(payload) ? payload : [payload]) as Row[]
        const faultIdx = faults.findIndex((f) => f.table === table)
        const fault = faultIdx >= 0 ? faults.splice(faultIdx, 1)[0] : null
        if (fault?.mode === 'rejectBeforeSave') return { data: null, error: { message: 'Synthetic 500 before save' } }
        const created: Row[] = []
        for (const item of items) {
          const row = { ...item, id: item.id ?? (table === 'room_activities' ? undefined : randomUUID()) }
          if (row.id && rows().some((r) => r.id === row.id)) return { data: null, error: { message: 'duplicate key value violates unique constraint' } }
          created.push(row)
        }
        rows().push(...created)
        if (fault?.mode === 'loseAck') return { data: null, error: { message: 'Synthetic response lost after server commit' } }
        return { data: Array.isArray(payload) ? created : created[0], error: null }
      }
      const exec = () => {
        if (op === 'insert') return runInsert()
        if (op === 'delete') {
          tables[table] = rows().filter((r) => !match(r))
          return { data: null, error: null }
        }
        return { data: rows().filter(match), error: null }
      }
      const q: Record<string, unknown> = {
        select() { return q },
        eq(k: string, v: unknown) { filters.push([k, v]); return q },
        order() { return q },
        limit() { return q },
        insert(p: Row | Row[]) { op = 'insert'; payload = p; return q },
        delete() { op = 'delete'; return q },
        maybeSingle: async () => {
          const r = exec() as { data: Row[] | Row | null; error: unknown }
          return { data: Array.isArray(r.data) ? r.data[0] ?? null : r.data, error: r.error }
        },
        single: async () => exec(),
        then(resolve: (v: unknown) => void, reject: (e: unknown) => void) {
          try { resolve(exec()) } catch (e) { reject(e) }
        },
      }
      return q
    },
  }
  return { client, tables, faults, insertCalls }
}

const isRecord = (x: unknown): x is Record<string, unknown> => Boolean(x) && typeof x === 'object' && !Array.isArray(x)
const isCloudId = (x: unknown) => typeof x === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(x)
const readStorage = <T,>(k: string, d: T): T => { const v = storage.get(k); return v ? JSON.parse(v) as T : d }

/** Construye el contexto de una "carga de página": solo sobreviven storage y servidor. */
function loadPage(server: ReturnType<typeof createServer>, notices: string[]) {
  const ctx: Ctx = {
    ...sync,
    crypto: { randomUUID },
    isRecord,
    isCloudId,
    supabase: server.client,
    authProfile: { id: 'teacher-A' },
    activities: readStorage('edueval-activities', []),
    rooms: readStorage('edueval-rooms', []),
    templates: [],
    entityRevisionRef: { current: new Map() },
    inFlightUpdateAbortRef: { current: new Map() },
    lastMonotonicMsRef: { current: 0 },
    syncingRef: { current: false },
    setSyncing() {},
    setActivities() {},
    setTemplates() {},
    setRooms() {},
    setEditingActivity() {},
    setSyncQueue() {},
    notify: (m: string) => notices.push(m),
    markSynced() {},
    readStorage,
    cloudActivityToLocal: (x: Row) => x,
    normalizeRoom: (r: Row) => r,
    cloudRoomToLocal: (row: Row, rel: Row[]) => ({ id: row.id, code: row.code, activityIds: rel.map((r) => r.activity_id), activities: rel.map((r) => r.activity_id) }),
    persistCloudTemplate: async () => false,
    persistCloudRoomTransition: async () => false,
  }
  return compile(['buildLocalActivitiesSnapshot', 'queueSync', 'persistCloudActivity', 'persistCloudRoom', 'flushSyncQueue'], ctx)
}

const activityA = { id: 'local-lost-ack', title: 'Misma operación', type: 'singleChoice', topic: 'Bioenergética', difficulty: 'Básico', prompt: '¿Qué molécula almacena energía?', options: ['ATP', 'ADN'], answer: 'ATP', feedback: 'Revisa el metabolismo.', details: { hint: 'Fosfatos' }, status: 'draft' }

const contentOf = (r: Row) => ({ title: r.title, type: r.type, topic: r.topic, difficulty: r.difficulty, prompt: r.prompt, options: r.options, answer: r.answer, feedback: r.feedback, status: r.status })
const expectedContent = (a: typeof activityA) => ({ title: a.title, type: a.type, topic: a.topic, difficulty: a.difficulty, prompt: a.prompt, options: a.options, answer: a.answer, feedback: a.feedback, status: a.status })

beforeEach(() => {
  storage.clear()
  const ls = {
    getItem: (k: string) => storage.get(k) ?? null,
    setItem: (k: string, v: string) => { storage.set(k, String(v)) },
    removeItem: (k: string) => { storage.delete(k) },
  }
  Object.assign(globalThis, { localStorage: ls, window: { localStorage: ls, dispatchEvent() {}, setTimeout, clearTimeout }, CustomEvent: class {} })
})

describe('R3-1 · pérdida de acuse tras insertar actividad (implementación real de App.tsx)', () => {
  it('acuse perdido después del guardado: tras recarga y reintento hay una sola fila, mismo ID, contenido exacto y pendiente retirado', async () => {
    const server = createServer()
    const notices: string[] = []
    storage.set('edueval-activities', JSON.stringify([activityA]))
    server.faults.push({ table: 'activities', mode: 'loseAck' })

    let page = loadPage(server, notices)
    const first = await page.persistCloudActivity(activityA, activityA.id, true)
    expect(first).toBeNull()
    expect(server.tables.activities).toHaveLength(1) // el servidor sí guardó
    const savedId = server.tables.activities[0].id
    expect(sync.readSyncQueue()).toHaveLength(1)

    page = loadPage(server, notices) // recarga: solo storage y servidor sobreviven
    await page.flushSyncQueue(true)

    expect(server.tables.activities).toHaveLength(1)
    expect(server.tables.activities[0].id).toBe(savedId)
    expect(contentOf(server.tables.activities[0])).toEqual(expectedContent(activityA))
    expect((server.tables.activities[0].details as Row).client_local_id).toBe(activityA.id)
    expect(sync.readSyncQueue()).toHaveLength(0)
    const stored = readStorage<Row[]>('edueval-activities', [])
    expect(stored.map((a) => a.id)).toEqual([savedId])
    expect(readStorage<Record<string, string>>('edueval-local-activity-map', {})[activityA.id]).toBe(savedId)
  })

  it('error antes del guardado: el reintento inserta exactamente una fila con la identidad reservada', async () => {
    const server = createServer()
    const notices: string[] = []
    storage.set('edueval-activities', JSON.stringify([activityA]))
    server.faults.push({ table: 'activities', mode: 'rejectBeforeSave' })

    let page = loadPage(server, notices)
    expect(await page.persistCloudActivity(activityA, activityA.id, true)).toBeNull()
    expect(server.tables.activities).toHaveLength(0) // nada se guardó
    expect(sync.readSyncQueue()).toHaveLength(1)

    page = loadPage(server, notices)
    await page.flushSyncQueue(true)
    expect(server.tables.activities).toHaveLength(1)
    expect(contentOf(server.tables.activities[0])).toEqual(expectedContent(activityA))
    expect(sync.readSyncQueue()).toHaveLength(0)

    page = loadPage(server, notices) // un reintento adicional idempotente no crea otra fila
    const again = await page.persistCloudActivity(activityA, activityA.id, false) as Row
    expect(again.id).toBe(server.tables.activities[0].id)
    expect(server.tables.activities).toHaveLength(1)
  })

  it('sala [A, B, A] con acuse perdido de A: tras recarga y reintento, 2 actividades, mismo ID de A y 3 vínculos con orden y multiplicidad', async () => {
    const server = createServer()
    const notices: string[] = []
    const a = { ...activityA, id: 'local-room-A', prompt: 'Pregunta A exacta' }
    const b = { ...activityA, id: 'local-room-B', prompt: 'Pregunta B exacta' }
    const room = { id: 'local-room-1', name: 'Sala R3-1', code: 'R31ACK', status: 'ready', questionCount: 3, activityIds: [a.id, b.id, a.id], activities: [a.id, b.id, a.id], createdAt: '2026-11-15T00:00:00.000Z' }
    storage.set('edueval-activities', JSON.stringify([a, b]))
    storage.set('edueval-rooms', JSON.stringify([room]))
    server.faults.push({ table: 'activities', mode: 'loseAck' })

    let page = loadPage(server, notices)
    expect(await page.persistCloudRoom(room, room.id, true)).toBe(false)
    expect(server.tables.activities).toHaveLength(1)
    const savedIdA = server.tables.activities[0].id
    expect(sync.readSyncQueue()).toHaveLength(1)

    page = loadPage(server, notices)
    await page.flushSyncQueue(true)

    expect(server.tables.activities).toHaveLength(2)
    const rowA = server.tables.activities.find((r) => r.prompt === 'Pregunta A exacta')!
    const rowB = server.tables.activities.find((r) => r.prompt === 'Pregunta B exacta')!
    expect(rowA.id).toBe(savedIdA)
    expect(server.tables.rooms).toHaveLength(1)
    const links = [...server.tables.room_activities].sort((x, y) => Number(x.position) - Number(y.position))
    expect(links.map((l) => [l.position, l.activity_id])).toEqual([[0, savedIdA], [1, rowB.id], [2, savedIdA]])
    expect(sync.readSyncQueue()).toHaveLength(0)
  })

  it('control: dos actividades locales distintas con el mismo título siguen siendo dos filas con contenido propio', async () => {
    const server = createServer()
    const page = loadPage(server, [])
    const x = { ...activityA, id: 'local-X', title: 'Título compartido', prompt: 'Pregunta X' }
    const y = { ...activityA, id: 'local-Y', title: 'Título compartido', prompt: 'Pregunta Y' }
    const rx = await page.persistCloudActivity(x, x.id, false) as Row
    const ry = await page.persistCloudActivity(y, y.id, false) as Row
    const rx2 = await page.persistCloudActivity(x, x.id, false) as Row
    expect(server.tables.activities).toHaveLength(2)
    expect(rx.id).not.toBe(ry.id)
    expect(rx2.id).toBe(rx.id)
    expect(server.tables.activities.map((r) => r.prompt).sort()).toEqual(['Pregunta X', 'Pregunta Y'])
  })
})
