import { describe, expect, it } from 'vitest'
import type { Institution } from '../App'

// Lógica de cálculo y reglas SaaS para Superadministrador e Instituciones
export function calculateSaaSTotals(institutions: Institution[]) {
  const totalLicensesSold = institutions.reduce((acc, i) => acc + i.licenseLimit, 0)
  const totalActiveLicenses = institutions.reduce((acc, i) => acc + i.activeLicenses, 0)
  const totalEvaluationsAcrossInstitutions = institutions.reduce((acc, i) => acc + (i.stats?.totalEvaluations || 0), 0)
  return {
    totalInstitutions: institutions.length,
    totalLicensesSold,
    totalActiveLicenses,
    totalEvaluationsAcrossInstitutions,
  }
}

export function canAssignTeacherLicense(institution: Institution, currentActiveTeachers: number): boolean {
  return currentActiveTeachers < institution.licenseLimit
}

export function filterInstitutionTeachers(
  teachers: Array<{ displayName: string; email: string; status: string }>,
  query: string,
  statusFilter: 'all' | 'active' | 'disabled'
) {
  const q = query.toLowerCase().trim()
  return teachers.filter((t) => {
    const matchesSearch = !q || t.displayName.toLowerCase().includes(q) || t.email.toLowerCase().includes(q)
    if (!matchesSearch) return false
    if (statusFilter === 'active') return t.status === 'Activo'
    if (statusFilter === 'disabled') return t.status === 'Bloqueado'
    return true
  })
}

export function auditSaaSEventLabel(type: string): string {
  switch (type) {
    case 'teacher_created': return 'Licencia asignada (Alta docente)'
    case 'teacher_suspended': return 'Licencia liberada (Pausa por licencia médica)'
    case 'teacher_reactivated': return 'Licencia reactivada (Reincorporación)'
    case 'teacher_access_recovery_sent': return 'Enlace de restablecimiento enviado'
    case 'institution_registered': return 'Nueva institución afiliada'
    default: return type.replaceAll('_', ' ')
  }
}

