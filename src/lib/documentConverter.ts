/**
 * Conversor universal de documentos a Markdown 100% en el navegador (PC, tablet y móvil/PWA).
 * - No requiere servidor Python ni sube archivos binarios pesados por datos móviles.
 * - Carga `jszip` y `pdfjs-dist` bajo demanda (lazy import) para mantener liviano el arranque móvil.
 * - Procesa PDF página por página liberando memoria RAM (`page.cleanup()`) para celulares gama media.
 */

import { CONTENT_SCHEMA_ID, CONTENT_SCHEMA_VERSION_V1, type ContentImportDocumentV1 } from './contentImport'

export const ALLOWED_DOCUMENT_EXTENSIONS = [
  '.pdf',
  '.pptx',
  '.docx',
  '.xlsx',
  '.txt',
  '.md',
  '.csv',
  '.html',
  '.htm',
] as const

/**
 * Atributo `accept` completo con tipos MIME y extensiones para máxima compatibilidad
 * con iOS Safari, Android Chrome, Google Drive, OneDrive e iCloud en dispositivos móviles.
 */
export const DOCUMENT_ACCEPT_ATTR = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/plain',
  'text/markdown',
  'text/csv',
  'text/html',
  ...ALLOWED_DOCUMENT_EXTENSIONS,
].join(',')

export const MAX_BROWSER_DOCUMENT_BYTES = 150 * 1024 * 1024 // 150 MB

export type ConvertedDocumentResult = {
  name: string
  extension: string
  bytes: number
  markdown: string
  conversionMs: number
  wordCount: number
}

export type BatchDocumentConversionResult = {
  documents: ConvertedDocumentResult[]
  combinedMarkdown: string
  totalConversionMs: number
}

export type BrowserDocumentInput = {
  name: string
  size: number
  arrayBuffer: () => Promise<ArrayBuffer>
}

export function getDocumentExtension(filename: string): string {
  const idx = filename.lastIndexOf('.')
  if (idx === -1) return ''
  return filename.slice(idx).toLowerCase()
}

export function isSupportedDocumentFilename(filename: string): boolean {
  const ext = getDocumentExtension(filename)
  return (ALLOWED_DOCUMENT_EXTENSIONS as readonly string[]).includes(ext)
}

function decodeXmlEntities(input: string): string {
  return input
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(parseInt(dec, 10)))
}

function renderMarkdownTable(rows: string[][]): string {
  const normalizedRows = rows
    .map((row) => row.map((cell) => cell.replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim()))
    .filter((row) => row.some((cell) => cell.length > 0))

  if (normalizedRows.length === 0) return ''
  const colCount = Math.max(...normalizedRows.map((r) => r.length))
  if (colCount === 0) return ''

  const padRow = (row: string[]) => {
    const copy = [...row]
    while (copy.length < colCount) copy.push('')
    return `| ${copy.join(' | ')} |`
  }

  const header = padRow(normalizedRows[0])
  const separator = `| ${Array.from({ length: colCount }, () => '---').join(' | ')} |`
  const body = normalizedRows.slice(1).map(padRow)
  return [header, separator, ...body].join('\n')
}

function extractXmlTagText(xmlFragment: string, textTagPattern: RegExp): string {
  const parts: string[] = []
  let match: RegExpExecArray | null
  while ((match = textTagPattern.exec(xmlFragment)) !== null) {
    parts.push(decodeXmlEntities(match[1]))
  }
  return parts.join('').replace(/\s+/g, ' ').trim()
}

