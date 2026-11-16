import { describe, expect, it } from 'vitest'
import { sanitizeCsvCell } from '../App'

describe('FG-04 / G-CSV-01: Neutralización de Inyección de Fórmulas CSV en EvaluEdu', () => {
  it('neutraliza fórmulas con prefijo = anteponiendo un apóstrofo', () => {
    expect(sanitizeCsvCell('=SUM(1,1)')).toBe("'=SUM(1,1)")
    expect(sanitizeCsvCell('=cmd|/C calc!A0')).toBe("'=cmd|/C calc!A0")
    expect(sanitizeCsvCell('=1+1')).toBe("'=1+1")
  })

  it('neutraliza fórmulas con prefijo + cuando no son puramente numéricas', () => {
    expect(sanitizeCsvCell('+SUM(1,1)')).toBe("'+SUM(1,1)")
    expect(sanitizeCsvCell('+cmd|/C calc!A0')).toBe("'+cmd|/C calc!A0")
  })

  it('neutraliza fórmulas con prefijo - cuando no son puramente numéricas', () => {
    expect(sanitizeCsvCell('-SUM(1,1)')).toBe("'-SUM(1,1)")
    expect(sanitizeCsvCell('-2+3*4')).toBe("'-2+3*4")
  })

  it('neutraliza fórmulas con prefijo @', () => {
    expect(sanitizeCsvCell('@SUM(1,1)')).toBe("'@SUM(1,1)")
  })

  it('neutraliza fórmulas precedidas de espacios o tabulaciones', () => {
    expect(sanitizeCsvCell('   =SUM(1,1)')).toBe("'   =SUM(1,1)")
    expect(sanitizeCsvCell('\t=cmd')).toBe("'\t=cmd")
    expect(sanitizeCsvCell('\r=cmd')).toBe("'\r=cmd")
  })

  it('conserva números realmente tipados sin alterar y neutraliza strings con apariencia numérica', () => {
    expect(sanitizeCsvCell(100)).toBe('100')
    expect(sanitizeCsvCell(-5)).toBe('-5')
    expect(sanitizeCsvCell(42)).toBe('42')
    expect(sanitizeCsvCell(3.1416)).toBe('3.1416')
    expect(sanitizeCsvCell(-0.5)).toBe('-0.5')
    expect(sanitizeCsvCell('-5')).toBe("'-5")
    expect(sanitizeCsvCell('+42')).toBe("'+42")
  })

  it('neutraliza variantes Unicode de ancho completo', () => {
    expect(sanitizeCsvCell('＝1+1')).toBe("'＝1+1")
    expect(sanitizeCsvCell('＋1+1')).toBe("'＋1+1")
    expect(sanitizeCsvCell('－1+1')).toBe("'－1+1")
    expect(sanitizeCsvCell('＠SUM(1)')).toBe("'＠SUM(1)")
  })

  it('conserva texto común docente y estudiantil', () => {
    expect(sanitizeCsvCell('Valeria Estudiante')).toBe('Valeria Estudiante')
    expect(sanitizeCsvCell('Ciencias Naturales')).toBe('Ciencias Naturales')
    expect(sanitizeCsvCell('¿Cómo se produce la fotosíntesis?')).toBe('¿Cómo se produce la fotosíntesis?')
  })
})
