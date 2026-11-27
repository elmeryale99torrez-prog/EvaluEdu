import { describe, it, expect } from 'vitest'
import { GOOGLE_PICKER_MIME_TYPES, resolveDriveDownloadSpec } from './googleDrivePicker'

describe('googleDrivePicker · resolución de archivos y formatos de Google Drive', () => {
  it('soporta PDF, Office y documentos nativos de Google Workspace', () => {
    expect(GOOGLE_PICKER_MIME_TYPES).toContain('application/pdf')
    expect(GOOGLE_PICKER_MIME_TYPES).toContain('application/vnd.google-apps.document')
    expect(GOOGLE_PICKER_MIME_TYPES).toContain('application/vnd.google-apps.presentation')
    expect(GOOGLE_PICKER_MIME_TYPES).toContain('application/vnd.google-apps.spreadsheet')
  })

  it('exporta Google Docs como .docx automáticamente', () => {
    const spec = resolveDriveDownloadSpec('file-123', 'Apuntes Unidad 1', 'application/vnd.google-apps.document')
    expect(spec.filename).toBe('Apuntes Unidad 1.docx')
    expect(spec.url).toContain('/files/file-123/export?mimeType=')
    expect(spec.mimeType).toBe('application/vnd.openxmlformats-officedocument.wordprocessingml.document')
  })

  it('exporta Google Slides como .pptx sin duplicar extensión', () => {
    const spec = resolveDriveDownloadSpec('slide-99', 'Clase 4.pptx', 'application/vnd.google-apps.presentation')
    expect(spec.filename).toBe('Clase 4.pptx')
    expect(spec.url).toContain('/files/slide-99/export?mimeType=')
    expect(spec.mimeType).toBe('application/vnd.openxmlformats-officedocument.presentationml.presentation')
  })

  it('descarga archivos PDF y binarios directamente mediante alt=media', () => {
    const spec = resolveDriveDownloadSpec('pdf-77', 'Programa_Oficial.pdf', 'application/pdf')
    expect(spec.filename).toBe('Programa_Oficial.pdf')
    expect(spec.url).toBe('https://www.googleapis.com/drive/v3/files/pdf-77?alt=media')
    expect(spec.mimeType).toBe('application/pdf')
  })
})
