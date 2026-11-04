import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const roomFields = 'id, owner_id, name, code, instructions, status, question_count, student_limit, time_minutes, score_per_question, shuffle_questions, allow_back, created_at, started_at, finished_at, archived_at'
const activityFields = 'id, template_id, type, title, topic, difficulty, prompt, options, feedback, details, status'
const privateActivityFields = `${activityFields}, answer`

type AnyRecord = Record<string, any>

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function record(value: unknown): AnyRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as AnyRecord : {}
}

function arrayOfStrings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

function normalizeName(value: string) {
  return value.trim().toLocaleLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
}

function isUuid(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}

function runtime(activity: AnyRecord) {
  const details = record(activity.details)
  const options = arrayOfStrings(activity.options)
  const answer = activity.answer
  const scenarioOptions = options.map((text, index) => ({ id: `fallback-option-${index}`, text, consequence: activity.feedback, feedback: activity.feedback, recommended: text === answer }))
  const matchingPairs = options.map((option, index) => { const [left, right] = option.split('→').map((part) => part.trim()); return { id: `fallback-pair-${index}`, left: left || option, right: right || option } })
  const sortingAnswer = Array.isArray(answer) ? answer : []
  const sortingItems = options.map((label, index) => ({ id: `fallback-item-${index}`, label, category: sortingAnswer[index] ?? 'Sin categoría' }))
  const orderingSteps = Array.isArray(answer) ? answer : options
  const choiceOptions = options.map((label, index) => ({ id: `fallback-choice-${index}`, label, correct: label === answer }))
  const multiSelectAnswer = new Set(Array.isArray(answer) ? answer : [])
  const multiSelectOptions = options.map((label, index) => ({ id: `fallback-ms-${index}`, label, correct: multiSelectAnswer.has(label) }))
  const fillBlanksAnswer = Array.isArray(answer) ? answer : [String(answer ?? '')]
  const fallbackBlanks = fillBlanksAnswer.filter(Boolean).map((ans, index) => ({ id: String(index + 1), answer: String(ans) }))
  const spotErrorSegments = options.map((text, index) => ({ id: `fallback-se-${index + 1}`, text, hasError: text === answer }))
  const markWordsAnswer = new Set(Array.isArray(answer) ? answer : [String(answer ?? '')])
  const markWordsTokens = options.map((text, index) => ({ id: `fallback-mw-${index + 1}`, text, correct: markWordsAnswer.has(text) }))
  const gridCheckRows = details.gridCheck?.rows ?? [
    { id: 'r1', label: options[0] ?? 'Elemento 1' },
    { id: 'r2', label: options[1] ?? 'Elemento 2' },
  ]
  const gridCheckColumns = details.gridCheck?.columns ?? [
    { id: 'c1', label: 'Criterio A' },
    { id: 'c2', label: 'Criterio B' },
  ]
  const gridCheckExpected = details.gridCheck?.expectedCells ?? (Array.isArray(answer) ? answer : [String(answer ?? '')]).filter(Boolean)
  return {
    scenario: details.scenario ?? { situation: activity.prompt, stages: [{ id: 'fallback-stage', title: 'Decisión', prompt: activity.prompt, options: scenarioOptions }] },
    trueFalse: details.trueFalse ?? { statement: activity.prompt, correct: answer === 'Verdadero', explanation: activity.feedback },
    matching: details.matching ?? { pairs: matchingPairs },
    sorting: details.sorting ?? { categories: Array.from(new Set(sortingAnswer)), items: sortingItems },
    ordering: details.ordering ?? { steps: orderingSteps },
    singleChoice: details.singleChoice ?? { options: choiceOptions },
    multiSelect: details.multiSelect ?? { options: multiSelectOptions },
    fillBlanks: details.fillBlanks ?? { textWithBlanks: activity.prompt, blanks: fallbackBlanks, distractors: options },
    spotError: details.spotError ?? { segments: spotErrorSegments },
    markWords: details.markWords ?? { text: activity.prompt, words: markWordsTokens },
    gridCheck: details.gridCheck ?? { rows: gridCheckRows, columns: gridCheckColumns, expectedCells: gridCheckExpected },
    vennDiagram: details.vennDiagram ?? {
      setA: 'Conjunto A',
      setB: 'Conjunto B',
      intersectionLabel: 'Ambos',
      items: options.map((label: string, index: number) => ({
        id: `fallback-venn-${index + 1}`,
        label,
        zone: index % 3 === 0 ? 'left' : index % 3 === 1 ? 'both' : 'right',
      })),
    },
  }
}

