import type {
  AssistantRuntimeContext,
  LocalAnswerResult,
  MatchConfidence,
  QuickChipItem,
  RelatedNoteChip,
  UnresolvedCaseEntry,
  VaultNote,
} from './types'
import { getRelatedNoteChips, knowledgeVault } from './vaultIndex'
import { humanizeWikilinks } from './vaultParser'

const STOPWORDS = new Set([
  'el', 'la', 'los', 'las', 'un', 'una', 'unos', 'unas', 'de', 'del', 'al', 'a', 'ante',
  'con', 'contra', 'desde', 'en', 'entre', 'hacia', 'hasta', 'para', 'por', 'segun', 'sobre',
  'y', 'e', 'o', 'u', 'que', 'quien', 'como', 'cuando', 'donde', 'cual', 'cuales', 'cuanto',
  'me', 'te', 'se', 'le', 'les', 'nos', 'mi', 'mis', 'tu', 'tus', 'su', 'sus',
  'es', 'son', 'fue', 'era', 'esta', 'estan', 'estoy', 'hay', 'ser', 'estar',
  'puedo', 'puede', 'pueden', 'quiero', 'necesito', 'tengo', 'tiene', 'hacer', 'hago',
  'esto', 'esta', 'eso', 'esa', 'ese', 'aqui', 'ahi', 'muy', 'mas', 'ya', 'si', 'pero',
  'hola', 'buenas', 'buenos', 'dias', 'tardes', 'noches', 'porfa', 'favor', 'ayuda',
])

const GREETING_PATTERNS = [
  /^(hola|hey|saludos|que tal|buenas|buenos dias|buenas tardes|buenas noches)(\s+(hola|buenas|buenos dias|buenas tardes|buenas noches|profe|asistente|bot|evaluedu))*[!.,\s]*$/,
]

const THANKS_PATTERNS = [
  /^(gracias|muchas gracias|genial|perfecto|listo|excelente|entendido|ok|vale)[!.,\s]*$/,
]

const UNRESOLVED_STORAGE_KEY = 'evaluedu-assistant-unresolved-cases'

export function normalizeText(raw: string): string {
  return raw
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9{}\[\]*\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function lightStem(token: string): string {
  if (token.length <= 4) return token
  if (token.endsWith('ciones')) return token.slice(0, -4)
  if (token.endsWith('cion')) return token.slice(0, -2)
  if (token.endsWith('ando') || token.endsWith('iendo')) return token.slice(0, -4)
  if (token.endsWith('es') && token.length >= 6) return token.slice(0, -2)
  if (token.endsWith('s') && token.length >= 5) return token.slice(0, -1)
  return token
}

export function tokenize(raw: string): string[] {
  const norm = normalizeText(raw)
  if (!norm) return []
  const parts = norm.split(' ').filter((w) => w.length >= 2)
  const filtered = parts.filter((w) => !STOPWORDS.has(w))
  return (filtered.length > 0 ? filtered : parts).map((w) => w.trim())
}

function levenshteinBounded(a: string, b: string, maxDist: number): number {
  if (a === b) return 0
  if (Math.abs(a.length - b.length) > maxDist) return maxDist + 1
  const prev = new Array<number>(b.length + 1)
  const curr = new Array<number>(b.length + 1)
  for (let j = 0; j <= b.length; j++) prev[j] = j

  for (let i = 1; i <= a.length; i++) {
    curr[0] = i
    let rowMin = curr[0]
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost)
      if (curr[j] < rowMin) rowMin = curr[j]
    }
    if (rowMin > maxDist) return maxDist + 1
    for (let j = 0; j <= b.length; j++) prev[j] = curr[j]
  }
  return prev[b.length]
}

function buildSynonymLookup(): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>()
  for (const group of knowledgeVault.synonymGroups) {
    const normalizedGroup = group.map(normalizeText).filter(Boolean)
    for (const term of normalizedGroup) {
      const bucket = map.get(term) ?? new Set<string>()
      for (const peer of normalizedGroup) {
        if (peer !== term) bucket.add(peer)
      }
      map.set(term, bucket)
    }
  }
  return map
}

