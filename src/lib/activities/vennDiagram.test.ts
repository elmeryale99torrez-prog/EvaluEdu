import { describe, it, expect } from 'vitest'
import {
  VennDiagramDefinition,
  VennDiagramResponse,
  validateVennDiagramActivity,
  toVennDiagramPublic,
  evaluateVennDiagramResponse,
  generateVennDiagramTeacherReport,
} from './vennDiagram'

describe('Contrato aislado Actividad #12: Diagrama de Venn (vennDiagram)', () => {
  const validDefinition: VennDiagramDefinition = {
    context: 'Comparación funcional y estructural de células en biología.',
    setA: 'Célula Animal',
    setB: 'Célula Vegetal',
    intersectionLabel: 'Ambos / Compartido',
    items: [
      { id: 'i1', label: 'Centriolos', zone: 'left' },
      { id: 'i2', label: 'Cloroplastos', zone: 'right' },
      { id: 'i3', label: 'Membrana plasmática', zone: 'both' },
      { id: 'i4', label: 'Mitocondrias', zone: 'both' },
    ],
    hint: 'Recuerda qué orgánulos son responsables de la fotosíntesis y cuáles forman parte del metabolismo energético común.',
    explanation: 'Los centriolos son propios de células animales; los cloroplastos realizan la fotosíntesis en vegetales; membrana y mitocondrias son comunes a ambas.',
  }

  it('valida exitosamente una definición válida y completa', () => {
    const res = validateVennDiagramActivity(validDefinition)
    expect(res.valid).toBe(true)
    expect(res.errors).toHaveLength(0)
  })

  it('rechaza si faltan los nombres de los conjuntos o son idénticos', () => {
    const missing = validateVennDiagramActivity({ ...validDefinition, setA: '' })
    expect(missing.valid).toBe(false)
    expect(missing.errors.some((e) => e.includes('Conjunto A'))).toBe(true)

    const same = validateVennDiagramActivity({ ...validDefinition, setB: 'Célula Animal' })
    expect(same.valid).toBe(false)
    expect(same.errors.some((e) => e.includes('distintos'))).toBe(true)
  })

  it('rechaza si tiene menos de 3 elementos o más de 8', () => {
    const tooFew = validateVennDiagramActivity({
      ...validDefinition,
      items: [{ id: 'i1', label: 'Centriolos', zone: 'left' }],
    })
    expect(tooFew.valid).toBe(false)
    expect(tooFew.errors.some((e) => e.includes('al menos 3'))).toBe(true)
  })

  it('exige que haya al menos un elemento en la intersección (both)', () => {
    const noBoth = validateVennDiagramActivity({
      ...validDefinition,
      items: [
        { id: 'i1', label: 'Centriolos', zone: 'left' },
        { id: 'i2', label: 'Cloroplastos', zone: 'right' },
        { id: 'i3', label: 'Pared celulosa', zone: 'right' },
      ],
    })
    expect(noBoth.valid).toBe(false)
    expect(noBoth.errors.some((e) => e.includes('intersección'))).toBe(true)
  })

  it('proyecta a la vista pública sin filtrar las zonas correctas ni la explicación', () => {
    const pub = toVennDiagramPublic(validDefinition, 42)
    expect(pub.setA).toBe('Célula Animal')
    expect(pub.setB).toBe('Célula Vegetal')
    expect(pub.items).toHaveLength(4)
    pub.items.forEach((item) => {
      expect((item as unknown as { zone?: string }).zone).toBeUndefined()
      expect(item.id).toBeDefined()
      expect(item.label).toBeDefined()
    })
    expect((pub as unknown as { explanation?: string }).explanation).toBeUndefined()
    expect(pub.hint).toBe(validDefinition.hint)
  })

  it('detecta omisión estricta si assignments está vacío o nulo', () => {
    const evalNull = evaluateVennDiagramResponse(validDefinition, null)
    expect(evalNull.isOmitted).toBe(true)
    expect(evalNull.isCorrect).toBe(false)
    expect(evalNull.scoreRatio).toBe(0)

    const emptyResp: VennDiagramResponse = { type: 'vennDiagram', assignments: {} }
    const evalEmpty = evaluateVennDiagramResponse(validDefinition, emptyResp)
    expect(evalEmpty.isOmitted).toBe(true)
    expect(evalEmpty.isCorrect).toBe(false)
  })

  it('evalúa una respuesta 100% correcta asignando puntaje total', () => {
    const correctResp: VennDiagramResponse = {
      type: 'vennDiagram',
      assignments: {
        i1: 'left',
        i2: 'right',
        i3: 'both',
        i4: 'both',
      },
    }
    const evalRes = evaluateVennDiagramResponse(validDefinition, correctResp, true)
    expect(evalRes.isCorrect).toBe(true)
    expect(evalRes.isOmitted).toBe(false)
    expect(evalRes.isComplete).toBe(true)
    expect(evalRes.scoreRatio).toBe(1)
    expect(evalRes.correctCount).toBe(4)
    expect(evalRes.detailedFeedback).toBe(validDefinition.explanation)
  })

  it('evalúa una respuesta parcial o incorrecta otorgando 0 puntos', () => {
    const partialResp: VennDiagramResponse = {
      type: 'vennDiagram',
      assignments: {
        i1: 'left',
        i2: 'left', // Incorrecto (era 'right')
        i3: 'both',
        i4: 'both',
      },
    }
    const evalRes = evaluateVennDiagramResponse(validDefinition, partialResp)
    expect(evalRes.isCorrect).toBe(false)
    expect(evalRes.isOmitted).toBe(false)
    expect(evalRes.isComplete).toBe(true)
    expect(evalRes.scoreRatio).toBe(0)
    expect(evalRes.correctCount).toBe(3)
  })

  it('genera reporte de docente comprensible con aciertos y desaciertos', () => {
    const partialResp: VennDiagramResponse = {
      type: 'vennDiagram',
      assignments: {
        i1: 'left',
        i2: 'both', // Esperado: right
        i3: 'both',
        i4: 'right', // Esperado: both
      },
    }
    const report = generateVennDiagramTeacherReport(validDefinition, partialResp)
    expect(report).toContain('[✓] Centriolos')
    expect(report).toContain('[✗] Cloroplastos')
    expect(report).toContain('[✓] Membrana plasmática')
    expect(report).toContain('[✗] Mitocondrias')
  })
})
