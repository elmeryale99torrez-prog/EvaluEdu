/**
 * rateLimiter.ts
 * Gestor de presupuestos diferenciados de disponibilidad y protección contra abuso
 * para Supabase Edge Functions (student-room-guest y student-room-sync) de EvaluEdu v1.3.
 * 
 * Implementación oficial de Fase C (LAB-C-001):
 * - Presupuesto 'join': Protección contra fuerza bruta / enumeración de códigos de sala.
 * - Presupuesto 'status': Soporte para aulas completas bajo NAT (IP compartida) sin bloquear sondeo.
 * - Presupuesto 'submit': Límite por sesión de participante y límite global por IP para ráfagas legítimas.
 * 
 * Límite arquitectónico declarado: La persistencia de ventanas reside en la memoria de la instancia (Node/Deno).
 * No certifica sincronización distribuida multi-nodo.
 */

export interface RateLimitResult {
  allowed: boolean;
  retryAfter: number;
}

interface WindowRecord {
  count: number;
  resetAt: number;
}

export type ActionCategory = 'join' | 'status' | 'submit' | 'general';

interface BudgetConfig {
  windowMs: number;
  maxPerIp: number;
  maxPerToken?: number;
}

const BUDGETS: Record<ActionCategory, BudgetConfig> = {
  join: {
    windowMs: 60 * 1000,
    maxPerIp: 150, // Permite ingreso concurrente legítimo de 30 a 50 estudiantes en aula bajo NAT escolar compartida
  },
  status: {
    windowMs: 60 * 1000,
    maxPerIp: 1200, // Permite que aulas con hasta 50 alumnos bajo la misma IP hagan sondeo sin interferencia
    maxPerToken: 120, // 2 solicitudes por segundo por participante
  },
  submit: {
    windowMs: 60 * 1000,
    maxPerIp: 300, // Permite entregas casi simultáneas al cierre de clase en NAT
    maxPerToken: 10, // Hasta 10 reintentos de entrega por sesión ante microcortes
  },
  general: {
    windowMs: 60 * 1000,
    maxPerIp: 60,
  },
};

const storeIp = new Map<string, WindowRecord>();
const storeToken = new Map<string, WindowRecord>();

export function getClientIp(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0].trim();
  return request.headers.get('cf-connecting-ip') ?? request.headers.get('x-real-ip') ?? '127.0.0.1';
}

function checkBucket(store: Map<string, WindowRecord>, key: string, limit: number, windowMs: number, now: number): RateLimitResult {
  // Limpieza periódica si el almacenamiento excede 5000 entradas
  if (store.size > 5000) {
    for (const [k, v] of store.entries()) {
      if (v.resetAt <= now) store.delete(k);
    }
  }

  const record = store.get(key);
  if (!record || record.resetAt <= now) {
    store.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, retryAfter: 0 };
  }

  if (record.count >= limit) {
    const retryAfter = Math.max(1, Math.ceil((record.resetAt - now) / 1000));
    return { allowed: false, retryAfter };
  }

  record.count += 1;
  return { allowed: true, retryAfter: 0 };
}

/**
 * Verifica si la solicitud cumple con la política de disponibilidad y límites según su acción y credenciales.
 */
export function checkRateLimit(
  action: string,
  clientIp: string,
  token?: string,
  now = Date.now()
): RateLimitResult {
  const category: ActionCategory =
    action === 'join' ? 'join'
    : action === 'status' ? 'status'
    : action === 'submit' || action === 'submit_attempt' ? 'submit'
    : 'general';

  const budget = BUDGETS[category];

  // 1. Verificación por IP
  const ipKey = `${category}:ip:${clientIp}`;
  const ipCheck = checkBucket(storeIp, ipKey, budget.maxPerIp, budget.windowMs, now);
  if (!ipCheck.allowed) return ipCheck;

  // 2. Verificación por Token de participante (si aplica a la acción)
  if (token && budget.maxPerToken) {
    const tokenKey = `${category}:token:${token}`;
    const tokenCheck = checkBucket(storeToken, tokenKey, budget.maxPerToken, budget.windowMs, now);
    if (!tokenCheck.allowed) return tokenCheck;
  }

  return { allowed: true, retryAfter: 0 };
}

/**
 * Limpia los almacenes en memoria (utilizado para pruebas aisladas).
 */
export function resetRateLimitStore(): void {
  storeIp.clear;
  storeIp.clear();
  storeToken.clear();
}