function normalizeShortAnswerText(text: string, caseSensitive: boolean, ignoreAccents: boolean): string {
  let res = text.trim().replace(/\s+/g, ' ')
  if (!caseSensitive) res = res.toLowerCase()
  if (ignoreAccents) {
    res = res.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  }
  return res
}

function isComplete(activity: AnyRecord, response: AnyRecord): boolean {
  if (response.type !== activity.type) return false
  const current = runtime(activity)

  if (response.type === 'scenario') {
    const stages = current.scenario.stages ?? []
    const choices = record(response.choices)
    return stages.length > 0 && stages.every((stage: AnyRecord) => Boolean(choices[stage.id]))
  }
  if (response.type === 'trueFalse' || response.type === 'singleChoice' || response.type === 'spotError' || response.type === 'shortAnswer') {
    return Boolean(response.value && String(response.value).trim())
  }
  if (response.type === 'multiSelect' || response.type === 'markWords' || response.type === 'gridCheck') {
    const values = arrayOfStrings(response.values)
    return values.length > 0
  }
  if (response.type === 'fillBlanks') {
    const blanks = current.fillBlanks.blanks ?? []
    const answers = record(response.answers)
    const chosen = blanks.map((b: AnyRecord) => String(answers[b.id] ?? '').trim())
    return blanks.length > 0 && chosen.every(Boolean) && new Set(chosen).size === blanks.length
  }
  if (response.type === 'matching') {
    const pairs = current.matching.pairs ?? []
    const userPairs = record(response.pairs)
    return pairs.length > 0 && pairs.every((pair: AnyRecord) => Boolean(userPairs[pair.left]))
  }
  if (response.type === 'sorting') {
    const items = current.sorting.items ?? []
    const assignments = record(response.assignments)
    return items.length > 0 && items.every((item: AnyRecord) => Boolean(assignments[item.id]))
  }
  if (response.type === 'ordering') {
    const steps = current.ordering.steps ?? []
    const order = Array.isArray(response.order) ? response.order : []
    return order.length === steps.length && new Set(order).size === steps.length
  }
  if (response.type === 'vennDiagram') {
    const items = current.vennDiagram.items ?? []
    const assignments = record(response.assignments)
    return items.length > 0 && items.every((item: AnyRecord) => {
      const z = assignments[item.id]
      return z === 'left' || z === 'both' || z === 'right'
    })
  }
  return false
}

function isOmitted(activity: AnyRecord, response: AnyRecord | undefined | null): boolean {
  if (!response) return true
  if (response.type !== activity.type) return true

  if (response.type === 'trueFalse' || response.type === 'singleChoice' || response.type === 'spotError') {
    return !response.value || !String(response.value).trim()
  }
  if (response.type === 'multiSelect' || response.type === 'markWords' || response.type === 'gridCheck') {
    const values = arrayOfStrings(response.values)
    return values.length === 0 || values.every((val) => !val.trim())
  }
  if (response.type === 'fillBlanks') {
    const answers = record(response.answers)
    return Object.keys(answers).length === 0 || Object.values(answers).every((val) => !String(val ?? '').trim())
  }
  if (response.type === 'matching') {
    const pairs = record(response.pairs)
    return Object.keys(pairs).length === 0 || Object.values(pairs).every((val) => !val)
  }
  if (response.type === 'sorting') {
    const assignments = record(response.assignments)
    return Object.keys(assignments).length === 0 || Object.values(assignments).every((val) => !val)
  }
  if (response.type === 'ordering') {
    const order = Array.isArray(response.order) ? response.order : []
    return order.length === 0
  }
  if (response.type === 'vennDiagram') {
    const assignments = record(response.assignments)
    return Object.keys(assignments).length === 0 || Object.values(assignments).every((val) => !val)
  }
  if (response.type === 'scenario') {
    const choices = record(response.choices)
    return Object.keys(choices).length === 0 || Object.values(choices).every((val) => !val)
  }
  return false
}

