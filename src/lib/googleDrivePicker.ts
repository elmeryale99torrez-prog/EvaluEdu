/**
 * Integración oficial de Google Drive Picker (OAuth 2.0 + Google Picker API) 100% en navegador.
 * - Usa únicamente el permiso mínimo `https://www.googleapis.com/auth/drive.file`
 *   (EvaluEdu solo puede leer el archivo exacto seleccionado por el docente).
 * - Carga los scripts de Google (`gsi/client` y `gapi`) bajo demanda al pulsar "Adjuntar desde Drive".
 * - Convierte automáticamente Google Docs, Google Slides y Google Sheets a .docx, .pptx y .xlsx.
 */

const GOOGLE_DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file'

const DEFAULT_GOOGLE_APP_ID = '122825955974'
const DEFAULT_GOOGLE_CLIENT_ID = '122825955974-hgen7joj0i3cdjifbdlsp8rjvg726mps.apps.googleusercontent.com'
const DEFAULT_GOOGLE_PICKER_API_KEY = 'AIzaSyDQoJxeLXqx_IC_YL2lQPJl3XIsYwtgrns'

export const GOOGLE_PICKER_MIME_TYPES = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.google-apps.document',
  'application/vnd.google-apps.presentation',
  'application/vnd.google-apps.spreadsheet',
  'text/plain',
  'text/markdown',
  'text/csv',
  'text/html',
] as const

export type DriveDownloadSpec = {
  url: string
  filename: string
  mimeType: string
}

const GOOGLE_EXPORT_MAP: Record<string, { mimeType: string; ext: string }> = {
  'application/vnd.google-apps.document': {
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ext: '.docx',
  },
  'application/vnd.google-apps.presentation': {
    mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    ext: '.pptx',
  },
  'application/vnd.google-apps.spreadsheet': {
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ext: '.xlsx',
  },
}

export function resolveDriveDownloadSpec(fileId: string, originalName: string, mimeType: string): DriveDownloadSpec {
  const safeId = encodeURIComponent(fileId)
  const cleanName = (originalName || 'documento-drive').trim()
  const exportConfig = GOOGLE_EXPORT_MAP[mimeType]

  if (exportConfig) {
    const hasExt = cleanName.toLowerCase().endsWith(exportConfig.ext)
    return {
      url: `https://www.googleapis.com/drive/v3/files/${safeId}/export?mimeType=${encodeURIComponent(exportConfig.mimeType)}`,
      filename: hasExt ? cleanName : `${cleanName}${exportConfig.ext}`,
      mimeType: exportConfig.mimeType,
    }
  }

  return {
    url: `https://www.googleapis.com/drive/v3/files/${safeId}?alt=media`,
    filename: cleanName,
    mimeType: mimeType || 'application/octet-stream',
  }
}

type GoogleTokenResponse = {
  access_token?: string
  expires_in?: number
  error?: string
  error_description?: string
}

type GoogleTokenClient = {
  requestAccessToken: (overrideConfig?: { prompt?: string }) => void
}

type GooglePickerDocument = {
  id: string
  name: string
  mimeType: string
}

type GooglePickerResponse = {
  action: string
  docs?: GooglePickerDocument[]
}

type GooglePickerView = {
  setMimeTypes: (mimeTypes: string) => GooglePickerView
  setIncludeFolders: (include: boolean) => GooglePickerView
}

type GooglePickerInstance = {
  setVisible: (visible: boolean) => void
}

type GooglePickerBuilder = {
  addView: (view: GooglePickerView) => GooglePickerBuilder
  enableFeature: (feature: unknown) => GooglePickerBuilder
  setLocale: (locale: string) => GooglePickerBuilder
  setOAuthToken: (token: string) => GooglePickerBuilder
  setDeveloperKey: (key: string) => GooglePickerBuilder
  setAppId: (appId: string) => GooglePickerBuilder
  setOrigin: (origin: string) => GooglePickerBuilder
  setTitle: (title: string) => GooglePickerBuilder
  setCallback: (cb: (data: GooglePickerResponse) => void) => GooglePickerBuilder
  build: () => GooglePickerInstance
}

