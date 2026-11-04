import { evaluateShortAnswerResponse, type ShortAnswerDefinition } from './activities/shortAnswer'

export type ActivityType = 'trueFalse' | 'singleChoice' | 'multiSelect' | 'fillBlanks' | 'spotError' | 'markWords' | 'gridCheck' | 'vennDiagram' | 'shortAnswer' | 'matching' | 'sorting' | 'ordering' | 'scenario'

export type ScenarioOption = { id: string; text: string; consequence: string; feedback: string; recommended: boolean }
export type ScenarioStage = { id: string; title: string; prompt: string; options: ScenarioOption[] }
export type MatchingPair = { id: string; left: string; right: string }
export type SortingItem = { id: string; label: string; category: string }
export type ChoiceOption = { id: string; label: string; correct: boolean }
export type FillBlankSlot = { id: string; answer: string }
export type SpotErrorSegment = { id: string; text: string; hasError: boolean }
export type MarkWordsToken = { id: string; text: string; correct: boolean }
export type GridCheckRow = { id: string; label: string }
export type GridCheckColumn = { id: string; label: string }
export type VennZone = 'left' | 'both' | 'right'
export type VennItem = { id: string; label: string; zone: VennZone }
export type ActivityDetails = {
  // context y hint pertenecen al contrato v1.2 (src/lib/activities/trueFalse.ts); son opcionales para actividades heredadas.
  trueFalse?: { statement: string; correct: boolean; explanation: string; context?: string; hint?: string }
  // context, hint y explanation pertenecen al contrato v1.2 (src/lib/activities/singleChoice.ts); son opcionales para actividades heredadas.
  singleChoice?: { options: ChoiceOption[]; context?: string; hint?: string; explanation?: string }
  // context, hint y explanation pertenecen al contrato v1.3 (src/lib/activities/multiSelect.ts).
  multiSelect?: { options: ChoiceOption[]; context?: string; hint?: string; explanation?: string }
  // textWithBlanks, blanks, distractors, context, hint y explanation pertenecen al contrato v1.3 (src/lib/activities/fillBlanks.ts).
  fillBlanks?: { textWithBlanks: string; blanks: FillBlankSlot[]; distractors: string[]; bank?: string[]; context?: string; hint?: string; explanation?: string }
  // segments, correction, context, hint y explanation pertenecen al contrato v1.3 (src/lib/activities/spotError.ts).
  spotError?: { segments: SpotErrorSegment[]; correction?: string; context?: string; hint?: string; explanation?: string }
  // text, words, context, hint y explanation pertenecen al contrato v1.3 (src/lib/activities/markWords.ts).
  markWords?: { text: string; words: MarkWordsToken[]; context?: string; hint?: string; explanation?: string }
  // rows, columns, expectedCells, context, hint y explanation pertenecen al contrato v1.3 (src/lib/activities/gridCheck.ts).
  gridCheck?: { rows: GridCheckRow[]; columns: GridCheckColumn[]; expectedCells: string[]; context?: string; hint?: string; explanation?: string }
  // setA, setB, intersectionLabel, items, context, hint y explanation pertenecen al contrato v1.3 (src/lib/activities/vennDiagram.ts).
  vennDiagram?: { setA: string; setB: string; intersectionLabel?: string; items: VennItem[]; context?: string; hint?: string; explanation?: string }
  // prompt, acceptedAnswers, caseSensitive, ignoreAccents, placeholder, context, hint y explanation pertenecen al contrato v1.3 (src/lib/activities/shortAnswer.ts).
  shortAnswer?: { prompt?: string; acceptedAnswers: string[]; caseSensitive?: boolean; ignoreAccents?: boolean; placeholder?: string; context?: string; hint?: string; explanation?: string }
  // context, hint y explanation pertenecen al contrato v1.2 (src/lib/activities/matching.ts); son opcionales para actividades heredadas.
  matching?: { pairs: MatchingPair[]; context?: string; hint?: string; explanation?: string }
  // context, hint y explanation pertenecen al contrato v1.2 (src/lib/activities/sorting.ts); son opcionales para actividades heredadas.
  sorting?: { categories: string[]; items: SortingItem[]; context?: string; hint?: string; explanation?: string }
  // context, hint y explanation pertenecen al contrato v1.2 (src/lib/activities/ordering.ts); son opcionales para actividades heredadas.
  ordering?: { steps: string[]; context?: string; hint?: string; explanation?: string }
  // hint y explanation pertenecen al contrato v1.2 (src/lib/activities/scenario.ts); son opcionales para actividades heredadas.
  scenario?: { situation: string; stages: ScenarioStage[]; hint?: string; explanation?: string }
}

