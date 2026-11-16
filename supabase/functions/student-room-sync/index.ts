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
const participantPublicFields = 'id, room_id, display_name, name_normalized, joined_at, last_seen_at, status'
const participantPrivateFields = `${participantPublicFields}, activities_snapshot`

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

function record(value: unknown): AnyRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as AnyRecord) : {}
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
  const authorization = request.headers.get('Authorization')
  const token = authorization?.replace(/^Bearer\s+/i, '')

  const rateLimit = checkRateLimit(action, clientIp, token)
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
  const publishableKey = Deno.env.get('SUPABASE_PUBLISHABLE_KEY') ?? Deno.env.get('SUPABASE_ANON_KEY') ?? ''
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

  if (!supabaseUrl || !publishableKey || !serviceRoleKey) {
    return json({ error: 'Configuración de servidor incompleta.' }, 500)
  }

  if (!token) {
    return json({ error: 'Sesión no válida o token requerido.' }, 401)
  }

  const callerClient = createClient(supabaseUrl, publishableKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  })
  const { data: authData, error: authError } = await callerClient.auth.getUser(token)
  if (authError || !authData.user) return json({ error: 'Sesión no válida o expirada.' }, 401)

  const adminClient = createClient(supabaseUrl, serviceRoleKey)

  const code = String(body.code ?? '').trim().toUpperCase()
  const roomId = body.roomId
  const roomQuery = isUuid(roomId)
    ? adminClient.from('rooms').select(roomFields).eq('id', roomId).maybeSingle()
    : adminClient.from('rooms').select(roomFields).eq('code', code).maybeSingle()

  const { data: room, error: roomError } = await roomQuery
  if (roomError) return json({ error: roomError.message }, 500)
  if (!room) return json({ error: 'No encontramos una sala con ese código.' }, 404)

  // 1. Acción: CONSULTAR ESTADO (status)
  if (action === 'status') {
    const { data: existingParticipant } = await adminClient
      .from('room_participants')
      .select(participantPrivateFields)
      .eq('room_id', room.id)
      .eq('auth_user_id', authData.user.id)
      .maybeSingle()

    const effectiveRoom =
      existingParticipant && hasValidSnapshot(existingParticipant.activities_snapshot)
        ? buildEffectiveRoom(room, existingParticipant.activities_snapshot.roomConfig)
        : room

    return json({
      ok: true,
      room: effectiveRoom,
      ...(existingParticipant ? { participant: toPublicParticipant(existingParticipant) } : {}),
    })
  }

  // 2. Acción: UNIRSE A LA SALA (join)
  if (action === 'join') {
    const rawName = String(body.displayName ?? '').trim()
    const displayName = rawName || authData.user.user_metadata?.display_name || authData.user.email || 'Estudiante'
    if (displayName.length < 2) return json({ error: 'Escribe un nombre válido.' }, 400)
    if (room.status === 'ready' || room.status === 'draft') return json({ error: 'La sala todavía no fue abierta por el docente.' }, 409)
    if (room.status === 'finished' || room.status === 'archived') return json({ error: 'Esta sala ya no acepta participantes.' }, 409)
    const nameNormalized = normalizeName(displayName)

    // 2A. Recuperación de sesión autenticada por auth_user_id antes del control de cupos
    const { data: existingParticipant, error: existingError } = await adminClient
      .from('room_participants')
      .select(participantPrivateFields)
      .eq('room_id', room.id)
      .eq('auth_user_id', authData.user.id)
      .maybeSingle()

    if (existingError) return json({ error: existingError.message }, 500)
    if (existingParticipant) {
      const { data: existingAttempt, error: attemptError } = await adminClient
        .from('attempts')
        .select('id')
        .eq('participant_id', existingParticipant.id)
        .maybeSingle()

      if (attemptError) return json({ error: attemptError.message }, 500)
      if (existingAttempt) return json({ ok: false, alreadyAttempted: true, error: 'Ya tienes un intento registrado para esta sala.' }, 409)

      const { data: touchedParticipant, error: touchError } = await adminClient
        .from('room_participants')
        .update({ last_seen_at: new Date().toISOString() })
        .eq('id', existingParticipant.id)
        .select(participantPublicFields)
        .maybeSingle()

      if (touchError) return json({ error: touchError.message }, 500)

      if (hasValidSnapshot(existingParticipant.activities_snapshot)) {
        const snapshot = existingParticipant.activities_snapshot
        return json(
          {
            ok: true,
            room: buildEffectiveRoom(room, snapshot.roomConfig),
            participant: toPublicParticipant(touchedParticipant ?? existingParticipant),
            participantId: existingParticipant.id,
            recovered: true,
            activityIds: snapshot.occurrenceLinks.map((l) => l.activity_id),
            occurrenceIds: snapshot.occurrenceLinks.map((l) => l.occurrence_id ?? l.id),
            activities: snapshot.activities,
          },
          201
        )
      }

      const candidateSnapshot = await buildRoomSnapshot(adminClient, room)
      const confirmed = await confirmSnapshotWrite(adminClient, existingParticipant.id, candidateSnapshot)
      if (!confirmed.ok) {
        return json({ error: confirmed.error }, 500)
      }

      return json(
        {
          ok: true,
          room: buildEffectiveRoom(room, confirmed.snapshot.roomConfig),
          participant: toPublicParticipant(touchedParticipant ?? confirmed.participant),
          participantId: existingParticipant.id,
          recovered: true,
          snapshotSealedOnRecovery: true,
          activityIds: confirmed.snapshot.occurrenceLinks.map((l) => l.activity_id),
          occurrenceIds: confirmed.snapshot.occurrenceLinks.map((l) => l.occurrence_id ?? l.id),
          activities: confirmed.snapshot.activities,
        },
        201
      )
    }

    // 2B. Control de cupos para nuevas admisiones
    const { count, error: countError } = await adminClient
      .from('room_participants')
      .select('id', { count: 'exact', head: true })
      .eq('room_id', room.id)
      .neq('status', 'abandoned')

    if (countError) return json({ error: countError.message }, 500)
    if (typeof room.student_limit === 'number' && room.student_limit > 0 && (count ?? 0) >= room.student_limit) {
      return json({ error: 'La sala alcanzó el límite de estudiantes.' }, 409)
    }

    // 2C. Alta de participante + confirmación estricta de snapshot inmutable
    const candidateSnapshot = await buildRoomSnapshot(adminClient, room)

    const { data: participant, error: participantError } = await adminClient
      .from('room_participants')
      .insert({
        room_id: room.id,
        auth_user_id: authData.user.id,
        display_name: displayName,
        name_normalized: nameNormalized,
        status: room.status === 'active' ? 'in_progress' : 'joined',
      })
      .select(participantPrivateFields)
      .single()

    if (participantError || !participant) return json({ error: participantError?.message ?? 'No se pudo registrar al participante.' }, 500)

    const confirmed = await confirmSnapshotWrite(adminClient, participant.id, candidateSnapshot)
    if (!confirmed.ok) {
      await adminClient.from('room_participants').delete().eq('id', participant.id)
      return json({ error: confirmed.error }, 500)
    }

    return json(
      {
        ok: true,
        room: buildEffectiveRoom(room, confirmed.snapshot.roomConfig),
        participant: toPublicParticipant(confirmed.participant),
        participantId: confirmed.participant.id,
        activityIds: confirmed.snapshot.occurrenceLinks.map((l) => l.activity_id),
        occurrenceIds: confirmed.snapshot.occurrenceLinks.map((l) => l.occurrence_id ?? l.id),
        activities: confirmed.snapshot.activities,
      },
      201
    )
  }

  // 3. Acción: ENTREGAR INTENTO (submit / submit_attempt)
  if (action === 'submit' || action === 'submit_attempt') {
    const participantId = body.participantId ?? body.participant?.id
    const attempt = record(body.attempt)

    if (!isUuid(participantId) || !isUuid(room.id)) return json({ error: 'Participante o sala no válidos.' }, 400)

    const { data: participant, error: partError } = await adminClient
      .from('room_participants')
      .select('id, room_id, status, auth_user_id, activities_snapshot')
      .eq('id', participantId)
      .eq('room_id', room.id)
      .eq('auth_user_id', authData.user.id)
      .maybeSingle()

    if (partError || !participant) return json({ error: 'El participante no pertenece a esta sesión.' }, 403)

    // Control prioritario de acuse perdido (P2)
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

    let attemptStatus = attempt.status === 'timeout' ? 'timeout' : 'completed'
    const timeMinutes = Number(effectiveRoom.time_minutes ?? 0)
    if (timeMinutes > 0 && room.started_at) {
      const roomStartedTime = new Date(room.started_at).getTime()
      if (!Number.isNaN(roomStartedTime)) {
        const elapsedMs = Date.now() - roomStartedTime
        const limitMs = timeMinutes * 60 * 1000
        const gracePeriodMs = 60 * 1000
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