function compare(activity: AnyRecord, response: AnyRecord): boolean {
  if (!isComplete(activity, response)) return false
  if (response.type !== activity.type) return false
  const current = runtime(activity)

  if (response.type === 'scenario') {
    const stages = current.scenario.stages ?? []
    const choices = record(response.choices)
    return stages.every((stage: AnyRecord) => {
      const chosen = choices[stage.id]
      const option = (stage.options ?? []).find((opt: AnyRecord) => opt.id === chosen || opt.text === chosen)
      return option?.recommended === true
    })
  }

  if (response.type === 'trueFalse') {
    const expected = current.trueFalse.correct ? 'Verdadero' : 'Falso'
    return response.value === expected
  }

  if (response.type === 'singleChoice') {
    const options = current.singleChoice.options ?? []
    const option = options.find((opt: AnyRecord) => opt.id === response.value || opt.label === response.value)
    return option?.correct === true
  }

  if (response.type === 'spotError') {
    const segments = current.spotError.segments ?? []
    const seg = segments.find((s: AnyRecord) => s.id === response.value || s.text === response.value)
    return seg?.hasError === true
  }

  if (response.type === 'markWords') {
    const words = current.markWords.words ?? []
    const values = arrayOfStrings(response.values).map((v) => v.trim()).filter(Boolean)
    if (values.length === 0) return false
    const selectedTokens = values
      .map((val) => words.find((w: AnyRecord) => w.id === val || String(w.text ?? '').toLowerCase() === val.toLowerCase()))
      .filter(Boolean) as AnyRecord[]
    if (selectedTokens.length !== values.length) return false
    const selectedIds = new Set(selectedTokens.map((t) => t.id))
    const expectedTokens = words.filter((w: AnyRecord) => w.correct === true)
    if (expectedTokens.length === 0) return false
    const expectedIds = new Set(expectedTokens.map((t) => t.id))
    const hasAllExpected = [...expectedIds].every((id) => selectedIds.has(id))
    const hasNoDistractors = selectedTokens.every((t) => t.correct === true)
    return hasAllExpected && hasNoDistractors && selectedIds.size === expectedIds.size
  }

  if (response.type === 'gridCheck') {
    const expected = new Set(arrayOfStrings(current.gridCheck.expectedCells).map((c) => c.trim().toLowerCase()))
    const values = arrayOfStrings(response.values).map((v) => v.trim().toLowerCase()).filter(Boolean)
    if (expected.size === 0 || values.length === 0) return false
    const selected = new Set(values)
    if (selected.size !== expected.size) return false
    return [...expected].every((cell) => selected.has(cell))
  }

  if (response.type === 'multiSelect') {
    const options = current.multiSelect.options ?? []
    const values = arrayOfStrings(response.values)
    const selectedOptions = values
      .map((val) => options.find((opt: AnyRecord) => opt.id === val || opt.label === val))
      .filter(Boolean) as AnyRecord[]
    if (selectedOptions.length !== values.length) return false
    const selectedIds = new Set(selectedOptions.map((opt) => opt.id))
    if (selectedIds.size !== values.length) return false
    const correctIds = new Set(options.filter((opt: AnyRecord) => opt.correct === true).map((opt: AnyRecord) => opt.id))
    return correctIds.size > 0 && selectedIds.size === correctIds.size && [...correctIds].every((id) => selectedIds.has(id))
  }

  if (response.type === 'fillBlanks') {
    const blanks = current.fillBlanks.blanks ?? []
    const answers = record(response.answers)
    return blanks.length > 0 && blanks.every((b: AnyRecord) => String(answers[b.id] ?? '').trim() === String(b.answer ?? '').trim())
  }

  if (response.type === 'matching') {
    const pairs = current.matching.pairs ?? []
    const userPairs = record(response.pairs)
    return pairs.every((pair: AnyRecord) => userPairs[pair.left] === pair.right)
  }

  if (response.type === 'sorting') {
    const items = current.sorting.items ?? []
    const assignments = record(response.assignments)
    return items.every((item: AnyRecord) => assignments[item.id] === item.category)
  }

  if (response.type === 'ordering') {
    const steps = current.ordering.steps ?? []
    const order = Array.isArray(response.order) ? response.order : []
    return order.every((step: string, index: number) => step === steps[index])
  }
  if (response.type === 'vennDiagram') {
    const items = current.vennDiagram.items ?? []
    const assignments = record(response.assignments)
    return items.length > 0 && items.every((item: AnyRecord) => assignments[item.id] === item.zone)
  }

  return false
}