export type Activity = {
  id: string
  templateId?: string
  title: string
  type: ActivityType
  topic: string
  difficulty: 'Inicial' | 'Intermedio' | 'Avanzado'
  prompt: string
  options: string[]
  answer: string | string[]
  feedback: string
  details?: ActivityDetails
  status: 'published' | 'draft' | 'pending'
  needsRepair?: boolean
  repairReason?: string
  rawImport?: Record<string, unknown>
}

export type ActivityResponse =
  | { type: 'scenario'; choices: Record<string, string> }
  | { type: 'trueFalse'; value: string }
  | { type: 'singleChoice'; value: string }
  | { type: 'multiSelect'; values: string[] }
  | { type: 'fillBlanks'; answers: Record<string, string> }
  | { type: 'spotError'; value: string }
  | { type: 'markWords'; values: string[] }
  | { type: 'gridCheck'; values: string[] }
  | { type: 'vennDiagram'; assignments: Record<string, VennZone> }
  | { type: 'shortAnswer'; value: string }
  | { type: 'matching'; pairs: Record<string, string> }
  | { type: 'sorting'; assignments: Record<string, string> }
  | { type: 'ordering'; order: string[] }

export type RuntimeActivity = {
  scenario: NonNullable<ActivityDetails['scenario']>
  trueFalse: NonNullable<ActivityDetails['trueFalse']>
  matching: NonNullable<ActivityDetails['matching']>
  sorting: NonNullable<ActivityDetails['sorting']>
  ordering: NonNullable<ActivityDetails['ordering']>
  singleChoice: NonNullable<ActivityDetails['singleChoice']>
  multiSelect: NonNullable<ActivityDetails['multiSelect']>
  fillBlanks: NonNullable<ActivityDetails['fillBlanks']>
  spotError: NonNullable<ActivityDetails['spotError']>
  markWords: NonNullable<ActivityDetails['markWords']>
  gridCheck: NonNullable<ActivityDetails['gridCheck']>
  vennDiagram: NonNullable<ActivityDetails['vennDiagram']>
  shortAnswer: NonNullable<ActivityDetails['shortAnswer']>
}

export type EvaluatedResponse = {
  response: string
  status: 'answered' | 'omitted'
  correct: boolean | null
  score: number
}