function parsePptxSlideXml(xml: string, slideNumber: number): string {
  const blocks: string[] = [`<!-- Slide number: ${slideNumber} -->`]

  // 1. Extraer tablas (<a:tbl> ... </a:tbl>) y reemplazarlas para no duplicar su texto en párrafos
  const tableRegex = /<a:tbl\b[^>]*>[\s\S]*?<\/a:tbl>/g
  const tables: string[] = []
  const withoutTables = xml.replace(tableRegex, (tableXml) => {
    const rows: string[][] = []
    const rowRegex = /<a:tr\b[^>]*>([\s\S]*?)<\/a:tr>/g
    let rowMatch: RegExpExecArray | null
    while ((rowMatch = rowRegex.exec(tableXml)) !== null) {
      const cells: string[] = []
      const cellRegex = /<a:tc\b[^>]*>([\s\S]*?)<\/a:tc>/g
      let cellMatch: RegExpExecArray | null
      while ((cellMatch = cellRegex.exec(rowMatch[1])) !== null) {
        const cellText = extractXmlTagText(cellMatch[1], /<a:t\b[^>]*>([\s\S]*?)<\/a:t>/g)
        cells.push(cellText)
      }
      if (cells.length > 0) rows.push(cells)
    }
    const mdTable = renderMarkdownTable(rows)
    if (mdTable) tables.push(mdTable)
    return ''
  })

  // 2. Extraer párrafos (<a:p> ... </a:p>)
  const paraRegex = /<a:p\b[^>]*>([\s\S]*?)<\/a:p>/g
  let paraMatch: RegExpExecArray | null
  while ((paraMatch = paraRegex.exec(withoutTables)) !== null) {
    const line = extractXmlTagText(paraMatch[1], /<a:t\b[^>]*>([\s\S]*?)<\/a:t>/g)
    if (line) blocks.push(line)
  }

  for (const tbl of tables) {
    blocks.push(tbl)
  }

  return blocks.join('\n')
}

async function convertPptxBufferToMarkdown(buffer: ArrayBuffer): Promise<string> {
  const JSZip = (await import('jszip')).default
  const zip = await JSZip.loadAsync(buffer)

  const slidePaths = Object.keys(zip.files)
    .filter((filePath) => /^ppt\/slides\/slide\d+\.xml$/i.test(filePath))
    .sort((a, b) => {
      const numA = parseInt(a.match(/slide(\d+)\.xml$/i)?.[1] ?? '0', 10)
      const numB = parseInt(b.match(/slide(\d+)\.xml$/i)?.[1] ?? '0', 10)
      return numA - numB
    })

  const slidesMarkdown: string[] = []
  for (let i = 0; i < slidePaths.length; i += 1) {
    const file = zip.file(slidePaths[i])
    if (!file) continue
    const xml = await file.async('string')
    const parsed = parsePptxSlideXml(xml, i + 1)
    if (parsed.trim()) slidesMarkdown.push(parsed)
  }

  return slidesMarkdown.join('\n\n')
}

function parseDocxDocumentXml(xml: string): string {
  const blocks: string[] = []

  // Separar bloques de nivel superior dentro de <w:body>: párrafos (<w:p>) y tablas (<w:tbl>)
  const bodyMatch = xml.match(/<w:body\b[^>]*>([\s\S]*?)<\/w:body>/)
  const bodyXml = bodyMatch ? bodyMatch[1] : xml

  const tokenRegex = /<w:tbl\b[^>]*>[\s\S]*?<\/w:tbl>|<w:p\b[^>]*>[\s\S]*?<\/w:p>/g
  let match: RegExpExecArray | null

  while ((match = tokenRegex.exec(bodyXml)) !== null) {
    const fragment = match[0]
    if (fragment.startsWith('<w:tbl')) {
      const rows: string[][] = []
      const rowRegex = /<w:tr\b[^>]*>([\s\S]*?)<\/w:tr>/g
      let rowMatch: RegExpExecArray | null
      while ((rowMatch = rowRegex.exec(fragment)) !== null) {
        const cells: string[] = []
        const cellRegex = /<w:tc\b[^>]*>([\s\S]*?)<\/w:tc>/g
        let cellMatch: RegExpExecArray | null
        while ((cellMatch = cellRegex.exec(rowMatch[1])) !== null) {
          const cellText = extractXmlTagText(cellMatch[1], /<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g)
          cells.push(cellText)
        }
        if (cells.length > 0) rows.push(cells)
      }
      const mdTable = renderMarkdownTable(rows)
      if (mdTable) blocks.push(mdTable)
      continue
    }

    // Es un párrafo <w:p>
    const text = extractXmlTagText(fragment, /<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g)
    if (!text) continue

    const styleMatch = fragment.match(/<w:pStyle\b[^>]*w:val="([^"]+)"/)
    const styleVal = (styleMatch?.[1] ?? '').toLowerCase()
    const isList = /<w:numPr\b/.test(fragment) || styleVal.includes('list')

    if (styleVal.includes('heading1') || styleVal.includes('titulo1') || styleVal.includes('ttulo1') || styleVal === 'title') {
      blocks.push(`# ${text}`)
    } else if (styleVal.includes('heading2') || styleVal.includes('titulo2') || styleVal.includes('ttulo2')) {
      blocks.push(`## ${text}`)
    } else if (styleVal.includes('heading3') || styleVal.includes('titulo3') || styleVal.includes('ttulo3')) {
      blocks.push(`### ${text}`)
    } else if (isList) {
      blocks.push(`- ${text}`)
    } else {
      blocks.push(text)
    }
  }

  return blocks.join('\n\n')
}