type GoogleWindow = Window & {
  google?: {
    accounts?: {
      oauth2?: {
        initTokenClient: (config: {
          client_id: string
          scope: string
          callback: (resp: GoogleTokenResponse) => void
          error_callback?: (err: { type?: string; message?: string }) => void
        }) => GoogleTokenClient
      }
    }
    picker?: {
      Action: { PICKED: string; CANCEL: string }
      Feature: { MULTISELECT_ENABLED: unknown; NAV_HIDDEN: unknown }
      ViewId: { DOCS: unknown }
      DocsView: new (viewId?: unknown) => GooglePickerView
      PickerBuilder: new () => GooglePickerBuilder
    }
  }
  gapi?: {
    load: (apiName: string, callback: () => void) => void
  }
}

function getGoogleConfig(): { appId: string; clientId: string; apiKey: string } {
  const env = import.meta.env as Record<string, string | undefined>
  return {
    appId: (env.VITE_GOOGLE_DRIVE_APP_ID ?? DEFAULT_GOOGLE_APP_ID).trim(),
    clientId: (env.VITE_GOOGLE_DRIVE_CLIENT_ID ?? DEFAULT_GOOGLE_CLIENT_ID).trim(),
    apiKey: (env.VITE_GOOGLE_DRIVE_PICKER_API_KEY ?? DEFAULT_GOOGLE_PICKER_API_KEY).trim(),
  }
}

function loadExternalScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${src}"]`) as HTMLScriptElement | null
    if (existing) {
      if (existing.dataset.loaded === 'true') {
        resolve()
        return
      }
      existing.addEventListener('load', () => resolve(), { once: true })
      existing.addEventListener('error', () => reject(new Error(`No se pudo cargar ${src}`)), { once: true })
      return
    }

    const script = document.createElement('script')
    script.src = src
    script.async = true
    script.defer = true
    script.onload = () => {
      script.dataset.loaded = 'true'
      resolve()
    }
    script.onerror = () => reject(new Error(`No se pudo cargar ${src}`))
    document.head.appendChild(script)
  })
}

let pickerScriptsReady: Promise<void> | null = null

async function ensureGooglePickerLoaded(): Promise<void> {
  if (!pickerScriptsReady) {
    pickerScriptsReady = (async () => {
      await Promise.all([
        loadExternalScript('https://accounts.google.com/gsi/client'),
        loadExternalScript('https://apis.google.com/js/api.js'),
      ])
      const w = window as GoogleWindow
      await new Promise<void>((resolve, reject) => {
        if (!w.gapi) {
          reject(new Error('No se pudo inicializar el selector de Google Drive.'))
          return
        }
        w.gapi.load('picker', () => resolve())
      })
    })().catch((err) => {
      pickerScriptsReady = null
      throw err
    })
  }
  await pickerScriptsReady
}

let cachedAccessToken = ''
let cachedTokenExpiresAt = 0

async function getGoogleAccessToken(clientId: string): Promise<string> {
  if (cachedAccessToken && Date.now() < cachedTokenExpiresAt - 60_000) {
    return cachedAccessToken
  }

  const w = window as GoogleWindow
  const oauth2 = w.google?.accounts?.oauth2
  if (!oauth2) {
    throw new Error('No se pudo conectar con la autenticación de Google.')
  }

  return new Promise<string>((resolve, reject) => {
    const tokenClient = oauth2.initTokenClient({
      client_id: clientId,
      scope: GOOGLE_DRIVE_SCOPE,
      callback: (resp) => {
        if (resp.error || !resp.access_token) {
          if (resp.error === 'access_denied') {
            reject(new Error('Acceso cancelado. Si deseas adjuntar desde Drive, acepta el permiso de lectura del archivo elegido.'))
            return
          }
          reject(new Error(resp.error_description || 'No se pudo autorizar el acceso a Google Drive.'))
          return
        }
        cachedAccessToken = resp.access_token
        cachedTokenExpiresAt = Date.now() + (resp.expires_in ?? 3500) * 1000
        resolve(resp.access_token)
      },
      error_callback: (err) => {
        if (err.type === 'popup_closed') {
          reject(new Error('CANCELLED'))
          return
        }
        if (err.type === 'popup_failed_to_open') {
          reject(new Error('Tu navegador bloqueó la ventana de Google Drive. Permite ventanas emergentes para este sitio e inténtalo de nuevo.'))
          return
        }
        reject(new Error(err.message || 'No se pudo abrir el inicio de sesión de Google Drive.'))
      },
    })

    tokenClient.requestAccessToken({ prompt: '' })
  })
}