export function activityRuntime(activity: Activity): RuntimeActivity {
  const details = activity.details ?? {}
  const scenarioOptions = activity.options.map((text, index) => ({ id: `fallback-option-${index}`, text, consequence: activity.feedback, feedback: activity.feedback, recommended: text === activity.answer }))
  const matchingPairs = activity.options.map((option, index) => { const [left, right] = option.split('→').map((part) => part.trim()); return { id: `fallback-pair-${index}`, left: left || option, right: right || option } })
  const sortingAnswer = Array.isArray(activity.answer) ? activity.answer : []
  const sortingItems = activity.options.map((label, index) => ({ id: `fallback-item-${index}`, label, category: sortingAnswer[index] ?? 'Sin categoría' }))
  const orderingSteps = Array.isArray(activity.answer) ? activity.answer : activity.options
  const choiceOptions = activity.options.map((label, index) => ({ id: `fallback-choice-${index}`, label, correct: label === activity.answer }))
  const multiSelectAnswers = Array.isArray(activity.answer) ? activity.answer : [activity.answer]
  const multiChoiceOptions = activity.options.map((label, index) => ({ id: `fallback-ms-${index}`, label, correct: multiSelectAnswers.includes(label) }))
  const fillBlanksAnswers = Array.isArray(activity.answer) ? activity.answer : [activity.answer]
  const fallbackBlanks = fillBlanksAnswers.filter(Boolean).map((ans, index) => ({ id: `fallback-blank-${index + 1}`, answer: ans }))
  const fallbackDistractors = activity.options.filter((opt) => !fillBlanksAnswers.includes(opt))
  const spotErrorSegments = activity.options.map((text, index) => ({ id: `fallback-seg-${index + 1}`, text, hasError: text === activity.answer }))
  const markWordsAnswers = Array.isArray(activity.answer) ? activity.answer : [activity.answer]
  const markWordsTokens = activity.options.map((text, index) => ({ id: `fallback-mw-${index + 1}`, text, correct: markWordsAnswers.includes(text) }))
  const gridCheckRows = details.gridCheck?.rows ?? [
    { id: 'r1', label: activity.options[0] ?? 'Fila 1' },
    { id: 'r2', label: activity.options[1] ?? 'Fila 2' },
  ]
  const gridCheckColumns = details.gridCheck?.columns ?? [
    { id: 'c1', label: 'Criterio A' },
    { id: 'c2', label: 'Criterio B' },
  ]
  const gridCheckExpected = details.gridCheck?.expectedCells ?? (Array.isArray(activity.answer) ? activity.answer : [activity.answer]).filter(Boolean)
  const vennItems: VennItem[] = details.vennDiagram?.items ?? activity.options.map((label, index) => {
    const zone: VennZone = index % 3 === 0 ? 'left' : index % 3 === 1 ? 'both' : 'right'
    return { id: `fallback-venn-${index + 1}`, label, zone }
  })
  return {
    scenario: details.scenario ?? { situation: activity.prompt, stages: [{ id: 'fallback-stage', title: 'Decisión', prompt: activity.prompt, options: scenarioOptions }] },
    trueFalse: details.trueFalse ?? { statement: activity.prompt, correct: activity.answer === 'Verdadero', explanation: activity.feedback },
    matching: details.matching ?? { pairs: matchingPairs },
    sorting: details.sorting ?? { categories: Array.from(new Set(sortingAnswer)), items: sortingItems },
    ordering: details.ordering ?? { steps: orderingSteps },
    singleChoice: details.singleChoice ?? { options: choiceOptions },
    multiSelect: details.multiSelect ?? { options: multiChoiceOptions },
    fillBlanks: details.fillBlanks ?? { textWithBlanks: activity.prompt, blanks: fallbackBlanks, distractors: fallbackDistractors },
    spotError: details.spotError ?? { segments: spotErrorSegments },
    markWords: details.markWords ?? { text: activity.prompt, words: markWordsTokens },
    gridCheck: details.gridCheck ?? { rows: gridCheckRows, columns: gridCheckColumns, expectedCells: gridCheckExpected },
    vennDiagram: details.vennDiagram ?? {
      setA: 'Conjunto A',
      setB: 'Conjunto B',
      intersectionLabel: 'Ambos / Compartido',
      items: vennItems,
    },
    shortAnswer: details.shortAnswer ?? {
      prompt: activity.prompt,
      acceptedAnswers: Array.isArray(activity.answer) ? activity.answer : [String(activity.answer ?? activity.options[0] ?? '').trim()].filter(Boolean),
      caseSensitive: false,
      ignoreAccents: true,
      placeholder: 'Escribe tu respuesta aquí...',
      hint: activity.feedback,
    },
  }
}