function serialize(response: AnyRecord): string {
  if (response.type === 'scenario') return Object.entries(record(response.choices)).map(([stage, choice]) => `${stage}: ${choice}`).join(' | ')
  if (response.type === 'trueFalse' || response.type === 'singleChoice' || response.type === 'spotError' || response.type === 'shortAnswer') return String(response.value ?? '').trim()
  if (response.type === 'multiSelect' || response.type === 'markWords' || response.type === 'gridCheck') return arrayOfStrings(response.values).join(' | ')
  if (response.type === 'fillBlanks') return Object.entries(record(response.answers)).map(([id, val]) => `[${id}: ${val}]`).join(' | ')
  if (response.type === 'matching') return Object.entries(record(response.pairs)).map(([left, right]) => `${left} → ${right}`).join(' | ')
  if (response.type === 'sorting') return Object.entries(record(response.assignments)).map(([item, category]) => `${item} → ${category}`).join(' | ')
  if (response.type === 'ordering') return Array.isArray(response.order) ? response.order.join(' → ') : ''
  if (response.type === 'vennDiagram') return Object.entries(record(response.assignments)).map(([item, zone]) => `${item} → ${zone}`).join(' | ')
  return ''
}

function publicActivity(activity: AnyRecord) {
  const current = runtime(activity)
  const safeOrderingSteps = current.ordering.steps.length > 2
    ? [...current.ordering.steps].reverse()
    : (current.ordering.steps.length === 2 ? [current.ordering.steps[1], current.ordering.steps[0]] : current.ordering.steps)

  const fillBlanksBank = Array.from(
    new Set([
      ...(current.fillBlanks.blanks ?? []).map((b: AnyRecord) => String(b.answer ?? '').trim()).filter(Boolean),
      ...arrayOfStrings(current.fillBlanks.distractors).map((d) => d.trim()).filter(Boolean),
    ]),
  ).sort((a, b) => a.localeCompare(b, 'es'))

  const safeOptions = activity.type === 'matching'
    ? current.matching.pairs.map((pair: AnyRecord) => pair.right)
    : activity.type === 'sorting'
      ? current.sorting.items.map((item: AnyRecord) => item.label)
      : activity.type === 'vennDiagram'
        ? (current.vennDiagram.items ?? []).map((item: AnyRecord) => item.label)
      : activity.type === 'ordering'
        ? safeOrderingSteps
        : activity.type === 'fillBlanks'
          ? fillBlanksBank
          : arrayOfStrings(activity.options)
  const safeDetails: AnyRecord = {
    scenario: { situation: current.scenario.situation, stages: current.scenario.stages.map((stage: AnyRecord) => ({ id: stage.id, title: stage.title, prompt: stage.prompt, options: stage.options.map((option: AnyRecord) => ({ id: option.id, text: option.text, consequence: option.consequence, feedback: option.feedback })) })) },
    trueFalse: { statement: current.trueFalse.statement, explanation: current.trueFalse.explanation },
    matching: { pairs: current.matching.pairs.map((pair: AnyRecord, index: number, pairs: AnyRecord[]) => ({ id: pair.id, left: pair.left, right: pairs.length > 1 ? pairs[(index + 1) % pairs.length].right : pair.right })) },
    sorting: { categories: arrayOfStrings(current.sorting.categories), items: current.sorting.items.map((item: AnyRecord) => ({ id: item.id, label: item.label, category: '' })) },
    ordering: { steps: safeOrderingSteps },
    singleChoice: { options: current.singleChoice.options.map((option: AnyRecord) => ({ id: option.id, label: option.label, correct: false })) },
    multiSelect: { options: current.multiSelect.options.map((option: AnyRecord) => ({ id: option.id, label: option.label, correct: false })) },
    fillBlanks: {
      textWithBlanks: current.fillBlanks.textWithBlanks,
      blanks: (current.fillBlanks.blanks ?? []).map((b: AnyRecord) => ({ id: b.id, answer: '' })),
      distractors: [],
      bank: fillBlanksBank,
    },
    spotError: {
      segments: (current.spotError.segments ?? []).map((s: AnyRecord) => ({ id: s.id, text: s.text, hasError: false })),
    },
    markWords: {
      text: current.markWords.text,
      words: (current.markWords.words ?? []).map((w: AnyRecord) => ({ id: w.id, text: w.text, correct: false })),
    },
    gridCheck: {
      rows: (current.gridCheck.rows ?? []).map((r: AnyRecord) => ({ id: r.id, label: r.label })),
      columns: (current.gridCheck.columns ?? []).map((c: AnyRecord) => ({ id: c.id, label: c.label })),
    },
    vennDiagram: {
      setA: current.vennDiagram.setA,
      setB: current.vennDiagram.setB,
      intersectionLabel: current.vennDiagram.intersectionLabel,
      items: (current.vennDiagram.items ?? []).map((item: AnyRecord) => ({ id: item.id, label: item.label, zone: '' })),
    },
  }
  return { id: activity.id, template_id: activity.template_id, type: activity.type, title: activity.title, topic: activity.topic, difficulty: activity.difficulty, prompt: activity.prompt, options: safeOptions, feedback: activity.feedback, details: safeDetails, status: activity.status }
}

