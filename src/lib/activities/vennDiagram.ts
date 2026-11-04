/**
 * Contrato aislado para la Actividad #12: Diagrama de Venn (vennDiagram)
 *
 * Evaluación de comparación y contraste conceptual mediante la intersección de dos conjuntos:
 * - Conjunto A (Izquierda / Exclusivo A)
 * - Conjunto B (Derecha / Exclusivo B)
 * - Intersección (Centro / Compartido por Ambos)
 */

export type VennZone = 'left' | 'both' | 'right'

export interface VennItem {
  id: string
  label: string
  zone: VennZone
}

export interface VennDiagramDefinition {
  context?: string
  setA: string
  setB: string
  intersectionLabel?: string
  items: VennItem[]
  hint: string
  explanation: string
  sourceRef?: string
}

export interface VennDiagramPublic {
  context?: string
  setA: string
  setB: string
  intersectionLabel?: string
  items: Array<{ id: string; label: string }>
  hint?: string
}

export interface VennDiagramResponse {
  type: 'vennDiagram'
  assignments: Record<string, VennZone>
}

export const VENN_DIAGRAM_LIMITS = {
  minSetNameLength: 2,
  maxSetNameLength: 60,
  minItems: 3,
  maxItems: 8,
  minItemLabelLength: 2,
  maxItemLabelLength: 140,
  minHintLength: 5,
  maxHintLength: 300,
  minExplanationLength: 10,
  maxExplanationLength: 600,
} as const

export interface VennDiagramValidationResult {
  valid: boolean
  errors: string[]
}

export function validateVennDiagramActivity(
  def: Partial<VennDiagramDefinition> | null | undefined
): VennDiagramValidationResult {
  const errors: string[] = []
  if (!def) {
    return { valid: false, errors: ['La definición de Diagrama de Venn no puede estar vacía.'] }
  }

  const setA = String(def.setA ?? '').trim()
  const setB = String(def.setB ?? '').trim()

  if (setA.length < VENN_DIAGRAM_LIMITS.minSetNameLength) {
    errors.push(`El nombre del Conjunto A debe tener al menos ${VENN_DIAGRAM_LIMITS.minSetNameLength} caracteres.`)
  }
  if (setA.length > VENN_DIAGRAM_LIMITS.maxSetNameLength) {
    errors.push(`El nombre del Conjunto A no puede superar los ${VENN_DIAGRAM_LIMITS.maxSetNameLength} caracteres.`)
  }

  if (setB.length < VENN_DIAGRAM_LIMITS.minSetNameLength) {
    errors.push(`El nombre del Conjunto B debe tener al menos ${VENN_DIAGRAM_LIMITS.minSetNameLength} caracteres.`)
  }
  if (setB.length > VENN_DIAGRAM_LIMITS.maxSetNameLength) {
    errors.push(`El nombre del Conjunto B no puede superar los ${VENN_DIAGRAM_LIMITS.maxSetNameLength} caracteres.`)
  }

  if (setA && setB && setA.toLowerCase() === setB.toLowerCase()) {
    errors.push('El Conjunto A y el Conjunto B deben tener nombres distintos para permitir el contraste.')
  }

  const items = Array.isArray(def.items) ? def.items : []
  if (items.length < VENN_DIAGRAM_LIMITS.minItems) {
    errors.push(`Debes incluir al menos ${VENN_DIAGRAM_LIMITS.minItems} elementos para contrastar en el diagrama.`)
  }
  if (items.length > VENN_DIAGRAM_LIMITS.maxItems) {
    errors.push(`No puedes incluir más de ${VENN_DIAGRAM_LIMITS.maxItems} elementos para preservar la legibilidad en pantallas móviles.`)
  }

  const validZones = new Set<VennZone>(['left', 'both', 'right'])
  const seenIds = new Set<string>()
  const seenLabels = new Set<string>()
  const presentZones = new Set<VennZone>()

  items.forEach((item, index) => {
    const id = String(item?.id ?? '').trim()
    const label = String(item?.label ?? '').trim()
    const zone = item?.zone as VennZone

    if (!id) {
      errors.push(`El elemento #${index + 1} debe tener un identificador válido.`)
    } else if (seenIds.has(id)) {
      errors.push(`El identificador "${id}" del elemento #${index + 1} está duplicado.`)
    } else {
      seenIds.add(id)
    }

    if (label.length < VENN_DIAGRAM_LIMITS.minItemLabelLength) {
      errors.push(`El texto del elemento #${index + 1} debe tener al menos ${VENN_DIAGRAM_LIMITS.minItemLabelLength} caracteres.`)
    } else if (label.length > VENN_DIAGRAM_LIMITS.maxItemLabelLength) {
      errors.push(`El texto del elemento #${index + 1} no puede exceder ${VENN_DIAGRAM_LIMITS.maxItemLabelLength} caracteres.`)
    } else {
      const lower = label.toLowerCase()
      if (seenLabels.has(lower)) {
        errors.push(`El concepto "${label}" está duplicado. Cada elemento debe ser único.`)
      }
      seenLabels.add(lower)
    }

    if (!validZones.has(zone)) {
      errors.push(`La zona asignada al elemento #${index + 1} debe ser 'left', 'both' o 'right'.`)
    } else {
      presentZones.add(zone)
    }
  })

  // Exigencia pedagógica de Venn: al menos 1 elemento debe estar en la intersección ('both') y al menos 1 exclusivo ('left' o 'right')
  if (items.length >= VENN_DIAGRAM_LIMITS.minItems) {
    if (!presentZones.has('both')) {
      errors.push('El diagrama de Venn debe contener al menos un elemento en la intersección ("Ambos / Compartido").')
    }
    if (!presentZones.has('left') && !presentZones.has('right')) {
      errors.push('El diagrama de Venn debe contener al menos un elemento exclusivo de alguno de los conjuntos.')
    }
  }

  const hint = String(def.hint ?? '').trim()
  if (hint.length < VENN_DIAGRAM_LIMITS.minHintLength) {
    errors.push(`La pista orientadora debe tener al menos ${VENN_DIAGRAM_LIMITS.minHintLength} caracteres.`)
  } else if (hint.length > VENN_DIAGRAM_LIMITS.maxHintLength) {
    errors.push(`La pista orientadora no puede exceder ${VENN_DIAGRAM_LIMITS.maxHintLength} caracteres.`)
  }

  const explanation = String(def.explanation ?? '').trim()
  if (explanation.length < VENN_DIAGRAM_LIMITS.minExplanationLength) {
    errors.push(`La justificación pedagógica debe tener al menos ${VENN_DIAGRAM_LIMITS.minExplanationLength} caracteres.`)
  } else if (explanation.length > VENN_DIAGRAM_LIMITS.maxExplanationLength) {
    errors.push(`La justificación pedagógica no puede exceder ${VENN_DIAGRAM_LIMITS.maxExplanationLength} caracteres.`)
  }

  return { valid: errors.length === 0, errors }
}

