import { describe, it, expect } from 'vitest'
import {
  Activity,
  createInitialResponse,
  isResponseComplete,
  compareActivityResponse,
  evaluateActivityResponse,
} from '../activityEngine'

describe('Integración de Actividad #12: Diagrama de Venn (vennDiagram) en el motor central', () => {
  const activity: Activity = {
    id: 'act-venn-1',
    title: 'Célula Animal vs Vegetal',
    type: 'vennDiagram',
    topic: 'Biología Celular',
    difficulty: 'Intermedio',
    prompt: 'Ubica cada orgánulo o estructura en la zona correspondiente del diagrama de Venn:',
    options: ['Centriolos', 'Cloroplastos', 'Mitocondrias'],
    answer: 'Centriolos',
    feedback: 'Analiza qué estructuras son exclusivas de cada reino y cuáles son comunes.',
    details: {
      vennDiagram: {
        setA: 'Célula Animal',
        setB: 'Célula Vegetal',
        intersectionLabel: 'Ambos / Compartido',
        items: [
          { id: 'v1', label: 'Centriolos', zone: 'left' },
          { id: 'v2', label: 'Cloroplastos', zone: 'right' },
          { id: 'v3', label: 'Mitocondrias', zone: 'both' },
        ],
        hint: 'Recuerda que la mitocondria genera ATP en ambos tipos de células.',
        explanation: 'Los centriolos son animales, los cloroplastos vegetales, y las mitocondrias comunes.',
      },
    },
    status: 'published',
  }

  it('crea la respuesta inicial vacía y detecta omisión estricta', () => {
    const initial = createInitialResponse(activity)
    expect(initial.type).toBe('vennDiagram')
    if (initial.type === 'vennDiagram') {
      expect(initial.assignments).toEqual({})
    }

    const evalOmitted = evaluateActivityResponse(activity, initial, 10)
    expect(evalOmitted.status).toBe('omitted')
    expect(evalOmitted.score).toBe(0)
    expect(evalOmitted.correct).toBe(null)
  })

  it('detecta completitud y compara correctamente las asignaciones esperadas', () => {
    const incomplete = {
      type: 'vennDiagram' as const,
      assignments: { v1: 'left' as const },
    }
    expect(isResponseComplete(activity, incomplete)).toBe(false)
    expect(compareActivityResponse(activity, incomplete)).toBe(false)

    const correct = {
      type: 'vennDiagram' as const,
      assignments: {
        v1: 'left' as const,
        v2: 'right' as const,
        v3: 'both' as const,
      },
    }
    expect(isResponseComplete(activity, correct)).toBe(true)
    expect(compareActivityResponse(activity, correct)).toBe(true)

    const evalResult = evaluateActivityResponse(activity, correct, 10)
    expect(evalResult.status).toBe('answered')
    expect(evalResult.correct).toBe(true)
    expect(evalResult.score).toBe(10)
  })

  it('asigna 0 puntos cuando al menos una asignación es incorrecta', () => {
    const wrong = {
      type: 'vennDiagram' as const,
      assignments: {
        v1: 'left' as const,
        v2: 'left' as const, // Error: debía ser 'right'
        v3: 'both' as const,
      },
    }
    expect(isResponseComplete(activity, wrong)).toBe(true)
    expect(compareActivityResponse(activity, wrong)).toBe(false)

    const evalResult = evaluateActivityResponse(activity, wrong, 10)
    expect(evalResult.status).toBe('answered')
    expect(evalResult.correct).toBe(false)
    expect(evalResult.score).toBe(0)
  })
})