export function createInitialResponse(activity: Activity): ActivityResponse {
  if (activity.type === 'scenario') return { type: 'scenario', choices: {} }
  if (activity.type === 'multiSelect') return { type: 'multiSelect', values: [] }
  if (activity.type === 'fillBlanks') return { type: 'fillBlanks', answers: {} }
  if (activity.type === 'spotError') return { type: 'spotError', value: '' }
  if (activity.type === 'markWords') return { type: 'markWords', values: [] }
  if (activity.type === 'gridCheck') return { type: 'gridCheck', values: [] }
  if (activity.type === 'vennDiagram') return { type: 'vennDiagram', assignments: {} }
  if (activity.type === 'shortAnswer') return { type: 'shortAnswer', value: '' }
  if (activity.type === 'matching') return { type: 'matching', pairs: {} }
  if (activity.type === 'sorting') return { type: 'sorting', assignments: {} }
  if (activity.type === 'ordering') return { type: 'ordering', order: shuffleItems(activityRuntime(activity).ordering.steps) }
  return { type: activity.type, value: '' }
}

export function isResponseComplete(activity: Activity, response: ActivityResponse): boolean {
  const runtime = activityRuntime(activity)
  if (response.type === 'scenario') return runtime.scenario.stages.length > 0 && runtime.scenario.stages.every((stage) => Boolean(response.choices[stage.id]))
  if (response.type === 'trueFalse' || response.type === 'singleChoice' || response.type === 'spotError' || response.type === 'shortAnswer') return Boolean(response.value && response.value.trim())
  if (response.type === 'multiSelect' || response.type === 'markWords' || response.type === 'gridCheck') return response.values.some((val) => Boolean(val && val.trim()))
  if (response.type === 'vennDiagram') return runtime.vennDiagram.items.length > 0 && runtime.vennDiagram.items.every((it) => Boolean(response.assignments[it.id]))
  if (response.type === 'fillBlanks') {
    const blanks = runtime.fillBlanks.blanks
    return blanks.length > 0 && blanks.every((blank, index) => Boolean(response.answers[blank.id] || response.answers[String(index + 1)]))
  }
  if (response.type === 'matching') return runtime.matching.pairs.length > 0 && runtime.matching.pairs.every((pair) => Boolean(response.pairs[pair.left]))
  if (response.type === 'sorting') return runtime.sorting.items.length > 0 && runtime.sorting.items.every((item) => Boolean(response.assignments[item.id]))
  return response.order.length === runtime.ordering.steps.length && new Set(response.order).size === runtime.ordering.steps.length
}

