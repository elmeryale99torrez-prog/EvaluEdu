import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
export const REPO_ROOT = path.resolve(__dirname, '../../..');

export const RC_CONFIG = {
  rcId: 'LAB-RC-002',
  baseSha: '4454f2e0fc35b65ec43b3df01c853b8488153177',
  coordSha: 'd4536702f309e52ef12d7758678410f9b917c99d',
  publicRefSha: '406b66e217ad00e4462cab28fa284d043e3d29d2',
  postgres: {
    binDir: '/usr/lib/postgresql/15/bin',
    host: '127.0.0.1',
    port: 54339,
    socketDir: '/tmp',
    superuser: 'antigravity',
    dbName: 'evaluedu_rc_isolated',
    rehearsalDbName: 'evaluedu_rc_rehearsal',
  },
  ports: {
    gateway: 54340,
    appServer: 54341,
    denoBase: 54350,
    chromiumDebug: 54365,
  },
  denoBin: '/home/antigravity/.deno/bin/deno',
  chromiumBin: '/usr/bin/chromium',
  workDir: '/tmp/evaluedu_rc_runtime',
  evidenciasDir: process.env.EVIDENCIAS_DIR || path.join(REPO_ROOT, 'docs/orchestration/fase-fg/evidencias'),
  edgeFunctions: [
    'student-room-guest',
    'student-room-sync',
    'admin-platform-data',
    'admin-create-pilot-teacher',
    'admin-invite-teacher',
    'admin-remove-user',
    'admin-resend-access',
  ],
  migrations: [
    'supabase/migrations/20261021154245_restrict_anonymous_access.sql',
    'supabase/migrations/20261029141500_attempt_answers_composite_index.sql',
    'supabase/migrations/20261029143500_submit_student_attempt_atomic.sql',
    'supabase/migrations/20261029160000_audit_events_immutability.sql',
    'supabase/migrations/20261112100000_fase_c_atomic_submission_and_grants.sql',
    'supabase/migrations/20261116120000_fase_fg_institutions_and_quotas.sql',
  ],
  syntheticUsers: {
    teacherOwner: {
      id: '99999999-9999-4999-8999-999999999901',
      email: 'docente.propietario@synthetic.evaluedu.local',
      displayName: 'Docente Propietario RC',
      role: 'teacher',
      roles: ['teacher'],
    },
    teacherOther: {
      id: '99999999-9999-4999-8999-999999999902',
      email: 'docente.ajeno@synthetic.evaluedu.local',
      displayName: 'Docente Ajeno RC',
      role: 'teacher',
      roles: ['teacher'],
    },
    adminDirector: {
      id: '99999999-9999-4999-8999-999999999903',
      email: 'direccion.admin@synthetic.evaluedu.local',
      displayName: 'Directora Admin RC',
      role: 'admin',
      roles: ['admin'],
    },
    teacherDual: {
      id: '99999999-9999-4999-8999-999999999904',
      email: 'docente.dual@synthetic.evaluedu.local',
      displayName: 'Coordinador Dual RC',
      role: 'teacher',
      roles: ['teacher', 'admin'],
    },
  },
  // Credenciales efímeras generadas en memoria o derivadas sintéticamente por corrida; no son secretos productivos.
  syntheticPasswordPrefix: 'RcSynth!2026#',
  forbiddenRemotePatterns: [
    'supabase.co',
    'supabase.in',
    'service_role_prod',
    'https://elmeryale99torrez-prog.github.io/EvaluEdu',
  ],
};
