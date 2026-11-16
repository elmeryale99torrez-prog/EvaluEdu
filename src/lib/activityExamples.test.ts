import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { StudentActivityDemo } from '../App'
import { activityExamples } from './activityExamples'
import { activityRuntime, createInitialResponse } from './activityEngine'

describe('Demostración de la vista real del estudiante', () => {
  it('cubre exactamente los trece formatos sin duplicar ejemplos por tipo', () => {
    expect(activityExamples.map((activity) => activity.type).sort()).toEqual([
      'trueFalse', 'singleChoice', 'matching', 'sorting', 'ordering', 'scenario',
      'multiSelect', 'fillBlanks', 'spotError', 'markWords', 'gridCheck', 'vennDiagram', 'shortAnswer',
    ].sort())
  })

  it.each(activityExamples)('renderiza el componente real para $type', (activity) => {
    expect(() => activityRuntime(activity)).not.toThrow()
    expect(createInitialResponse(activity).type).toBe(activity.type)
    const html = renderToStaticMarkup(createElement(StudentActivityDemo, { activity, resetLabel: 'Reiniciar ejemplo' }))
    expect(html).toContain('play-card')
    expect(html).toContain('Reiniciar ejemplo')
    expect(html).toContain('Comprobar respuesta')
  })
})
