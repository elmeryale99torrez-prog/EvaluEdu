import React, { useEffect, useMemo, useRef, useState } from 'react'
import { FlameBot3D, type FlameBotMood } from './FlameBot3D'
import {
  buildGraphRagContext,
  buildPersonalizedGreeting,
  captureAppViewportScreenshot,
  compressUploadedImageFile,
  extractTeacherFirstName,
  getContextualQuickChips,
  openNoteBySlug,
  queryLocalAssistant,
  recordUnresolvedCase,
  shouldRefreshConversation,
  trimHistoryForAI,
  type AssistantRuntimeContext,
  type CapturedScreenshot,
  type HelpAssistantAIAdapter,
  type LocalAnswerResult,
  type RelatedNoteChip,
  type VaultActionTarget,
} from '../lib/helpAssistant'

interface ChatEntry {
  id: string
  sender: 'user' | 'bot'
  text: string
  queryOrigin?: string
  screenshot?: CapturedScreenshot
  answer?: LocalAnswerResult
  threeGuides?: RelatedNoteChip[]
  suggestCapture?: boolean
  feedbackState?: 'helpful' | 'unresolved'
  cloudAnswer?: string
  cloudLoading?: boolean
  isGreeting?: boolean
  isNotice?: boolean
}

interface WidgetPosition {
  x: number
  y: number
}

const POSITION_STORAGE_KEY = 'evaluedu-assistant-pos-v2'
const DRAG_THRESHOLD_PX = 7
const DOCK_SIZE = 74
const DEFAULT_PANEL_W = 400
const DEFAULT_PANEL_H = 440

export interface TeacherAssistantWidgetProps {
  context: AssistantRuntimeContext
  externalOpenSignal?: number
  externalCloseSignal?: number
  onOpenChange?: (open: boolean) => void
  onExecuteAction: (target: VaultActionTarget) => void
  aiAdapter?: HelpAssistantAIAdapter
}

function getDefaultDockPosition(): WidgetPosition {
  if (typeof window === 'undefined') return { x: 24, y: 24 }
  const margin = window.innerWidth <= 640 ? 14 : 22
  return {
    x: Math.max(margin, window.innerWidth - DOCK_SIZE - margin),
    y: Math.max(margin + 64, window.innerHeight - DOCK_SIZE - margin),
  }
}

function clampPosition(pos: WidgetPosition, width: number, height: number): WidgetPosition {
  if (typeof window === 'undefined') return pos
  const margin = 10
  const safeW = Math.min(width, Math.max(260, window.innerWidth - margin * 2))
  const safeH = Math.min(height, Math.max(220, window.innerHeight - margin * 2))
  const maxX = Math.max(margin, window.innerWidth - safeW - margin)
  const maxY = Math.max(margin, window.innerHeight - safeH - margin)
  return {
    x: Math.min(Math.max(margin, pos.x), maxX),
    y: Math.min(Math.max(margin, pos.y), maxY),
  }
}

/**
 * Calcula dónde abrir la ventana de chat en escritorio de forma natural
 * junto a la ubicación actual de la flama (en vez de clavarla siempre arriba).
 */
function computePanelPositionNearDock(dock: WidgetPosition, panelW: number, panelH: number): WidgetPosition {
  if (typeof window === 'undefined') return { x: 20, y: 20 }
  const dockCenterX = dock.x + DOCK_SIZE / 2
  const dockCenterY = dock.y + DOCK_SIZE / 2

  const preferredX =
    dockCenterX > window.innerWidth / 2
      ? dock.x + DOCK_SIZE - panelW
      : dock.x

  const preferredY =
    dockCenterY > window.innerHeight / 2
      ? dock.y + DOCK_SIZE - panelH
      : dock.y

  return clampPosition({ x: preferredX, y: preferredY }, panelW, panelH)
}

function loadSavedPosition(): WidgetPosition {
  if (typeof window === 'undefined') return { x: 24, y: 24 }
  try {
    const raw = window.localStorage.getItem(POSITION_STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<WidgetPosition>
      if (typeof parsed.x === 'number' && typeof parsed.y === 'number') {
        return clampPosition({ x: parsed.x, y: parsed.y }, DOCK_SIZE, DOCK_SIZE)
      }
    }
  } catch {
    // Usar posición inicial si no existe almacenamiento
  }
  return getDefaultDockPosition()
}

