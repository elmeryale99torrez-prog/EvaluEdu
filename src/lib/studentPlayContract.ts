import {
  type Activity,
  type ActivityDetails,
  type ActivityResponse,
  type RuntimeActivity,
  type VennZone,
} from './activityEngine'
import { scrambleWordBank } from './activities/fillBlanks'
import { parseMarkWordsText } from './activities/markWords'

export type SimpleChoiceDisplayOption = {
  value: string
  label: string
}

export type MarkWordsInteractiveSegment =
  | { kind: 'text'; text: string }
  | { kind: 'word'; tokenId: string; text: string; index: number }

export function getSimpleChoiceDisplayOptions(
  type: Activity['type'],
  singleChoiceRuntime: NonNullable<ActivityDetails['singleChoice']>
): SimpleChoiceDisplayOption[] {
  if (type === 'trueFalse') {
    return [
      { value: 'Verdadero', label: 'Verdadero' },
      { value: 'Falso', label: 'Falso' },
    ]
  }
  return (singleChoiceRuntime.options ?? []).map((option, index) => ({
    value: option.id || `choice-${index + 1}`,
    label: option.label,
  }))
}

export function selectSimpleChoiceResponse(
  type: Activity['type'],
  optionValue: string
): Extract<ActivityResponse, { type: 'trueFalse' | 'singleChoice' }> {
  return type === 'trueFalse'
    ? { type: 'trueFalse', value: optionValue }
    : { type: 'singleChoice', value: optionValue }
}

export function getMultiSelectOptionId(option: { id?: string; label?: string }): string {
  return option.id || option.label || ''
}

export function toggleMultiSelectOption(
  selectedValues: readonly string[],
  option: { id?: string; label?: string }
): string[] {
  const identifier = getMultiSelectOptionId(option)
  if (!identifier) return [...selectedValues]
  const isSelected = selectedValues.includes(identifier)
  return isSelected
    ? selectedValues.filter((v) => v !== identifier)
    : [...selectedValues, identifier]
}

export function buildMarkWordsInteractiveSegments(
  markWordsRuntime: NonNullable<ActivityDetails['markWords']>
): MarkWordsInteractiveSegment[] {
  const parsed = parseMarkWordsText(markWordsRuntime.text ?? '')
  const words = markWordsRuntime.words ?? []
  const hasParsedWordSegments = parsed.segments.some((seg) => seg.kind === 'word')

  if (hasParsedWordSegments) {
    return parsed.segments.map((segment) => {
      if (segment.kind === 'text') {
        return { kind: 'text', text: segment.text }
      }
      const mappedWord = words[segment.index]
      return {
        kind: 'word',
        tokenId: mappedWord?.id || segment.id,
        text: segment.text,
        index: segment.index,
      }
    })
  }

  // Respaldo explícito cuando una actividad heredada define words sin corchetes en text
  const fallbackSegments: MarkWordsInteractiveSegment[] = []
  if (markWordsRuntime.text) {
    fallbackSegments.push({ kind: 'text', text: `${markWordsRuntime.text} ` })
  }
  words.forEach((word, index) => {
    fallbackSegments.push({
      kind: 'word',
      tokenId: word.id || `mw-${index + 1}`,
      text: word.text,
      index,
    })
  })
  return fallbackSegments
}

export function toggleMarkWordToken(selectedValues: readonly string[], tokenId: string): string[] {
  if (!tokenId) return [...selectedValues]
  const isMarked = selectedValues.includes(tokenId)
  return isMarked
    ? selectedValues.filter((id) => id !== tokenId)
    : [...selectedValues, tokenId]
}

export function resolveFillBlanksWordBank(
  fillBlanksRuntime: NonNullable<ActivityDetails['fillBlanks']>
): string[] {
  if (Array.isArray(fillBlanksRuntime.bank) && fillBlanksRuntime.bank.length > 0) {
    return [...fillBlanksRuntime.bank]
  }
  return scrambleWordBank(
    (fillBlanksRuntime.blanks ?? []).map((b) => String(b.answer ?? '')),
    fillBlanksRuntime.distractors ?? []
  )
}

export type FillBlanksBankChip = {
  chipIndex: number
  word: string
  used: boolean
}

function getAssignedBlankWords(
  fillBlanksRuntime: NonNullable<ActivityDetails['fillBlanks']>,
  answers: Record<string, string>
): string[] {
  const blanks = fillBlanksRuntime.blanks ?? []
  if (blanks.length === 0) {
    return Object.values(answers)
      .map((val) => String(val ?? '').trim())
      .filter(Boolean)
  }
  const assigned: string[] = []
  blanks.forEach((blank, idx) => {
    const val = (answers[blank.id] || answers[String(idx + 1)] || '').trim()
    if (val) assigned.push(val)
  })
  return assigned
}

