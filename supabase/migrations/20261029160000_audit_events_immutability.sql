-- Migración Fase 6: Inmutabilidad estricta de auditoría institucional y políticas RLS
-- Garantiza que ningún evento registrado en audit_events pueda ser modificado (UPDATE) ni eliminado (DELETE).

-- 1. Función de rechazo de alteración para auditoría
CREATE OR REPLACE FUNCTION public.prevent_audit_events_mutation()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Los registros del Libro de Auditoría Institucional son inmutables: no se permite alterar ni eliminar eventos (violación de seguridad probatoria).';
END;
$$ LANGUAGE plpgsql;

-- 2. Disparador (Trigger) a nivel de fila antes de UPDATE o DELETE
DROP TRIGGER IF EXISTS trg_prevent_audit_events_mutation ON public.audit_events;
CREATE TRIGGER trg_prevent_audit_events_mutation
BEFORE UPDATE OR DELETE ON public.audit_events
FOR EACH ROW EXECUTE FUNCTION public.prevent_audit_events_mutation();

-- 3. Habilitar RLS en public.audit_events
ALTER TABLE public.audit_events ENABLE ROW LEVEL SECURITY;

-- 4. Política de lectura: Los administradores pueden leer todo el historial de auditoría
DROP POLICY IF EXISTS "audit_events_admin_select" ON public.audit_events;
CREATE POLICY "audit_events_admin_select"
ON public.audit_events
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid()
      AND (p.role = 'admin' OR 'admin' = ANY(p.roles))
  )
);

-- 5. Política de inserción: Usuarios autenticados pueden registrar eventos atribuibles a ellos
DROP POLICY IF EXISTS "audit_events_authenticated_insert" ON public.audit_events;
CREATE POLICY "audit_events_authenticated_insert"
ON public.audit_events
FOR INSERT
TO authenticated
WITH CHECK (
  actor_id = auth.uid()
);