const synonymLookup = buildSynonymLookup()

function expandTokensWithSynonyms(tokens: string[], normalizedQuery: string): Set<string> {
  const expanded = new Set<string>()
  for (const token of tokens) {
    expanded.add(token)
    expanded.add(lightStem(token))
    const directPeers = synonymLookup.get(token)
    if (directPeers) {
      for (const peer of directPeers) {
        for (const pTok of tokenize(peer)) {
          expanded.add(pTok)
          expanded.add(lightStem(pTok))
        }
      }
    }
  }
  // También expandir frases compuestas del diccionario presentes en la consulta
  for (const [phrase, peers] of synonymLookup.entries()) {
    if (phrase.includes(' ') && normalizedQuery.includes(phrase)) {
      for (const peer of peers) {
        for (const pTok of tokenize(peer)) {
          expanded.add(pTok)
          expanded.add(lightStem(pTok))
        }
      }
    }
  }
  return expanded
}

interface IndexedNoteTokens {
  note: VaultNote
  normTitle: string
  titleTokens: Set<string>
  normSynonyms: string[]
  synonymTokens: Set<string>
  normSymptoms: string[]
  normQuestions: string[]
  bodyNorm: string
  bodyTokens: Set<string>
}

const indexedNotes: IndexedNoteTokens[] = knowledgeVault.searchableNotes.map((note) => {
  const normTitle = normalizeText(note.titulo)
  const titleTokens = new Set<string>()
  for (const t of tokenize(note.titulo)) {
    titleTokens.add(t)
    titleTokens.add(lightStem(t))
  }
  if (note.actividad) {
    titleTokens.add(normalizeText(note.actividad))
  }

  const normSynonyms = note.sinonimos.map(normalizeText).filter(Boolean)
  const synonymTokens = new Set<string>()
  for (const s of normSynonyms) {
    for (const t of tokenize(s)) {
      synonymTokens.add(t)
      synonymTokens.add(lightStem(t))
    }
  }

  const normSymptoms = note.sintomas.map(normalizeText).filter(Boolean)
  const normQuestions = note.preguntasEjemplo.map(normalizeText).filter(Boolean)
  const bodyNorm = normalizeText(humanizeWikilinks(note.bodyMarkdown, knowledgeVault.titleBySlug))
  const bodyTokens = new Set<string>()
  for (const t of tokenize(bodyNorm)) {
    bodyTokens.add(t)
    bodyTokens.add(lightStem(t))
  }

  return {
    note,
    normTitle,
    titleTokens,
    normSynonyms,
    synonymTokens,
    normSymptoms,
    normQuestions,
    bodyNorm,
    bodyTokens,
  }
})

function tokenMatchesSet(token: string, set: Set<string>): number {
  if (set.has(token)) return 1
  const stemmed = lightStem(token)
  if (set.has(stemmed)) return 0.92
  if (token.length >= 4) {
    const maxDist = token.length >= 7 ? 2 : 1
    for (const candidate of set) {
      if (candidate.length < 4) continue
      if (candidate[0] !== token[0] && Math.abs(candidate.length - token.length) > 0) continue
      const dist = levenshteinBounded(token, candidate, maxDist)
      if (dist <= maxDist) return dist === 1 ? 0.8 : 0.65
    }
  }
  return 0
}

