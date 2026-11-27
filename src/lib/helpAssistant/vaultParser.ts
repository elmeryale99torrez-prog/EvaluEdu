import type { ActivityType } from '../activityEngine'
import type {
  AssistantView,
  VaultAction,
  VaultActionTarget,
  VaultDiagnosticButton,
  VaultNote,
  VaultNoteKind,
  VaultSection,
} from './types'

const VALID_VIEWS = new Set<AssistantView>([
  'overview',
  'content',
  'proposals',
  'rooms',
  'results',
  'play',
  'adminUsers',
  'adminAudit',
])

const VALID_ACTIVITIES = new Set<ActivityType>([
  'trueFalse',
  'singleChoice',
  'matching',
  'sorting',
  'ordering',
  'scenario',
  'multiSelect',
  'fillBlanks',
  'spotError',
  'markWords',
  'gridCheck',
  'vennDiagram',
  'shortAnswer',
])

const VALID_KINDS = new Set<VaultNoteKind>([
  'dashboard',
  'inbox',
  'configuracion',
  'moc',
  'guia',
  'actividad',
  'emergencia',
  'cuenta',
])

const VALID_ACTION_TARGETS = new Set<VaultActionTarget>([
  'view:overview',
  'view:content',
  'view:proposals',
  'view:rooms',
  'view:results',
  'role:student',
  'modal:feedback',
  'modal:help',
])

function stripQuotes(raw: string): string {
  const trimmed = raw.trim()
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1).replace(/\\"/g, '"').replace(/\\'/g, "'")
  }
  return trimmed
}

function parseInlineArray(raw: string): string[] {
  const inner = raw.trim().replace(/^\[/, '').replace(/\]$/, '').trim()
  if (!inner) return []
  return inner
    .split(',')
    .map((item) => stripQuotes(item))
    .filter(Boolean)
}

type RawFrontmatter = {
  scalars: Record<string, string>
  lists: Record<string, string[]>
  objectLists: Record<string, Array<Record<string, string>>>
}

