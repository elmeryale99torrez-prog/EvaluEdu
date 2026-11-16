export type SyncKind =
  | 'activity'
  | 'activity_update'
  | 'template'
  | 'template_update'
  | 'room'
  | 'room_transition'
  | 'activity_status'
  | 'attempt'

export type TeacherSyncKind = Exclude<SyncKind, 'attempt'>

export type SyncQueueItem = {
  id: string
  kind: SyncKind
  ownerId?: string
  payload: unknown
  createdAt: string
  attempts: number
  lastError?: string
  lastStatus?: number
  nextRetryAt?: string
  retryAfterSeconds?: number
  entityVersion?: string
  clientRevision?: number
}

export type SyncStorageErrorCode =
  | 'STORAGE_UNAVAILABLE'
  | 'QUOTA_EXCEEDED'
  | 'SERIALIZATION_ERROR'
  | 'VERIFICATION_MISMATCH'
  | 'WRITE_FAILED'

export type WriteSyncQueueResult = {
  ok: boolean
  persistedCount: number
  error?: SyncStorageErrorCode
  message?: string
}

export type EnqueueSyncOptions = {
  entityVersion?: string
  clientRevision?: number
  nextRetryAt?: string
  lastStatus?: number
  lastError?: string
  retryAfterSeconds?: number
}

export type EnqueueSyncResult = {
  ok: boolean
  action: 'enqueued' | 'replaced' | 'kept_newer' | 'rejected'
  queue: SyncQueueItem[]
  item?: SyncQueueItem
  reason?: 'MISSING_OWNER_ID' | SyncStorageErrorCode
  message?: string
}

export type MarkSyncFailedOptions = {
  status?: number
  retryAfterSeconds?: number | null
  nowMs?: number
}

const syncQueueKey = 'edueval-sync-queue'
export const syncQueueChangedEvent = 'edueval-sync-changed'

const VERSIONED_TEACHER_KINDS: ReadonlySet<SyncKind> = new Set(['activity_update', 'template_update'])