describe('EvaluEdu SaaS — Arquitectura de Superadministrador e Instituciones Educativas', () => {
  const mockInstitutions: Institution[] = [
    {
      id: 'inst-san-simon',
      name: 'Unidad Educativa San Simón',
      code: 'COL-SAN-SIMON',
      planName: 'Licencia Institucional Anual (Secundaria)',
      licenseLimit: 20,
      activeLicenses: 14,
      contactName: 'Lic. Roberto Valdez (Director)',
      contactEmail: 'direccion@sansimon.edu.bo',
      status: 'active',
      validUntil: '2027-12-15',
      createdAt: '2026-02-01',
      stats: { totalEvaluations: 184, activeTeachersPercent: 85 },
    },
    {
      id: 'inst-san-agustin',
      name: 'Colegio San Agustín',
      code: 'COL-SAN-AGUSTIN',
      planName: 'Plan Institucional Pro',
      licenseLimit: 30,
      activeLicenses: 26,
      contactName: 'Dra. María Elena Ramos (Rectora)',
      contactEmail: 'rectoria@sanagustin.edu.bo',
      status: 'active',
      validUntil: '2027-11-30',
      createdAt: '2026-03-10',
      stats: { totalEvaluations: 312, activeTeachersPercent: 92 },
    },
  ]

  describe('Pilar 1: Panel Maestro Superadministrador (Visión Global SaaS)', () => {
    it('calcula con precisión el total de licencias vendidas y consumo activo global', () => {
      const totals = calculateSaaSTotals(mockInstitutions)
      expect(totals.totalInstitutions).toBe(2)
      expect(totals.totalLicensesSold).toBe(50) // 20 + 30
      expect(totals.totalActiveLicenses).toBe(40) // 14 + 26
      expect(totals.totalEvaluationsAcrossInstitutions).toBe(496) // 184 + 312
    })

    it('identifica colegios por código de licencia o contacto institucional', () => {
      const foundByCode = mockInstitutions.find((i) => i.code === 'COL-SAN-SIMON')
      expect(foundByCode?.name).toBe('Unidad Educativa San Simón')
      expect(foundByCode?.licenseLimit).toBe(20)
    })
  })

  describe('Pilar 2: Control de Cupos y Asignación de Licencias por Colegio', () => {
    const institution = mockInstitutions[0] // 20 licencias contratadas

    it('permite incorporar un docente si el cupo contratado no ha sido rebasado', () => {
      const activeTeachers = 14
      expect(canAssignTeacherLicense(institution, activeTeachers)).toBe(true)
    })

    it('bloquea la incorporación de docentes cuando se alcanza el límite de licencias', () => {
      const activeTeachersAtLimit = 20
      expect(canAssignTeacherLicense(institution, activeTeachersAtLimit)).toBe(false)
    })

    it('libera cupo de licencia cuando un docente es pausado por baja médica', () => {
      const teachers = [
        { displayName: 'Prof. Lucía Martínez', email: 'lucia@sansimon.edu.bo', status: 'Activo' },
        { displayName: 'Prof. Paola Arce', email: 'paola@sansimon.edu.bo', status: 'Bloqueado' }, // Pausada
      ]

      const activeTeachers = teachers.filter((t) => t.status === 'Activo').length
      expect(activeTeachers).toBe(1)
      const availableSpots = institution.licenseLimit - activeTeachers
      expect(availableSpots).toBe(19) // 20 - 1 = 19 cupos libres
    })

    it('permite reasignar el cupo libre a un suplente sin costo adicional', () => {
      const teachers = [
        { displayName: 'Prof. Lucía Martínez', email: 'lucia@sansimon.edu.bo', status: 'Activo' },
        { displayName: 'Prof. Paola Arce', email: 'paola@sansimon.edu.bo', status: 'Bloqueado' }, // En baja médica
        { displayName: 'Prof. Fernando Rojas (Suplente)', email: 'fernando@sansimon.edu.bo', status: 'Activo' }, // Ocupa cupo libre
      ]

      const activeTeachers = teachers.filter((t) => t.status === 'Activo').length
      expect(activeTeachers).toBe(2)
      expect(canAssignTeacherLicense(institution, activeTeachers)).toBe(true)
    })
  })

  describe('Pilar 3: Directorio Docente y Filtrado por Estado', () => {
    const faculty = [
      { displayName: 'Prof. Lucía Martínez', email: 'lucia.martinez@sansimon.edu.bo', status: 'Activo' },
      { displayName: 'Prof. Marco Quispe', email: 'marco.quispe@sansimon.edu.bo', status: 'Activo' },
      { displayName: 'Prof. Paola Arce', email: 'paola.arce@sansimon.edu.bo', status: 'Bloqueado' },
    ]

    it('filtra profesores activos y pausados por licencia médica', () => {
      const activeList = filterInstitutionTeachers(faculty, '', 'active')
      const disabledList = filterInstitutionTeachers(faculty, '', 'disabled')

      expect(activeList).toHaveLength(2)
      expect(disabledList).toHaveLength(1)
      expect(disabledList[0].displayName).toBe('Prof. Paola Arce')
    })

    it('encuentra docentes por búsqueda parcial de nombre o correo institucional', () => {
      const searchByName = filterInstitutionTeachers(faculty, 'quispe', 'all')
      expect(searchByName).toHaveLength(1)
      expect(searchByName[0].email).toBe('marco.quispe@sansimon.edu.bo')
    })
  })

  describe('Pilar 4: Privacidad Pedagógica y Cero Espionaje', () => {
    it('traduce eventos administrativos sin exponer respuestas ni notas de estudiantes', () => {
      expect(auditSaaSEventLabel('teacher_created')).toBe('Licencia asignada (Alta docente)')
      expect(auditSaaSEventLabel('teacher_suspended')).toBe('Licencia liberada (Pausa por licencia médica)')
      expect(auditSaaSEventLabel('teacher_reactivated')).toBe('Licencia reactivada (Reincorporación)')
    })
  })
})