function renderInlineFormatted(text: string): React.ReactNode[] {
  const parts: React.ReactNode[] = []
  const regex = /(\*\*[^*]+\*\*|`[^`]+`|\*[^*]+\*)/g
  let lastIndex = 0
  let match: RegExpExecArray | null
  let key = 0

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index))
    }
    const token = match[0]
    if (token.startsWith('**') && token.endsWith('**')) {
      parts.push(<strong key={`b-${key++}`}>{token.slice(2, -2)}</strong>)
    } else if (token.startsWith('`') && token.endsWith('`')) {
      parts.push(<code key={`c-${key++}`} className="ta-inline-code">{token.slice(1, -1)}</code>)
    } else if (token.startsWith('*') && token.endsWith('*')) {
      parts.push(<em key={`i-${key++}`}>{token.slice(1, -1)}</em>)
    } else {
      parts.push(token)
    }
    lastIndex = regex.lastIndex
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex))
  }
  return parts
}

function MarkdownBlocks({ markdown }: { markdown: string }) {
  const lines = markdown.split(/\r?\n/)
  const nodes: React.ReactNode[] = []
  let listItems: Array<{ ordered: boolean; text: string }> = []
  let tableRows: string[][] = []
  let key = 0

  const flushList = () => {
    if (!listItems.length) return
    const isOrdered = listItems[0].ordered
    const Tag = isOrdered ? 'ol' : 'ul'
    nodes.push(
      <Tag key={`list-${key++}`} className="ta-md-list">
        {listItems.map((item, idx) => (
          <li key={idx}>{renderInlineFormatted(item.text)}</li>
        ))}
      </Tag>
    )
    listItems = []
  }

  const flushTable = () => {
    if (!tableRows.length) return
    const [head, ...body] = tableRows
    nodes.push(
      <div key={`tbl-${key++}`} className="ta-md-table-wrap">
        <table className="ta-md-table">
          <thead>
            <tr>
              {head.map((cell, idx) => (
                <th key={idx}>{renderInlineFormatted(cell)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {body.map((row, rIdx) => (
              <tr key={rIdx}>
                {row.map((cell, cIdx) => (
                  <td key={cIdx}>{renderInlineFormatted(cell)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
    tableRows = []
  }

  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (!line) {
      flushList()
      flushTable()
      continue
    }

    if (line.startsWith('|') && line.endsWith('|')) {
      flushList()
      const cells = line
        .slice(1, -1)
        .split('|')
        .map((c) => c.trim())
      const isSeparator = cells.every((c) => /^:?-{2,}:?$/.test(c))
      if (!isSeparator) tableRows.push(cells)
      continue
    }
    flushTable()

    const headingMatch = line.match(/^#{2,3}\s+(.+)$/)
    if (headingMatch) {
      flushList()
      nodes.push(
        <h4 key={`h-${key++}`} className="ta-md-heading">
          {renderInlineFormatted(headingMatch[1])}
        </h4>
      )
      continue
    }

    const orderedMatch = line.match(/^\d+\.\s+(.+)$/)
    if (orderedMatch) {
      if (listItems.length && !listItems[0].ordered) flushList()
      listItems.push({ ordered: true, text: orderedMatch[1] })
      continue
    }

    const bulletMatch = line.match(/^[-*•]\s+(.+)$/)
    if (bulletMatch) {
      if (listItems.length && listItems[0].ordered) flushList()
      listItems.push({ ordered: false, text: bulletMatch[1] })
      continue
    }

    flushList()
    nodes.push(
      <p key={`p-${key++}`} className="ta-md-p">
        {renderInlineFormatted(line)}
      </p>
    )
  }

  flushList()
  flushTable()
  return <div className="ta-md-body">{nodes}</div>
}

function buildThreeRelatedGuides(
  answer: LocalAnswerResult | undefined,
  context: AssistantRuntimeContext
): RelatedNoteChip[] {
  const seen = new Set<string>()
  if (answer?.note?.slug) seen.add(answer.note.slug)
  const result: RelatedNoteChip[] = []

  const addCandidate = (chip: RelatedNoteChip) => {
    if (seen.has(chip.slug) || result.length >= 3) return
    seen.add(chip.slug)
    result.push(chip)
  }

  if (answer) {
    for (const rel of answer.relatedNotes) addCandidate(rel)
    for (const alt of answer.alternatives) addCandidate(alt)
  }

  for (const quick of getContextualQuickChips(context)) {
    if (!quick.noteSlug) continue
    addCandidate({ slug: quick.noteSlug, titulo: quick.label, tipo: 'guia' })
  }

  return result.slice(0, 3)
}

export function TeacherAssistantWidget({
  context,
  externalOpenSignal = 0,
  externalCloseSignal = 0,
  onOpenChange,
  onExecuteAction,
  aiAdapter,
}: TeacherAssistantWidgetProps) {
  const teacherFirstName = useMemo(
    () => extractTeacherFirstName(context.firstName),
    [context.firstName]
  )

  const makeInitialGreetingEntry = (noticeText?: string): ChatEntry[] => {
    const now = Date.now()
    const list: ChatEntry[] = []
    if (noticeText) {
      list.push({
        id: `notice-${now}`,
        sender: 'bot',
        text: noticeText,
        isNotice: true,
      })
    }
    list.push({
      id: `greet-${now + 1}`,
      sender: 'bot',
      text: buildPersonalizedGreeting(teacherFirstName, context),
      isGreeting: true,
    })
    return list
  }

  const [isOpen, setIsOpen] = useState(false)
  const [isCapturing, setIsCapturing] = useState(false)
  const [captureNotice, setCaptureNotice] = useState('')
  const [pendingScreenshot, setPendingScreenshot] = useState<CapturedScreenshot | null>(null)
  const [inputValue, setInputValue] = useState('')
  const [messages, setMessages] = useState<ChatEntry[]>(() => makeInitialGreetingEntry())
  const [lastActivityAtMs, setLastActivityAtMs] = useState<number>(() => Date.now())
  const [userTurnCount, setUserTurnCount] = useState(0)
  const [dockPos, setDockPos] = useState<WidgetPosition>(loadSavedPosition)
  const [panelPos, setPanelPos] = useState<WidgetPosition | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [dragTilt, setDragTilt] = useState(0)
  const [isHovered, setIsHovered] = useState(false)
  const [lookVec, setLookVec] = useState<{ x: number; y: number }>({ x: 0, y: 0 })
  const [expandedDetailsId, setExpandedDetailsId] = useState<string | null>(null)
  const [scrollTargetBotId, setScrollTargetBotId] = useState<string | null>(null)

  const dragStateRef = useRef<{
    active: boolean
    target: 'dock' | 'panel'
    pointerId: number
    startX: number
    startY: number
    lastX: number
    originX: number
    originY: number
    elW: number
    elH: number
    moved: boolean
    captureEl: HTMLElement | null
  } | null>(null)

  const suppressClickRef = useRef(false)
  const dockRef = useRef<HTMLDivElement | null>(null)
  const panelRef = useRef<HTMLElement | null>(null)
  const panelBodyRef = useRef<HTMLDivElement | null>(null)
  const botMsgRefs = useRef<Map<string, HTMLElement>>(new Map())
  const inputRef = useRef<HTMLInputElement | null>(null)
  const fileFallbackRef = useRef<HTMLInputElement | null>(null)
  const lastOpenSignalRef = useRef(externalOpenSignal)
  const lastCloseSignalRef = useRef(externalCloseSignal)

  const getCurrentPanelMetrics = (): { w: number; h: number } => {
    const el = panelRef.current
    if (el) {
      const rect = el.getBoundingClientRect()
      if (rect.width > 0 && rect.height > 0) {
        return { w: rect.width, h: rect.height }
      }
    }
    const maxW = typeof window !== 'undefined' ? Math.min(DEFAULT_PANEL_W, window.innerWidth - 24) : DEFAULT_PANEL_W
    const maxH = typeof window !== 'undefined' ? Math.min(DEFAULT_PANEL_H, window.innerHeight - 36) : DEFAULT_PANEL_H
    return { w: maxW, h: maxH }
  }

  const setOpenState = (nextOpen: boolean) => {
    if (nextOpen && typeof window !== 'undefined' && window.innerWidth > 640) {
      const w = Math.min(DEFAULT_PANEL_W, window.innerWidth - 24)
      const h = Math.min(DEFAULT_PANEL_H, window.innerHeight - 36)
      setPanelPos(computePanelPositionNearDock(dockPos, w, h))
    }
    setIsOpen(nextOpen)
    onOpenChange?.(nextOpen)
  }

  const maybeRefreshContext = (notify = true): boolean => {
    const check = shouldRefreshConversation({ userTurnCount, lastActivityAtMs })
    if (!check.shouldRefresh) return false
    const notice =
      check.reason === 'idle_timeout'
        ? 'Conversación renovada tras inactividad para mantener respuestas precisas.'
        : 'Conversación renovada para mantener el enfoque claro.'
    setMessages(makeInitialGreetingEntry(notify ? notice : undefined))
    setUserTurnCount(0)
    setLastActivityAtMs(Date.now())
    setExpandedDetailsId(null)
    setPendingScreenshot(null)
    setCaptureNotice('')
    return true
  }

  useEffect(() => {
    if (externalOpenSignal > lastOpenSignalRef.current) {
      lastOpenSignalRef.current = externalOpenSignal
      maybeRefreshContext(true)
      setOpenState(true)
      window.setTimeout(() => inputRef.current?.focus(), 80)
    }
  }, [externalOpenSignal])

  useEffect(() => {
    if (externalCloseSignal > lastCloseSignalRef.current) {
      lastCloseSignalRef.current = externalCloseSignal
      if (isOpen) {
        setOpenState(false)
      }
    }
  }, [externalCloseSignal, isOpen])

  useEffect(() => {
    if (userTurnCount === 0) {
      setMessages(makeInitialGreetingEntry())
    }
  }, [teacherFirstName])

  // Si el navegador pasa a sin conexión, limpiar cualquier captura pendiente
  useEffect(() => {
    if (!context.isOnline && pendingScreenshot) {
      setPendingScreenshot(null)
      setCaptureNotice('Sin conexión: el análisis de capturas se activará cuando vuelva internet.')
    }
  }, [context.isOnline, pendingScreenshot])

  // Seguimiento sutil de mirada hacia el cursor cuando está minimizado
  useEffect(() => {
    if (isOpen) return
    const handlePointerMove = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse' || !dockRef.current) return
      const rect = dockRef.current.getBoundingClientRect()
      const cx = rect.left + rect.width / 2
      const cy = rect.top + rect.height / 2
      setLookVec({
        x: Math.max(-1, Math.min(1, (e.clientX - cx) / 260)),
        y: Math.max(-1, Math.min(1, (e.clientY - cy) / 260)),
      })
    }
    window.addEventListener('pointermove', handlePointerMove, { passive: true })
    return () => window.removeEventListener('pointermove', handlePointerMove)
  }, [isOpen])

  // Ajustar dentro del viewport si cambia el tamaño de ventana o al crecer el contenido del panel
  useEffect(() => {
    const handleResize = () => {
      setDockPos((prev) => clampPosition(prev, DOCK_SIZE, DOCK_SIZE))
      setPanelPos((prev) => {
        if (!prev) return null
        const { w, h } = getCurrentPanelMetrics()
        return clampPosition(prev, w, h)
      })
    }
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  // Si al crecer el panel se saldría por abajo, reajustar suavemente su posición Y real
  useEffect(() => {
    if (!isOpen || !panelPos || typeof window === 'undefined' || window.innerWidth <= 640) return
    const frame = window.requestAnimationFrame(() => {
      const { w, h } = getCurrentPanelMetrics()
      const clamped = clampPosition(panelPos, w, h)
      if (clamped.x !== panelPos.x || clamped.y !== panelPos.y) {
        setPanelPos(clamped)
      }
    })
    return () => window.cancelAnimationFrame(frame)
  }, [messages.length, pendingScreenshot, isOpen])

  // Auto-scroll al INICIO de la última respuesta del bot (nunca al fondo)
  useEffect(() => {
    if (!isOpen || !scrollTargetBotId) return
    const targetEl = botMsgRefs.current.get(scrollTargetBotId)
    if (targetEl) {
      window.requestAnimationFrame(() => {
        targetEl.scrollIntoView({ behavior: 'smooth', block: 'start' })
      })
    }
  }, [scrollTargetBotId, isOpen])

  const persistDockPos = (next: WidgetPosition) => {
    try {
      window.localStorage.setItem(POSITION_STORAGE_KEY, JSON.stringify(next))
    } catch {
      // Ignorar
    }
  }

  const startDrag = (
    event: React.PointerEvent<HTMLElement>,
    target: 'dock' | 'panel'
  ) => {
    if (event.button !== 0 && event.pointerType === 'mouse') return

    let origin: WidgetPosition
    let elW = DOCK_SIZE
    let elH = DOCK_SIZE

    if (target === 'dock') {
      origin = dockPos
    } else {
      const rect = panelRef.current?.getBoundingClientRect()
      elW = rect?.width && rect.width > 0 ? rect.width : DEFAULT_PANEL_W
      elH = rect?.height && rect.height > 0 ? rect.height : DEFAULT_PANEL_H
      origin = panelPos ?? (rect ? { x: rect.left, y: rect.top } : computePanelPositionNearDock(dockPos, elW, elH))
    }

    dragStateRef.current = {
      active: true,
      target,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      lastX: event.clientX,
      originX: origin.x,
      originY: origin.y,
      elW,
      elH,
      moved: false,
      captureEl: event.currentTarget,
    }
  }

  useEffect(() => {
    const onWinPointerMove = (event: PointerEvent) => {
      const state = dragStateRef.current
      if (!state || !state.active || state.pointerId !== event.pointerId) return
      const dx = event.clientX - state.startX
      const dy = event.clientY - state.startY

      if (!state.moved && Math.hypot(dx, dy) >= DRAG_THRESHOLD_PX) {
        state.moved = true
        setIsDragging(true)
        try {
          state.captureEl?.setPointerCapture(event.pointerId)
        } catch {
          // Ignorar
        }
      }
      if (!state.moved) return

      const vx = event.clientX - state.lastX
      state.lastX = event.clientX
      setDragTilt(Math.max(-18, Math.min(18, vx * 1.25)))

      const nextPos = clampPosition(
        { x: state.originX + dx, y: state.originY + dy },
        state.elW,
        state.elH
      )
      if (state.target === 'dock') {
        setDockPos(nextPos)
      } else {
        setPanelPos(nextPos)
      }
    }

    const onWinPointerEnd = (event: PointerEvent) => {
      const state = dragStateRef.current
      if (!state || !state.active || state.pointerId !== event.pointerId) return
      const moved = state.moved
      const target = state.target
      dragStateRef.current = null
      setIsDragging(false)
      setDragTilt(0)

      try {
        if (moved) state.captureEl?.releasePointerCapture(event.pointerId)
      } catch {
        // Ignorar
      }

      if (moved) {
        suppressClickRef.current = true
        window.setTimeout(() => {
          suppressClickRef.current = false
        }, 120)
        if (target === 'dock') {
          const dx = event.clientX - state.startX
          const dy = event.clientY - state.startY
          persistDockPos(clampPosition({ x: state.originX + dx, y: state.originY + dy }, DOCK_SIZE, DOCK_SIZE))
        }
      }
    }

    window.addEventListener('pointermove', onWinPointerMove)
    window.addEventListener('pointerup', onWinPointerEnd)
    window.addEventListener('pointercancel', onWinPointerEnd)
    return () => {
      window.removeEventListener('pointermove', onWinPointerMove)
      window.removeEventListener('pointerup', onWinPointerEnd)
      window.removeEventListener('pointercancel', onWinPointerEnd)
    }
  }, [])

  const openWidget = () => {
    if (suppressClickRef.current) return
    maybeRefreshContext(true)
    setOpenState(true)
    window.setTimeout(() => inputRef.current?.focus(), 80)
  }

  const resetChat = () => {
    setMessages(makeInitialGreetingEntry())
    setUserTurnCount(0)
    setLastActivityAtMs(Date.now())
    setInputValue('')
    setPendingScreenshot(null)
    setCaptureNotice('')
    setExpandedDetailsId(null)
    setScrollTargetBotId(null)
    window.setTimeout(() => inputRef.current?.focus(), 40)
  }

  const handlePanelWheel = (event: React.WheelEvent<HTMLElement>) => {
    const body = panelBodyRef.current
    const target = event.target as HTMLElement | null
    if (!body || !target || !body.contains(target)) {
      event.preventDefault()
      event.stopPropagation()
      return
    }
    const atTop = body.scrollTop <= 0 && event.deltaY < 0
    const atBottom =
      body.scrollTop + body.clientHeight >= body.scrollHeight - 1 && event.deltaY > 0
    if (atTop || atBottom) {
      event.preventDefault()
    }
    event.stopPropagation()
  }

  const handlePanelTouchMove = (event: React.TouchEvent<HTMLElement>) => {
    event.stopPropagation()
  }

  const handleTriggerScreenCapture = async () => {
    if (isCapturing) return
    if (!context.isOnline) {
      setCaptureNotice(
        'Para analizar capturas de pantalla necesitas conexión a internet. Sin conexión puedes escribirme tu duda y te ayudo al instante.'
      )
      return
    }

    setCaptureNotice('')
    setIsCapturing(true)

    try {
      const captured = await captureAppViewportScreenshot()
      setPendingScreenshot(captured)
      setIsCapturing(false)
      setOpenState(true)
      window.setTimeout(() => inputRef.current?.focus(), 90)
    } catch {
      setIsCapturing(false)
      setOpenState(true)
      setCaptureNotice('No se pudo capturar automáticamente. Puedes seleccionar una imagen de tu dispositivo.')
      fileFallbackRef.current?.click()
    }
  }

  const handleFallbackFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    try {
      const compressed = await compressUploadedImageFile(file)
      setPendingScreenshot(compressed)
      setCaptureNotice('')
      window.setTimeout(() => inputRef.current?.focus(), 60)
    } catch {
      setCaptureNotice('No se pudo leer la imagen seleccionada.')
    }
  }

  const fetchCloudResponseForEntry = async (params: {
    botId: string
    query: string
    screenshot?: CapturedScreenshot
    primarySlug?: string
    currentMessages: ChatEntry[]
  }) => {
    if (!aiAdapter || !context.isOnline) return
    const graphRagContext = buildGraphRagContext(params.primarySlug, 3)
    const history = trimHistoryForAI(
      params.currentMessages
        .filter((m) => !m.isNotice && !m.isGreeting)
        .map((m) => ({ role: m.sender === 'user' ? 'user' : 'assistant', text: m.text }))
    )

    try {
      const response = await aiAdapter({
        query: params.query,
        context,
        graphRagContext,
        history,
        screenshotBase64: params.screenshot?.dataUrl,
      })

      setMessages((prev) =>
        prev.map((item) => {
          if (item.id !== params.botId) return item
          if (response.ok && response.answer) {
            return {
              ...item,
              cloudLoading: false,
              cloudAnswer: response.answer,
              text: response.answer,
            }
          }
          return {
            ...item,
            cloudLoading: false,
            cloudAnswer: response.error ?? undefined,
          }
        })
      )
    } catch {
      setMessages((prev) =>
        prev.map((item) =>
          item.id === params.botId ? { ...item, cloudLoading: false } : item
        )
      )
    }
  }

  const pushConversationTurn = (
    userLabel: string,
    answer: LocalAnswerResult,
    options?: { originQuery?: string; screenshot?: CapturedScreenshot; autoCloud?: boolean }
  ) => {
    const refreshed = maybeRefreshContext(false)
    const now = Date.now()
    const userMsg: ChatEntry = {
      id: `u-${now}`,
      sender: 'user',
      text: userLabel,
      screenshot: options?.screenshot,
    }
    const botId = `b-${now + 1}`
    const threeGuides = buildThreeRelatedGuides(answer, context)
    const willCallCloud = Boolean(options?.autoCloud && aiAdapter && context.isOnline)

    const botMsg: ChatEntry = {
      id: botId,
      sender: 'bot',
      text: answer.summary,
      queryOrigin: options?.originQuery ?? userLabel,
      screenshot: options?.screenshot,
      answer,
      threeGuides,
      suggestCapture:
        context.isOnline &&
        !options?.screenshot &&
        !willCallCloud &&
        (answer.kind === 'fallback' || answer.confidence === 'low'),
      cloudLoading: willCallCloud,
    }

    const baseMessages = refreshed
      ? makeInitialGreetingEntry('Conversación renovada para mantener respuestas precisas.')
      : messages

    const nextMessages = [...baseMessages, userMsg, botMsg]
    setMessages(nextMessages)
    setUserTurnCount((count) => (refreshed ? 1 : count + 1))
    setLastActivityAtMs(now)
    setExpandedDetailsId(botId)
    setScrollTargetBotId(botId)

    if (answer.kind === 'fallback' && options?.originQuery && !willCallCloud) {
      recordUnresolvedCase({
        query: options.originQuery,
        context,
        reason: 'low_confidence',
        suggestedNoteSlug: answer.alternatives[0]?.slug,
      })
    }

    if (willCallCloud) {
      const contextualSlug =
        answer.note?.slug ??
        answer.alternatives[0]?.slug ??
        getContextualQuickChips(context)[0]?.noteSlug
      void fetchCloudResponseForEntry({
        botId,
        query: options?.originQuery ?? userLabel,
        screenshot: options?.screenshot,
        primarySlug: contextualSlug,
        currentMessages: baseMessages,
      })
    }
  }

  const handleOpenNote = (slug: string, customLabel?: string) => {
    const result = openNoteBySlug(slug)
    if (!result) return
    pushConversationTurn(customLabel ?? result.title, result)
  }

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault()
    const clean = inputValue.trim()
    const attached = pendingScreenshot
    if (!clean && !attached) return

    setInputValue('')
    setPendingScreenshot(null)
    setCaptureNotice('')

    // Si hay captura adjunta: requiere internet para analizarla
    if (attached) {
      if (!context.isOnline) {
        setCaptureNotice(
          'Para analizar capturas de pantalla necesitas conexión a internet. Sin conexión puedes escribirme tu duda y te ayudo al instante.'
        )
        return
      }

      const contextualGuides = getContextualQuickChips(context)
      const fallbackNote = contextualGuides[0]?.noteSlug
        ? openNoteBySlug(contextualGuides[0].noteSlug)
        : null

      const captureFallback: LocalAnswerResult = {
        kind: 'note',
        confidence: 'medium',
        score: 0.6,
        title: 'Revisión de pantalla',
        summary: fallbackNote
          ? `Mientras tanto, aquí tienes la guía principal de esta sección: ${fallbackNote.summary}`
          : 'Descríbeme brevemente qué mensaje o botón aparece en tu pantalla para darte los pasos exactos.',
        bodyMarkdown: fallbackNote
          ? fallbackNote.bodyMarkdown
          : 'Descríbeme brevemente qué mensaje o botón aparece en tu pantalla para ayudarte paso a paso.',
        note: fallbackNote?.note,
        actions: fallbackNote?.actions ?? [],
        diagnosticButtons: [],
        relatedNotes: fallbackNote?.relatedNotes ?? [],
        alternatives: [],
        shouldOfferAiFallback: true,
      }

      pushConversationTurn(clean || 'Captura de pantalla', captureFallback, {
        originQuery: clean || 'Analiza esta captura de pantalla de EvaluEdu y explícame qué ocurre y cómo resolverlo.',
        screenshot: attached,
        autoCloud: Boolean(aiAdapter),
      })
      return
    }

    const result = queryLocalAssistant(clean, context)
    const shouldEscalateAutomatically =
      result.kind === 'fallback' && Boolean(aiAdapter) && context.isOnline

    pushConversationTurn(clean, result, {
      originQuery: clean,
      autoCloud: shouldEscalateAutomatically,
    })
  }

  const handleFeedback = (entryId: string, state: 'helpful' | 'unresolved') => {
    setMessages((prev) =>
      prev.map((item) => {
        if (item.id !== entryId) return item
        if (state === 'unresolved' && item.feedbackState !== 'unresolved') {
          recordUnresolvedCase({
            query: item.queryOrigin ?? item.text,
            context,
            reason: 'user_marked_unresolved',
            suggestedNoteSlug: item.answer?.note?.slug,
          })
        }
        return {
          ...item,
          feedbackState: state,
          suggestCapture: state === 'unresolved' && context.isOnline ? true : item.suggestCapture,
        }
      })
    )
  }

  const handleRequestExpandedHelp = (entry: ChatEntry) => {
    if (!aiAdapter || !context.isOnline || entry.cloudLoading) return
    setMessages((prev) =>
      prev.map((item) => (item.id === entry.id ? { ...item, cloudLoading: true } : item))
    )
    void fetchCloudResponseForEntry({
      botId: entry.id,
      query: entry.queryOrigin ?? entry.text,
      screenshot: entry.screenshot,
      primarySlug: entry.answer?.note?.slug ?? entry.answer?.alternatives[0]?.slug,
      currentMessages: messages,
    })
  }

  if (isCapturing) {
    return null
  }

  const isMobileViewport = typeof window !== 'undefined' && window.innerWidth <= 640
  const dockMood: FlameBotMood = isDragging ? 'dragging' : isHovered ? 'hover' : 'idle'
  const isAnyCloudLoading = messages.some((m) => m.cloudLoading)

  const contextLabel =
    context.role === 'student'
      ? 'Vista estudiante'
      : context.view === 'content'
        ? 'Contenido'
        : context.view === 'proposals'
          ? 'Propuestas'
          : context.view === 'rooms'
            ? 'Salas'
            : context.view === 'results'
              ? 'Resultados'
              : 'Inicio'

  if (!isOpen) {
    return (
      <div
        ref={dockRef}
        data-assistant-ignore="true"
        className={`ta-dock-wrap${isDragging ? ' dragging' : ''}`}
        style={{ left: `${dockPos.x}px`, top: `${dockPos.y}px` }}
        onPointerDown={(e) => startDrag(e, 'dock')}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        role="region"
        aria-label="Asistente docente flotante de EvaluEdu"
      >
        <button
          type="button"
          className="ta-dock-mascot"
          onClick={openWidget}
          title="Abrir asistente de EvaluEdu (arrastra para mover)"
          aria-label="Abrir asistente de EvaluEdu"
        >
          <FlameBot3D
            size={68}
            mood={dockMood}
            lookX={lookVec.x}
            lookY={lookVec.y}
            tiltDeg={dragTilt}
            showFloorShadow
          />
        </button>
      </div>
    )
  }

  const panelStyle: React.CSSProperties | undefined =
    !isMobileViewport && panelPos
      ? { left: `${panelPos.x}px`, top: `${panelPos.y}px`, right: 'auto', bottom: 'auto' }
      : undefined

  return (
    <section
      ref={panelRef}
      data-assistant-ignore="true"
      className={`ta-panel-shell${isDragging ? ' dragging' : ''}`}
      style={panelStyle}
      onWheel={handlePanelWheel}
      onTouchMove={handlePanelTouchMove}
      role="dialog"
      aria-modal="false"
      aria-label="Asistente docente EvaluEdu"
    >
      {/* Cabecera arrastrable libremente en X e Y en escritorio */}
      <header
        className="ta-panel-head"
        onPointerDown={(e) => {
          if (!isMobileViewport && !(e.target as HTMLElement).closest('button')) {
            startDrag(e, 'panel')
          }
        }}
      >
        <div className="ta-head-identity">
          <span className="ta-head-mascot" aria-hidden="true">
            <FlameBot3D
              size={34}
              mood={isAnyCloudLoading ? 'thinking' : 'happy'}
              showFloorShadow={false}
            />
          </span>
          <div>
            <strong>Asistente EvaluEdu</strong>
            <small>
              {contextLabel} · {context.isOnline ? 'En línea' : 'Sin conexión'}
            </small>
          </div>
        </div>
        <div className="ta-head-actions">
          <button
            type="button"
            className="ta-icon-btn"
            onClick={resetChat}
            title="Nueva conversación"
            aria-label="Nueva conversación"
          >
            ↺
          </button>
          <button
            type="button"
            className="ta-icon-btn"
            onClick={() => setOpenState(false)}
            title="Minimizar asistente"
            aria-label="Minimizar asistente"
          >
            —
          </button>
        </div>
      </header>

      {/* Aviso breve solo cuando realmente aporta al docente */}
      {(!context.isOnline || context.pendingSyncCount > 0 || context.role === 'student') && (
        <div className="ta-status-strip">
          {!context.isOnline && (
            <span className="ta-status-pill warn">Sin conexión · Respondo dudas por texto</span>
          )}
          {context.pendingSyncCount > 0 && (
            <span className="ta-status-pill info">
              {context.pendingSyncCount} cambio{context.pendingSyncCount === 1 ? '' : 's'} por sincronizar
            </span>
          )}
          {context.role === 'student' && (
            <span className="ta-status-pill safe">Modo prueba · Solo visible para ti</span>
          )}
        </div>
      )}

      {/* Cuerpo de conversación */}
      <div ref={panelBodyRef} className="ta-panel-body">
        <div className="ta-messages">
          {messages.map((entry) => {
            if (entry.isNotice) {
              return (
                <div key={entry.id} className="ta-context-notice">
                  <span>{entry.text}</span>
                </div>
              )
            }

            if (entry.sender === 'user') {
              return (
                <div key={entry.id} className="ta-msg ta-msg-user">
                  <div className="ta-user-bubble">
                    {entry.screenshot && (
                      <img
                        src={entry.screenshot.dataUrl}
                        alt="Captura de pantalla adjunta"
                        className="ta-msg-screenshot"
                      />
                    )}
                    <span>{entry.text}</span>
                  </div>
                </div>
              )
            }

            if (entry.isGreeting) {
              return (
                <article
                  key={entry.id}
                  ref={(el) => {
                    if (el) botMsgRefs.current.set(entry.id, el)
                  }}
                  className="ta-msg ta-msg-bot"
                >
                  <div className="ta-bot-card ta-greeting-card">
                    <p className="ta-md-p">{renderInlineFormatted(entry.text)}</p>
                  </div>
                </article>
              )
            }

            const ans = entry.answer
            const showFull = expandedDetailsId === entry.id
            const threeGuides = entry.threeGuides ?? []

            return (
              <article
                key={entry.id}
                ref={(el) => {
                  if (el) botMsgRefs.current.set(entry.id, el)
                }}
                className="ta-msg ta-msg-bot"
              >
                <div className="ta-bot-card">
                  {entry.cloudLoading ? (
                    <div className="ta-thinking-row">
                      <FlameBot3D size={28} mood="thinking" showFloorShadow={false} />
                      <span>
                        {entry.screenshot
                          ? 'Revisando tu captura de pantalla…'
                          : 'Preparando una respuesta clara para ti…'}
                      </span>
                    </div>
                  ) : entry.cloudAnswer ? (
                    <MarkdownBlocks markdown={entry.cloudAnswer} />
                  ) : ans ? (
                    <>
                      <div className="ta-bot-card-head">
                        <strong>{ans.title}</strong>
                      </div>

                      {showFull ? (
                        <MarkdownBlocks markdown={ans.bodyMarkdown} />
                      ) : (
                        <p className="ta-md-p">{renderInlineFormatted(ans.summary)}</p>
                      )}

                      {ans.bodyMarkdown.length > ans.summary.length + 30 && (
                        <button
                          type="button"
                          className="ta-toggle-detail"
                          onClick={() => setExpandedDetailsId(showFull ? null : entry.id)}
                        >
                          {showFull ? 'Ver resumen breve ▲' : 'Ver paso a paso completo ▼'}
                        </button>
                      )}
                    </>
                  ) : null}

                  {!entry.cloudLoading && ans && ans.diagnosticButtons.length > 0 && (
                    <div className="ta-diag-list">
                      {ans.diagnosticButtons.map((btn) => (
                        <button
                          key={btn.targetNote}
                          type="button"
                          className="ta-diag-btn"
                          onClick={() => handleOpenNote(btn.targetNote, btn.label)}
                        >
                          {btn.label} →
                        </button>
                      ))}
                    </div>
                  )}

                  {!entry.cloudLoading && ans && ans.actions.length > 0 && (
                    <div className="ta-actions-row">
                      {ans.actions.map((act) => (
                        <button
                          key={`${act.target}-${act.label}`}
                          type="button"
                          className="ta-action-btn"
                          onClick={() => onExecuteAction(act.target)}
                        >
                          {act.label} ↗
                        </button>
                      ))}
                    </div>
                  )}

                  {/* Sugerencia proactiva de captura (solo con internet activo) */}
                  {!entry.cloudLoading && entry.suggestCapture && context.isOnline && (
                    <div className="ta-capture-suggest">
                      <p>
                        Si prefieres, toma una captura rápida de tu pantalla para que vea exactamente qué aparece y te guíe paso a paso.
                      </p>
                      <button
                        type="button"
                        className="ta-capture-suggest-btn"
                        onClick={() => void handleTriggerScreenCapture()}
                      >
                        📷 Tomar captura de pantalla
                      </button>
                    </div>
                  )}

                  {/* Opción discreta de explicación ampliada si marcó "No" y hay internet */}
                  {!entry.cloudLoading &&
                    entry.feedbackState === 'unresolved' &&
                    aiAdapter &&
                    context.isOnline &&
                    !entry.cloudAnswer && (
                      <button
                        type="button"
                        className="ta-ai-escalate-btn"
                        onClick={() => handleRequestExpandedHelp(entry)}
                      >
                        ✦ Buscar una explicación más detallada
                      </button>
                    )}

                  {/* 3 guías rápidas relacionadas */}
                  {!entry.cloudLoading && threeGuides.length > 0 && (
                    <div className="ta-related-block">
                      <small>OTRAS GUÍAS RÁPIDAS RELACIONADAS</small>
                      <div className="ta-related-chips">
                        {threeGuides.map((rel) => (
                          <button
                            key={rel.slug}
                            type="button"
                            className="ta-related-chip"
                            onClick={() => handleOpenNote(rel.slug, rel.titulo)}
                          >
                            {rel.titulo}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Cierre consistente: ¿Se resolvió tu duda? */}
                  {!entry.cloudLoading && (
                    <div className="ta-feedback-bar">
                      {entry.feedbackState === 'helpful' ? (
                        <span className="ta-fb-done">✓ ¡Me alegra haberte ayudado!</span>
                      ) : entry.feedbackState === 'unresolved' ? (
                        <span className="ta-fb-done">
                          Tomé nota para mejorar esta guía. Si es un fallo técnico, también puedes{' '}
                          <button
                            type="button"
                            className="ta-inline-link"
                            onClick={() => onExecuteAction('modal:feedback')}
                          >
                            escribir sugerencia
                          </button>
                          .
                        </span>
                      ) : (
                        <>
                          <span>¿Se resolvió tu duda?</span>
                          <button
                            type="button"
                            className="ta-fb-btn"
                            onClick={() => handleFeedback(entry.id, 'helpful')}
                          >
                            Sí
                          </button>
                          <button
                            type="button"
                            className="ta-fb-btn"
                            onClick={() => handleFeedback(entry.id, 'unresolved')}
                          >
                            No
                          </button>
                        </>
                      )}
                    </div>
                  )}
                </div>
              </article>
            )
          })}
        </div>
      </div>

      {/* Barra inferior limpia con botón de captura automática (bloqueado con aviso sin internet) */}
      <form className="ta-composer-wrap" onSubmit={handleSubmit}>
        <input
          ref={fileFallbackRef}
          type="file"
          accept="image/*"
          className="sr-only"
          onChange={(e) => void handleFallbackFileChange(e)}
        />

        {pendingScreenshot && context.isOnline && (
          <div className="ta-capture-preview">
            <img src={pendingScreenshot.dataUrl} alt="Vista previa de captura" />
            <div className="ta-capture-preview-info">
              <b>Captura lista</b>
              <small>Escribe lo que notas o envíala directamente.</small>
            </div>
            <button
              type="button"
              className="ta-capture-remove"
              onClick={() => setPendingScreenshot(null)}
              aria-label="Quitar captura"
              title="Quitar captura"
            >
              ×
            </button>
          </div>
        )}

        {captureNotice && <p className="ta-capture-notice">{captureNotice}</p>}

        <div className="ta-composer-pill">
          <button
            type="button"
            className={`ta-composer-capture${!context.isOnline ? ' offline' : ''}`}
            onClick={() => void handleTriggerScreenCapture()}
            aria-disabled={!context.isOnline}
            title={
              context.isOnline
                ? 'Tomar captura de la pantalla actual'
                : 'Requiere internet para analizar capturas'
            }
            aria-label={
              context.isOnline
                ? 'Tomar captura de pantalla'
                : 'Captura no disponible sin conexión a internet'
            }
          >
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z" />
              <circle cx="12" cy="13" r="3" />
            </svg>
          </button>
          <input
            ref={inputRef}
            type="text"
            className="ta-composer-input"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            placeholder="Iniciar conversación"
            aria-label="Iniciar conversación"
          />
          <button
            type="submit"
            className="ta-composer-send"
            disabled={!inputValue.trim() && !(pendingScreenshot && context.isOnline)}
            aria-label="Enviar consulta"
            title="Enviar"
          >
            ↑
          </button>
        </div>
      </form>
    </section>
  )
}