async function getRoomActivities(adminClient: ReturnType<typeof createClient>, roomId: string) {
  const { data: links, error: linksError } = await adminClient.from('room_activities').select('activity_id, position').eq('room_id', roomId).order('position', { ascending: true })
  if (linksError) throw new Error(linksError.message)
  const ids = (links ?? []).map((link) => link.activity_id)
  if (!ids.length) return { activityIds: [], activities: [], privateActivities: [] }
  const { data: activities, error: activityError } = await adminClient.from('activities').select(privateActivityFields).in('id', [...new Set(ids)])
  if (activityError) throw new Error(activityError.message)
  const byId = new Map((activities ?? []).map((activity) => [activity.id, activity]))
  return {
    activityIds: ids,
    activities: (ids.map((id) => byId.get(id)).filter(Boolean) as AnyRecord[]).map(publicActivity),
    privateActivities: (ids.map((id) => byId.get(id)).filter(Boolean) as AnyRecord[]),
  }
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') return json({ error: 'Método no permitido.' }, 405)

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
  const publishableKey = Deno.env.get('SUPABASE_PUBLISHABLE_KEY') ?? Deno.env.get('SUPABASE_ANON_KEY') ?? ''
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  const authorization = request.headers.get('Authorization')
  const token = authorization?.replace(/^Bearer\s+/i, '')
  if (!supabaseUrl || !publishableKey || !serviceRoleKey) return json({ error: 'Configuración de servidor incompleta.' }, 500)
  if (!token) return json({ error: 'Se requiere una sesión estudiantil.' }, 401)

  const callerClient = createClient(supabaseUrl, publishableKey, { global: { headers: { Authorization: `Bearer ${token}` } } })
  const { data: authData, error: authError } = await callerClient.auth.getUser(token)
  if (authError || !authData.user) return json({ error: 'Sesión no válida.' }, 401)
  if (!authData.user.is_anonymous) return json({ error: 'Esta función solo admite sesiones estudiantiles anónimas.' }, 403)

  const adminClient = createClient(supabaseUrl, serviceRoleKey)
  let body: AnyRecord
  try { body = await request.json() } catch { return json({ error: 'El cuerpo de la solicitud no es válido.' }, 400) }
  const action = String(body.action ?? '')
  const code = String(body.code ?? '').trim().toUpperCase()
  const roomId = body.roomId
  const roomQuery = isUuid(roomId) ? adminClient.from('rooms').select(roomFields).eq('id', roomId).maybeSingle() : adminClient.from('rooms').select(roomFields).eq('code', code).maybeSingle()
  const { data: room, error: roomError } = await roomQuery
  if (roomError) return json({ error: roomError.message }, 500)
  if (!room) return json({ error: 'No encontramos una sala con ese código.' }, 404)
  if (action === 'status') return json({ ok: true, room })

  if (action === 'join') {
    const displayName = String(body.displayName ?? '').trim()
    if (displayName.length < 2) return json({ error: 'Escribe un nombre válido.' }, 400)
    if (room.status === 'ready' || room.status === 'draft') return json({ error: 'La sala todavía no fue abierta por el docente.' }, 409)
    if (room.status === 'finished' || room.status === 'archived') return json({ error: 'Esta sala ya no acepta participantes.' }, 409)
    const nameNormalized = normalizeName(displayName)
    const { data: existingParticipant, error: existingError } = await adminClient.from('room_participants').select('id, room_id, display_name, name_normalized, joined_at, last_seen_at, status').eq('room_id', room.id).eq('auth_user_id', authData.user.id).maybeSingle()
    if (existingError) return json({ error: existingError.message }, 500)
    if (existingParticipant) {
      const { data: existingAttempt, error: attemptError } = await adminClient.from('attempts').select('id').eq('participant_id', existingParticipant.id).maybeSingle()
      if (attemptError) return json({ error: attemptError.message }, 500)
      if (existingAttempt) return json({ ok: false, alreadyAttempted: true, error: 'Ya tienes un intento registrado para esta sala.' }, 409)
      const content = await getRoomActivities(adminClient, room.id)
      return json({
        ok: true,
        room,
        participant: existingParticipant,
        activityIds: content.activityIds,
        activities: content.activities,
      })
    }
    const { count, error: countError } = await adminClient.from('room_participants').select('id', { count: 'exact', head: true }).eq('room_id', room.id).neq('status', 'abandoned')
    if (countError) return json({ error: countError.message }, 500)
    if ((count ?? 0) >= room.student_limit) return json({ error: 'La sala alcanzó el límite de estudiantes.' }, 409)
    const { data: participant, error: participantError } = await adminClient.from('room_participants').insert({ room_id: room.id, auth_user_id: authData.user.id, display_name: displayName, name_normalized: nameNormalized, status: room.status === 'active' ? 'in_progress' : 'joined' }).select('id, room_id, display_name, name_normalized, joined_at, last_seen_at, status').single()
    if (participantError || !participant) return json({ error: participantError?.message ?? 'No se pudo registrar al participante.' }, 500)
    const content = await getRoomActivities(adminClient, room.id)
    return json({
      ok: true,
      room,
      participant,
      activityIds: content.activityIds,
      activities: content.activities,
    }, 201)
  }

  if (action === 'submit_attempt') {
    const participantId = body.participantId
    const attempt = record(body.attempt)
    if (!isUuid(participantId) || !isUuid(room.id)) return json({ error: 'Participante o sala no válidos.' }, 400)
    const { data: participant, error: participantError } = await adminClient.from('room_participants').select('id, room_id, auth_user_id').eq('id', participantId).eq('room_id', room.id).eq('auth_user_id', authData.user.id).maybeSingle()
    if (participantError) return json({ error: participantError.message }, 500)
    if (!participant) return json({ error: 'El participante no pertenece a esta sesión.' }, 403)

    if (room.status === 'finished' || room.status === 'archived') {
      return json({ error: 'La sala ya no acepta más entregas porque fue finalizada por el docente.' }, 409)
    }
    if (room.status !== 'active') {
      return json({ error: 'La sala no se encuentra en curso para recibir entregas.' }, 409)
    }

    const { data: previousAttempt, error: previousError } = await adminClient.from('attempts').select('id').eq('participant_id', participantId).maybeSingle()
    if (previousError) return json({ error: previousError.message }, 500)
    if (previousAttempt) return json({ ok: true, attemptId: previousAttempt.id, alreadySaved: true })

    let attemptStatus = attempt.status === 'timeout' ? 'timeout' : 'completed'
    const timeMinutes = Number(room.time_minutes)
    if (timeMinutes > 0 && room.started_at) {
      const roomStartedTime = new Date(room.started_at).getTime()
      if (!Number.isNaN(roomStartedTime)) {
        const elapsedMs = Date.now() - roomStartedTime
        const limitMs = timeMinutes * 60 * 1000
        const gracePeriodMs = 60 * 1000 // 60 segundos de gracia por latencia de red
        if (elapsedMs > limitMs + gracePeriodMs + 5 * 60 * 1000) {
          return json({ error: 'El plazo para entregar esta evaluación ha expirado completamente.' }, 409)
        }
        if (elapsedMs > limitMs + gracePeriodMs) {
          attemptStatus = 'timeout'
        }
      }
    }

    const content = await getRoomActivities(adminClient, room.id)
    const privateById = new Map(content.privateActivities.map((activity: AnyRecord) => [activity.id, activity]))
    const responses = Array.isArray(body.responses) ? body.responses as AnyRecord[] : []
    const evaluated = (responses.map((item) => {
      const activity = privateById.get(item.activityId)
      if (!activity) return null
      const resp = record(item.response)
      const omitted = isOmitted(activity, resp)
      const answered = !omitted
      const correct = answered ? compare(activity, resp) : null
      const score = correct === true ? Number(room.score_per_question) : 0
      const serializedText = answered ? serialize(resp) : ''
      const status = answered ? 'answered' : 'omitted'
      return {
        item,
        activity,
        response: resp,
        result: { response: serializedText, status, correct, score },
      }
    }).filter(Boolean) as AnyRecord[])
    const answerRows = evaluated.map(({ item, activity, response, result }) => ({ activity_id: activity.id, question_index: Number(item.index ?? 0), response: response, response_text: result.response, status: result.status, correct: result.correct, score: result.score, time_seconds: Number(item.timeSeconds ?? 0) }))
    const answeredCount = evaluated.filter((item) => item.result.status === 'answered').length
    const omittedCount = evaluated.filter((item) => item.result.status === 'omitted').length
    const correctCount = evaluated.filter((item) => item.result.correct === true).length
    const score = evaluated.reduce((total, item) => total + item.result.score, 0)
    const maxScore = evaluated.length * Number(room.score_per_question)

    // Intento de guardado transaccional atómico mediante función RPC PostgreSQL
    const { data: rpcResult, error: rpcError } = await adminClient.rpc('submit_student_attempt_atomic', {
      p_room_id: room.id,
      p_participant_id: participantId,
      p_started_at: typeof attempt.startedAt === 'string' ? attempt.startedAt : new Date().toISOString(),
      p_finished_at: typeof attempt.finishedAt === 'string' ? attempt.finishedAt : new Date().toISOString(),
      p_status: attemptStatus,
      p_total_questions: evaluated.length,
      p_answered_count: answeredCount,
      p_omitted_count: omittedCount,
      p_correct_count: correctCount,
      p_score: score,
      p_max_score: maxScore,
      p_events: Array.isArray(attempt.events) ? attempt.events : [],
      p_answers: answerRows,
    })

    if (!rpcError && rpcResult && rpcResult.ok) {
      return json({ ok: true, attemptId: rpcResult.attemptId, score, maxScore, alreadySaved: rpcResult.alreadySaved ?? false }, 201)
    }

    // Fallback de contingencia: Guardado directo si la RPC no estuviese desplegada en base de datos
    const { data: savedAttempt, error: savedAttemptError } = await adminClient.from('attempts').insert({ room_id: room.id, participant_id: participantId, started_at: typeof attempt.startedAt === 'string' ? attempt.startedAt : new Date().toISOString(), finished_at: typeof attempt.finishedAt === 'string' ? attempt.finishedAt : new Date().toISOString(), status: attemptStatus, total_questions: evaluated.length, answered_count: answeredCount, omitted_count: omittedCount, correct_count: correctCount, score, max_score: maxScore, events: Array.isArray(attempt.events) ? attempt.events : [] }).select('id').single()
    if (savedAttemptError || !savedAttempt) return json({ error: savedAttemptError?.message ?? rpcError?.message ?? 'No se pudo guardar el intento.' }, 500)
    const finalAnswerRows = answerRows.map((answer) => ({ ...answer, attempt_id: savedAttempt.id }))
    if (finalAnswerRows.length) {
      const { error: answerError } = await adminClient.from('attempt_answers').insert(finalAnswerRows)
      if (answerError) { await adminClient.from('attempts').delete().eq('id', savedAttempt.id); return json({ error: answerError.message }, 500) }
    }
    await adminClient.from('room_participants').update({ status: 'completed', last_seen_at: new Date().toISOString() }).eq('id', participantId)
    return json({ ok: true, attemptId: savedAttempt.id, score, maxScore }, 201)
  }

  return json({ error: 'Acción no reconocida.' }, 400)
})
