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
})
