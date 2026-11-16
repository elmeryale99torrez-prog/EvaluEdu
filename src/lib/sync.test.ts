import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  claimLegacySyncItem,
  computeNextRetryDelayMs,
  discardLegacySyncItem,
  enqueueSyncItem,
  enqueueSyncItemDurable,
  isSyncItemReadyForRetry,
  markSyncItemFailed,
  markSyncItemFailedDurable,
  readLegacyOwnerlessTeacherItems,
  readOwnedTeacherSyncQueue,
  readStudentSyncQueue,
  readSyncQueue,
  removeAttemptSyncItems,
  removeSyncItemsForEntity,
  removeSyncItemsForEntityIfNotNewer,
  syncQueueChangedEvent,
  updateSyncItemPayload,
} from './sync'

type MockStorageMode = 'normal' | 'quota' | 'corrupt-readback'

function installMockWindow(mode: MockStorageMode = 'normal') {
  const store = new Map<string, string>()
  const events: string[] = []

  const localStorageMock = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      if (mode === 'quota') {
        const err = new Error('QuotaExceededError')
        ;(err as Error & { name: string; code: number }).name = 'QuotaExceededError'
        ;(err as Error & { name: string; code: number }).code = 22
        throw err
      }
      if (mode === 'corrupt-readback') {
        store.set(key, '[]')
        return
      }
      store.set(key, String(value))
    },
    removeItem: (key: string) => store.delete(key),
    clear: () => store.clear(),
  }

  const CustomEventImpl = class {
    type: string
    constructor(type: string) {
      this.type = type
    }
  }

  ;(globalThis as Record<string, unknown>).CustomEvent = CustomEventImpl
  ;(globalThis as Record<string, unknown>).window = {
    localStorage: localStorageMock,
    dispatchEvent: (ev: { type: string }) => {
      events.push(ev.type)
      return true
    },
  }

  return { store, events, localStorageMock }
}