/**
 * Proyecta la definición privada a la vista pública del estudiante:
 * - Oculta la zona correcta ('zone').
 * - Baraja determinísticamente los elementos según una semilla.
 * - Oculta explicación y referencias internas de solución.
 */
export function toVennDiagramPublic(
  def: VennDiagramDefinition,
  shuffleSeed = 0
): VennDiagramPublic {
  const publicItems = (def.items || []).map((it) => ({
    id: it.id,
    label: it.label,
  }))

  // Barajado determinista
  const shuffled = [...publicItems].sort((a, b) => {
    const hashA = (a.id.charCodeAt(0) * 31 + shuffleSeed) % 100
    const hashB = (b.id.charCodeAt(0) * 31 + shuffleSeed) % 100
    return hashA - hashB
  })

  return {
    context: def.context,
    setA: def.setA,
    setB: def.setB,
    intersectionLabel: def.intersectionLabel || 'Ambos / Compartido',
    items: shuffled,
    hint: def.hint,
  }
}

export interface VennEvaluationResult {
  isCorrect: boolean
  isOmitted: boolean
  isComplete: boolean
  scoreRatio: number // 0 a 1
  correctCount: number
  totalCount: number
  feedbackHint?: string
  detailedFeedback?: string
}

/**
 * Evalúa la respuesta del estudiante frente a la definición privada.
 * - Omisión: Ningún elemento tiene zona asignada.
 * - Completitud: Todos los elementos tienen zona asignada.
 * - Corrección exacta: 100% de los elementos ubicados en su zona esperada ('left', 'both', 'right').
 */
export function evaluateVennDiagramResponse(
  def: VennDiagramDefinition,
  response?: VennDiagramResponse | null,
  showDetailedExplanation = false
): VennEvaluationResult {
  const items = def.items || []
  const totalCount = items.length

  if (!response || !response.assignments || Object.keys(response.assignments).length === 0) {
    return {
      isCorrect: false,
      isOmitted: true,
      isComplete: false,
      scoreRatio: 0,
      correctCount: 0,
      totalCount,
      feedbackHint: def.hint,
    }
  }

  const assignments = response.assignments
  const assignedKeys = Object.keys(assignments).filter((id) => Boolean(assignments[id]))

  if (assignedKeys.length === 0) {
    return {
      isCorrect: false,
      isOmitted: true,
      isComplete: false,
      scoreRatio: 0,
      correctCount: 0,
      totalCount,
      feedbackHint: def.hint,
    }
  }

  const isComplete = items.every((it) => Boolean(assignments[it.id]))

  let correctCount = 0
  items.forEach((it) => {
    if (assignments[it.id] === it.zone) {
      correctCount++
    }
  })

  const isCorrect = totalCount > 0 && correctCount === totalCount
  const scoreRatio = totalCount > 0 ? (isCorrect ? 1 : 0) : 0

  return {
    isCorrect,
    isOmitted: false,
    isComplete,
    scoreRatio,
    correctCount,
    totalCount,
    feedbackHint: def.hint,
    detailedFeedback: showDetailedExplanation ? def.explanation : undefined,
  }
}

/**
 * Genera el reporte textual detallado de la respuesta para el docente y la exportación CSV.
 */
export function generateVennDiagramTeacherReport(
  def: VennDiagramDefinition,
  response?: VennDiagramResponse | null
): string {
  if (!response || !response.assignments || Object.keys(response.assignments).length === 0) {
    return 'Sin respuesta (Omitida)'
  }

  const zoneLabels: Record<VennZone, string> = {
    left: `Solo ${def.setA}`,
    both: def.intersectionLabel || 'Ambos / Compartido',
    right: `Solo ${def.setB}`,
  }

  return def.items
    .map((it) => {
      const studentZone = response.assignments[it.id]
      const studentLabel = studentZone ? zoneLabels[studentZone] ?? studentZone : 'Sin clasificar'
      const targetLabel = zoneLabels[it.zone]
      const statusIcon = studentZone === it.zone ? '✓' : '✗'
      return `[${statusIcon}] ${it.label}: asignado a "${studentLabel}" (esperado: "${targetLabel}")`
    })
    .join(' | ')
}
