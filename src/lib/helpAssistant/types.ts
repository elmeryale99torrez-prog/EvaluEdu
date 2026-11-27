import type { ActivityType } from '../activityEngine'

export type AssistantView =
  | 'overview'
  | 'content'
  | 'proposals'
  | 'rooms'
  | 'results'
  | 'play'
  | 'adminUsers'
  | 'adminAudit'

export type AssistantRole = 'admin' | 'teacher' | 'student'

export type VaultNoteKind =
  | 'dashboard'
  | 'inbox'
  | 'configuracion'
  | 'moc'
  | 'guia'
  | 'actividad'
  | 'emergencia'
  | 'cuenta'

export type VaultActionTarget =
  | 'view:overview'
  | 'view:content'
  | 'view:proposals'
  | 'view:rooms'
  | 'view:results'
  | 'role:student'
  | 'modal:feedback'
  | 'modal:help'

export interface VaultAction {
  label: string
  target: VaultActionTarget
}

export interface VaultDiagnosticButton {
  label: string
  targetNote: string
}

export interface VaultSection {
  heading: string
  content: string
}

export interface VaultNote {
  slug: string
  path: string
  folder: string
  id: string
  tipo: VaultNoteKind
  titulo: string
  vistas: AssistantView[]
  actividad: ActivityType | null
  sinonimos: string[]
  sintomas: string[]
  preguntasEjemplo: string[]
  acciones: VaultAction[]
  diagnosticoBotones: VaultDiagnosticButton[]
  rawMarkdown: string
  bodyMarkdown: string
  summary: string
  sections: VaultSection[]
  outgoingLinks: string[]
  incomingLinks: string[]
}

export interface AssistantRuntimeContext {
  firstName?: string
  role: AssistantRole
  view: AssistantView
  activeActivityType?: ActivityType | null
  isOnline: boolean
  backendReady: boolean
  pendingSyncCount: number
  pendingProposalsCount: number
}

export type MatchConfidence = 'high' | 'medium' | 'low'

export interface RelatedNoteChip {
  slug: string
  titulo: string
  tipo: VaultNoteKind
}

export interface LocalAnswerResult {
  kind: 'greeting' | 'thanks' | 'note' | 'fallback'
  confidence: MatchConfidence
  score: number
  title: string
  summary: string
  bodyMarkdown: string
  note?: VaultNote
  actions: VaultAction[]
  diagnosticButtons: VaultDiagnosticButton[]
  relatedNotes: RelatedNoteChip[]
  alternatives: RelatedNoteChip[]
  shouldOfferAiFallback: boolean
}

export interface QuickChipItem {
  label: string
  noteSlug?: string
  query?: string
}

export interface UnresolvedCaseEntry {
  id: string
  at: string
  view: AssistantView
  role: AssistantRole
  activityType: ActivityType | null
  isOnline: boolean
  querySanitized: string
  reason: 'low_confidence' | 'user_marked_unresolved'
  suggestedNoteSlug?: string
}

/**
 * Contrato preparado para la Fase 2 (Capa 2: Gemini cascada + NVIDIA Vision).
 * Permite acoplar el backend IA sin refactorizar el motor ni la interfaz.
 */
export interface HelpAssistantAIRequest {
  query: string
  context: AssistantRuntimeContext
  graphRagContext: string
  history?: Array<{ role: 'user' | 'assistant'; text: string }>
  screenshotBase64?: string
}

export interface HelpAssistantAIResponse {
  ok: boolean
  answer?: string
  providerUsed?: string
  error?: string
}

export type HelpAssistantAIAdapter = (
  request: HelpAssistantAIRequest
) => Promise<HelpAssistantAIResponse>