function scoreNote(
  indexed: IndexedNoteTokens,
  normQuery: string,
  queryTokens: string[],
  expandedTokens: Set<string>,
  context: AssistantRuntimeContext
): number {
  let score = 0
  const { note } = indexed

  // 1. Coincidencia literal o de subcadena en SÍNTOMAS (mensajes reales de pantalla/error)
  for (const symptom of indexed.normSymptoms) {
    if (!symptom) continue
    if (normQuery.includes(symptom) && symptom.length >= 4) {
      score += 48
    } else if (normQuery.length >= 8 && symptom.includes(normQuery)) {
      score += 38
    } else {
      const symTokens = tokenize(symptom)
      if (symTokens.length >= 2) {
        let hits = 0
        for (const st of symTokens) {
          if (expandedTokens.has(st) || expandedTokens.has(lightStem(st))) hits++
        }
        const ratio = hits / symTokens.length
        if (ratio >= 0.7) score += 28 * ratio
      }
    }
  }

  // 2. Coincidencia exacta o de frase en SINÓNIMOS y PREGUNTAS EJEMPLO
  for (const syn of indexed.normSynonyms) {
    if (syn.length >= 4 && normQuery.includes(syn)) {
      score += 24
    } else if (normQuery.length >= 5 && syn.includes(normQuery)) {
      score += 18
    }
  }

  for (const qEx of indexed.normQuestions) {
    const qTokens = tokenize(qEx)
    if (!qTokens.length) continue
    let overlap = 0
    for (const qt of qTokens) {
      if (expandedTokens.has(qt) || expandedTokens.has(lightStem(qt))) overlap++
    }
    const ratio = overlap / qTokens.length
    if (ratio >= 0.55) {
      score += 22 * ratio
    }
  }

  // 3. Coincidencia token a token sobre título, sinónimos y cuerpo (con fuzzy match)
  let titleHits = 0
  let synHits = 0
  let bodyHits = 0
  for (const token of queryTokens) {
    const tMatch = tokenMatchesSet(token, indexed.titleTokens)
    const sMatch = tokenMatchesSet(token, indexed.synonymTokens)
    const bMatch = tokenMatchesSet(token, indexed.bodyTokens)
    if (tMatch > 0) titleHits += tMatch
    if (sMatch > 0) synHits += sMatch
    if (bMatch > 0) bodyHits += bMatch
  }

  const denom = Math.max(queryTokens.length, 1)
  score += (titleHits / denom) * 26
  score += (synHits / denom) * 22
  score += (bodyHits / denom) * 14

  // Coincidencia expandida con Diccionario_Sinonimos
  if (expandedTokens.size > queryTokens.length) {
    let extraHits = 0
    for (const expTok of expandedTokens) {
      if (indexed.titleTokens.has(expTok) || indexed.synonymTokens.has(expTok)) {
        extraHits += 1
      }
    }
    score += Math.min(extraHits * 3.5, 14)
  }

  // Coincidencia directa con código de actividad (ej. fillBlanks, vennDiagram, 429, 409, 401, 404, 150)
  if (note.actividad && normQuery.includes(normalizeText(note.actividad))) {
    score += 35
  }

  // 4. Bono contextual por pantalla actual y actividad activa (solo si ya hubo alguna señal textual)
  if (score >= 8) {
    if (note.vistas.includes(context.view)) {
      score += 4.5
    }
    if (context.activeActivityType && note.actividad === context.activeActivityType) {
      score += 9
    }
    // Si el docente expresa un bloqueo o error, priorizar la nota de emergencia correspondiente
    if (
      note.tipo === 'emergencia' &&
      /\b(error|falla|fallo|bloqueo|bloqueado|deshabilitado|no se activa|no me deja|no funciona|no puedo|no carga|no ve|no encuentro|problema)\b/.test(
        normQuery
      )
    ) {
      score += 10
    }
    // Preferir notas atómicas concretas sobre MOCs generales en consultas específicas
    if (note.tipo !== 'moc') {
      score += 2.5
    }
  }

  return score
}