async function convertDocxBufferToMarkdown(buffer: ArrayBuffer): Promise<string> {
  const JSZip = (await import('jszip')).default
  const zip = await JSZip.loadAsync(buffer)
  const docFile = zip.file('word/document.xml')
  if (!docFile) {
    throw new Error('El archivo Word (.docx) no contiene contenido legible.')
  }
  const xml = await docFile.async('string')
  return parseDocxDocumentXml(xml)
}

async function convertXlsxBufferToMarkdown(buffer: ArrayBuffer): Promise<string> {
  const JSZip = (await import('jszip')).default
  const zip = await JSZip.loadAsync(buffer)

  // Cargar tabla de textos compartidos si existe
  const sharedStrings: string[] = []
  const sstFile = zip.file('xl/sharedStrings.xml')
  if (sstFile) {
    const sstXml = await sstFile.async('string')
    const siRegex = /<si\b[^>]*>([\s\S]*?)<\/si>/g
    let siMatch: RegExpExecArray | null
    while ((siMatch = siRegex.exec(sstXml)) !== null) {
      sharedStrings.push(extractXmlTagText(siMatch[1], /<t\b[^>]*>([\s\S]*?)<\/t>/g))
    }
  }

  const sheetPaths = Object.keys(zip.files)
    .filter((p) => /^xl\/worksheets\/sheet\d+\.xml$/i.test(p))
    .sort((a, b) => {
      const numA = parseInt(a.match(/sheet(\d+)\.xml$/i)?.[1] ?? '0', 10)
      const numB = parseInt(b.match(/sheet(\d+)\.xml$/i)?.[1] ?? '0', 10)
      return numA - numB
    })

  const sheetBlocks: string[] = []
  for (let idx = 0; idx < sheetPaths.length; idx += 1) {
    const sheetFile = zip.file(sheetPaths[idx])
    if (!sheetFile) continue
    const xml = await sheetFile.async('string')
    const rows: string[][] = []
    const rowRegex = /<row\b[^>]*>([\s\S]*?)<\/row>/g
    let rowMatch: RegExpExecArray | null
    while ((rowMatch = rowRegex.exec(xml)) !== null) {
      const cells: string[] = []
      const cellRegex = /<c\b([^>]*)>([\s\S]*?)<\/c>/g
      let cellMatch: RegExpExecArray | null
      while ((cellMatch = cellRegex.exec(rowMatch[1])) !== null) {
        const attrs = cellMatch[1]
        const inner = cellMatch[2]
        const typeMatch = attrs.match(/\bt="([^"]+)"/)
        const cellType = typeMatch?.[1] ?? ''
        if (cellType === 's') {
          const valMatch = inner.match(/<v>(\d+)<\/v>/)
          const strIdx = valMatch ? parseInt(valMatch[1], 10) : -1
          cells.push(sharedStrings[strIdx] ?? '')
        } else if (cellType === 'inlineStr') {
          cells.push(extractXmlTagText(inner, /<t\b[^>]*>([\s\S]*?)<\/t>/g))
        } else {
          const valMatch = inner.match(/<v>([\s\S]*?)<\/v>/)
          cells.push(valMatch ? decodeXmlEntities(valMatch[1].trim()) : '')
        }
      }
      if (cells.some((c) => c.length > 0)) rows.push(cells)
    }
    const mdTable = renderMarkdownTable(rows)
    if (mdTable) {
      sheetBlocks.push(`## Hoja ${idx + 1}\n\n${mdTable}`)
    }
  }

  return sheetBlocks.join('\n\n')
}

