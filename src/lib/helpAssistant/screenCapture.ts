/**
 * Captura automática del área visible de EvaluEdu en el navegador (PC y celular).
 * - Carga `html-to-image` bajo demanda (lazy import) para mantener liviano el arranque.
 * - Excluye cualquier elemento marcado con `data-assistant-ignore="true"`.
 * - Recorta al viewport visible actual y comprime en `<canvas>` a JPEG (~120-220 KB)
 *   para enviarlo con rapidez hacia NVIDIA NIM Vision / Gemini Vision en Fase 2.
 */

export interface CapturedScreenshot {
  dataUrl: string
  width: number
  height: number
  approxKb: number
  capturedAt: string
}

const MAX_CAPTURE_WIDTH = 1024
const JPEG_QUALITY = 0.76

function nextAnimationFrame(): Promise<void> {
  return new Promise((resolve) => {
    window.requestAnimationFrame(() => resolve())
  })
}

async function compressDataUrlToCanvas(
  sourceDataUrl: string,
  maxWidth = MAX_CAPTURE_WIDTH
): Promise<CapturedScreenshot> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      const scale = img.width > maxWidth ? maxWidth / img.width : 1
      const targetW = Math.max(1, Math.round(img.width * scale))
      const targetH = Math.max(1, Math.round(img.height * scale))
      const canvas = document.createElement('canvas')
      canvas.width = targetW
      canvas.height = targetH
      const ctx = canvas.getContext('2d')
      if (!ctx) {
        reject(new Error('No se pudo inicializar el lienzo de compresión.'))
        return
      }
      ctx.drawImage(img, 0, 0, targetW, targetH)
      const compressed = canvas.toDataURL('image/jpeg', JPEG_QUALITY)
      const approxKb = Math.max(1, Math.round((compressed.length * 3) / 4 / 1024))
      resolve({
        dataUrl: compressed,
        width: targetW,
        height: targetH,
        approxKb,
        capturedAt: new Date().toISOString(),
      })
    }
    img.onerror = () => reject(new Error('No se pudo procesar la captura de pantalla.'))
    img.src = sourceDataUrl
  })
}

export async function captureAppViewportScreenshot(): Promise<CapturedScreenshot> {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    throw new Error('La captura de pantalla solo está disponible en el navegador.')
  }

  // Esperar dos frames para garantizar que el chat oculto ya desapareció del repintado
  await nextAnimationFrame()
  await nextAnimationFrame()

  const targetNode = (document.getElementById('root') ?? document.body) as HTMLElement
  const { toCanvas } = await import('html-to-image')

  const bgColor =
    window.getComputedStyle(document.body).backgroundColor ||
    (document.documentElement.getAttribute('data-theme') === 'dark' ? '#111315' : '#f3f5fa')

  const vw = Math.max(320, window.innerWidth)
  const vh = Math.max(320, window.innerHeight)

  const renderedCanvas = await toCanvas(targetNode, {
    cacheBust: false,
    backgroundColor: bgColor,
    pixelRatio: Math.min(window.devicePixelRatio || 1, 1.5),
    skipFonts: true,
    filter: (node) => {
      if (!(node instanceof HTMLElement)) return true
      if (node.dataset.assistantIgnore === 'true') return false
      return true
    },
  })

  // Recortar exactamente la porción visible del viewport actual (scrollX / scrollY)
  const ratioX = renderedCanvas.width / Math.max(1, targetNode.scrollWidth || vw)
  const ratioY = renderedCanvas.height / Math.max(1, targetNode.scrollHeight || vh)
  const sx = Math.max(0, Math.round(window.scrollX * ratioX))
  const sy = Math.max(0, Math.round(window.scrollY * ratioY))
  const sw = Math.min(renderedCanvas.width - sx, Math.round(vw * ratioX))
  const sh = Math.min(renderedCanvas.height - sy, Math.round(vh * ratioY))

  const outScale = sw > MAX_CAPTURE_WIDTH ? MAX_CAPTURE_WIDTH / sw : 1
  const outW = Math.max(1, Math.round(sw * outScale))
  const outH = Math.max(1, Math.round(sh * outScale))

  const cropped = document.createElement('canvas')
  cropped.width = outW
  cropped.height = outH
  const ctx = cropped.getContext('2d')
  if (!ctx) {
    throw new Error('No se pudo generar la imagen de captura.')
  }

  ctx.fillStyle = bgColor
  ctx.fillRect(0, 0, outW, outH)
  ctx.drawImage(renderedCanvas, sx, sy, sw, sh, 0, 0, outW, outH)

  const dataUrl = cropped.toDataURL('image/jpeg', JPEG_QUALITY)
  const approxKb = Math.max(1, Math.round((dataUrl.length * 3) / 4 / 1024))

  return {
    dataUrl,
    width: outW,
    height: outH,
    approxKb,
    capturedAt: new Date().toISOString(),
  }
}

export async function compressUploadedImageFile(file: File): Promise<CapturedScreenshot> {
  const rawUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      if (typeof reader.result === 'string') resolve(reader.result)
      else reject(new Error('No se pudo leer la imagen seleccionada.'))
    }
    reader.onerror = () => reject(new Error('No se pudo leer la imagen seleccionada.'))
    reader.readAsDataURL(file)
  })
  return compressDataUrlToCanvas(rawUrl, MAX_CAPTURE_WIDTH)
}
