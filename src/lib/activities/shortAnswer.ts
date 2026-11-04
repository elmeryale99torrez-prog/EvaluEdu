/**
 * Contrato aislado para la Actividad #13: Respuesta Corta Conceptual (shortAnswer)
 *
 * Evaluación de recuperación activa y evocación directa desde la memoria (Recall)
 * sin alternativas visibles. El estudiante escribe el término o concepto exacto.
 *
 * Características de corrección:
 * - Lista de variantes/sinónimos aceptados por el docente (acceptedAnswers).
 * - Normalización de texto con tolerancia opcional a tildes (ignoreAccents) y mayúsculas (caseSensitive).
 * - Limpieza estricta de espacios en blanco duplicados.
 */

export interface ShortAnswerDefinition {
  context?: string
  prompt: string
  acceptedAnswers: string[]
  caseSensitive?: boolean
  ignoreAccents?: boolean
  placeholder?: string
  hint: string
  explanation: string
  sourceRef?: string
}

export interface ShortAnswerPublic {
  context?: string
  prompt: string
  placeholder?: string
  hint?: string
}

export interface ShortAnswerResponse {
  type: 'shortAnswer'
  value: string
}

export const SHORT_ANSWER_LIMITS = {
  minAcceptedAnswers: 1,
  maxAcceptedAnswers: 6,
  minAnswerLength: 1,
  maxAnswerLength: 80,
  minPromptLength: 5,
  maxPromptLength: 300,
  minHintLength: 5,
  maxHintLength: 300,
  minExplanationLength: 10,
  maxExplanationLength: 600,
} as const

export interface ShortAnswerValidationResult {
  valid: boolean
  errors: string[]
}

/**
 * Normaliza una cadena de texto para comparación pedagógica determinista.
 */
export function normalizeShortAnswer(
  text: string,
  options?: { caseSensitive?: boolean; ignoreAccents?: boolean }
): string {
  if (!text) return ''
  let cleaned = text.trim().replace(/\s+/g, ' ')

  if (!options?.caseSensitive) {
    cleaned = cleaned.toLowerCase()
  }

  const ignoreAccents = options?.ignoreAccents !== false
  if (ignoreAccents) {
    cleaned = cleaned.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  }

  return cleaned
}

/**
 * Valida la definición docente de una actividad de respuesta corta.
 */