export function compareActivityResponse(activity: Activity, response: ActivityResponse): boolean {
  if (!isResponseComplete(activity, response)) return false
  const runtime = activityRuntime(activity)
  if (response.type === 'scenario') return activity.type === 'scenario' && runtime.scenario.stages.every((stage) => stage.options.find((option) => option.id === response.choices[stage.id] || option.text === response.choices[stage.id])?.recommended === true)
  if (response.type === 'shortAnswer') {
    if (activity.type !== 'shortAnswer') return false
    const def: ShortAnswerDefinition = {
      prompt: activity.prompt,
      acceptedAnswers: runtime.shortAnswer.acceptedAnswers,
      caseSensitive: runtime.shortAnswer.caseSensitive,
      ignoreAccents: runtime.shortAnswer.ignoreAccents,
      hint: runtime.shortAnswer.hint ?? activity.feedback,
      explanation: runtime.shortAnswer.explanation ?? '',
    }
    const evaluated = evaluateShortAnswerResponse(def, response, 10)
    return evaluated.correct === true
  }
  if (response.type === 'trueFalse') return activity.type === 'trueFalse' && response.value === (runtime.trueFalse.correct ? 'Verdadero' : 'Falso')
  if (response.type === 'singleChoice') return activity.type === 'singleChoice' && runtime.singleChoice.options.find((option) => option.id === response.value || option.label === response.value)?.correct === true
  if (response.type === 'spotError') return activity.type === 'spotError' && runtime.spotError.segments.find((seg) => seg.id === response.value || seg.text === response.value)?.hasError === true
  if (response.type === 'markWords') {
    if (activity.type !== 'markWords') return false
    const words = runtime.markWords.words
    const expectedTokens = words.filter((w) => w.correct)
    if (expectedTokens.length === 0) return false
    const expectedIds = new Set(expectedTokens.map((w) => w.id))
    const selectedTokens: MarkWordsToken[] = []
    for (const val of response.values) {
      const clean = val.trim().toLocaleLowerCase()
      const matched = words.find((w) => w.id === val || w.text.trim().toLocaleLowerCase() === clean)
      if (!matched) return false
      selectedTokens.push(matched)
    }
    const selectedIds = new Set(selectedTokens.map((t) => t.id))
    const hasAllCorrect = expectedIds.size > 0 && Array.from(expectedIds).every((id) => selectedIds.has(id))
    const hasNoDistractors = selectedTokens.every((t) => t.correct === true)
    return hasAllCorrect && hasNoDistractors && selectedIds.size === expectedIds.size
  }
  if (response.type === 'gridCheck') {
    if (activity.type !== 'gridCheck') return false
    const expected = new Set(runtime.gridCheck.expectedCells.map((c) => c.trim().toLowerCase()))
    const selected = new Set(response.values.filter((v) => Boolean(v && v.trim())).map((v) => v.trim().toLowerCase()))
    if (expected.size === 0) return false
    if (selected.size !== expected.size) return false
    return Array.from(expected).every((cell) => selected.has(cell))
  }
  if (response.type === 'vennDiagram') {
    if (activity.type !== 'vennDiagram') return false
    const items = runtime.vennDiagram.items
    if (items.length === 0) return false
    return items.every((it) => response.assignments[it.id] === it.zone)
  }
  if (response.type === 'multiSelect') {
    if (activity.type !== 'multiSelect') return false
    const options = runtime.multiSelect.options
    const expectedIds = new Set(options.filter((option) => option.correct).map((option) => option.id))
    if (expectedIds.size === 0) return false
    const selectedIds = new Set<string>()
    for (const val of response.values) {
      const matched = options.find((option) => option.id === val || option.label === val)
      if (!matched) return false
      selectedIds.add(matched.id)
    }
    return selectedIds.size === expectedIds.size && Array.from(expectedIds).every((id) => selectedIds.has(id))
  }
  if (response.type === 'fillBlanks') {
    if (activity.type !== 'fillBlanks') return false
    return runtime.fillBlanks.blanks.every((blank, index) => {
      const chosen = response.answers[blank.id] ?? response.answers[String(index + 1)] ?? ''
      return chosen.trim() === blank.answer.trim()
    })
  }
  if (response.type === 'matching') return activity.type === 'matching' && runtime.matching.pairs.every((pair) => response.pairs[pair.left] === pair.right)
  if (response.type === 'sorting') return activity.type === 'sorting' && runtime.sorting.items.every((item) => response.assignments[item.id] === item.category)
  if (response.type === 'ordering') return activity.type === 'ordering' && response.order.every((step, index) => step === runtime.ordering.steps[index])
  return false
}

export function serializeActivityResponse(response: ActivityResponse): string {
  if (response.type === 'scenario') return Object.entries(response.choices).map(([stage, choice]) => `${stage}: ${choice}`).join(' | ')
  if (response.type === 'trueFalse' || response.type === 'singleChoice' || response.type === 'spotError' || response.type === 'shortAnswer') return response.value.trim()
  if (response.type === 'multiSelect' || response.type === 'markWords' || response.type === 'gridCheck') return response.values.join(' | ')
  if (response.type === 'vennDiagram') return Object.entries(response.assignments).map(([id, zone]) => `${id}: ${zone}`).join(' | ')
  if (response.type === 'fillBlanks') return Object.entries(response.answers).filter(([, val]) => Boolean(val)).map(([key, val]) => `${key}: ${val}`).join(' | ')
  if (response.type === 'matching') return Object.entries(response.pairs).map(([left, right]) => `${left} → ${right}`).join(' | ')
  if (response.type === 'sorting') return Object.entries(response.assignments).map(([item, category]) => `${item} → ${category}`).join(' | ')
  return response.order.join(' → ')
}

