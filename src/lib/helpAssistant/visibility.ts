import type { Session } from '@supabase/supabase-js'
import { canAccessPanel, type Profile } from '../auth'
import type { AssistantRole } from './types'

export interface TeacherAssistantVisibilityParams {
  authSession: Pick<Session, 'user'> | null
  authProfile: Profile | null
  role: AssistantRole
}

/**
 * Regla estricta de visibilidad del Asistente Docente:
 * - Exige sesión real con correo autorizado (nunca anónima ni sin sesión).
 * - Exige perfil verificado en `profiles` con permiso docente (`teacher`).
 * - Visible únicamente en el Panel Docente (`role === 'teacher'`) y en el
 *   Panel de Prueba como Estudiante del propio docente (`role === 'student'`).
 * - Jamás visible para estudiantes reales sin cuenta ni en modo Administrador.
 */
export function canShowTeacherAssistant(params: TeacherAssistantVisibilityParams): boolean {
  const { authSession, authProfile, role } = params
  if (!authSession || !authSession.user) return false
  if (authSession.user.is_anonymous) return false
  if (!authSession.user.email || !authSession.user.email.trim()) return false
  if (!authProfile) return false
  if (!canAccessPanel(authProfile, 'teacher')) return false
  return role === 'teacher' || role === 'student'
}
