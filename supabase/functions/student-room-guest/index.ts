import { createClient } from 'npm:@supabase/supabase-js@2'
import {
  publicActivity,
  evaluateRoomAttempt,
  shuffleArray,
  cryptoRandomRng,
  hasValidSnapshot,
  buildEffectiveRoom,
  SessionSnapshot,
  RoomOccurrenceLink,
  AnyRecord,
} from '../_shared/activityEvaluator.ts'
import { checkRateLimit, getClientIp } from '../_shared/rateLimiter.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const roomFields =
  'id, owner_id, name, code, instructions, status, question_count, student_limit, time_minutes, score_per_question, shuffle_questions, allow_back, created_at, started_at, finished_at, archived_at'
const activityFields = 'id, template_id, type, title, topic, difficulty, prompt, options, feedback, details, status'
const privateActivityFields = `${activityFields}, answer`
const participantPublicFields =
  'id, room_id, display_name, name_normalized, joined_at, last_seen_at, status, guest_token_expires_at'
const participantPrivateFields = `${participantPublicFields}, activities_snapshot`
const guestSessionHours = 6

// deno-lint-ignore no-explicit-any
type SupabaseAny = any

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function toPublicParticipant(row: AnyRecord | null | undefined) {
  if (!row || typeof row !== 'object') return null
  return {
    id: row.id,
    room_id: row.room_id,
    display_name: row.display_name,
    name_normalized: row.name_normalized,
    joined_at: row.joined_at,
    last_seen_at: row.last_seen_at,
    status: row.status,
    guest_token_expires_at: row.guest_token_expires_at,
  }
}

function normalizeName(value: string) {
  return value.trim().toLocaleLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
}

function isUuid(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
  )
}

function toBase64Url(bytes: Uint8Array) {
  let binary = ''
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte)
  })
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function createGuestToken() {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return toBase64Url(bytes)
}

