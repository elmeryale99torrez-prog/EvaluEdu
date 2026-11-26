import { describe, it, expect } from 'vitest'
import JSZip from 'jszip'
import {
  buildLocalEvalueduV1FromMarkdown,
  convertDocumentsInBrowser,
  convertDocumentToMarkdown,
  DOCUMENT_ACCEPT_ATTR,
  isSupportedDocumentFilename,
  type BrowserDocumentInput,
} from './documentConverter'
import { parseContentImport } from './contentImport'

function createInputFromText(name: string, content: string): BrowserDocumentInput {
  const encoded = new TextEncoder().encode(content)
  const arrayBuffer = encoded.buffer.slice(encoded.byteOffset, encoded.byteOffset + encoded.byteLength)
  return {
    name,
    size: encoded.byteLength,
    arrayBuffer: async () => arrayBuffer,
  }
}

async function createSamplePptxInput(): Promise<BrowserDocumentInput> {
  const zip = new JSZip()
  zip.file(
    'ppt/slides/slide1.xml',
    `<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
      <a:p><a:r><a:t>Arquitectura Hexagonal y Microservicios</a:t></a:r></a:p>
      <a:p><a:r><a:t>Asignatura: Ingeniería de Software Avanzada</a:t></a:r></a:p>
      <a:p><a:r><a:t>Núcleo de Dominio: Contiene la lógica de negocio pura y libre de dependencias externas.</a:t></a:r></a:p>
      <a:p><a:r><a:t>Puertos: Contratos definidos por el dominio para interactuar con el exterior.</a:t></a:r></a:p>
    </p:sld>`,
  )
  zip.file(
    'ppt/slides/slide2.xml',
    `<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
      <a:p><a:r><a:t>Paso 1: Delimitar contextos acotados mediante Domain-Driven Design.</a:t></a:r></a:p>
      <a:p><a:r><a:t>Paso 2: Aislar y desacoplar el modelo de datos en esquemas independientes.</a:t></a:r></a:p>
      <a:tbl>
        <a:tr><a:tc><a:t>Criterio</a:t></a:tc><a:tc><a:t>Monolito Tradicional</a:t></a:tc><a:tc><a:t>Microservicios</a:t></a:tc></a:tr>
        <a:tr><a:tc><a:t>Despliegue</a:t></a:tc><a:tc><a:t>Conjunto</a:t></a:tc><a:tc><a:t>Independiente</a:t></a:tc></a:tr>
      </a:tbl>
      <a:p><a:r><a:t>Caso Práctico: Caída de Pasarela de Pagos</a:t></a:r></a:p>
      <a:p><a:r><a:t>Contexto: Durante una compra masiva el servicio externo de cobros colapsa.</a:t></a:r></a:p>
      <a:p><a:r><a:t>Decisión Recomendada: Implementar el patrón Circuit Breaker y encolar el pedido.</a:t></a:r></a:p>
      <a:p><a:r><a:t>Consecuencia: La plataforma mantiene continuidad y reintenta el cobro de forma asíncrona.</a:t></a:r></a:p>
    </p:sld>`,
  )
  const buf = await zip.generateAsync({ type: 'arraybuffer' })
  return {
    name: 'clase_hexagonal.pptx',
    size: buf.byteLength,
    arrayBuffer: async () => buf,
  }
}

async function createSampleDocxInput(): Promise<BrowserDocumentInput> {
  const zip = new JSZip()
  zip.file(
    'word/document.xml',
    `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
      <w:body>
        <w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Guía de Estudio: Diseño de Software Confiable</w:t></w:r></w:p>
        <w:p><w:pPr><w:pStyle w:val="Heading2"/></w:pPr><w:r><w:t>1. Principios de Modularidad</w:t></w:r></w:p>
        <w:p><w:r><w:t>El acoplamiento eferente mide cuántos módulos externos necesita una clase para operar.</w:t></w:r></w:p>
        <w:p><w:pPr><w:numPr/></w:pPr><w:r><w:t>Puertos Primarios: Invocados por actores externos hacia la aplicación.</w:t></w:r></w:p>
        <w:p><w:pPr><w:numPr/></w:pPr><w:r><w:t>Puertos Secundarios: Invocados por el dominio hacia bases de datos o colas.</w:t></w:r></w:p>
      </w:body>
    </w:document>`,
  )
  const buf = await zip.generateAsync({ type: 'arraybuffer' })
  return {
    name: 'guia_estudio.docx',
    size: buf.byteLength,
    arrayBuffer: async () => buf,
  }
}

