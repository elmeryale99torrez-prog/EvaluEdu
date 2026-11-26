import { describe, it, expect } from 'vitest'
import {
  activityRuntime,
  createInitialResponse,
  isResponseComplete,
  evaluateActivityResponse,
} from './activityEngine'
import type { Activity } from './activityEngine'

describe('Refinamiento de Experiencia y Consolidación de 13 Actividades (v1.3)', () => {
  it('garantiza que cada uno de los 13 tipos cuenta con su runtime, estado inicial y validación de respuesta', () => {
    const types = [
      'trueFalse',
      'singleChoice',
      'multiSelect',
      'fillBlanks',
      'spotError',
      'markWords',
      'gridCheck',
      'matching',
      'sorting',
      'ordering',
      'scenario',
      'vennDiagram',
      'shortAnswer',
    ] as const

    expect(types).toHaveLength(13)

    for (const t of types) {
      const mockActivity: Activity = {
        id: `act-${t}`,
        title: `Actividad ${t}`,
        type: t,
        topic: 'Prueba',
        difficulty: 'Intermedio',
        prompt: `Consigna para ${t}`,
        options: ['Opción 1', 'Opción 2', 'Opción 3'],
        answer: 'Opción 1',
        feedback: 'Pista orientadora formativa sin desvelar la clave.',
        status: 'published',
      }

      const runtime = activityRuntime(mockActivity)
      expect(runtime).toBeDefined()

      const initialResp = createInitialResponse(mockActivity)
      expect(initialResp.type).toBe(t)

      // Inicialmente la respuesta no debe estar completa (salvo ordenamiento que baraja pasos)
      if (t !== 'ordering') {
        expect(isResponseComplete(mockActivity, initialResp)).toBe(false)
      }
    }
  })

  it('evalúa una respuesta de multiSelect de forma robusta', () => {
    const activity: Activity = {
      id: 'ms-test',
      title: 'Selección Múltiple',
      type: 'multiSelect',
      topic: 'Ecología',
      difficulty: 'Intermedio',
      prompt: '¿Cuáles son fuentes renovables?',
      options: ['Solar', 'Eólica', 'Carbón'],
      answer: ['Solar', 'Eólica'],
      feedback: 'Recuerda qué fuentes no se agotan con su uso.',
      details: {
        multiSelect: {
          options: [
            { id: 'opt-1', label: 'Solar', correct: true },
            { id: 'opt-2', label: 'Eólica', correct: true },
            { id: 'opt-3', label: 'Carbón', correct: false },
          ],
          hint: 'Recuerda qué fuentes no se agotan con su uso.',
        },
      },
      status: 'published',
    }

    // Respuesta correcta exacta
    const goodResp = { type: 'multiSelect' as const, values: ['Solar', 'Eólica'] }
    expect(isResponseComplete(activity, goodResp)).toBe(true)
    const goodEval = evaluateActivityResponse(activity, goodResp, 10)
    expect(goodEval.correct).toBe(true)
    expect(goodEval.score).toBe(10)
    expect(goodEval.status).toBe('answered')

    // Respuesta con distractor
    const badResp = { type: 'multiSelect' as const, values: ['Solar', 'Carbón'] }
    const badEval = evaluateActivityResponse(activity, badResp, 10)
    expect(badEval.correct).toBe(false)
    expect(badEval.score).toBe(0)
  })

  it('evalúa una respuesta de fillBlanks con slots y banco cerrado', () => {
    const activity: Activity = {
      id: 'fb-test',
      title: 'Completar Espacios',
      type: 'fillBlanks',
      topic: 'Biología',
      difficulty: 'Intermedio',
      prompt: 'La {{1}} produce clorofila y la {{2}} genera ATP.',
      options: ['fotosíntesis', 'respiración', 'fermentación'],
      answer: ['fotosíntesis', 'respiración'],
      feedback: 'Revisa las funciones energéticas celulares.',
      details: {
        fillBlanks: {
          textWithBlanks: 'La {{1}} produce clorofila y la {{2}} genera ATP.',
          blanks: [
            { id: 'b1', answer: 'fotosíntesis' },
            { id: 'b2', answer: 'respiración' },
          ],
          distractors: ['fermentación'],
          hint: 'Revisa las funciones energéticas celulares.',
        },
      },
      status: 'published',
    }

    const goodResp = {
      type: 'fillBlanks' as const,
      answers: { b1: 'fotosíntesis', b2: 'respiración' },
    }
    expect(isResponseComplete(activity, goodResp)).toBe(true)
    const goodEval = evaluateActivityResponse(activity, goodResp, 10)
    expect(goodEval.correct).toBe(true)
    expect(goodEval.score).toBe(10)

    const partialResp = {
      type: 'fillBlanks' as const,
      answers: { b1: 'fotosíntesis' },
    }
    expect(isResponseComplete(activity, partialResp)).toBe(false)
  })

  it('evalúa una respuesta de spotError señalando el fragmento incorrecto', () => {
    const activity: Activity = {
      id: 'se-test',
      title: 'Detección del error',
      type: 'spotError',
      topic: 'Salud',
      difficulty: 'Intermedio',
      prompt: 'Detecta el error en el procedimiento:',
      options: ['Lavar manos', 'No desinfectar bisturí', 'Usar guantes'],
      answer: 'No desinfectar bisturí',
      feedback: 'Revisa la cadena de esterilización.',
      details: {
        spotError: {
          segments: [
            { id: 's1', text: 'Lavar manos', hasError: false },
            { id: 's2', text: 'No desinfectar bisturí', hasError: true },
            { id: 's3', text: 'Usar guantes', hasError: false },
          ],
          hint: 'Revisa la cadena de esterilización.',
        },
      },
      status: 'published',
    }

    const goodResp = { type: 'spotError' as const, value: 's2' }
    expect(isResponseComplete(activity, goodResp)).toBe(true)
    const goodEval = evaluateActivityResponse(activity, goodResp, 10)
    expect(goodEval.correct).toBe(true)
    expect(goodEval.score).toBe(10)

    const badResp = { type: 'spotError' as const, value: 's1' }
    const badEval = evaluateActivityResponse(activity, badResp, 10)
    expect(badEval.correct).toBe(false)
    expect(badEval.score).toBe(0)
  })

  it('evalúa una respuesta de markWords resaltando términos diana', () => {
    const activity: Activity = {
      id: 'mw-test',
      title: 'Marcar palabras',
      type: 'markWords',
      topic: 'Lengua',
      difficulty: 'Intermedio',
      prompt: 'Resalta los verbos en el texto:',
      options: ['corre', 'salta', 'mesa'],
      answer: ['corre', 'salta'],
      feedback: 'Identifica las palabras que expresan acciones.',
      details: {
        markWords: {
          text: 'El niño [corre*] y [salta*] cerca de la [mesa].',
          words: [
            { id: 'w1', text: 'corre', correct: true },
            { id: 'w2', text: 'salta', correct: true },
            { id: 'w3', text: 'mesa', correct: false },
          ],
          hint: 'Identifica las palabras que expresan acciones.',
        },
      },
      status: 'published',
    }

    const goodResp = { type: 'markWords' as const, values: ['corre', 'salta'] }
    expect(isResponseComplete(activity, goodResp)).toBe(true)
    const goodEval = evaluateActivityResponse(activity, goodResp, 10)
    expect(goodEval.correct).toBe(true)
    expect(goodEval.score).toBe(10)
  })

  it('evalúa una matriz de doble entrada gridCheck cruzando filas y columnas', () => {
    const activity: Activity = {
      id: 'gc-test',
      title: 'Matriz de doble entrada',
      type: 'gridCheck',
      topic: 'Biología',
      difficulty: 'Intermedio',
      prompt: 'Relaciona célula y organelo presente:',
      options: ['Vegetal', 'Animal'],
      answer: ['r1:c1', 'r1:c2', 'r2:c1'],
      feedback: 'Compara las estructuras distintivas de cada tipo celular.',
      details: {
        gridCheck: {
          rows: [
            { id: 'r1', label: 'Célula Vegetal' },
            { id: 'r2', label: 'Célula Animal' },
          ],
          columns: [
            { id: 'c1', label: 'Núcleo' },
            { id: 'c2', label: 'Cloroplasto' },
          ],
          expectedCells: ['r1:c1', 'r1:c2', 'r2:c1'],
          hint: 'Compara las estructuras distintivas de cada tipo celular.',
        },
      },
      status: 'published',
    }

    const goodResp = { type: 'gridCheck' as const, values: ['r1:c1', 'r1:c2', 'r2:c1'] }
    expect(isResponseComplete(activity, goodResp)).toBe(true)
    const goodEval = evaluateActivityResponse(activity, goodResp, 10)
    expect(goodEval.correct).toBe(true)
    expect(goodEval.score).toBe(10)

    const badResp = { type: 'gridCheck' as const, values: ['r1:c1', 'r2:c2'] }
    const badEval = evaluateActivityResponse(activity, badResp, 10)
    expect(badEval.correct).toBe(false)
  })

  it('cumple room_participants_status_check (joined, in_progress, completed, abandoned) en student-room-guest, schema_representativo.sql y edgeFunctionAdapter', async () => {
    const fsModuleName = 'node:fs'
    const { readFileSync } = (await import(/* @vite-ignore */ fsModuleName)) as {
      readFileSync: (path: URL, encoding: string) => string
    }

    const guestSource = readFileSync(
      new URL('../../supabase/functions/student-room-guest/index.ts', import.meta.url),
      'utf8'
    )
    const schemaSource = readFileSync(
      new URL('../../tests/integracion/env/schema_representativo.sql', import.meta.url),
      'utf8'
    )
    const rolloutSource = readFileSync(
      new URL('../../tests/integracion/sql/verify_rollout_and_rollback.mjs', import.meta.url),
      'utf8'
    )

    // 1. student-room-guest nunca asigna 'active' a room_participants.status; usa 'in_progress' | 'joined'
    expect(guestSource).toContain(
      "status: existingAuth.status === 'abandoned' ? (room.status === 'active' ? 'in_progress' : 'joined') : existingAuth.status"
    )
    expect(guestSource).toContain("status: room.status === 'active' ? 'in_progress' : 'joined'")
    expect(guestSource).not.toMatch(/status:\s*'active'/)
    expect(guestSource).not.toMatch(/existingAuth\.status\s*===\s*'abandoned'\s*\?\s*'active'/)

    // 2. schema_representativo.sql define DEFAULT 'joined' y CONSTRAINT room_participants_status_check
    expect(schemaSource).toMatch(/status\s+text\s+NOT\s+NULL\s+DEFAULT\s+'joined'/)
    expect(schemaSource).toMatch(
      /CONSTRAINT\s+room_participants_status_check\s+CHECK\s*\(\s*status\s+IN\s*\(\s*'joined',\s*'in_progress',\s*'completed',\s*'abandoned'\s*\)\s*\)/
    )

    // 3. verify_rollout_and_rollback.mjs usa 'in_progress' en las semillas de room_participants
    expect(rolloutSource).not.toMatch(/'hash_post_3',\s*'active'/)
    expect(rolloutSource).not.toMatch(/'hash_reapply_4',\s*'active'/)
    expect(rolloutSource).toMatch(/'hash_post_3',\s*'in_progress'/)
    expect(rolloutSource).toMatch(/'hash_reapply_4',\s*'in_progress'/)

    // 4. edgeFunctionAdapter aplica room_participants_status_check en insert y update en tiempo de ejecución
    const adapterModulePath = '../../tests/fase-c/backend/edgeFunctionAdapter'
    const {
      VALID_ROOM_PARTICIPANT_STATUSES,
      createMockDbStore,
      buildMockSupabaseClient,
    } = (await import(/* @vite-ignore */ adapterModulePath)) as {
      VALID_ROOM_PARTICIPANT_STATUSES: Set<string>
      createMockDbStore: () => { participants: Map<string, Record<string, unknown>> }
      buildMockSupabaseClient: (store: unknown) => {
        from: (table: string) => {
          insert: (data: Record<string, unknown>) => {
            select: () => { single: () => Promise<{ data: Record<string, unknown> | null; error: { code?: string; message?: string } | null }> }
          }
          update: (data: Record<string, unknown>) => {
            eq: (col: string, val: unknown) => {
              select: () => { maybeSingle: () => Promise<{ data: Record<string, unknown> | null; error: { code?: string; message?: string } | null }> }
            }
          }
        }
      }
    }

    expect(Array.from(VALID_ROOM_PARTICIPANT_STATUSES)).toEqual([
      'joined',
      'in_progress',
      'completed',
      'abandoned',
    ])

    const store = createMockDbStore()
    const client = buildMockSupabaseClient(store)

    // Default 'joined' cuando se omite status
    const defaultInsert = await client
      .from('room_participants')
      .insert({ id: 'p-default', room_id: 'r-1', display_name: 'Ana', name_normalized: 'ana' })
      .select()
      .single()
    expect(defaultInsert.error).toBeNull()
    expect(defaultInsert.data?.status).toBe('joined')

    // Rechazo de 'active' en insert (código 23514) sin mutar store.participants
    const invalidInsert = await client
      .from('room_participants')
      .insert({ id: 'p-invalid', room_id: 'r-1', display_name: 'Mal', name_normalized: 'mal', status: 'active' })
      .select()
      .single()
    expect(invalidInsert.data).toBeNull()
    expect(invalidInsert.error?.code).toBe('23514')
    expect(invalidInsert.error?.message).toContain('room_participants_status_check')
    expect(store.participants.has('p-invalid')).toBe(false)

    // Rechazo de 'active' en update (código 23514) preservando el estado previo
    const invalidUpdate = await client
      .from('room_participants')
      .update({ status: 'active' })
      .eq('id', 'p-default')
      .select()
      .maybeSingle()
    expect(invalidUpdate.data).toBeNull()
    expect(invalidUpdate.error?.code).toBe('23514')
    expect(invalidUpdate.error?.message).toContain('room_participants_status_check')
    expect(store.participants.get('p-default')?.status).toBe('joined')
  })

  it('mantiene el menú lateral (.sidebar) unido (.sidebar-footer con margin-top: 20px) y fijo (sticky) en escritorio sin bloqueo por overflow-x', async () => {
    const fsModuleName = 'node:fs'
    const { readFileSync } = (await import(/* @vite-ignore */ fsModuleName)) as {
      readFileSync: (path: URL, encoding: string) => string
    }

    const css = readFileSync(new URL('../index.css', import.meta.url), 'utf8')

    // 1. .sidebar-footer usa margin-top: 20px y nunca margin-top: auto
    expect(css).toMatch(/\.sidebar-footer\s*\{\s*margin-top:\s*20px\s*;?\s*\}/)
    expect(css).not.toMatch(/\.sidebar-footer\s*\{[^}]*margin-top:\s*auto/)

    // 2. .sidebar en escritorio (> 720px) tiene position: sticky, top: 76px, height: calc(100vh - 76px), overflow-y: auto
    expect(css).toMatch(
      /\.sidebar\{width:235px;[^}]*position:sticky;top:76px;height:calc\(100vh - 76px\);overflow-y:auto\}/
    )
    expect(css).toMatch(
      /@media\s*\(min-width:\s*721px\)\s*\{\s*\.sidebar\s*\{\s*position:\s*sticky;\s*top:\s*76px;\s*height:\s*calc\(100vh\s*-\s*76px\);\s*overflow-y:\s*auto;\s*\}/
    )

    // 3. En móvil (<= 720px) se preserva el cajón fijo (position: fixed; left: 0; top: 64px; bottom: 0; height: auto)
    expect(css).toMatch(
      /@media\(max-width:720px\)\{\.mobile-nav-toggle\{display:inline-flex\}\.sidebar\{display:none;position:fixed;left:0;top:64px;bottom:0;width:min\(286px,86vw\);height:auto;/
    )

    // 4. Ancestros (html, body y .app-shell, .layout, .main-content) usan overflow-x: clip en vez de overflow-x: hidden
    expect(css).toMatch(/html,\s*body\s*\{[^}]*overflow-x:\s*clip/)
    expect(css).not.toMatch(/html,\s*body\s*\{[^}]*overflow-x:\s*hidden/)
    expect(css).toMatch(/\.app-shell,\s*\.layout,\s*\.main-content\s*\{[^}]*overflow-x:\s*clip/)
    expect(css).not.toMatch(/\.app-shell,\s*\.layout,\s*\.main-content\s*\{[^}]*overflow-x:\s*hidden/)
  })
})
