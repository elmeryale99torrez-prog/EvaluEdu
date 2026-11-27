import { describe, expect, it } from 'vitest'
import type { ActivityType } from '../activityEngine'
import type { Profile } from '../auth'
import {
  ACTIVE_HISTORY_WINDOW,
  buildGraphRagContext,
  buildPersonalizedGreeting,
  canShowTeacherAssistant,
  extractTeacherFirstName,
  formatUnresolvedCasesAsMarkdown,
  getContextualQuickChips,
  invokeTeacherHelpAssistant,
  knowledgeVault,
  MAX_CONTEXT_TURNS,
  MAX_IDLE_MS,
  openNoteBySlug,
  queryLocalAssistant,
  sanitizeUnresolvedText,
  shouldRefreshConversation,
  trimHistoryForAI,
  type AssistantRuntimeContext,
} from './index'

const ALL_13_ACTIVITIES: ActivityType[] = [
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
]

function makeContext(overrides: Partial<AssistantRuntimeContext> = {}): AssistantRuntimeContext {
  return {
    role: 'teacher',
    view: 'overview',
    activeActivityType: null,
    isOnline: true,
    backendReady: true,
    pendingSyncCount: 0,
    pendingProposalsCount: 0,
    ...overrides,
  }
}

describe('Mini-Vault Obsidian (Integridad del Cerebro EvaluEdu)', () => {
  it('carga todas las notas sin enlaces [[wikilinks]] rotos ni IDs duplicados', () => {
    expect(knowledgeVault.allNotes.length).toBeGreaterThanOrEqual(55)
    expect(knowledgeVault.brokenLinks).toEqual([])

    const ids = knowledgeVault.allNotes.map((n) => n.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('no tiene nodos operativos huérfanos en el grafo', () => {
    const orphans = knowledgeVault.allNotes.filter(
      (n) =>
        !n.path.includes('/Plantillas/') &&
        n.slug !== 'Dashboard_Cerebro_EvaluEdu' &&
        n.incomingLinks.length === 0
    )
    expect(orphans.map((n) => n.slug)).toEqual([])
  })

  it('cubre las 13 actividades oficiales con su nota atómica dedicada', () => {
    for (const activityType of ALL_13_ACTIVITIES) {
      const note = knowledgeVault.notesByActivity.get(activityType)
      expect(note, `Falta nota atómica para ${activityType}`).toBeDefined()
      expect(note?.summary.length).toBeGreaterThan(20)
    }
  })

  it('carga correctamente el Diccionario_Sinonimos desde el vault', () => {
    expect(knowledgeVault.synonymGroups.length).toBeGreaterThanOrEqual(15)
  })

  it('genera contexto GraphRAG compacto con el nodo principal y sus vecinos', () => {
    const rag = buildGraphRagContext('Emergencia_Alumno_En_Pantalla_Espera', 2)
    expect(rag).toContain('Emergencia_Alumno_En_Pantalla_Espera')
    expect(rag.length).toBeGreaterThan(300)
    expect(rag.length).toBeLessThan(4000)
  })
})

describe('Regla estricta de visibilidad (canShowTeacherAssistant)', () => {
  const teacherProfile: Profile = {
    id: 't1',
    display_name: 'Profe Ana',
    role: 'teacher',
    roles: ['teacher'],
    created_at: '2026-10-20T00:00:00Z',
    updated_at: '2026-10-20T00:00:00Z',
  }

  const adminOnlyProfile: Profile = {
    id: 'a1',
    display_name: 'Director',
    role: 'admin',
    roles: ['admin'],
    created_at: '2026-10-20T00:00:00Z',
    updated_at: '2026-10-20T00:00:00Z',
  }

  const dualProfile: Profile = {
    id: 'd1',
    display_name: 'Elmer',
    role: 'admin',
    roles: ['admin', 'teacher'],
    created_at: '2026-10-20T00:00:00Z',
    updated_at: '2026-10-20T00:00:00Z',
  }

  const realSession = {
    user: { id: 't1', email: 'profe@colegio.edu', is_anonymous: false },
  } as unknown as Parameters<typeof canShowTeacherAssistant>[0]['authSession']

  const anonSession = {
    user: { id: 'anon1', email: '', is_anonymous: true },
  } as unknown as Parameters<typeof canShowTeacherAssistant>[0]['authSession']

  it('oculta el bot por completo para estudiantes reales sin sesión', () => {
    expect(
      canShowTeacherAssistant({ authSession: null, authProfile: null, role: 'student' })
    ).toBe(false)
  })

  it('oculta el bot si la sesión es anónima o sin correo', () => {
    expect(
      canShowTeacherAssistant({ authSession: anonSession, authProfile: teacherProfile, role: 'student' })
    ).toBe(false)
  })

  it('oculta el bot en el Panel Administrativo', () => {
    expect(
      canShowTeacherAssistant({ authSession: realSession, authProfile: dualProfile, role: 'admin' })
    ).toBe(false)
    expect(
      canShowTeacherAssistant({ authSession: realSession, authProfile: adminOnlyProfile, role: 'admin' })
    ).toBe(false)
  })

  it('activa el bot para docente autenticado tanto en Panel Docente como en Probar como Estudiante', () => {
    expect(
      canShowTeacherAssistant({ authSession: realSession, authProfile: teacherProfile, role: 'teacher' })
    ).toBe(true)
    expect(
      canShowTeacherAssistant({ authSession: realSession, authProfile: teacherProfile, role: 'student' })
    ).toBe(true)
    expect(
      canShowTeacherAssistant({ authSession: realSession, authProfile: dualProfile, role: 'teacher' })
    ).toBe(true)
    expect(
      canShowTeacherAssistant({ authSession: realSession, authProfile: dualProfile, role: 'student' })
    ).toBe(true)
  })
})

describe('Motor Quirúrgico Capa 1 (Consultas reales de docentes 100% offline)', () => {
  const cases: Array<{ query: string; expectedSlug: string; ctx?: Partial<AssistantRuntimeContext> }> = [
    {
      query: 'Mis alumnos metieron el codigo pero quedaron en pantalla de espera',
      expectedSlug: 'Emergencia_Alumno_En_Pantalla_Espera',
      ctx: { view: 'rooms' },
    },
    {
      query: 'Al alumno le sale No encontramos ninguna sala con ese codigo',
      expectedSlug: 'Emergencia_Codigo_Invalido_O_Sala_Cerrada',
      ctx: { view: 'rooms' },
    },
    {
      query: 'Dice Ese nombre ya esta participando en la sala',
      expectedSlug: 'Emergencia_Nombre_Duplicado_O_Intento_Registrado',
    },
    {
      query: 'La sala alcanzo su capacidad maxima de estudiantes',
      expectedSlug: 'Emergencia_Sala_Capacidad_Maxima',
    },
    {
      query: 'Un alunmo cerro la pestana y se le fue el wifi en medio del examen',
      expectedSlug: 'Emergencia_Alumno_Perdio_Conexion_O_Cerro_Pestana',
    },
    {
      query: 'Que significa pending_sync o respaldo local no confirmado',
      expectedSlug: 'Emergencia_Entrega_Pendiente_O_Rechazada',
    },
    {
      query: 'El plazo para entregar esta evaluacion ha expirado completamente',
      expectedSlug: 'Emergencia_Tiempo_Agotado_Y_Gracia',
    },
    {
      query: 'En el wifi del colegio sale Demasiadas solicitudes error 429',
      expectedSlug: 'Emergencia_Token_Expirado_Y_Limite_429',
    },
    {
      query: 'Por que el estudiante no ve su nota ni la respuesta correcta',
      expectedSlug: 'Emergencia_Alumno_No_Ve_Nota_Ni_Solucion',
    },
    {
      query: 'Tu navegador bloqueo la ventana de Google Drive',
      expectedSlug: 'Emergencia_Google_Drive_O_Popup_Bloqueado',
      ctx: { view: 'content' },
    },
    {
      query: 'Por que no se activa el boton importar documento aunque subi el pdf',
      expectedSlug: 'Emergencia_Archivo_No_Admitido_O_Confirmacion_Cierre',
      ctx: { view: 'content' },
    },
    {
      query: 'Como subo un pdf o word desde Google Drive',
      expectedSlug: 'Importar_Documentos_y_Google_Drive',
      ctx: { view: 'content' },
    },
    {
      query: 'Diferencia entre guardar borrador y aceptar contenido',
      expectedSlug: 'Guardar_Borrador_vs_Aceptar_Plantilla',
      ctx: { view: 'content' },
    },
    {
      query: 'Como descargar los resultados en exel o csv',
      expectedSlug: 'Resultados_Privados_y_Exportar_CSV',
      ctx: { view: 'results' },
    },
    {
      query: 'Como imprimir el examen en blanco en pdf',
      expectedSlug: 'Examen_en_Blanco_PDF',
      ctx: { view: 'rooms' },
    },
    {
      query: 'Diferencia entre modo simulador y probar como estudiante',
      expectedSlug: 'Probar_Como_Estudiante_vs_Simulador',
    },
    {
      query: 'Como borro mi intento de prueba o limpio resultados de la sala',
      expectedSlug: 'Eliminar_Sala_Resultados_O_Intento',
      ctx: { view: 'results' },
    },
    {
      query: 'Como escribo los espacios {{1}} en completar espacios',
      expectedSlug: 'Actividad_08_Completar_Espacios',
    },
    {
      query: 'Sintaxis corchetes con asterisco en marcar palabras clave',
      expectedSlug: 'Actividad_10_Marcar_Palabras',
    },
    {
      query: 'Como se ve la matriz de doble entrada en celular',
      expectedSlug: 'Actividad_11_Matriz_Doble_Entrada',
    },
    {
      query: 'Diagrama de Venn conjunto A y conjunto B interseccion',
      expectedSlug: 'Actividad_12_Diagrama_Venn',
    },
    {
      query: 'Respuesta corta acepta sin tildes ni mayusculas',
      expectedSlug: 'Actividad_13_Respuesta_Corta',
    },
    {
      query: 'Tu sesion expiro error 401 como cambiar contrasena',
      expectedSlug: 'Sesion_Expirada_Y_Cambio_Contrasena',
    },
    {
      query: 'Como instalo la app PWA en mi celular android o iphone',
      expectedSlug: 'Instalar_PWA_Celular_Y_PC',
    },
  ]

  for (const testCase of cases) {
    it(`resuelve correctamente: "${testCase.query}"`, () => {
      const result = queryLocalAssistant(testCase.query, makeContext(testCase.ctx))
      expect(result.kind).toBe('note')
      expect(result.note?.slug).toBe(testCase.expectedSlug)
      expect(result.confidence === 'high' || result.confidence === 'medium').toBe(true)
    })
  }

  it('maneja saludos y agradecimientos localmente sin escalar a IA', () => {
    const hi = queryLocalAssistant('Hola buenas tardes', makeContext({ view: 'rooms' }))
    expect(hi.kind).toBe('greeting')
    expect(hi.shouldOfferAiFallback).toBe(false)

    const thanks = queryLocalAssistant('Muchas gracias!', makeContext())
    expect(thanks.kind).toBe('thanks')
    expect(thanks.shouldOfferAiFallback).toBe(false)
  })

  it('detecta preguntas fuera de EvaluEdu con confianza baja y marca shouldOfferAiFallback', () => {
    const offTopic = queryLocalAssistant(
      'Dame una receta tradicional de paella valenciana con mariscos',
      makeContext()
    )
    expect(offTopic.kind).toBe('fallback')
    expect(offTopic.confidence).toBe('low')
    expect(offTopic.shouldOfferAiFallback).toBe(true)
  })

  it('ofrece atajos contextuales adaptados a cada pantalla y a la actividad activa', () => {
    const studentChips = getContextualQuickChips(
      makeContext({ role: 'student', view: 'play', activeActivityType: 'vennDiagram' })
    )
    expect(studentChips[0].noteSlug).toBe('Actividad_12_Diagrama_Venn')

    const note = openNoteBySlug('MOC_Emergencias_Aula')
    expect(note?.diagnosticButtons.length).toBeGreaterThanOrEqual(4)
  })

  it('sanitiza correos y teléfonos antes de registrar incidencias para Inbox_Incidencias', () => {
    const clean = sanitizeUnresolvedText('Escríbeme a profe.juan@escuela.edu o al +591 7123-4567 porfa')
    expect(clean).not.toContain('profe.juan@escuela.edu')
    expect(clean).not.toContain('7123-4567')
    expect(clean).toContain('[correo]')
    expect(clean).toContain('[telefono]')

    const md = formatUnresolvedCasesAsMarkdown([
      {
        id: 'inc-1',
        at: '2026-11-27T10:00:00.000Z',
        view: 'rooms',
        role: 'teacher',
        activityType: null,
        isOnline: false,
        querySanitized: clean,
        reason: 'low_confidence',
      },
    ])
    expect(md).toContain('**Vista:** `rooms`')
    expect(md).toContain('Sin conexión')
  })
})

describe('Ventana de contexto y saludo personalizado', () => {
  it('extrae el primer nombre desde el perfil o desde el correo', () => {
    expect(extractTeacherFirstName('Elmer Yaletorrez')).toBe('Elmer')
    expect(extractTeacherFirstName('', 'maria.gomez@colegio.edu')).toBe('Maria')
    expect(extractTeacherFirstName('', '')).toBe('Docente')
  })

  it('construye un saludo personalizado según hora y vista actual', () => {
    const greeting = buildPersonalizedGreeting('Elmer', { role: 'teacher', view: 'rooms' }, 10)
    expect(greeting).toContain('Buenos días, Elmer')
    expect(greeting).toContain('Salas')
  })

  it('refresca automáticamente el contexto tras inactividad o al alcanzar el límite de turnos', () => {
    const baseNow = 1_700_000_000_000
    expect(
      shouldRefreshConversation({ userTurnCount: 3, lastActivityAtMs: baseNow - 60_000, nowMs: baseNow })
    ).toEqual({ shouldRefresh: false, reason: null })

    expect(
      shouldRefreshConversation({
        userTurnCount: 3,
        lastActivityAtMs: baseNow - MAX_IDLE_MS - 1000,
        nowMs: baseNow,
      })
    ).toEqual({ shouldRefresh: true, reason: 'idle_timeout' })

    expect(
      shouldRefreshConversation({
        userTurnCount: MAX_CONTEXT_TURNS,
        lastActivityAtMs: baseNow - 5_000,
        nowMs: baseNow,
      })
    ).toEqual({ shouldRefresh: true, reason: 'turn_limit' })
  })

  it('recorta el historial a la ventana activa sin acumular mensajes antiguos', () => {
    const manyTurns = Array.from({ length: 20 }, (_, i) => ({
      role: i % 2 === 0 ? ('user' as const) : ('assistant' as const),
      text: `Mensaje ${i + 1}`,
    }))
    const trimmed = trimHistoryForAI(manyTurns)
    expect(trimmed.length).toBe(ACTIVE_HISTORY_WINDOW * 2)
    expect(trimmed[0].text).toBe('Mensaje 9')
    expect(trimmed[trimmed.length - 1].text).toBe('Mensaje 20')
  })
})

describe('Capa 2 (cloudAdapter y contrato de seguridad de teacher-help-assistant)', () => {
  it('bloquea capturas sin internet con mensaje limpio para docentes (sin jerga técnica)', async () => {
    const res = await invokeTeacherHelpAssistant({
      query: 'No entiendo este error',
      context: makeContext({ isOnline: false }),
      graphRagContext: '',
      screenshotBase64: 'data:image/jpeg;base64,/9j/4AAQSkZJRg==',
    })
    expect(res.ok).toBe(false)
    expect(res.error).toContain('conexión a internet')
    expect(res.error).not.toMatch(/supabase|nvidia|gemini|api|edge|fase/i)
  })

  it('degrada limpiamente consultas de texto cuando el dispositivo está sin conexión', async () => {
    const res = await invokeTeacherHelpAssistant({
      query: 'Pregunta abierta',
      context: makeContext({ isOnline: false }),
      graphRagContext: '',
    })
    expect(res.ok).toBe(false)
    expect(res.error).toContain('Sin conexión')
    expect(res.error).not.toMatch(/supabase|nvidia|gemini|edge|fase/i)
  })

  it('cumple el contrato de seguridad, privacidad y cascada Gemini + NVIDIA en teacher-help-assistant', async () => {
    const fsModuleName = 'node:fs'
    const { readFileSync } = (await import(/* @vite-ignore */ fsModuleName)) as {
      readFileSync: (path: URL, encoding: string) => string
    }
    const source = readFileSync(
      new URL('../../../supabase/functions/teacher-help-assistant/index.ts', import.meta.url),
      'utf8'
    )

    // Validación obligatoria de JWT real no anónimo y perfil docente
    expect(source).toContain('auth.getUser')
    expect(source).toContain('is_anonymous')
    expect(source).toContain("from('profiles')")

    // Protección de privacidad y cuotas
    expect(source).toContain('sanitizePii')
    expect(source).toContain('checkTeacherQuota')
    expect(source).toContain('AbortController')

    // Cero almacenamiento de capturas ni consultas a tablas de estudiantes/resultados
    expect(source).not.toContain('.storage.')
    expect(source).not.toContain("from('room_attempts')")
    expect(source).not.toContain("from('students')")

    // Cascada multimodal configurable (Gemini texto + NVIDIA NIM visión + respaldos cruzados)
    expect(source).toContain('generativelanguage.googleapis.com')
    expect(source).toContain('integrate.api.nvidia.com/v1/chat/completions')
    expect(source).toContain('GEMINI_TEXT_MODELS')
    expect(source).toContain('NVIDIA_VISION_MODELS')
    expect(source).toContain('GEMINI_VISION_MODELS')
    expect(source).toContain('NVIDIA_TEXT_MODELS')
  })
})