describe('documentConverter · conversión nativa en navegador (PC y móvil)', () => {
  it('incluye tipos MIME completos para compatibilidad con Android e iOS Safari', () => {
    expect(DOCUMENT_ACCEPT_ATTR).toContain('application/pdf')
    expect(DOCUMENT_ACCEPT_ATTR).toContain('application/vnd.openxmlformats-officedocument.presentationml.presentation')
    expect(DOCUMENT_ACCEPT_ATTR).toContain('application/vnd.openxmlformats-officedocument.wordprocessingml.document')
    expect(DOCUMENT_ACCEPT_ATTR).toContain('.pdf')
    expect(DOCUMENT_ACCEPT_ATTR).toContain('.pptx')
    expect(DOCUMENT_ACCEPT_ATTR).toContain('.docx')
  })

  it('valida extensiones soportadas y rechaza formatos no permitidos', () => {
    expect(isSupportedDocumentFilename('Tema_1.PDF')).toBe(true)
    expect(isSupportedDocumentFilename('diapositivas.pptx')).toBe(true)
    expect(isSupportedDocumentFilename('guia.docx')).toBe(true)
    expect(isSupportedDocumentFilename('tabla.xlsx')).toBe(true)
    expect(isSupportedDocumentFilename('malware.exe')).toBe(false)
    expect(isSupportedDocumentFilename('video.mp4')).toBe(false)
  })

  it('convierte un PowerPoint (.pptx) a Markdown preservando diapositivas, pasos y tablas', async () => {
    const result = await convertDocumentToMarkdown(await createSamplePptxInput())
    expect(result.markdown).toContain('Arquitectura Hexagonal y Microservicios')
    expect(result.markdown).toContain('Núcleo de Dominio')
    expect(result.markdown).toContain('| Criterio | Monolito Tradicional | Microservicios |')
    expect(result.markdown).toContain('Circuit Breaker')
  })

  it('convierte un Word (.docx) a Markdown preservando títulos y viñetas', async () => {
    const result = await convertDocumentToMarkdown(await createSampleDocxInput())
    expect(result.markdown).toContain('# Guía de Estudio: Diseño de Software Confiable')
    expect(result.markdown).toContain('## 1. Principios de Modularidad')
    expect(result.markdown).toContain('- Puertos Primarios')
  })

  it('convierte CSV y HTML a Markdown limpio', async () => {
    const csvRes = await convertDocumentToMarkdown(
      createInputFromText('comparativa.csv', 'Concepto,Ventaja,Riesgo\nCaché,Reduce latencia,Datos desactualizados'),
    )
    expect(csvRes.markdown).toContain('| Concepto | Ventaja | Riesgo |')
    expect(csvRes.markdown).toContain('| Caché | Reduce latencia | Datos desactualizados |')

    const htmlRes = await convertDocumentToMarkdown(
      createInputFromText('apunte.html', '<html><head><script>alert(1)</script></head><body><h1>Biología</h1><p>La célula es la unidad funcional.</p></body></html>'),
    )
    expect(htmlRes.markdown).toContain('# Biología')
    expect(htmlRes.markdown).toContain('La célula es la unidad funcional.')
    expect(htmlRes.markdown).not.toContain('alert(1)')
  })

  it('procesa un lote combinado (.pptx + .docx) y genera un documento EvaluEdu 100% válido con los 13 formatos', async () => {
    const batch = await convertDocumentsInBrowser([
      await createSamplePptxInput(),
      await createSampleDocxInput(),
    ])

    expect(batch.documents).toHaveLength(2)
    const doc = buildLocalEvalueduV1FromMarkdown(
      batch.combinedMarkdown,
      batch.documents.map((d) => d.name),
    )

    const validated = parseContentImport(JSON.stringify(doc))
    expect(validated.ok).toBe(true)
    if (validated.ok) {
      const availableCount = Object.values(validated.compatibility).filter((c) => c.available).length
      expect(availableCount).toBe(13)
    }
  })
})