function convertCsvToMarkdown(text: string): string {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0)
  if (!lines.length) return ''
  const separator = lines[0].includes(';') && !lines[0].includes(',') ? ';' : ','
  const rows = lines.map((line) => line.split(separator).map((cell) => cell.replace(/^"|"$/g, '').trim()))
  return renderMarkdownTable(rows)
}

function convertHtmlToMarkdown(html: string): string {
  return decodeXmlEntities(
    html
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi, '\n# $1\n')
      .replace(/<h2\b[^>]*>([\s\S]*?)<\/h2>/gi, '\n## $1\n')
      .replace(/<h3\b[^>]*>([\s\S]*?)<\/h3>/gi, '\n### $1\n')
      .replace(/<li\b[^>]*>([\s\S]*?)<\/li>/gi, '\n- $1')
      .replace(/<\/(p|div|section|article|tr|br)>/gi, '\n')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

type PdfTextItem = {
  str?: string
  transform?: number[]
  hasEOL?: boolean
}

let pdfWorkerConfigured = false

async function convertPdfBufferToMarkdown(
  buffer: ArrayBuffer,
  onPageProgress?: (current: number, total: number) => void,
): Promise<string> {
  const pdfjs = await import('pdfjs-dist')

  // Configurar worker empaquetado localmente por Vite (funciona 100% offline/PWA sin CDN externo)
  if (!pdfWorkerConfigured && typeof window !== 'undefined') {
    const workerModule = await import('pdfjs-dist/build/pdf.worker.min.mjs?url')
    pdfjs.GlobalWorkerOptions.workerSrc = workerModule.default
    pdfWorkerConfigured = true
  }

  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(buffer),
    useSystemFonts: true,
  })

  const pdfDoc = await loadingTask.promise
  const pagesOutput: string[] = []

  try {
    for (let pageNum = 1; pageNum <= pdfDoc.numPages; pageNum += 1) {
      onPageProgress?.(pageNum, pdfDoc.numPages)
      const page = await pdfDoc.getPage(pageNum)
      try {
        const textContent = await page.getTextContent()
        const lines: string[] = []
        let currentLine: string[] = []
        let lastY: number | null = null

        for (const rawItem of textContent.items) {
          const item = rawItem as PdfTextItem
          const str = typeof item.str === 'string' ? item.str : ''
          const y = Array.isArray(item.transform) ? Math.round(item.transform[5] ?? 0) : null

          if (lastY !== null && y !== null && Math.abs(y - lastY) > 4) {
            const joined = currentLine.join(' ').replace(/\s+/g, ' ').trim()
            if (joined) lines.push(joined)
            currentLine = []
          }

          if (str.trim()) {
            currentLine.push(str.trim())
          }

          if (item.hasEOL) {
            const joined = currentLine.join(' ').replace(/\s+/g, ' ').trim()
            if (joined) lines.push(joined)
            currentLine = []
            lastY = null
          } else if (y !== null) {
            lastY = y
          }
        }

        const trailing = currentLine.join(' ').replace(/\s+/g, ' ').trim()
        if (trailing) lines.push(trailing)

        if (lines.length > 0) {
          pagesOutput.push(lines.join('\n'))
        }
      } finally {
        // Liberar memoria página por página (vital para teléfonos móviles con PDFs extensos)
        page.cleanup()
      }
    }
  } finally {
    await loadingTask.destroy()
  }

  return pagesOutput.join('\n\n')
}