export function evaluateActivityResponse(activity: Activity, response: ActivityResponse | undefined, scorePerQuestion: number): EvaluatedResponse {
  if (!response) return { response: '', status: 'omitted', correct: null, score: 0 }
  // Falso/verdadero, Selección única, Selección múltiple, Completar espacios, Detección del error, Marcar palabras, Matriz de doble entrada, Diagrama de Venn, Asociación, Clasificación, Ordenamiento y Escenario: una respuesta vacía es una omisión, nunca una respuesta incorrecta.
  if (response.type === 'trueFalse' && activity.type === 'trueFalse' && (!response.value || !response.value.trim())) return { response: '', status: 'omitted', correct: null, score: 0 }
  if (response.type === 'singleChoice' && activity.type === 'singleChoice' && (!response.value || !response.value.trim())) return { response: '', status: 'omitted', correct: null, score: 0 }
  if (response.type === 'spotError' && activity.type === 'spotError' && !response.value.trim()) return { response: '', status: 'omitted', correct: null, score: 0 }
  if (response.type === 'shortAnswer' && activity.type === 'shortAnswer' && !response.value.trim()) return { response: '', status: 'omitted', correct: null, score: 0 }
  if (response.type === 'multiSelect' && activity.type === 'multiSelect' && response.values.filter((val) => val.trim()).length === 0) return { response: '', status: 'omitted', correct: null, score: 0 }
  if (response.type === 'markWords' && activity.type === 'markWords' && response.values.filter((val) => val.trim()).length === 0) return { response: '', status: 'omitted', correct: null, score: 0 }
  if (response.type === 'gridCheck' && activity.type === 'gridCheck' && response.values.filter((val) => val.trim()).length === 0) return { response: '', status: 'omitted', correct: null, score: 0 }
  if (response.type === 'vennDiagram' && activity.type === 'vennDiagram' && Object.values(response.assignments).every((value) => !value)) return { response: '', status: 'omitted', correct: null, score: 0 }
  if (response.type === 'fillBlanks' && activity.type === 'fillBlanks' && Object.values(response.answers).every((value) => !value || !value.trim())) return { response: '', status: 'omitted', correct: null, score: 0 }
  if (response.type === 'matching' && activity.type === 'matching' && Object.values(response.pairs).every((value) => !value)) return { response: '', status: 'omitted', correct: null, score: 0 }
  if (response.type === 'sorting' && activity.type === 'sorting' && Object.values(response.assignments).every((value) => !value)) return { response: '', status: 'omitted', correct: null, score: 0 }
  if (response.type === 'ordering' && activity.type === 'ordering' && response.order.length === 0) return { response: '', status: 'omitted', correct: null, score: 0 }
  if (response.type === 'scenario' && activity.type === 'scenario' && Object.values(response.choices).every((value) => !value)) return { response: '', status: 'omitted', correct: null, score: 0 }
  const correct = compareActivityResponse(activity, response)
  return { response: serializeActivityResponse(response), status: 'answered', correct, score: correct ? scorePerQuestion : 0 }
}

function shuffleItems<T>(items: T[]): T[] {
  const result = [...items]
  for (let index = result.length - 1; index > 0; index -= 1) {
    const target = Math.floor(Math.random() * (index + 1))
    ;[result[index], result[target]] = [result[target], result[index]]
  }
  return result
}