function openPickerModal(
  accessToken: string,
  config: { appId: string; apiKey: string },
): Promise<GooglePickerDocument[]> {
  const w = window as GoogleWindow
  const pickerApi = w.google?.picker
  if (!pickerApi) {
    return Promise.reject(new Error('El selector de Google Drive no está disponible en este momento.'))
  }

  return new Promise<GooglePickerDocument[]>((resolve) => {
    const docsView = new pickerApi.DocsView(pickerApi.ViewId.DOCS)
      .setIncludeFolders(true)
      .setMimeTypes(GOOGLE_PICKER_MIME_TYPES.join(','))

    const picker = new pickerApi.PickerBuilder()
      .addView(docsView)
      .enableFeature(pickerApi.Feature.MULTISELECT_ENABLED)
      .setLocale('es')
      .setTitle('Selecciona documentos para EvaluEdu')
      .setOAuthToken(accessToken)
      .setDeveloperKey(config.apiKey)
      .setAppId(config.appId)
      .setOrigin(window.location.origin)
      .setCallback((data) => {
        if (data.action === pickerApi.Action.PICKED) {
          resolve(data.docs ?? [])
        } else if (data.action === pickerApi.Action.CANCEL) {
          resolve([])
        }
      })
      .build()

    picker.setVisible(true)
  })
}

async function downloadDriveDocsAsFiles(
  docs: GooglePickerDocument[],
  accessToken: string,
  onStatus?: (message: string) => void,
): Promise<File[]> {
  const downloaded: File[] = []

  for (let i = 0; i < docs.length; i += 1) {
    const doc = docs[i]
    onStatus?.(`Descargando de Drive (${i + 1}/${docs.length}): ${doc.name}...`)
    const spec = resolveDriveDownloadSpec(doc.id, doc.name, doc.mimeType)
    const response = await fetch(spec.url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })

    if (!response.ok) {
      if (response.status === 401) {
        cachedAccessToken = ''
        cachedTokenExpiresAt = 0
      }
      throw new Error(`No se pudo descargar "${doc.name}" desde Google Drive (HTTP ${response.status}).`)
    }

    const blob = await response.blob()
    const file = new File([blob], spec.filename, {
      type: spec.mimeType,
      lastModified: Date.now(),
    })
    downloaded.push(file)
  }

  return downloaded
}

/**
 * Abre la ventana oficial de Google Drive, permite seleccionar uno o varios documentos
 * (PDF, PPTX, DOCX, XLSX, TXT, Google Docs, Google Slides, Google Sheets) y los devuelve
 * como objetos `File` listos para la bandeja de importación de EvaluEdu.
 */
export async function pickFilesFromGoogleDrive(onStatus?: (message: string) => void): Promise<File[]> {
  const config = getGoogleConfig()
  if (!config.clientId || !config.apiKey) {
    throw new Error('La integración de Google Drive no está configurada.')
  }

  onStatus?.('Conectando con Google Drive...')
  await ensureGooglePickerLoaded()

  let accessToken: string
  try {
    accessToken = await getGoogleAccessToken(config.clientId)
  } catch (err) {
    if (err instanceof Error && err.message === 'CANCELLED') {
      return []
    }
    throw err
  }

  onStatus?.('Esperando tu selección en Google Drive...')
  const selectedDocs = await openPickerModal(accessToken, config)
  if (!selectedDocs.length) {
    return []
  }

  return downloadDriveDocsAsFiles(selectedDocs, accessToken, onStatus)
}