function parseYamlFrontmatter(yamlBlock: string): RawFrontmatter {
  const scalars: Record<string, string> = {}
  const lists: Record<string, string[]> = {}
  const objectLists: Record<string, Array<Record<string, string>>> = {}

  const lines = yamlBlock.split(/\r?\n/)
  let currentKey: string | null = null
  let currentObj: Record<string, string> | null = null

  for (const rawLine of lines) {
    const cleanLine = rawLine.replace(/\s+#.*$/, '')
    if (!cleanLine.trim()) continue

    // Clave de nivel raíz: `clave: valor`
    const rootMatch = cleanLine.match(/^([a-zA-Z0-9_]+):\s*(.*)$/)
    if (rootMatch) {
      const key = rootMatch[1]
      const value = rootMatch[2].trim()
      currentObj = null

      if (!value) {
        currentKey = key
        continue
      }
      if (value.startsWith('[') && value.endsWith(']')) {
        lists[key] = parseInlineArray(value)
        currentKey = null
        continue
      }
      scalars[key] = stripQuotes(value)
      currentKey = null
      continue
    }

    if (!currentKey) continue

    // Elemento de objeto en lista: `  - label: "Ir a Salas"`
    const objStartMatch = cleanLine.match(/^\s+-\s+([a-zA-Z0-9_]+):\s*(.*)$/)
    if (objStartMatch) {
      if (!objectLists[currentKey]) objectLists[currentKey] = []
      currentObj = { [objStartMatch[1]]: stripQuotes(objStartMatch[2]) }
      objectLists[currentKey].push(currentObj)
      continue
    }

    // Propiedad adicional del objeto en lista: `    target: "view:rooms"`
    const objPropMatch = cleanLine.match(/^\s{4,}([a-zA-Z0-9_]+):\s*(.*)$/)
    if (objPropMatch && currentObj) {
      currentObj[objPropMatch[1]] = stripQuotes(objPropMatch[2])
      continue
    }

    // Elemento simple en lista: `  - "sinonimo"`
    const listItemMatch = cleanLine.match(/^\s+-\s+(.*)$/)
    if (listItemMatch) {
      if (!lists[currentKey]) lists[currentKey] = []
      const item = stripQuotes(listItemMatch[1])
      if (item) lists[currentKey].push(item)
    }
  }

  return { scalars, lists, objectLists }
}

export function extractWikilinks(markdown: string): string[] {
  const withoutComments = markdown.replace(/<!--[\s\S]*?-->/g, '')
  const links: string[] = []
  const seen = new Set<string>()
  const regex = /\[\[([^\]|#]+)(?:\|[^\]]+)?\]\]/g
  let match: RegExpExecArray | null
  while ((match = regex.exec(withoutComments)) !== null) {
    const target = match[1].trim()
    if (target && !seen.has(target)) {
      seen.add(target)
      links.push(target)
    }
  }
  return links
}

export function humanizeWikilinks(markdown: string, titleLookup?: ReadonlyMap<string, string>): string {
  return markdown.replace(/\[\[([^\]|#]+)(?:\|([^\]]+))?\]\]/g, (_, rawTarget: string, alias?: string) => {
    if (alias && alias.trim()) return alias.trim()
    const target = rawTarget.trim()
    return titleLookup?.get(target) ?? target.replace(/_/g, ' ')
  })
}

function parseSections(bodyMarkdown: string): VaultSection[] {
  const withoutComments = bodyMarkdown.replace(/<!--[\s\S]*?-->/g, '').trim()
  const lines = withoutComments.split(/\r?\n/)
  const sections: VaultSection[] = []
  let currentHeading = ''
  let buffer: string[] = []

  const flush = () => {
    const content = buffer.join('\n').trim()
    if (currentHeading && content) {
      sections.push({ heading: currentHeading, content })
    }
    buffer = []
  }

  for (const line of lines) {
    const h2 = line.match(/^##\s+(.+)$/)
    if (h2) {
      flush()
      currentHeading = h2[1].trim()
      continue
    }
    if (currentHeading) {
      buffer.push(line)
    }
  }
  flush()
  return sections
}

export function slugFromVaultPath(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/')
  const base = normalized.split('/').pop() ?? normalized
  return base.replace(/\.md$/i, '')
}

export function folderFromVaultPath(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/')
  const idx = normalized.indexOf('knowledge/')
  const rel = idx >= 0 ? normalized.slice(idx + 'knowledge/'.length) : normalized
  const parts = rel.split('/')
  return parts.length > 1 ? parts[0] : ''
}

export function parseVaultMarkdown(filePath: string, rawMarkdown: string): VaultNote {
  const slug = slugFromVaultPath(filePath)
  const folder = folderFromVaultPath(filePath)
  const fmMatch = rawMarkdown.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/)
  const fmRaw = fmMatch ? fmMatch[1] : ''
  const bodyMarkdown = (fmMatch ? rawMarkdown.slice(fmMatch[0].length) : rawMarkdown).trim()

  const parsed = parseYamlFrontmatter(fmRaw)
  const id = parsed.scalars.id || slug.toLowerCase()
  const rawKind = parsed.scalars.tipo as VaultNoteKind | undefined
  const tipo: VaultNoteKind = rawKind && VALID_KINDS.has(rawKind) ? rawKind : 'guia'
  const titulo = parsed.scalars.titulo || slug.replace(/_/g, ' ')

  const vistas = (parsed.lists.vistas ?? []).filter((v): v is AssistantView =>
    VALID_VIEWS.has(v as AssistantView)
  )

  const rawActividad = parsed.scalars.actividad
  const actividad: ActivityType | null =
    rawActividad && rawActividad !== 'null' && VALID_ACTIVITIES.has(rawActividad as ActivityType)
      ? (rawActividad as ActivityType)
      : null

  const acciones: VaultAction[] = (parsed.objectLists.acciones ?? [])
    .filter((entry) => entry.label && VALID_ACTION_TARGETS.has(entry.target as VaultActionTarget))
    .map((entry) => ({
      label: entry.label,
      target: entry.target as VaultActionTarget,
    }))

  const diagnosticoBotones: VaultDiagnosticButton[] = (parsed.objectLists.diagnostico_botones ?? [])
    .filter((entry) => entry.label && entry.target_note)
    .map((entry) => ({
      label: entry.label,
      targetNote: entry.target_note,
    }))

  const sections = parseSections(bodyMarkdown)
  const quickSection = sections.find((s) => /respuesta r[aá]pida/i.test(s.heading))
  const firstParagraph =
    quickSection?.content ??
    bodyMarkdown
      .replace(/^#\s+.+$/gm, '')
      .split(/\r?\n\r?\n/)
      .map((p) => p.trim())
      .find((p) => p && !p.startsWith('```') && !p.startsWith('>')) ??
    titulo

  return {
    slug,
    path: filePath.replace(/\\/g, '/'),
    folder,
    id,
    tipo,
    titulo,
    vistas,
    actividad,
    sinonimos: parsed.lists.sinonimos ?? [],
    sintomas: parsed.lists.sintomas ?? [],
    preguntasEjemplo: parsed.lists.preguntas_ejemplo ?? [],
    acciones,
    diagnosticoBotones,
    rawMarkdown,
    bodyMarkdown,
    summary: firstParagraph,
    sections,
    outgoingLinks: extractWikilinks(bodyMarkdown),
    incomingLinks: [],
  }
}

export function parseSynonymDictionary(rawMarkdown: string): string[][] {
  const codeBlockMatch = rawMarkdown.match(/```yaml\r?\n([\s\S]*?)\r?\n```/i)
  if (!codeBlockMatch) return []

  const groups: string[][] = []
  const lines = codeBlockMatch[1].split(/\r?\n/)
  for (const line of lines) {
    const match = line.match(/^\s+[a-zA-Z0-9_]+:\s*\[(.+)\]\s*$/)
    if (!match) continue
    const terms = match[1]
      .split(',')
      .map((item) => stripQuotes(item))
      .filter(Boolean)
    if (terms.length > 1) groups.push(terms)
  }
  return groups
}
