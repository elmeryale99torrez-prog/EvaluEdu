import type { ActivityType } from '../activityEngine'
import type { RelatedNoteChip, VaultNote } from './types'
import { humanizeWikilinks, parseSynonymDictionary, parseVaultMarkdown } from './vaultParser'

// Auto-descubre cualquier nota .md creada o editada desde Obsidian sin tocar TypeScript.
const rawVaultFiles = import.meta.glob('../../knowledge/**/*.md', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

export interface KnowledgeVaultIndex {
  allNotes: VaultNote[]
  searchableNotes: VaultNote[]
  notesBySlug: Map<string, VaultNote>
  notesById: Map<string, VaultNote>
  notesByActivity: Map<ActivityType, VaultNote>
  titleBySlug: Map<string, string>
  synonymGroups: string[][]
  brokenLinks: Array<{ from: string; target: string }>
}

function buildVaultIndex(): KnowledgeVaultIndex {
  const allNotes: VaultNote[] = []
  const notesBySlug = new Map<string, VaultNote>()
  const notesById = new Map<string, VaultNote>()
  const notesByActivity = new Map<ActivityType, VaultNote>()
  const titleBySlug = new Map<string, string>()
  let synonymGroups: string[][] = []

  const entries = Object.entries(rawVaultFiles).sort(([a], [b]) => a.localeCompare(b))

  for (const [filePath, rawContent] of entries) {
    const normalizedPath = filePath.replace(/\\/g, '/')
    const note = parseVaultMarkdown(normalizedPath, rawContent)

    allNotes.push(note)
    notesBySlug.set(note.slug, note)
    notesById.set(note.id, note)
    titleBySlug.set(note.slug, note.titulo)

    if (note.slug === 'Diccionario_Sinonimos') {
      synonymGroups = parseSynonymDictionary(rawContent)
    }

    if (note.tipo === 'actividad' && note.actividad) {
      notesByActivity.set(note.actividad, note)
    }
  }

  // Enlazar grafo bidireccional (incomingLinks) y detectar enlaces rotos
  const brokenLinks: Array<{ from: string; target: string }> = []
  for (const note of allNotes) {
    if (note.path.includes('/Plantillas/')) continue
    for (const targetSlug of note.outgoingLinks) {
      const target = notesBySlug.get(targetSlug)
      if (!target) {
        brokenLinks.push({ from: note.slug, target: targetSlug })
      } else if (!target.incomingLinks.includes(note.slug)) {
        target.incomingLinks.push(note.slug)
      }
    }
  }

  const searchableNotes = allNotes.filter(
    (note) =>
      !note.path.includes('/Plantillas/') &&
      note.tipo !== 'dashboard' &&
      note.tipo !== 'inbox' &&
      note.tipo !== 'configuracion'
  )

  return {
    allNotes,
    searchableNotes,
    notesBySlug,
    notesById,
    notesByActivity,
    titleBySlug,
    synonymGroups,
    brokenLinks,
  }
}

export const knowledgeVault: KnowledgeVaultIndex = buildVaultIndex()

export function getRelatedNoteChips(slug: string, maxItems = 4): RelatedNoteChip[] {
  const note = knowledgeVault.notesBySlug.get(slug)
  if (!note) return []

  const orderedSlugs = [...note.outgoingLinks, ...note.incomingLinks]
  const seen = new Set<string>([slug])
  const result: RelatedNoteChip[] = []

  for (const candidateSlug of orderedSlugs) {
    if (seen.has(candidateSlug)) continue
    const candidate = knowledgeVault.notesBySlug.get(candidateSlug)
    if (!candidate) continue
    if (
      candidate.tipo === 'dashboard' ||
      candidate.tipo === 'inbox' ||
      candidate.tipo === 'configuracion' ||
      candidate.path.includes('/Plantillas/')
    ) {
      continue
    }
    seen.add(candidateSlug)
    result.push({
      slug: candidate.slug,
      titulo: candidate.titulo,
      tipo: candidate.tipo,
    })
    if (result.length >= maxItems) break
  }

  return result
}

/**
 * Construye un paquete GraphRAG ligero (nodo principal + hasta N vecinos enlazados)
 * listo para enviar a Capa 2 (Gemini / NVIDIA Vision) sin inflar tokens ni alucinar.
 */
export function buildGraphRagContext(primarySlug: string | undefined, maxNeighbors = 3): string {
  const chunks: string[] = []
  const visited = new Set<string>()

  const appendNote = (note: VaultNote, maxChars: number) => {
    if (visited.has(note.slug)) return
    visited.add(note.slug)
    const readable = humanizeWikilinks(note.bodyMarkdown, knowledgeVault.titleBySlug)
      .replace(/##\s+Relacionado[\s\S]*$/i, '')
      .trim()
      .slice(0, maxChars)
    chunks.push(`[NOTA: ${note.titulo} (${note.slug})]\n${readable}`)
  }

  if (primarySlug) {
    const primary = knowledgeVault.notesBySlug.get(primarySlug)
    if (primary) {
      appendNote(primary, 1400)
      const neighbors = getRelatedNoteChips(primary.slug, maxNeighbors)
      for (const neighbor of neighbors) {
        const neighborNote = knowledgeVault.notesBySlug.get(neighbor.slug)
        if (neighborNote) appendNote(neighborNote, 700)
      }
    }
  }

  return chunks.join('\n\n---\n\n')
}
