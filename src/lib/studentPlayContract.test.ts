import { describe, expect, it } from 'vitest'
import { selectScenarioOption, selectSimpleChoiceResponse, selectSpotErrorSegment } from './studentPlayContract'

describe('selecciones de respuesta', () => {
  it('permite marcar, desmarcar y cambiar una opción simple', () => {
    expect(selectSimpleChoiceResponse('singleChoice', 'a', '')).toEqual({ type: 'singleChoice', value: 'a' })
    expect(selectSimpleChoiceResponse('singleChoice', 'a', 'a')).toEqual({ type: 'singleChoice', value: '' })
    expect(selectSimpleChoiceResponse('trueFalse', 'Verdadero', 'Falso')).toEqual({ type: 'trueFalse', value: 'Verdadero' })
  })

  it('permite retirar el segmento señalado y la decisión de una etapa', () => {
    expect(selectSpotErrorSegment({ id: 's1' }, 's1')).toBe('')
    expect(selectSpotErrorSegment({ id: 's1' }, '')).toBe('s1')
    const selected = selectScenarioOption({}, 'stage-1', { id: 'option-1' })
    expect(selectScenarioOption(selected, 'stage-1', { id: 'option-1' })).toEqual({})
  })
})