export function getFillBlanksBankChips(
  fillBlanksRuntime: NonNullable<ActivityDetails['fillBlanks']>,
  answers: Record<string, string>
): FillBlanksBankChip[] {
  const wordBank = resolveFillBlanksWordBank(fillBlanksRuntime)
  const remainingUsedByWord = new Map<string, number>()
  for (const usedWord of getAssignedBlankWords(fillBlanksRuntime, answers)) {
    const norm = usedWord.trim().toLowerCase()
    remainingUsedByWord.set(norm, (remainingUsedByWord.get(norm) ?? 0) + 1)
  }

  return wordBank.map((word, chipIndex) => {
    const norm = word.trim().toLowerCase()
    const remainingUsed = remainingUsedByWord.get(norm) ?? 0
    if (remainingUsed > 0) {
      remainingUsedByWord.set(norm, remainingUsed - 1)
      return { chipIndex, word, used: true }
    }
    return { chipIndex, word, used: false }
  })
}

export function selectFillBlanksWord(params: {
  runtime: NonNullable<ActivityDetails['fillBlanks']>
  answers: Record<string, string>
  activeSlotId: string | null
  word: string
  chipIndex?: number
}): { nextAnswers: Record<string, string>; nextActiveSlotId: string | null } | null {
  const chips = getFillBlanksBankChips(params.runtime, params.answers)
  const normTarget = params.word.trim().toLowerCase()
  if (!normTarget) return null

  const availableChip =
    typeof params.chipIndex === 'number'
      ? chips[params.chipIndex]
      : chips.find((chip) => !chip.used && chip.word.trim().toLowerCase() === normTarget)

  if (!availableChip || availableChip.used || availableChip.word.trim().toLowerCase() !== normTarget) {
    return null
  }

  const blanks = params.runtime.blanks ?? []
  const isSlotFilled = (slotId: string) => {
    const idx = blanks.findIndex((b) => b.id === slotId)
    if (idx >= 0) {
      return Boolean((params.answers[slotId] || params.answers[String(idx + 1)] || '').trim())
    }
    return Boolean((params.answers[slotId] || '').trim())
  }

  let targetSlot = params.activeSlotId
  if (!targetSlot || isSlotFilled(targetSlot)) {
    const firstEmpty = blanks.find((b, idx) => !params.answers[b.id] && !params.answers[String(idx + 1)])
    targetSlot = firstEmpty ? firstEmpty.id : blanks[0]?.id ?? '1'
  }

  const nextAnswers = { ...params.answers, [targetSlot]: availableChip.word }
  const nextEmpty = blanks.find(
    (b, idx) => b.id !== targetSlot && !nextAnswers[b.id] && !nextAnswers[String(idx + 1)]
  )
  return {
    nextAnswers,
    nextActiveSlotId: nextEmpty ? nextEmpty.id : null,
  }
}

export function clearFillBlanksSlot(params: {
  runtime: NonNullable<ActivityDetails['fillBlanks']>
  answers: Record<string, string>
  slotKey: string
}): { nextAnswers: Record<string, string>; nextActiveSlotId: string } {
  const nextAnswers = { ...params.answers }
  delete nextAnswers[params.slotKey]
  const blanks = params.runtime.blanks ?? []
  const idx = blanks.findIndex((b, bIdx) => b.id === params.slotKey || String(bIdx + 1) === params.slotKey)
  if (idx >= 0) {
    delete nextAnswers[blanks[idx].id]
    delete nextAnswers[String(idx + 1)]
  }
  return {
    nextAnswers,
    nextActiveSlotId: params.slotKey,
  }
}

export function selectSpotErrorSegment(segment: { id?: string; text?: string }): string {
  return segment.id || segment.text || ''
}

export function toggleGridCheckCell(
  selectedCells: readonly string[],
  rowId: string,
  colId: string
): string[] {
  const cellKey = `${rowId}:${colId}`
  return selectedCells.includes(cellKey)
    ? selectedCells.filter((c) => c !== cellKey)
    : [...selectedCells, cellKey]
}

export function selectScenarioOption(
  choices: Record<string, string>,
  stageId: string,
  option: { id?: string; text?: string }
): Record<string, string> {
  return {
    ...choices,
    [stageId]: option.id || option.text || '',
  }
}

export function resolveSelectedScenarioOption<T extends { id?: string; text?: string }>(
  options: readonly T[],
  selectedValue: string | undefined
): T | undefined {
  if (!selectedValue) return undefined
  return (
    options.find((opt) => opt.id === selectedValue) ??
    options.find((opt) => opt.text === selectedValue)
  )
}

export function isScenarioOptionSelected(
  options: readonly { id?: string; text?: string }[],
  selectedValue: string | undefined,
  option: { id?: string; text?: string }
): boolean {
  if (!selectedValue) return false
  const resolved = resolveSelectedScenarioOption(options, selectedValue)
  if (!resolved) return false
  if (resolved.id && option.id) return resolved.id === option.id
  return resolved === option
}

export function selectMatchingRight(
  pairsDef: readonly { left: string }[],
  currentPairs: Record<string, string>,
  activeLeft: string | null,
  rightText: string
): { nextPairs: Record<string, string>; nextActiveLeft: string | null } | null {
  const targetLeft = activeLeft ?? pairsDef.find((pair) => !currentPairs[pair.left])?.left ?? null
  if (!targetLeft) return null
  const nextPairs = { ...currentPairs }
  Object.keys(nextPairs).forEach((key) => {
    if (nextPairs[key] === rightText && key !== targetLeft) delete nextPairs[key]
  })
  nextPairs[targetLeft] = rightText
  const nextActiveLeft = pairsDef.find((pair) => pair.left !== targetLeft && !nextPairs[pair.left])?.left ?? null
  return { nextPairs, nextActiveLeft }
}