export function validateShortAnswerActivity(
  def: Partial<ShortAnswerDefinition> | null | undefined
): ShortAnswerValidationResult {
  const errors: string[] = []
  if (!def) {
    return { valid: false, errors: ['La definición de Respuesta Corta no puede estar vacía.'] }
  }

  const prompt = String(def.prompt ?? '').trim()
  if (prompt.length < SHORT_ANSWER_LIMITS.minPromptLength) {
    errors.push(`La consigna debe tener al menos ${SHORT_ANSWER_LIMITS.minPromptLength} caracteres.`)
  }
  if (prompt.length > SHORT_ANSWER_LIMITS.maxPromptLength) {
    errors.push(`La consigna no puede superar los ${SHORT_ANSWER_LIMITS.maxPromptLength} caracteres.`)
  }

  const accepted = Array.isArray(def.acceptedAnswers)
    ? def.acceptedAnswers.map((a) => String(a ?? '').trim()).filter(Boolean)
    : []

  if (accepted.length < SHORT_ANSWER_LIMITS.minAcceptedAnswers) {
    errors.push(`Debes definir al menos ${SHORT_ANSWER_LIMITS.minAcceptedAnswers} respuesta válida o sinónimo aceptado.`)
  }
  if (accepted.length > SHORT_ANSWER_LIMITS.maxAcceptedAnswers) {
    errors.push(`No puedes incluir más de ${SHORT_ANSWER_LIMITS.maxAcceptedAnswers} respuestas aceptadas.`)
  }

  accepted.forEach((ans, idx) => {
    if (ans.length < SHORT_ANSWER_LIMITS.minAnswerLength) {
      errors.push(`La respuesta aceptada #${idx + 1} no puede estar vacía.`)
    }
    if (ans.length > SHORT_ANSWER_LIMITS.maxAnswerLength) {
      errors.push(`La respuesta aceptada #${idx + 1} no puede superar los ${SHORT_ANSWER_LIMITS.maxAnswerLength} caracteres.`)
    }
  })

  const hint = String(def.hint ?? '').trim()
  if (hint.length < SHORT_ANSWER_LIMITS.minHintLength) {
    errors.push(`La pista orientadora debe tener al menos ${SHORT_ANSWER_LIMITS.minHintLength} caracteres.`)
  }
  if (hint.length > SHORT_ANSWER_LIMITS.maxHintLength) {
    errors.push(`La pista orientadora no puede superar los ${SHORT_ANSWER_LIMITS.maxHintLength} caracteres.`)
  }

  if (def.explanation !== undefined && def.explanation.trim() !== '') {
    const exp = def.explanation.trim()
    if (exp.length < SHORT_ANSWER_LIMITS.minExplanationLength) {
      errors.push(`La explicación privada debe tener al menos ${SHORT_ANSWER_LIMITS.minExplanationLength} caracteres si se incluye.`)
    }
    if (exp.length > SHORT_ANSWER_LIMITS.maxExplanationLength) {
      errors.push(`La explicación privada no puede superar los ${SHORT_ANSWER_LIMITS.maxExplanationLength} caracteres.`)
    }
  }

  return { valid: errors.length === 0, errors }
}

/**
 * Proyecta la actividad hacia la versión pública estudiantil, ocultando respuestas aceptadas y explicaciones.
 */
export function toShortAnswerPublic(def: ShortAnswerDefinition): ShortAnswerPublic {
  return {
    context: def.context?.trim() || undefined,
    prompt: (def.prompt ?? '').trim(),
    placeholder: def.placeholder?.trim() || 'Escribe tu respuesta aquí...',
    hint: def.hint ? def.hint.trim() : undefined,
  }
}

/**
 * Evalúa la respuesta de un estudiante con tolerancia configurada.
 */
export function evaluateShortAnswerResponse(
  def: ShortAnswerDefinition,
  response: ShortAnswerResponse | undefined | null,
  maxScore: number
): {
  status: 'answered' | 'omitted'
  correct: boolean | null
  score: number
  response: string
} {
  const rawValue = String(response?.value ?? '').trim()

  if (!rawValue) {
    return {
      status: 'omitted',
      correct: null,
      score: 0,
      response: '',
    }
  }

  const normOptions = {
    caseSensitive: def.caseSensitive === true,
    ignoreAccents: def.ignoreAccents !== false,
  }

  const studentNorm = normalizeShortAnswer(rawValue, normOptions)
  const acceptedNorms = (def.acceptedAnswers || []).map((ans) =>
    normalizeShortAnswer(ans, normOptions)
  )

  const isMatch = acceptedNorms.includes(studentNorm)

  return {
    status: 'answered',
    correct: isMatch,
    score: isMatch ? maxScore : 0,
    response: rawValue,
  }
}

/**
 * Genera el reporte textual para docentes y auditoría CSV.
 */
export function generateShortAnswerTeacherReport(
  def: ShortAnswerDefinition,
  response: ShortAnswerResponse | undefined | null
): {
  studentAnswer: string
  isCorrect: boolean
  acceptedAnswers: string[]
  explanation: string
} {
  const evalResult = evaluateShortAnswerResponse(def, response, 10)
  return {
    studentAnswer: evalResult.response || '(Sin respuesta - Omitida)',
    isCorrect: evalResult.correct === true,
    acceptedAnswers: def.acceptedAnswers,
    explanation: def.explanation || 'Sin justificación privada.',
  }
}