function canUseStorage() {
  return typeof window !== 'undefined' && Boolean(window.localStorage)
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

export function isTeacherSyncKind(kind: SyncKind): kind is TeacherSyncKind {
  return kind !== 'attempt'
}

export function isStudentSyncItem(item: SyncQueueItem): boolean {
  return item.kind === 'attempt'
}

export function readSyncQueue(): SyncQueueItem[] {
  if (!canUseStorage()) return []
  try {
    const value = window.localStorage.getItem(syncQueueKey)
    const parsed = value ? (JSON.parse(value) as unknown) : []
    return Array.isArray(parsed) ? parsed.filter(isSyncQueueItem) : []
  } catch {
    return []
  }
}

export function readStudentSyncQueue(): SyncQueueItem[] {
  return readSyncQueue().filter(isStudentSyncItem)
}

export function readTeacherSyncQueue(ownerId?: string): SyncQueueItem[] {
  const queue = readSyncQueue()
  if (typeof ownerId === 'string') {
    const trimmed = ownerId.trim()
    if (!trimmed) return []
    return queue.filter((item) => isTeacherSyncKind(item.kind) && item.ownerId === trimmed)
  }
  return queue.filter((item) => isTeacherSyncKind(item.kind))
}

export function readOwnedTeacherSyncQueue(ownerId: string | undefined | null): SyncQueueItem[] {
  const trimmed = nonEmptyString(ownerId)
  if (!trimmed) return []
  return readSyncQueue().filter((item) => isTeacherSyncKind(item.kind) && item.ownerId === trimmed)
}

export function readLegacyOwnerlessTeacherItems(): SyncQueueItem[] {
  return readSyncQueue().filter((item) => isTeacherSyncKind(item.kind) && !nonEmptyString(item.ownerId))
}

function classifyStorageWriteError(error: unknown): { code: SyncStorageErrorCode; message: string } {
  if (error && typeof error === 'object') {
    const err = error as { name?: unknown; code?: unknown; message?: unknown }
    if (
      err.name === 'QuotaExceededError' ||
      err.name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
      err.code === 22 ||
      err.code === 1014
    ) {
      return {
        code: 'QUOTA_EXCEEDED',
        message: typeof err.message === 'string' && err.message ? err.message : 'Cuota de almacenamiento local excedida.',
      }
    }
    if (typeof err.message === 'string' && err.message) {
      return { code: 'WRITE_FAILED', message: err.message }
    }
  }
  return { code: 'WRITE_FAILED', message: 'No se pudo escribir la cola en localStorage.' }
}

export function writeSyncQueue(items: SyncQueueItem[]): WriteSyncQueueResult {
  if (!canUseStorage()) {
    return {
      ok: false,
      persistedCount: 0,
      error: 'STORAGE_UNAVAILABLE',
      message: 'localStorage no disponible en este entorno.',
    }
  }

  let serialized = ''
  try {
    serialized = JSON.stringify(items)
  } catch (err) {
    return {
      ok: false,
      persistedCount: 0,
      error: 'SERIALIZATION_ERROR',
      message: err instanceof Error ? err.message : 'Error al serializar la cola de sincronización.',
    }
  }

  try {
    window.localStorage.setItem(syncQueueKey, serialized)
    const persistedRaw = window.localStorage.getItem(syncQueueKey)
    if (persistedRaw !== serialized) {
      return {
        ok: false,
        persistedCount: 0,
        error: 'VERIFICATION_MISMATCH',
        message: 'La cola escrita en localStorage no coincidió al releerse.',
      }
    }
    window.dispatchEvent(new CustomEvent(syncQueueChangedEvent))
    return {
      ok: true,
      persistedCount: items.length,
    }
  } catch (err) {
    const classified = classifyStorageWriteError(err)
    return {
      ok: false,
      persistedCount: 0,
      error: classified.code,
      message: classified.message,
    }
  }
}

export function getSyncItemVersionInfo(item: Pick<SyncQueueItem, 'payload' | 'entityVersion' | 'clientRevision'>): {
  entityVersion?: string
  clientRevision?: number
} {
  const payload = isPlainRecord(item.payload) ? item.payload : null
  const nestedAct = payload && isPlainRecord(payload.activity) ? payload.activity : null
  const nestedTmpl = payload && isPlainRecord(payload.template) ? payload.template : null
  const entityVersion =
    nonEmptyString(item.entityVersion) ??
    nonEmptyString(payload?.updatedAt) ??
    nonEmptyString(nestedAct?.updatedAt) ??
    nonEmptyString(nestedTmpl?.updatedAt) ??
    undefined
  const clientRevision =
    typeof item.clientRevision === 'number' && Number.isFinite(item.clientRevision)
      ? item.clientRevision
      : typeof payload?.clientRevision === 'number' && Number.isFinite(payload.clientRevision)
        ? payload.clientRevision
        : undefined
  return { entityVersion, clientRevision }
}

export function compareSyncVersion(
  left: { entityVersion?: string; clientRevision?: number },
  right: { entityVersion?: string; clientRevision?: number }
): number {
  const leftMs = left.entityVersion ? Date.parse(left.entityVersion) : Number.NaN
  const rightMs = right.entityVersion ? Date.parse(right.entityVersion) : Number.NaN
  if (Number.isFinite(leftMs) && Number.isFinite(rightMs) && leftMs !== rightMs) {
    return leftMs > rightMs ? 1 : -1
  }
  const leftRev = typeof left.clientRevision === 'number' && Number.isFinite(left.clientRevision) ? left.clientRevision : null
  const rightRev = typeof right.clientRevision === 'number' && Number.isFinite(right.clientRevision) ? right.clientRevision : null
  if (leftRev !== null && rightRev !== null && leftRev !== rightRev) {
    return leftRev > rightRev ? 1 : -1
  }
  if (leftRev !== null && rightRev === null && left.entityVersion && !right.entityVersion) return 1
  if (rightRev !== null && leftRev === null && right.entityVersion && !left.entityVersion) return -1
  return 0
}

export function enqueueSyncItemDurable(
  kind: SyncKind,
  payload: unknown,
  ownerId?: string,
  options?: EnqueueSyncOptions
): EnqueueSyncResult {
  const current = readSyncQueue()
  const payloadOwner =
    isPlainRecord(payload) && typeof payload.ownerId === 'string' ? nonEmptyString(payload.ownerId) : null
  const explicitOwner = nonEmptyString(ownerId)

  // Los intentos estudiantiles nunca deben heredar un ownerId docente
  const candidateOwner = isTeacherSyncKind(kind) ? explicitOwner ?? payloadOwner ?? undefined : undefined

  if (isTeacherSyncKind(kind) && !candidateOwner) {
    return {
      ok: false,
      action: 'rejected',
      queue: current,
      reason: 'MISSING_OWNER_ID',
      message: 'Toda operación docente en cola requiere un ownerId válido.',
    }
  }

  const normalizedPayload =
    isTeacherSyncKind(kind) && isPlainRecord(payload) && !nonEmptyString(payload.ownerId)
      ? { ...payload, ownerId: candidateOwner }
      : payload

  const identity = syncIdentity(kind, normalizedPayload, candidateOwner)
  const existingMatches = current.filter(
    (item) => syncIdentity(item.kind, item.payload, isTeacherSyncKind(item.kind) ? item.ownerId : undefined) === identity
  )
  const existing = existingMatches[existingMatches.length - 1]

  const incomingVersionInfo = getSyncItemVersionInfo({
    payload: normalizedPayload,
    entityVersion: options?.entityVersion,
    clientRevision: options?.clientRevision,
  })

  if (existing && VERSIONED_TEACHER_KINDS.has(kind)) {
    const existingVersionInfo = getSyncItemVersionInfo(existing)
    if (compareSyncVersion(incomingVersionInfo, existingVersionInfo) < 0) {
      return {
        ok: true,
        action: 'kept_newer',
        queue: current,
        item: existing,
      }
    }
  }

  const nextItem: SyncQueueItem = {
    id: `${kind}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    kind,
    ...(candidateOwner ? { ownerId: candidateOwner } : {}),
    payload: normalizedPayload,
    createdAt: existing?.createdAt ?? new Date().toISOString(),
    attempts: 0,
    ...(options?.lastError ? { lastError: options.lastError } : {}),
    ...(typeof options?.lastStatus === 'number' ? { lastStatus: options.lastStatus } : {}),
    ...(options?.nextRetryAt ? { nextRetryAt: options.nextRetryAt } : {}),
    ...(typeof options?.retryAfterSeconds === 'number' ? { retryAfterSeconds: options.retryAfterSeconds } : {}),
    ...(incomingVersionInfo.entityVersion ? { entityVersion: incomingVersionInfo.entityVersion } : {}),
    ...(typeof incomingVersionInfo.clientRevision === 'number'
      ? { clientRevision: incomingVersionInfo.clientRevision }
      : {}),
  }

  const withoutDuplicate = current.filter(
    (item) => syncIdentity(item.kind, item.payload, isTeacherSyncKind(item.kind) ? item.ownerId : undefined) !== identity
  )
  const next = [...withoutDuplicate, nextItem]
  const writeResult = writeSyncQueue(next)
  if (!writeResult.ok) {
    return {
      ok: false,
      action: 'rejected',
      queue: readSyncQueue(),
      reason: writeResult.error ?? 'WRITE_FAILED',
      message: writeResult.message,
    }
  }

  return {
    ok: true,
    action: existing ? 'replaced' : 'enqueued',
    queue: next,
    item: nextItem,
  }
}

export function enqueueSyncItem(
  kind: SyncKind,
  payload: unknown,
  ownerId?: string,
  options?: EnqueueSyncOptions
): SyncQueueItem[] {
  return enqueueSyncItemDurable(kind, payload, ownerId, options).queue
}

export function removeSyncItem(id: string): SyncQueueItem[] {
  const next = readSyncQueue().filter((item) => item.id !== id)
  const writeRes = writeSyncQueue(next)
  return writeRes.ok ? next : readSyncQueue()
}

export function removeSyncItemDurable(id: string): WriteSyncQueueResult & { queue: SyncQueueItem[] } {
  const next = readSyncQueue().filter((item) => item.id !== id)
  const writeRes = writeSyncQueue(next)
  return { ...writeRes, queue: writeRes.ok ? next : readSyncQueue() }
}

export function removeAttemptSyncItems(params: {
  id?: string
  participantId?: string
  roomId?: string
  roomCode?: string
  logicalAttemptId?: string
}): WriteSyncQueueResult & { queue: SyncQueueItem[] } {
  const next = readSyncQueue().filter((item) => {
    if (item.kind !== 'attempt') return true
    if (params.id && item.id === params.id) return false
    if (!params.participantId && !params.logicalAttemptId) return true
    const p = isPlainRecord(item.payload) ? item.payload : null
    const rec = p && isPlainRecord(p.record) ? p.record : null
    const itemParticipant = nonEmptyString(p?.participantId) ?? nonEmptyString(rec?.participantId)
    if (params.participantId && itemParticipant !== params.participantId) return true
    const itemRoomId = nonEmptyString(p?.roomId) ?? nonEmptyString(rec?.roomId)
    const itemRoomCode = nonEmptyString(p?.roomCode)?.toUpperCase() ?? nonEmptyString(rec?.roomCode)?.toUpperCase()
    if (params.roomId && itemRoomId && itemRoomId !== params.roomId) {
      if (!params.roomCode || itemRoomCode !== params.roomCode.trim().toUpperCase()) return true
    } else if (params.roomCode && itemRoomCode && itemRoomCode !== params.roomCode.trim().toUpperCase()) {
      return true
    }
    if (params.logicalAttemptId) {
      const itemLogical = nonEmptyString(p?.logicalAttemptId) ?? nonEmptyString(rec?.id) ?? 'single'
      if (itemLogical !== params.logicalAttemptId) return true
    }
    return false
  })
  const writeRes = writeSyncQueue(next)
  return { ...writeRes, queue: writeRes.ok ? next : readSyncQueue() }
}

export function removeSyncItemsForEntity(kind: SyncKind, entityId: string, ownerId?: string): SyncQueueItem[] {
  const targetId = entityId.trim()
  const trimmedOwner = nonEmptyString(ownerId)
  const next = readSyncQueue().filter((item) => {
    if (item.kind !== kind) return true
    // Un docente autenticado solo puede eliminar ítems propios, jamás de otro docente ni ítems heredados sin ownerId.
    if (isTeacherSyncKind(kind) && trimmedOwner && item.ownerId !== trimmedOwner) return true
    const key = extractEntityKey(item.payload)
    return key !== targetId
  })
  const writeRes = writeSyncQueue(next)
  return writeRes.ok ? next : readSyncQueue()
}

export function removeSyncItemsForEntityIfNotNewer(
  kind: SyncKind,
  entityId: string,
  ownerId: string,
  confirmedRevision?: number,
  confirmedVersion?: string
): WriteSyncQueueResult & { queue: SyncQueueItem[] } {
  const targetId = entityId.trim()
  const trimmedOwner = ownerId.trim()
  const confirmedInfo = { entityVersion: confirmedVersion, clientRevision: confirmedRevision }
  const next = readSyncQueue().filter((item) => {
    if (item.kind !== kind) return true
    if (item.ownerId !== trimmedOwner) return true
    if (extractEntityKey(item.payload) !== targetId) return true
    const itemInfo = getSyncItemVersionInfo(item)
    // Conservar si el ítem en cola representa una edición estrictamente más nueva que la confirmada
    if (compareSyncVersion(itemInfo, confirmedInfo) > 0) return true
    return false
  })
  const writeRes = writeSyncQueue(next)
  return { ...writeRes, queue: writeRes.ok ? next : readSyncQueue() }
}

export function updateSyncItemPayload(
  matcher: { id?: string; kind: SyncKind; ownerId?: string; entityKey?: string },
  nextPayload: unknown
): WriteSyncQueueResult & { updated: boolean; queue: SyncQueueItem[] } {
  const current = readSyncQueue()
  let updated = false
  const targetOwner = nonEmptyString(matcher.ownerId)
  const targetKey = nonEmptyString(matcher.entityKey)

  const next = current.map((item) => {
    if (updated) return item
    if (matcher.id) {
      if (item.id !== matcher.id) return item
      if (isTeacherSyncKind(item.kind) && targetOwner && item.ownerId !== targetOwner) return item
      updated = true
      return { ...item, payload: nextPayload }
    }
    if (item.kind !== matcher.kind) return item
    if (isTeacherSyncKind(item.kind) && targetOwner && item.ownerId !== targetOwner) return item
    if (targetKey && extractEntityKey(item.payload) !== targetKey) return item
    updated = true
    return { ...item, payload: nextPayload }
  })

  if (!updated) {
    return { ok: true, persistedCount: current.length, updated: false, queue: current }
  }
  const writeRes = writeSyncQueue(next)
  return {
    ...writeRes,
    updated: writeRes.ok,
    queue: writeRes.ok ? next : readSyncQueue(),
  }
}

export function computeNextRetryDelayMs(options: {
  attempts: number
  status?: number
  retryAfterSeconds?: number | null
}): number {
  if (typeof options.retryAfterSeconds === 'number' && Number.isFinite(options.retryAfterSeconds) && options.retryAfterSeconds > 0) {
    const clampedSeconds = Math.min(Math.max(options.retryAfterSeconds, 1), 300)
    return Math.round(clampedSeconds * 1000)
  }
  const step = Math.max(0, Math.min(options.attempts, 5))
  const baseMs = options.status === 429 ? 5000 : 2000
  return Math.min(baseMs * Math.pow(2, step), 30_000)
}

export function isSyncItemReadyForRetry(item: SyncQueueItem, nowMs = Date.now()): boolean {
  if (!item.nextRetryAt) return true
  const retryMs = Date.parse(item.nextRetryAt)
  if (!Number.isFinite(retryMs)) return true
  return nowMs >= retryMs
}

export function markSyncItemFailedDurable(
  id: string,
  error: string,
  options?: MarkSyncFailedOptions
): WriteSyncQueueResult & { queue: SyncQueueItem[] } {
  const nowMs = options?.nowMs ?? Date.now()
  const next = readSyncQueue().map((item) => {
    if (item.id !== id) return item
    const nextAttempts = item.attempts + 1
    const delayMs = computeNextRetryDelayMs({
      attempts: item.attempts,
      status: options?.status,
      retryAfterSeconds: options?.retryAfterSeconds,
    })
    return {
      ...item,
      attempts: nextAttempts,
      lastError: error,
      ...(typeof options?.status === 'number' ? { lastStatus: options.status } : {}),
      ...(typeof options?.retryAfterSeconds === 'number' && Number.isFinite(options.retryAfterSeconds)
        ? { retryAfterSeconds: options.retryAfterSeconds }
        : {}),
      nextRetryAt: new Date(nowMs + delayMs).toISOString(),
    }
  })
  const writeRes = writeSyncQueue(next)
  return { ...writeRes, queue: writeRes.ok ? next : readSyncQueue() }
}

export function markSyncItemFailed(id: string, error: string, options?: MarkSyncFailedOptions): SyncQueueItem[] {
  return markSyncItemFailedDurable(id, error, options).queue
}

export function claimLegacySyncItem(id: string, ownerId: string): WriteSyncQueueResult & { queue: SyncQueueItem[] } {
  const trimmedOwner = nonEmptyString(ownerId)
  if (!trimmedOwner) {
    return { ok: false, persistedCount: readSyncQueue().length, error: 'WRITE_FAILED', message: 'ownerId inválido.', queue: readSyncQueue() }
  }
  const next = readSyncQueue().map((item) => {
    if (item.id !== id) return item
    if (!isTeacherSyncKind(item.kind) || nonEmptyString(item.ownerId)) return item
    const nextPayload = isPlainRecord(item.payload) ? { ...item.payload, ownerId: trimmedOwner } : item.payload
    return { ...item, ownerId: trimmedOwner, payload: nextPayload }
  })
  const writeRes = writeSyncQueue(next)
  return { ...writeRes, queue: writeRes.ok ? next : readSyncQueue() }
}

export function discardLegacySyncItem(id: string): WriteSyncQueueResult & { queue: SyncQueueItem[] } {
  const next = readSyncQueue().filter((item) => {
    if (item.id !== id) return true
    if (!isTeacherSyncKind(item.kind) || nonEmptyString(item.ownerId)) return true
    return false
  })
  const writeRes = writeSyncQueue(next)
  return { ...writeRes, queue: writeRes.ok ? next : readSyncQueue() }
}

export function extractEntityKey(payload: unknown): string | null {
  if (isPlainRecord(payload)) {
    const candidateRecord = isPlainRecord(payload.record) ? payload.record : null
    const candidateActivity = isPlainRecord(payload.activity) ? payload.activity : null
    const candidateTemplate = isPlainRecord(payload.template) ? payload.template : null
    const candidateRoom = isPlainRecord(payload.room) ? payload.room : null

    const key =
      payload.localId ??
      payload.id ??
      payload.roomCode ??
      payload.code ??
      payload.participantId ??
      candidateRecord?.id ??
      candidateActivity?.id ??
      candidateTemplate?.id ??
      candidateRoom?.id

    if (typeof key === 'string' && key.trim()) return key.trim()
  }
  return null
}

export function extractAttemptIdentityKey(payload: unknown): string {
  if (!isPlainRecord(payload)) {
    return `attempt:${JSON.stringify(payload)}`
  }
  const record = isPlainRecord(payload.record) ? payload.record : null
  const roomKey =
    nonEmptyString(payload.roomId) ??
    nonEmptyString(payload.roomCode)?.toUpperCase() ??
    nonEmptyString(record?.roomId) ??
    nonEmptyString(record?.roomCode)?.toUpperCase() ??
    'unknown-room'
  const participantKey = nonEmptyString(payload.participantId) ?? nonEmptyString(record?.participantId) ?? 'unknown-participant'
  const logicalAttemptKey = nonEmptyString(payload.logicalAttemptId) ?? nonEmptyString(record?.id) ?? 'single'
  return `attempt:${roomKey}:${participantKey}:${logicalAttemptKey}`
}

function syncIdentity(kind: SyncKind, payload: unknown, ownerId?: string) {
  if (kind === 'attempt') {
    return extractAttemptIdentityKey(payload)
  }
  const key = extractEntityKey(payload)
  if (key) {
    return ownerId ? `${kind}:${ownerId}:${key}` : `${kind}:${key}`
  }
  return ownerId ? `${kind}:${ownerId}:${JSON.stringify(payload)}` : `${kind}:${JSON.stringify(payload)}`
}

function isSyncQueueItem(value: unknown): value is SyncQueueItem {
  if (!value || typeof value !== 'object') return false
  const item = value as Record<string, unknown>
  return (
    typeof item.id === 'string' &&
    typeof item.kind === 'string' &&
    typeof item.createdAt === 'string' &&
    typeof item.attempts === 'number' &&
    'payload' in item
  )
}