export function assignSortingCategory(
  assignments: Record<string, string>,
  itemId: string,
  category: string
): Record<string, string> {
  return { ...assignments, [itemId]: category }
}

export function moveOrderingStepInList(
  currentOrder: readonly string[],
  index: number,
  direction: -1 | 1
): string[] | null {
  const target = index + direction
  if (target < 0 || target >= currentOrder.length) return null
  const order = [...currentOrder]
  const tmp = order[index]
  order[index] = order[target]
  order[target] = tmp
  return order
}

export function toggleVennItemZone(
  assignments: Record<string, VennZone>,
  itemId: string,
  targetZone: VennZone
): Record<string, VennZone> {
  const next = { ...assignments }
  if (next[itemId] === targetZone) {
    delete next[itemId]
  } else {
    next[itemId] = targetZone
  }
  return next
}

export function cloudActivityRowToStudentActivity(row: Record<string, unknown>): Activity {
  const rawOptions = Array.isArray(row.options)
    ? row.options.filter((v): v is string => typeof v === 'string')
    : []
  const rawAnswer = row.answer
  const answer: string | string[] = Array.isArray(rawAnswer)
    ? rawAnswer.filter((v): v is string => typeof v === 'string')
    : typeof rawAnswer === 'string'
      ? rawAnswer
      : ''

  return {
    id: String(row.id ?? ''),
    templateId: typeof row.template_id === 'string' ? row.template_id : undefined,
    title: String(row.title ?? ''),
    type: String(row.type ?? 'singleChoice') as Activity['type'],
    topic: String(row.topic ?? ''),
    difficulty: (row.difficulty as Activity['difficulty']) ?? 'Inicial',
    prompt: String(row.prompt ?? ''),
    options: rawOptions,
    answer,
    feedback: typeof row.feedback === 'string' ? row.feedback : '',
    details:
      row.details && typeof row.details === 'object' && !Array.isArray(row.details)
        ? (row.details as ActivityDetails)
        : undefined,
    status: (row.status as Activity['status']) ?? 'published',
    ...(typeof row.updated_at === 'string' && row.updated_at ? { updatedAt: row.updated_at } : {}),
  }
}

export function createEmptyActivityResponse(type: Activity['type']): ActivityResponse {
  switch (type) {
    case 'scenario':
      return { type: 'scenario', choices: {} }
    case 'trueFalse':
      return { type: 'trueFalse', value: '' }
    case 'singleChoice':
      return { type: 'singleChoice', value: '' }
    case 'multiSelect':
      return { type: 'multiSelect', values: [] }
    case 'fillBlanks':
      return { type: 'fillBlanks', answers: {} }
    case 'spotError':
      return { type: 'spotError', value: '' }
    case 'markWords':
      return { type: 'markWords', values: [] }
    case 'gridCheck':
      return { type: 'gridCheck', values: [] }
    case 'vennDiagram':
      return { type: 'vennDiagram', assignments: {} }
    case 'shortAnswer':
      return { type: 'shortAnswer', value: '' }
    case 'matching':
      return { type: 'matching', pairs: {} }
    case 'sorting':
      return { type: 'sorting', assignments: {} }
    case 'ordering':
      return { type: 'ordering', order: [] }
  }
}

export function omitQuestionFromResponses(
  responses: Record<number, ActivityResponse>,
  index: number
): Record<number, ActivityResponse> {
  if (!Object.prototype.hasOwnProperty.call(responses, index)) return responses
  const next = { ...responses }
  delete next[index]
  return next
}

export function buildCloudSubmitPayload(params: {
  roomId: string
  roomCode: string
  participantId: string
  guestToken?: string
  activitySequence: readonly { activityId: string; occurrenceId?: string }[]
  responses: Record<number, ActivityResponse | null | undefined>
  answerTimes?: Record<number, number>
  startedAt?: string
  finishedAt?: string
  status?: 'completed' | 'timeout'
  events?: unknown[]
}) {
  return {
    action: 'submit_attempt',
    roomId: params.roomId,
    code: params.roomCode,
    participantId: params.participantId,
    ...(params.guestToken ? { guestToken: params.guestToken } : {}),
    responses: params.activitySequence.map((item, index) => ({
      activityId: item.activityId,
      occurrenceId: item.occurrenceId,
      index,
      response: params.responses[index] ?? null,
      timeSeconds: params.answerTimes?.[index] ?? 0,
    })),
    attempt: {
      startedAt: params.startedAt ?? new Date().toISOString(),
      finishedAt: params.finishedAt ?? new Date().toISOString(),
      status: params.status ?? 'completed',
      events: params.events ?? [],
    },
  }
}

export type StudentPlayRuntime = RuntimeActivity