describe('Cola de sincronización endurecida (R2-A / R2-B)', () => {
  const originalWindow = (globalThis as Record<string, unknown>).window
  const originalCustomEvent = (globalThis as Record<string, unknown>).CustomEvent

  beforeEach(() => {
    installMockWindow('normal')
  })

  afterEach(() => {
    if (originalWindow === undefined) {
      delete (globalThis as Record<string, unknown>).window
    } else {
      ;(globalThis as Record<string, unknown>).window = originalWindow
    }
    if (originalCustomEvent === undefined) {
      delete (globalThis as Record<string, unknown>).CustomEvent
    } else {
      ;(globalThis as Record<string, unknown>).CustomEvent = originalCustomEvent
    }
  })

  it('separa intentos de distintos participantes en la misma sala sin colisión por roomCode y fuerza ownerId=undefined', () => {
    const resA = enqueueSyncItemDurable(
      'attempt',
      {
        roomId: 'room-1',
        roomCode: 'EDU-500',
        participantId: 'part-A',
        logicalAttemptId: 'att-A',
        guestToken: 'tok-A',
        record: { id: 'rec-A', roomId: 'room-1', roomCode: 'EDU-500' },
      },
      'teacher-should-be-ignored'
    )
    const resB = enqueueSyncItemDurable(
      'attempt',
      {
        roomId: 'room-1',
        roomCode: 'EDU-500',
        participantId: 'part-B',
        logicalAttemptId: 'att-B',
        guestToken: 'tok-B',
        record: { id: 'rec-B', roomId: 'room-1', roomCode: 'EDU-500' },
      },
      'teacher-should-be-ignored'
    )

    expect(resA.ok).toBe(true)
    expect(resB.ok).toBe(true)
    const studentQueue = readStudentSyncQueue()
    expect(studentQueue).toHaveLength(2)
    expect(studentQueue.every((item) => item.ownerId === undefined)).toBe(true)
    expect(readOwnedTeacherSyncQueue('teacher-should-be-ignored')).toHaveLength(0)

    // Re-encolar el mismo intento lógico del participante A reemplaza su sobre sin duplicar
    const resA2 = enqueueSyncItemDurable('attempt', {
      roomId: 'room-1',
      roomCode: 'EDU-500',
      participantId: 'part-A',
      logicalAttemptId: 'att-A',
      guestToken: 'tok-A',
      record: { id: 'rec-A', roomId: 'room-1', roomCode: 'EDU-500', answeredCount: 5 },
    })
    expect(resA2.action).toBe('replaced')
    expect(readStudentSyncQueue()).toHaveLength(2)

    // Eliminar solo el intento de A deja intacto el de B
    removeAttemptSyncItems({ participantId: 'part-A', roomId: 'room-1', logicalAttemptId: 'att-A' })
    const remaining = readStudentSyncQueue()
    expect(remaining).toHaveLength(1)
    expect((remaining[0].payload as Record<string, unknown>).participantId).toBe('part-B')
  })

  it('rechaza operaciones docentes sin ownerId y aísla estrictamente entre docente A, docente B e ítems heredados sin ownerId', () => {
    const missingOwner = enqueueSyncItemDurable('activity', { localId: 'a1', activity: { id: 'a1' } })
    expect(missingOwner.ok).toBe(false)
    expect(missingOwner.reason).toBe('MISSING_OWNER_ID')
    expect(readSyncQueue()).toHaveLength(0)

    // Simular ítem heredado sin ownerId escrito directamente en localStorage
    const legacyItem = {
      id: 'legacy-act-1',
      kind: 'activity_update',
      payload: { activity: { id: 'act-shared-id', title: 'Legacy' } },
      createdAt: '2026-11-01T00:00:00.000Z',
      attempts: 1,
    }
    ;(globalThis as { window: { localStorage: Storage } }).window.localStorage.setItem(
      'edueval-sync-queue',
      JSON.stringify([legacyItem])
    )

    enqueueSyncItem('activity_update', { activity: { id: 'act-shared-id', title: 'Docente A' }, ownerId: 'teacher-A' }, 'teacher-A')
    enqueueSyncItem('activity_update', { activity: { id: 'act-shared-id', title: 'Docente B' }, ownerId: 'teacher-B' }, 'teacher-B')

    expect(readOwnedTeacherSyncQueue('teacher-A')).toHaveLength(1)
    expect(readOwnedTeacherSyncQueue('teacher-B')).toHaveLength(1)
    expect(readLegacyOwnerlessTeacherItems()).toHaveLength(1)

    // removeSyncItemsForEntity para teacher-A solo elimina el de teacher-A; preserva teacher-B y legacy
    removeSyncItemsForEntity('activity_update', 'act-shared-id', 'teacher-A')
    expect(readOwnedTeacherSyncQueue('teacher-A')).toHaveLength(0)
    expect(readOwnedTeacherSyncQueue('teacher-B')).toHaveLength(1)
    expect(readLegacyOwnerlessTeacherItems()).toHaveLength(1)

    // Reclamo manual explícito del ítem legado asigna ownerId; descarte manual lo retira
    claimLegacySyncItem('legacy-act-1', 'teacher-B')
    expect(readLegacyOwnerlessTeacherItems()).toHaveLength(0)
    expect(readOwnedTeacherSyncQueue('teacher-B')).toHaveLength(2)

    // Otro ítem legado descartado manualmente
    enqueueSyncItem('activity', { localId: 'a2', ownerId: 'teacher-A' }, 'teacher-A')
    const resDiscard = discardLegacySyncItem('non-existent')
    expect(resDiscard.ok).toBe(true)
  })

  it('impide que una edición vieja (v1) sobrescriba o borre de la cola a una edición más reciente (v2)', () => {
    const v2 = enqueueSyncItemDurable(
      'activity_update',
      {
        activity: { id: 'act-uuid-1', title: 'Versión 2', updatedAt: '2026-11-15T10:00:02.000Z' },
        ownerId: 'teacher-1',
        updatedAt: '2026-11-15T10:00:02.000Z',
        clientRevision: 2,
      },
      'teacher-1',
      { entityVersion: '2026-11-15T10:00:02.000Z', clientRevision: 2 }
    )
    expect(v2.ok).toBe(true)

    // Llega fallo tardío de v1 e intenta encolarse
    const v1Late = enqueueSyncItemDurable(
      'activity_update',
      {
        activity: { id: 'act-uuid-1', title: 'Versión 1 obsoleta', updatedAt: '2026-11-15T10:00:01.000Z' },
        ownerId: 'teacher-1',
        updatedAt: '2026-11-15T10:00:01.000Z',
        clientRevision: 1,
      },
      'teacher-1',
      { entityVersion: '2026-11-15T10:00:01.000Z', clientRevision: 1 }
    )
    expect(v1Late.ok).toBe(true)
    expect(v1Late.action).toBe('kept_newer')

    const queueAfterV1 = readOwnedTeacherSyncQueue('teacher-1')
    expect(queueAfterV1).toHaveLength(1)
    expect((queueAfterV1[0].payload as { activity: { title: string } }).activity.title).toBe('Versión 2')

    // Si v1 confirma tarde en red, removeSyncItemsForEntityIfNotNewer NO borra v2 de la cola
    const removeV1Res = removeSyncItemsForEntityIfNotNewer(
      'activity_update',
      'act-uuid-1',
      'teacher-1',
      1,
      '2026-11-15T10:00:01.000Z'
    )
    expect(removeV1Res.queue.filter((i) => i.ownerId === 'teacher-1')).toHaveLength(1)

    // Si v2 confirma, sí limpia v2
    const removeV2Res = removeSyncItemsForEntityIfNotNewer(
      'activity_update',
      'act-uuid-1',
      'teacher-1',
      2,
      '2026-11-15T10:00:02.000Z'
    )
    expect(removeV2Res.queue.filter((i) => i.ownerId === 'teacher-1')).toHaveLength(0)
  })

  it('verifica fallo durable cuando localStorage lanza QuotaExceededError o hay mismatch al releer', () => {
    const quotaEnv = installMockWindow('quota')
    const quotaRes = enqueueSyncItemDurable('attempt', {
      roomId: 'room-q',
      roomCode: 'EDU-Q',
      participantId: 'part-q',
      logicalAttemptId: 'att-q',
      guestToken: 'tok-q',
      record: { id: 'att-q' },
    })
    expect(quotaRes.ok).toBe(false)
    expect(quotaRes.action).toBe('rejected')
    expect(quotaRes.reason).toBe('QUOTA_EXCEEDED')
    expect(quotaEnv.events).not.toContain(syncQueueChangedEvent)

    const corruptEnv = installMockWindow('corrupt-readback')
    const mismatchRes = enqueueSyncItemDurable('attempt', {
      roomId: 'room-c',
      roomCode: 'EDU-C',
      participantId: 'part-c',
      logicalAttemptId: 'att-c',
      guestToken: 'tok-c',
      record: { id: 'att-c' },
    })
    expect(mismatchRes.ok).toBe(false)
    expect(mismatchRes.reason).toBe('VERIFICATION_MISMATCH')
    expect(corruptEnv.events).not.toContain(syncQueueChangedEvent)
  })

  it('nunca descarta ítems tras 3+ fallos y programa Retry-After / backoff exponencial', () => {
    const enq = enqueueSyncItemDurable('attempt', {
      roomId: 'r-1',
      roomCode: 'EDU-1',
      participantId: 'p-1',
      logicalAttemptId: 'a-1',
      guestToken: 'tok-1',
      record: { id: 'a-1' },
    })
    const itemId = enq.item!.id
    const t0 = Date.parse('2026-11-15T12:00:00.000Z')

    markSyncItemFailed(itemId, 'Error 500 #1', { status: 500, nowMs: t0 })
    markSyncItemFailed(itemId, 'Error 500 #2', { status: 500, nowMs: t0 + 10_000 })
    markSyncItemFailed(itemId, 'Error 500 #3', { status: 500, nowMs: t0 + 20_000 })
    const fourth = markSyncItemFailedDurable(itemId, 'Rate limit 429', {
      status: 429,
      retryAfterSeconds: 45,
      nowMs: t0 + 30_000,
    })

    expect(fourth.queue).toHaveLength(1)
    expect(fourth.queue[0].attempts).toBe(4)
    expect(fourth.queue[0].lastStatus).toBe(429)
    expect(fourth.queue[0].retryAfterSeconds).toBe(45)
    expect(isSyncItemReadyForRetry(fourth.queue[0], t0 + 40_000)).toBe(false)
    expect(isSyncItemReadyForRetry(fourth.queue[0], t0 + 75_000)).toBe(true)
    expect(computeNextRetryDelayMs({ attempts: 0, status: 429, retryAfterSeconds: 12 })).toBe(12_000)
  })

  it('actualiza en sitio el payload de una sala parcialmente reconciliada preservando orden, multiplicidad e item.id', () => {
    const initialPayload = {
      room: { id: 'r-local-1', activityIds: ['loc-A', 'loc-B', 'loc-A'], activities: ['loc-A', 'loc-B', 'loc-A'] },
      localId: 'r-local-1',
      ownerId: 'teacher-1',
      localActivitiesSnapshot: { 'loc-A': { id: 'loc-A', title: 'A' }, 'loc-B': { id: 'loc-B', title: 'B' } },
    }
    const enq = enqueueSyncItemDurable('room', initialPayload, 'teacher-1')
    const itemId = enq.item!.id

    const patched = updateSyncItemPayload(
      { id: itemId, kind: 'room', ownerId: 'teacher-1', entityKey: 'r-local-1' },
      {
        ...initialPayload,
        room: {
          ...initialPayload.room,
          activityIds: ['uuid-A', 'loc-B', 'uuid-A'],
          activities: ['uuid-A', 'loc-B', 'uuid-A'],
        },
        localActivitiesSnapshot: { 'loc-B': { id: 'loc-B', title: 'B' } },
      }
    )

    expect(patched.ok).toBe(true)
    expect(patched.updated).toBe(true)
    expect(patched.queue).toHaveLength(1)
    expect(patched.queue[0].id).toBe(itemId)
    const updatedPayload = patched.queue[0].payload as typeof initialPayload
    expect(updatedPayload.room.activityIds).toEqual(['uuid-A', 'loc-B', 'uuid-A'])
    expect(Object.keys(updatedPayload.localActivitiesSnapshot)).toEqual(['loc-B'])
  })
})