export async function convertDocumentToMarkdown(
  file: BrowserDocumentInput,
  onProgress?: (detail: string) => void,
): Promise<ConvertedDocumentResult> {
  const start = performance.now()
  const ext = getDocumentExtension(file.name)

  if (!isSupportedDocumentFilename(file.name)) {
    throw new Error(`El formato de "${file.name}" no es compatible. Usa PDF, PowerPoint, Word, Excel o texto.`)
  }
  if (file.size > MAX_BROWSER_DOCUMENT_BYTES) {
    throw new Error(`"${file.name}" supera el límite de 150 MB por archivo.`)
  }

  const buffer = await file.arrayBuffer()
  let markdown = ''

  if (ext === '.pdf') {
    markdown = await convertPdfBufferToMarkdown(buffer, (curr, total) => {
      if (total > 3) {
        onProgress?.(`Leyendo "${file.name}" (página ${curr} de ${total})...`)
      }
    })
  } else if (ext === '.pptx') {
    markdown = await convertPptxBufferToMarkdown(buffer)
  } else if (ext === '.docx') {
    markdown = await convertDocxBufferToMarkdown(buffer)
  } else if (ext === '.xlsx') {
    markdown = await convertXlsxBufferToMarkdown(buffer)
  } else {
    const rawText = new TextDecoder('utf-8', { fatal: false }).decode(buffer)
    if (ext === '.csv') {
      markdown = convertCsvToMarkdown(rawText)
    } else if (ext === '.html' || ext === '.htm') {
      markdown = convertHtmlToMarkdown(rawText)
    } else {
      markdown = rawText.trim()
    }
  }

  const cleaned = markdown.trim()
  if (!cleaned) {
    throw new Error(
      `No se pudo extraer texto de "${file.name}". Si es un PDF escaneado como imagen sin texto seleccionable, prueba con un archivo con texto digital.`,
    )
  }

  const elapsed = Math.round((performance.now() - start) * 10) / 10
  return {
    name: file.name,
    extension: ext,
    bytes: file.size,
    markdown: cleaned,
    conversionMs: elapsed,
    wordCount: cleaned.split(/\s+/).filter(Boolean).length,
  }
}

export async function convertDocumentsInBrowser(
  files: BrowserDocumentInput[],
  onProgress?: (message: string) => void,
): Promise<BatchDocumentConversionResult> {
  const results: ConvertedDocumentResult[] = []
  const blocks: string[] = []
  let totalMs = 0

  for (let i = 0; i < files.length; i += 1) {
    const file = files[i]
    onProgress?.(`Leyendo documento ${i + 1} de ${files.length}: ${file.name}...`)
    const converted = await convertDocumentToMarkdown(file, onProgress)
    results.push(converted)
    totalMs += converted.conversionMs
    blocks.push(`<!-- Documento fuente: ${converted.name} -->\n${converted.markdown}`)
  }

  return {
    documents: results,
    combinedMarkdown: blocks.join('\n\n---\n\n'),
    totalConversionMs: Math.round(totalMs * 10) / 10,
  }
}