function renderCleanBody(note: VaultNote): string {
  const readable = humanizeWikilinks(note.bodyMarkdown, knowledgeVault.titleBySlug)
  return readable
    .replace(/^#\s+.+\r?\n+/, '')
    .replace(/\r?\n##\s+Relacionado[\s\S]*$/i, '')
    .trim()
}

export function buildAnswerFromNote(
  note: VaultNote,
  confidence: MatchConfidence = 'high',
  score = 1,
  alternatives: RelatedNoteChip[] = []
): LocalAnswerResult {
  const readableSummary = humanizeWikilinks(note.summary, knowledgeVault.titleBySlug)
  return {
    kind: 'note',
    confidence,
    score,
    title: note.titulo,
    summary: readableSummary,
    bodyMarkdown: renderCleanBody(note),
    note,
    actions: note.acciones,
    diagnosticButtons: note.diagnosticoBotones,
    relatedNotes: getRelatedNoteChips(note.slug, 4),
    alternatives,
    shouldOfferAiFallback: confidence !== 'high',
  }
}

export function openNoteBySlug(slug: string): LocalAnswerResult | null {
  const note = knowledgeVault.notesBySlug.get(slug)
  if (!note) return null
  return buildAnswerFromNote(note, 'high', 1, [])
}

export function getContextualQuickChips(context: AssistantRuntimeContext): QuickChipItem[] {
  if (context.role === 'student' || context.view === 'play') {
    const chips: QuickChipItem[] = []
    if (context.activeActivityType) {
      const actNote = knowledgeVault.notesByActivity.get(context.activeActivityType)
      if (actNote) {
        chips.push({ label: `Cómo funciona ${actNote.titulo.split('·')[1]?.trim() ?? actNote.titulo}`, noteSlug: actNote.slug })
      }
    }
    chips.push(
      { label: 'Alumno en pantalla de espera', noteSlug: 'Emergencia_Alumno_En_Pantalla_Espera' },
      { label: 'Perdió conexión o cerró pestaña', noteSlug: 'Emergencia_Alumno_Perdio_Conexion_O_Cerro_Pestana' },
      { label: 'No ve su nota ni la clave', noteSlug: 'Emergencia_Alumno_No_Ve_Nota_Ni_Solucion' },
      { label: 'Volver a Panel Docente', noteSlug: 'Probar_Como_Estudiante_vs_Simulador' }
    )
    return chips.slice(0, 4)
  }

  switch (context.view) {
    case 'content':
      return [
        { label: 'Importar PDF, Word o Drive', noteSlug: 'Importar_Documentos_y_Google_Drive' },
        { label: 'Error de Google Drive / Popup', noteSlug: 'Emergencia_Google_Drive_O_Popup_Bloqueado' },
        { label: 'Borrador vs Aceptar plantilla', noteSlug: 'Guardar_Borrador_vs_Aceptar_Plantilla' },
        { label: 'Formatos atenuados en plantilla', noteSlug: 'Emergencia_No_Puedo_Editar_Sala_O_Actividad_Atenuada' },
      ]
    case 'proposals':
      return [
        { label: 'Revisar y aprobar variantes', noteSlug: 'Propuestas_Variantes_y_Reparacion' },
        { label: 'Simulador vs Probar estudiante', noteSlug: 'Probar_Como_Estudiante_vs_Simulador' },
        { label: 'Las 13 actividades oficiales', noteSlug: 'MOC_13_Actividades' },
        { label: 'Cómo elegir formato adecuado', noteSlug: 'Elegir_Formato_Adecuado' },
      ]
    case 'rooms':
      return [
        { label: 'Abrir e iniciar una sala', noteSlug: 'Ciclo_Estados_Sala' },
        { label: 'Alumno en pantalla de espera', noteSlug: 'Emergencia_Alumno_En_Pantalla_Espera' },
        { label: 'Imprimir Examen en blanco / PDF', noteSlug: 'Examen_en_Blanco_PDF' },
        { label: 'Emergencias en clase', noteSlug: 'MOC_Emergencias_Aula' },
      ]
    case 'results':
      return [
        { label: 'Exportar resultados a Excel/CSV', noteSlug: 'Resultados_Privados_y_Exportar_CSV' },
        { label: 'Borrar intento o limpiar sala', noteSlug: 'Eliminar_Sala_Resultados_O_Intento' },
        { label: 'Entrega pendiente (pending_sync)', noteSlug: 'Emergencia_Entrega_Pendiente_O_Rechazada' },
        { label: 'Por qué el alumno no ve nota', noteSlug: 'Emergencia_Alumno_No_Ve_Nota_Ni_Solucion' },
      ]
    default:
      return [
        { label: 'Recorrido completo docente', noteSlug: 'MOC_Panel_Docente' },
        { label: 'Importar documentos o Drive', noteSlug: 'Importar_Documentos_y_Google_Drive' },
        { label: 'Crear y abrir una sala', noteSlug: 'Crear_y_Configurar_Sala' },
        { label: 'Emergencias en vivo', noteSlug: 'MOC_Emergencias_Aula' },
      ]
  }
}

export function queryLocalAssistant(
  rawQuery: string,
  context: AssistantRuntimeContext
): LocalAnswerResult {
  const normQuery = normalizeText(rawQuery)

  if (!normQuery || GREETING_PATTERNS.some((re) => re.test(normQuery))) {
    const viewLabel =
      context.role === 'student'
        ? 'Modo prueba como Estudiante'
        : context.view === 'content'
          ? 'Contenido'
          : context.view === 'proposals'
            ? 'Propuestas'
            : context.view === 'rooms'
              ? 'Salas'
              : context.view === 'results'
                ? 'Resultados'
                : 'Inicio'

    return {
      kind: 'greeting',
      confidence: 'high',
      score: 1,
      title: 'Asistente EvaluEdu listo',
      summary: `Estoy contigo en **${viewLabel}**. Pregúntame sobre cualquier paso del Panel Docente, las 13 actividades, Google Drive, salas o problemas de tus estudiantes (funciono incluso sin internet).`,
      bodyMarkdown: `Estoy contigo en **${viewLabel}**. Escribe tu duda o elige uno de los accesos rápidos para ver la solución paso a paso.`,
      actions: [],
      diagnosticButtons: [
        { label: 'Recorrido del Panel Docente', targetNote: 'MOC_Panel_Docente' },
        { label: 'Emergencias con estudiantes', targetNote: 'MOC_Emergencias_Aula' },
        { label: 'Las 13 actividades oficiales', targetNote: 'MOC_13_Actividades' },
      ],
      relatedNotes: [],
      alternatives: [],
      shouldOfferAiFallback: false,
    }
  }

  if (THANKS_PATTERNS.some((re) => re.test(normQuery))) {
    return {
      kind: 'thanks',
      confidence: 'high',
      score: 1,
      title: '¡Con gusto!',
      summary: 'Aquí sigo en tu pantalla por si surge cualquier otra duda durante tu clase.',
      bodyMarkdown: 'Aquí sigo en tu pantalla por si surge cualquier otra duda durante tu clase.',
      actions: [],
      diagnosticButtons: [],
      relatedNotes: [],
      alternatives: [],
      shouldOfferAiFallback: false,
    }
  }

  const queryTokens = tokenize(rawQuery)
  const expandedTokens = expandTokensWithSynonyms(queryTokens, normQuery)

  const ranked = indexedNotes
    .map((indexed) => ({
      note: indexed.note,
      rawScore: scoreNote(indexed, normQuery, queryTokens, expandedTokens, context),
    }))
    .filter((entry) => entry.rawScore > 0)
    .sort((a, b) => b.rawScore - a.rawScore)

  const top = ranked[0]
  const normalizedConfidence = top ? Math.min(1, top.rawScore / 42) : 0

  const alternatives: RelatedNoteChip[] = ranked.slice(1, 4).map((item) => ({
    slug: item.note.slug,
    titulo: item.note.titulo,
    tipo: item.note.tipo,
  }))

  if (!top || normalizedConfidence < 0.36) {
    return {
      kind: 'fallback',
      confidence: 'low',
      score: Number(normalizedConfidence.toFixed(2)),
      title: 'No encontré una coincidencia exacta en la base local',
      summary:
        'Tu consulta parece estar fuera de las guías directas de EvaluEdu o usa un término nuevo. Revisa estos temas cercanos o registra el caso para incorporarlo al cerebro del asistente.',
      bodyMarkdown:
        'Prueba reformular con el nombre de la pantalla (*Contenido, Propuestas, Salas, Resultados*) o el mensaje exacto que ves en pantalla. También puedes elegir una categoría de diagnóstico abajo.',
      actions: [{ label: 'Abrir Escribir sugerencia', target: 'modal:feedback' }],
      diagnosticButtons: [
        { label: 'Emergencias con estudiantes', targetNote: 'MOC_Emergencias_Aula' },
        { label: 'Recorrido del Panel Docente', targetNote: 'MOC_Panel_Docente' },
        { label: 'Las 13 actividades oficiales', targetNote: 'MOC_13_Actividades' },
      ],
      relatedNotes: [],
      alternatives,
      shouldOfferAiFallback: true,
    }
  }

  const confidence: MatchConfidence = normalizedConfidence >= 0.62 ? 'high' : 'medium'
  return buildAnswerFromNote(
    top.note,
    confidence,
    Number(normalizedConfidence.toFixed(2)),
    alternatives
  )
}

/**
 * Elimina correos electrónicos y números telefónicos antes de almacenar
 * cualquier consulta no resuelta para la Bandeja de Entrada (`Inbox_Incidencias.md`).
 */
export function sanitizeUnresolvedText(text: string): string {
  return text
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[correo]')
    .replace(/\b\+?\d[\d\s\-()]{7,}\d\b/g, '[telefono]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 320)
}

export function readUnresolvedCases(): UnresolvedCaseEntry[] {
  if (typeof window === 'undefined' || !window.localStorage) return []
  try {
    const raw = window.localStorage.getItem(UNRESOLVED_STORAGE_KEY)
    const parsed = raw ? (JSON.parse(raw) as unknown) : []
    return Array.isArray(parsed) ? (parsed as UnresolvedCaseEntry[]) : []
  } catch {
    return []
  }
}

export function recordUnresolvedCase(params: {
  query: string
  context: AssistantRuntimeContext
  reason: UnresolvedCaseEntry['reason']
  suggestedNoteSlug?: string
}): UnresolvedCaseEntry {
  const entry: UnresolvedCaseEntry = {
    id: `inc-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    at: new Date().toISOString(),
    view: params.context.view,
    role: params.context.role,
    activityType: params.context.activeActivityType ?? null,
    isOnline: params.context.isOnline,
    querySanitized: sanitizeUnresolvedText(params.query),
    reason: params.reason,
    ...(params.suggestedNoteSlug ? { suggestedNoteSlug: params.suggestedNoteSlug } : {}),
  }

  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      const current = readUnresolvedCases()
      const next = [entry, ...current].slice(0, 50)
      window.localStorage.setItem(UNRESOLVED_STORAGE_KEY, JSON.stringify(next))
    } catch {
      // Ignorar fallo de cuota en almacenamiento local
    }
  }

  return entry
}

export function formatUnresolvedCasesAsMarkdown(entries: readonly UnresolvedCaseEntry[]): string {
  if (!entries.length) return '*(Sin incidencias registradas en este dispositivo)*'
  return entries
    .map((e) => {
      const dateStr = e.at.slice(0, 10)
      const actPart = e.activityType ? ` | **Actividad:** \`${e.activityType}\`` : ''
      const sugPart = e.suggestedNoteSlug ? ` | **Sugerido:** [[${e.suggestedNoteSlug}]]` : ''
      return [
        `- [ ] **Fecha:** ${dateStr} | **Vista:** \`${e.view}\` | **Rol:** \`${e.role}\`${actPart}`,
        `  - **Consulta sanitizada:** "${e.querySanitized}"`,
        `  - **Motivo:** \`${e.reason}\` | **Conexión:** ${e.isOnline ? 'En línea' : 'Sin conexión'}${sugPart}`,
      ].join('\n')
    })
    .join('\n')
}