async function hashToken(token: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

async function getRoomActivities(adminClient: SupabaseAny, roomId: string, shuffleQuestions = false) {
  const { data: links, error: linksError } = await adminClient
    .from('room_activities')
    .select('id, activity_id, position')
    .eq('room_id', roomId)
    .order('position', { ascending: true })

  if (linksError) throw new Error(linksError.message)
  const rawData: AnyRecord[] = Array.isArray(links) ? links : []
  let rawLinks = rawData.map((link: AnyRecord) => ({
    id: String(link.id),
    room_id: roomId,
    activity_id: String(link.activity_id),
    position: Number(link.position ?? 0),
    occurrence_id: String(link.id),
  })) as RoomOccurrenceLink[]

  // Barajado con aleatoriedad criptográfica independiente de identificadores públicos
  if (shuffleQuestions) {
    rawLinks = shuffleArray(rawLinks, cryptoRandomRng)
  }

  const occurrenceLinks = rawLinks
  const ids = occurrenceLinks.map((link) => link.activity_id)
  if (!ids.length) return { occurrenceLinks: [], activities: [], privateActivities: [] }

  const { data: activities, error: activityError } = await adminClient
    .from('activities')
    .select(privateActivityFields)
    .in('id', [...new Set(ids)])

  if (activityError) throw new Error(activityError.message)
  const actsList: AnyRecord[] = Array.isArray(activities) ? activities : []
  const byId = new Map(actsList.map((activity: AnyRecord) => [String(activity.id), activity]))

  const projectedActivities = occurrenceLinks
    .map((link) => {
      const act = byId.get(link.activity_id)
      if (!act) return null
      // La proyección pública aplica barajado antitrampas con RNG criptográfico independiente
      const proj = publicActivity(act, { rng: cryptoRandomRng })
      return {
        ...proj,
        occurrenceId: link.occurrence_id ?? link.id,
        position: link.position,
      }
    })
    .filter(Boolean) as AnyRecord[]

  const privateList = occurrenceLinks
    .map((link) => byId.get(link.activity_id))
    .filter((a): a is AnyRecord => Boolean(a))

  return { occurrenceLinks, activities: projectedActivities, privateActivities: privateList }
}

async function buildRoomSnapshot(adminClient: SupabaseAny, room: AnyRecord): Promise<SessionSnapshot> {
  const content = await getRoomActivities(adminClient, room.id, room.shuffle_questions !== false)
  return {
    version: 2,
    roomConfig: {
      score_per_question: Number(room.score_per_question ?? 10),
      time_minutes: room.time_minutes ?? null,
      shuffle_questions: room.shuffle_questions !== false,
      allow_back: room.allow_back !== false,
    },
    occurrenceLinks: content.occurrenceLinks,
    activities: content.activities,
    privateActivities: content.privateActivities,
  }
}

async function confirmSnapshotWrite(
  adminClient: SupabaseAny,
  participantId: string,
  candidateSnapshot: SessionSnapshot
): Promise<{ ok: true; participant: AnyRecord; snapshot: SessionSnapshot } | { ok: false; error: string }> {
  const { data: updated, error: updateError } = await adminClient
    .from('room_participants')
    .update({ activities_snapshot: candidateSnapshot })
    .eq('id', participantId)
    .is('activities_snapshot', null)
    .select(participantPrivateFields)
    .maybeSingle()

  if (updateError) {
    return { ok: false, error: updateError.message }
  }

  if (updated && hasValidSnapshot(updated.activities_snapshot)) {
    return { ok: true, participant: updated as AnyRecord, snapshot: updated.activities_snapshot }
  }

  // En caso de inicialización concurrente previa, re-leer el snapshot ya sellado sin sobrescribirlo
  const { data: reread, error: rereadError } = await adminClient
    .from('room_participants')
    .select(participantPrivateFields)
    .eq('id', participantId)
    .maybeSingle()

  if (rereadError) {
    return { ok: false, error: rereadError.message }
  }

  if (reread && hasValidSnapshot(reread.activities_snapshot)) {
    return { ok: true, participant: reread as AnyRecord, snapshot: reread.activities_snapshot }
  }

  return { ok: false, error: 'No se pudo confirmar el snapshot autoritativo de la sesión.' }
}

async function findParticipant(
  adminClient: SupabaseAny,
  roomId: string,
  participantId: unknown,
  token: string
): Promise<AnyRecord | null> {
  if (!isUuid(roomId) || !isUuid(participantId) || !token) return null
  const tokenHash = await hashToken(token)
  const { data, error } = await adminClient
    .from('room_participants')
    .select(participantPrivateFields)
    .eq('id', participantId)
    .eq('room_id', roomId)
    .eq('guest_token_hash', tokenHash)
    .gt('guest_token_expires_at', new Date().toISOString())
    .maybeSingle()

  if (error) throw new Error(error.message)
  return data ? (data as AnyRecord) : null
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') return json({ error: 'Método no permitido.' }, 405)

  let body: AnyRecord = {}
  try {
    body = await request.json()
  } catch {
    return json({ error: 'El cuerpo de la solicitud no es un JSON válido.' }, 400)
  }

  const action = String(body.action ?? '')
  const clientIp = getClientIp(request)
  const guestToken = typeof body.guestToken === 'string' ? body.guestToken : undefined

  const rateLimit = checkRateLimit(action, clientIp, guestToken)
  if (!rateLimit.allowed) {
    return new Response(
      JSON.stringify({
        error: 'Demasiadas solicitudes. Por favor, espera antes de reintentar.',
        retryAfter: rateLimit.retryAfter,
      }),
      {
        status: 429,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
          'Retry-After': String(rateLimit.retryAfter),
        },
      }
    )
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  if (!supabaseUrl || !serviceRoleKey) return json({ error: 'Configuración de servidor incompleta.' }, 500)

  const adminClient = createClient(supabaseUrl, serviceRoleKey)

  // 1. Acción: UNIRSE A LA SALA (join)
  if (action === 'join') {
    const rawCode = String(body.code ?? '').trim().toUpperCase()
    const rawName = String(body.displayName ?? '').trim()
    if (!rawCode) return json({ error: 'El código de sala es obligatorio.' }, 400)
    if (!rawName) return json({ error: 'Escribe tu nombre para ingresar.' }, 400)

    const { data: room, error: roomError } = await adminClient
      .from('rooms')
      .select(roomFields)
      .eq('code', rawCode)
      .maybeSingle()

    if (roomError) return json({ error: roomError.message }, 500)
    if (!room) return json({ error: 'No encontramos ninguna sala con ese código.' }, 404)
    if (room.status !== 'active' && room.status !== 'waiting') {
      return json({ error: 'Esta sala no está abierta actualmente.' }, 403)
    }

    // 1A. Recuperación de sesión autenticada (antes del control de cupo para no bloquear a quien ya fue contado)
    const suppliedToken = String(body.guestToken ?? '').trim()
    const suppliedParticipantId = body.participantId ?? body.participant?.id
    if (suppliedToken && isUuid(suppliedParticipantId)) {
      const existingAuth = await findParticipant(adminClient, room.id, suppliedParticipantId, suppliedToken)
      if (existingAuth) {
        const { data: previousAttempt, error: attemptError } = await adminClient
          .from('attempts')
          .select('id')
          .eq('participant_id', existingAuth.id)
          .maybeSingle()

        if (attemptError) return json({ error: attemptError.message }, 500)
        if (previousAttempt) {
          return json(
            {
              ok: false,
              alreadyAttempted: true,
              error: 'Ya tienes un intento registrado para esta sala.',
            },
            409
          )
        }

        const { data: touchedParticipant, error: touchError } = await adminClient
          .from('room_participants')
          .update({
            last_seen_at: new Date().toISOString(),
            status: existingAuth.status === 'abandoned' ? (room.status === 'active' ? 'in_progress' : 'joined') : existingAuth.status,
          })
          .eq('id', existingAuth.id)
          .select(participantPublicFields)
          .maybeSingle()

        if (touchError) {
          return json({ error: touchError.message }, 500)
        }

        if (hasValidSnapshot(existingAuth.activities_snapshot)) {
          const snapshot = existingAuth.activities_snapshot
          return json(
            {
              ok: true,
              room: buildEffectiveRoom(room, snapshot.roomConfig),
              participant: toPublicParticipant(touchedParticipant ?? existingAuth),
              participantId: existingAuth.id,
              guestToken: suppliedToken,
              recovered: true,
              activityIds: snapshot.occurrenceLinks.map((l) => l.activity_id),
              occurrenceIds: snapshot.occurrenceLinks.map((l) => l.occurrence_id ?? l.id),
              activities: snapshot.activities,
            },
            200
          )
        }

        // Tratamiento explícito y recuperable para participante heredado sin snapshot previo
        const candidateSnapshot = await buildRoomSnapshot(adminClient, room)
        const confirmed = await confirmSnapshotWrite(adminClient, existingAuth.id, candidateSnapshot)
        if (!confirmed.ok) {
          return json({ error: confirmed.error }, 500)
        }

        return json(
          {
            ok: true,
            room: buildEffectiveRoom(room, confirmed.snapshot.roomConfig),
            participant: toPublicParticipant(touchedParticipant ?? confirmed.participant),
            participantId: existingAuth.id,
            guestToken: suppliedToken,
            recovered: true,
            snapshotSealedOnRecovery: true,
            activityIds: confirmed.snapshot.occurrenceLinks.map((l) => l.activity_id),
            occurrenceIds: confirmed.snapshot.occurrenceLinks.map((l) => l.occurrence_id ?? l.id),
            activities: confirmed.snapshot.activities,
          },
          200
        )
      }
    }

    // 1B. Protección contra suplantación: un nombre ya activo sin token válido se rechaza con 409 sin rotar el token original
    const normalized = normalizeName(rawName)
    const { data: sameName, error: sameNameError } = await adminClient
      .from('room_participants')
      .select('id')
      .eq('room_id', room.id)
      .eq('name_normalized', normalized)
      .neq('status', 'abandoned')
      .maybeSingle()

    if (sameNameError) return json({ error: sameNameError.message }, 500)
    if (sameName) {
      return json(
        {
          error: 'Ese nombre ya está participando en la sala. Usa una variante o recupera tu sesión con tu credencial original.',
        },
        409
      )
    }

    // 1C. Control de cupos para nuevas admisiones
    const { count, error: countError } = await adminClient
      .from('room_participants')
      .select('id', { count: 'exact', head: true })
      .eq('room_id', room.id)
      .neq('status', 'abandoned')

    if (countError) return json({ error: countError.message }, 500)
    if (typeof room.student_limit === 'number' && room.student_limit > 0 && (count ?? 0) >= room.student_limit) {
      return json({ error: 'La sala alcanzó su capacidad máxima de estudiantes.' }, 403)
    }

    // 1D. Alta de nuevo participante + confirmación obligatoria de snapshot inmutable
    const rawToken = createGuestToken()
    const tokenHash = await hashToken(rawToken)
    const expiresAt = new Date(Date.now() + guestSessionHours * 60 * 60 * 1000).toISOString()

    const candidateSnapshot = await buildRoomSnapshot(adminClient, room)

    const { data: newParticipant, error: insertError } = await adminClient
      .from('room_participants')
      .insert({
        room_id: room.id,
        display_name: rawName,
        name_normalized: normalized,
        guest_token_hash: tokenHash,
        guest_token_expires_at: expiresAt,
        status: room.status === 'active' ? 'in_progress' : 'joined',
      })
      .select(participantPrivateFields)
      .single()

    if (insertError || !newParticipant) {
      return json({ error: insertError?.message ?? 'No se pudo crear la sesión del estudiante.' }, 500)
    }

    const confirmed = await confirmSnapshotWrite(adminClient, newParticipant.id, candidateSnapshot)
    if (!confirmed.ok) {
      // Revertir alta incompleta si no pudo confirmarse el snapshot autoritativo
      await adminClient.from('room_participants').delete().eq('id', newParticipant.id)
      return json({ error: confirmed.error }, 500)
    }

    return json(
      {
        ok: true,
        room: buildEffectiveRoom(room, confirmed.snapshot.roomConfig),
        participant: toPublicParticipant(confirmed.participant),
        participantId: confirmed.participant.id,
        guestToken: rawToken,
        activityIds: confirmed.snapshot.occurrenceLinks.map((l) => l.activity_id),
        occurrenceIds: confirmed.snapshot.occurrenceLinks.map((l) => l.occurrence_id ?? l.id),
        activities: confirmed.snapshot.activities,
      },
      201
    )
  }

  // 2. Acción: CONSULTAR ESTADO (status)
  if (action === 'status') {
    const rawCode = String(body.code ?? '').trim().toUpperCase()
    const participantId = body.participantId ?? body.participant?.id
    const token = String(body.guestToken ?? '').trim()
    if (!rawCode || !isUuid(participantId) || !token) return json({ error: 'Credenciales incompletas.' }, 400)

    const { data: room, error: roomError } = await adminClient
      .from('rooms')
      .select(roomFields)
      .eq('code', rawCode)
      .maybeSingle()

    if (roomError) return json({ error: roomError.message }, 500)
    if (!room) return json({ error: 'Sala no encontrada.' }, 404)

    const participant = await findParticipant(adminClient, room.id, participantId, token)
    if (!participant) return json({ error: 'Sesión no válida o expirada.' }, 401)

    const { error: seenError } = await adminClient
      .from('room_participants')
      .update({ last_seen_at: new Date().toISOString() })
      .eq('id', participant.id)

    if (seenError) return json({ error: seenError.message }, 500)

    const effectiveRoom = hasValidSnapshot(participant.activities_snapshot)
      ? buildEffectiveRoom(room, participant.activities_snapshot.roomConfig)
      : room

    return json({
      ok: true,
      room: effectiveRoom,
      participant: toPublicParticipant(participant),
      roomStatus: room.status,
      participantStatus: participant.status,
    })
  }

  // 3. Acción: ENTREGAR INTENTO (submit / submit_attempt)
  if (action === 'submit' || action === 'submit_attempt') {
    const rawCode = String(body.code ?? '').trim().toUpperCase()
    let roomId = body.roomId
    const participantId = body.participantId ?? body.participant?.id
    const token = String(body.guestToken ?? '').trim()
    const attempt = typeof body.attempt === 'object' && body.attempt !== null ? (body.attempt as AnyRecord) : {}

    if ((!isUuid(roomId) && !rawCode) || !isUuid(participantId) || !token) {
      return json({ error: 'Credenciales de entrega incompletas.' }, 400)
    }

    let roomQuery = adminClient.from('rooms').select(roomFields)
    if (isUuid(roomId)) {
      roomQuery = roomQuery.eq('id', roomId)
    } else {
      roomQuery = roomQuery.eq('code', rawCode)
    }
    const { data: room, error: roomError } = await roomQuery.maybeSingle()

    if (roomError) return json({ error: roomError.message }, 500)
    if (!room) return json({ error: 'Sala no encontrada.' }, 404)
    roomId = room.id

    const participant = await findParticipant(adminClient, room.id, participantId, token)
    if (!participant) return json({ error: 'Sesión no válida o expirada.' }, 401)

    // Control prioritario de acuse perdido (P2): Si el intento ya fue persistido previamente,
    // devolverlo inmediatamente con HTTP 200 y alreadySaved: true tras autenticar al participante.
    const { data: existingAttempt } = await adminClient
      .from('attempts')
      .select('id, score, max_score, status, correct_count, answered_count, omitted_count')
      .eq('participant_id', participant.id)
      .maybeSingle()

    if (existingAttempt) {
      return json(
        {
          ok: true,
          attemptId: existingAttempt.id,
          score: Number(existingAttempt.score),
          maxScore: Number(existingAttempt.max_score),
          status: existingAttempt.status,
          correctCount: existingAttempt.correct_count,
          answeredCount: existingAttempt.answered_count,
          omittedCount: existingAttempt.omitted_count,
          alreadySaved: true,
        },
        200
      )
    }

    if (room.status === 'finished' || room.status === 'archived') {
      return json({ error: 'La sala ya no acepta más entregas porque fue finalizada por el docente.' }, 409)
    }
    if (room.status !== 'active') {
      return json({ error: 'La sala no se encuentra en curso para recibir entregas.' }, 409)
    }

    // Exigir snapshot inmutable confirmado; nunca degradar silenciosamente a contenido vivo
    if (!hasValidSnapshot(participant.activities_snapshot)) {
      return json(
        {
          error:
            'Tu sesión heredada no cuenta con un snapshot autoritativo confirmado. Reingresa a la sala para sellar tu evaluación antes de entregar.',
          code: 'SNAPSHOT_MISSING_RECOVERABLE',
        },
        409
      )
    }

    const snapshot = participant.activities_snapshot
    const effectiveRoom = buildEffectiveRoom(room, snapshot.roomConfig)

    let attemptStatus = 'completed'
    const timeMinutes = Number(effectiveRoom.time_minutes ?? 0)
    if (timeMinutes > 0 && room.started_at) {
      const roomStartedTime = new Date(room.started_at).getTime()
      if (!Number.isNaN(roomStartedTime)) {
        const elapsedMs = Date.now() - roomStartedTime
        const limitMs = timeMinutes * 60 * 1000
        const gracePeriodMs = 60 * 1000 // 60 segundos de gracia por latencia
        if (elapsedMs > limitMs + gracePeriodMs + 5 * 60 * 1000) {
          return json({ error: 'El plazo para entregar esta evaluación ha expirado completamente.' }, 409)
        }
        if (elapsedMs > limitMs + gracePeriodMs) {
          attemptStatus = 'timeout'
        }
      }
    }

    const occurrenceLinks = snapshot.occurrenceLinks as RoomOccurrenceLink[]
    const activitiesById = new Map(
      (snapshot.privateActivities as AnyRecord[]).map((a) => [String(a.id), a])
    )

    const studentResponses = Array.isArray(body.responses) ? (body.responses as AnyRecord[]) : []

    // Evaluación autoritativa unificada contra configuración y definiciones congeladas en el snapshot
    const evaluation = evaluateRoomAttempt(effectiveRoom, occurrenceLinks, activitiesById, studentResponses)
    if (!evaluation.success) {
      return json({ error: evaluation.error }, evaluation.statusCode ?? 400)
    }

    // Persistencia atómica e indivisible mediante RPC en PostgreSQL
    const { data: rpcResult, error: rpcError } = await adminClient.rpc('submit_student_attempt_atomic', {
      p_room_id: room.id,
      p_participant_id: participant.id,
      p_started_at: typeof attempt.startedAt === 'string' ? attempt.startedAt : new Date().toISOString(),
      p_finished_at: typeof attempt.finishedAt === 'string' ? attempt.finishedAt : new Date().toISOString(),
      p_status: attemptStatus,
      p_total_questions: evaluation.totalQuestions,
      p_answered_count: evaluation.answeredCount,
      p_omitted_count: evaluation.omittedCount,
      p_correct_count: evaluation.correctCount,
      p_score: evaluation.score,
      p_max_score: evaluation.maxScore,
      p_events: Array.isArray(attempt.events) ? attempt.events : [],
      p_answers: evaluation.answerRows,
    })

    if (rpcError) {
      return json({ error: `Fallo al registrar intento: ${rpcError.message}` }, 500)
    }

    const finalScore = rpcResult?.alreadySaved ? Number(rpcResult.score) : evaluation.score
    const finalMaxScore = rpcResult?.alreadySaved ? Number(rpcResult.maxScore) : evaluation.maxScore
    const finalAnsweredCount = rpcResult?.alreadySaved
      ? Number(rpcResult.answeredCount ?? 0)
      : evaluation.answeredCount
    const finalOmittedCount = rpcResult?.alreadySaved
      ? Number(rpcResult.omittedCount ?? 0)
      : evaluation.omittedCount
    const finalCorrectCount = rpcResult?.alreadySaved
      ? Number(rpcResult.correctCount ?? 0)
      : evaluation.correctCount
    const finalTotalQuestions = rpcResult?.alreadySaved
      ? finalAnsweredCount + finalOmittedCount
      : evaluation.totalQuestions
    const statusCode = rpcResult?.alreadySaved ? 200 : 201

    return json(
      {
        ok: true,
        attemptId: rpcResult?.attemptId,
        score: finalScore,
        maxScore: finalMaxScore,
        totalQuestions: finalTotalQuestions,
        answeredCount: finalAnsweredCount,
        omittedCount: finalOmittedCount,
        correctCount: finalCorrectCount,
        alreadySaved: rpcResult?.alreadySaved ?? false,
      },
      statusCode
    )
  }

  return json({ error: 'Acción no reconocida.' }, 400)
})