function cleanTextLine(text: string): string {
  return text
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/[*_`]+/g, '')
    .replace(/^\s*[-•*·]+\s*/, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Estructurador local en TypeScript:
 * Convierte el Markdown extraído en el navegador en un documento `edueval.content` v1
 * válido cuando no hay Edge Function / motor LLM activo (modo local, pruebas o sin conexión).
 */
export function buildLocalEvalueduV1FromMarkdown(
  combinedMarkdown: string,
  filenames: string[],
): ContentImportDocumentV1 {
  const lines = combinedMarkdown.split(/\r?\n/).map((ln) => ln.trim())
  const nonEmpty = lines.filter((ln) => ln.length > 0 && !ln.startsWith('<!--'))

  // 1. Título principal
  let title = ''
  for (const ln of nonEmpty) {
    if (ln.startsWith('# ')) {
      title = cleanTextLine(ln.slice(2))
      break
    }
  }
  if (!title) {
    for (const ln of nonEmpty) {
      const cleaned = cleanTextLine(ln)
      if (cleaned.length >= 5 && cleaned.length <= 120 && !cleaned.startsWith('|')) {
        title = cleaned
        break
      }
    }
  }
  if (!title) {
    const base = (filenames[0] ?? 'Documento académico').replace(/\.[^.]+$/, '')
    title = base.replace(/[_-]+/g, ' ').trim() || 'Documento académico'
  }
  title = title.slice(0, 180)

  // 2. Asignatura, objetivo y competencia
  let subject = 'Cátedra Universitaria'
  let objective = `Analizar y aplicar los conceptos clave extraídos de ${title}.`
  let competency = `Integra los fundamentos teóricos y procedimentales abordados en ${title}.`

  for (const ln of nonEmpty.slice(0, 25)) {
    const low = ln.toLowerCase()
    if (low.startsWith('asignatura:') || low.startsWith('materia:') || low.startsWith('curso:')) {
      const val = cleanTextLine(ln.slice(ln.indexOf(':') + 1))
      if (val) subject = val.slice(0, 120)
    } else if (low.startsWith('objetivo:')) {
      const val = cleanTextLine(ln.slice(ln.indexOf(':') + 1))
      if (val) objective = val.slice(0, 1200)
    } else if (low.startsWith('competencia:')) {
      const val = cleanTextLine(ln.slice(ln.indexOf(':') + 1))
      if (val) competency = val.slice(0, 1200)
    }
  }

  // 3. Conceptos
  const concepts: Array<{ name: string; definition: string; example?: string }> = []
  const seenConcepts = new Set<string>()
  const skipConceptKeys = new Set([
    'asignatura',
    'materia',
    'curso',
    'objetivo',
    'competencia',
    'contexto',
    'decisión recomendada',
    'consecuencia',
    'paso 1',
    'paso 2',
    'paso 3',
    'paso 4',
  ])

  const addConcept = (name: string, definition: string) => {
    const cName = cleanTextLine(name).slice(0, 140)
    const cDef = cleanTextLine(definition).slice(0, 600)
    if (cName.length < 3 || cDef.length < 12) return
    const key = cName.toLowerCase()
    if (skipConceptKeys.has(key) || seenConcepts.has(key)) return
    seenConcepts.add(key)
    concepts.push({ name: cName, definition: cDef })
  }

  for (const ln of nonEmpty) {
    if (ln.startsWith('|') || ln.startsWith('#')) continue
    const cleaned = cleanTextLine(ln)
    const colonIdx = cleaned.indexOf(':')
    if (colonIdx > 2 && !/^paso\s+\d+/i.test(cleaned)) {
      const left = cleaned.slice(0, colonIdx).trim()
      const right = cleaned.slice(colonIdx + 1).trim()
      if (left.length >= 3 && left.length <= 75 && right.length >= 15) {
        addConcept(left, right)
      }
    }
  }

  for (let i = 0; i < lines.length; i += 1) {
    const ln = lines[i]
    if (ln.startsWith('## ')) {
      const heading = cleanTextLine(ln.slice(3)).replace(/^\d+[.)]\s*/, '')
      for (const nxt of lines.slice(i + 1, i + 6)) {
        if (nxt && !nxt.startsWith('#') && !nxt.startsWith('|') && !nxt.startsWith('<!--')) {
          addConcept(heading, nxt)
          break
        }
      }
    }
  }

  // 4. Pasos de proceso
  const processSteps: string[] = []
  for (const ln of nonEmpty) {
    const cleaned = cleanTextLine(ln)
    if (/^(paso\s+\d+|fase\s+\d+|etapa\s+\d+|\d+[.)])\s*[:-]?\s+/i.test(cleaned)) {
      const stepText = cleaned.replace(/^(paso\s+\d+|fase\s+\d+|etapa\s+\d+|\d+[.)])\s*[:-]?\s*/i, '').trim()
      if (stepText.length >= 10 && !processSteps.includes(stepText)) {
        processSteps.push(stepText.slice(0, 280))
      }
    }
  }

  // 5. Categorías (encabezados de tablas Markdown o subtítulos ##)
  const categories: string[] = []
  for (const ln of nonEmpty) {
    if (ln.startsWith('|') && ln.endsWith('|') && !ln.includes('---')) {
      const cells = ln.slice(1, -1).split('|').map((c) => cleanTextLine(c))
      if (cells.length >= 3 && ['criterio', 'característica', 'aspecto', 'dimensión', 'tema'].includes(cells[0].toLowerCase())) {
        for (const col of cells.slice(1)) {
          if (col && !categories.includes(col)) categories.push(col.slice(0, 100))
        }
        break
      }
    }
  }
  if (categories.length < 2) {
    for (const ln of nonEmpty) {
      if (ln.startsWith('## ')) {
        const cat = cleanTextLine(ln.slice(3)).replace(/^\d+[.)]\s*/, '')
        if (cat.length >= 3 && cat.length <= 80 && !categories.includes(cat)) {
          categories.push(cat)
        }
        if (categories.length >= 4) break
      }
    }
  }

  // 6. Situaciones / casos prácticos
  const situations: Array<{ title: string; context: string; decision: string; consequence: string }> = []
  let sitTitle = ''
  let ctxVal = ''
  let decVal = ''
  let consVal = ''

  for (const ln of nonEmpty) {
    const cleaned = cleanTextLine(ln)
    const low = cleaned.toLowerCase()
    if (low.startsWith('caso práctico:') || low.startsWith('caso de estudio:') || low.startsWith('escenario:')) {
      sitTitle = cleaned.slice(cleaned.indexOf(':') + 1).trim().slice(0, 140)
    } else if (low.startsWith('contexto:')) {
      ctxVal = cleaned.slice(cleaned.indexOf(':') + 1).trim().slice(0, 800)
    } else if (low.startsWith('decisión recomendada:') || low.startsWith('decisión:') || low.startsWith('solución:')) {
      decVal = cleaned.slice(cleaned.indexOf(':') + 1).trim().slice(0, 800)
    } else if (low.startsWith('consecuencia:') || low.startsWith('resultado:')) {
      consVal = cleaned.slice(cleaned.indexOf(':') + 1).trim().slice(0, 800)
    }
  }

  if (ctxVal && decVal && consVal) {
    situations.push({
      title: sitTitle || `Caso aplicado de ${title}`.slice(0, 140),
      context: ctxVal,
      decision: decVal,
      consequence: consVal,
    })
  }

  if (concepts.length === 0) {
    const paragraphs = nonEmpty
      .filter((ln) => !ln.startsWith('#') && !ln.startsWith('|'))
      .map(cleanTextLine)
      .filter((ln) => ln.length >= 40)
    paragraphs.slice(0, 5).forEach((para, idx) => {
      addConcept(`Idea clave ${idx + 1} (${title.slice(0, 40)})`, para)
    })
  }

  if (concepts.length === 0) {
    concepts.push({
      name: title.slice(0, 100),
      definition: cleanTextLine(combinedMarkdown).slice(0, 450) || `Material académico de ${title}.`,
    })
  }

  const descriptionParts = nonEmpty
    .filter((ln) => !ln.startsWith('#') && !ln.startsWith('|'))
    .map(cleanTextLine)
    .slice(0, 4)

  return {
    schema: CONTENT_SCHEMA_ID,
    version: CONTENT_SCHEMA_VERSION_V1,
    content: {
      title,
      subject,
      description: descriptionParts.join(' ').slice(0, 1400) || `Material académico importado desde ${filenames.join(', ')}.`,
      objective,
      competency,
      difficulty: 'Intermedio',
      concepts: concepts.slice(0, 20),
      situations: situations.slice(0, 6),
      processSteps: processSteps.slice(0, 12),
      categories: categories.slice(0, 8),
    },
  }
}
