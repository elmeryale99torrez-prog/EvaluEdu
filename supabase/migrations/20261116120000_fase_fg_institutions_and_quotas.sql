-- 20261116120000_fase_fg_institutions_and_quotas.sql
-- LAB-FG-001: Instituciones, membresías, aislamiento multi-tenant y control transaccional de cupos docentes

CREATE TABLE IF NOT EXISTS public.institutions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (char_length(trim(name)) >= 3),
  code text NOT NULL UNIQUE,
  plan_name text NOT NULL DEFAULT 'Licencia Institucional',
  license_limit integer NOT NULL DEFAULT 20 CHECK (license_limit >= 1),
  contact_name text,
  contact_email text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'archived')),
  valid_until timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.institution_memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id uuid NOT NULL REFERENCES public.institutions(id) ON DELETE RESTRICT,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  email text NOT NULL,
  display_name text NOT NULL,
  role text NOT NULL DEFAULT 'teacher' CHECK (role IN ('teacher', 'admin')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'reserved', 'paused', 'cancelled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_institution_email UNIQUE (institution_id, email)
);

CREATE INDEX IF NOT EXISTS idx_inst_memberships_inst_status ON public.institution_memberships (institution_id, status);
CREATE INDEX IF NOT EXISTS idx_inst_memberships_user ON public.institution_memberships (user_id);

-- Helpers de autorización y alcance (ejecutados con privilegios de consulta controlada)
CREATE OR REPLACE FUNCTION public.is_platform_admin(p_uid uuid DEFAULT auth.uid())
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_role text;
  v_roles text[];
  v_has_inst_admin boolean;
BEGIN
  IF p_uid IS NULL THEN
    RETURN false;
  END IF;

  SELECT p.role, p.roles INTO v_role, v_roles
  FROM public.profiles p
  WHERE p.id = p_uid;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  -- Capacidad explícita de plataforma
  IF v_role IN ('superadmin', 'platform_admin') OR
     (v_roles IS NOT NULL AND ('superadmin' = ANY(v_roles) OR 'platform_admin' = ANY(v_roles))) THEN
    RETURN true;
  END IF;

  -- Si tiene rol admin pero NO es un director restringido a una institución específica
  IF v_role = 'admin' OR (v_roles IS NOT NULL AND 'admin' = ANY(v_roles)) THEN
    SELECT EXISTS (
      SELECT 1 FROM public.institution_memberships m
      WHERE m.user_id = p_uid AND m.role = 'admin'
    ) INTO v_has_inst_admin;

    RETURN NOT v_has_inst_admin;
  END IF;

  RETURN false;
END;
$$;

CREATE OR REPLACE FUNCTION public.is_institution_director(p_institution_id uuid, p_uid uuid DEFAULT auth.uid())
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  IF p_uid IS NULL OR p_institution_id IS NULL THEN
    RETURN false;
  END IF;

  RETURN EXISTS (
    SELECT 1
    FROM public.profiles p
    JOIN public.institution_memberships m ON m.user_id = p.id
    WHERE p.id = p_uid
      AND (p.role = 'admin' OR (p.roles IS NOT NULL AND 'admin' = ANY(p.roles)))
      AND m.institution_id = p_institution_id
      AND m.role = 'admin'
      AND m.status = 'active'
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.is_institution_member(p_institution_id uuid, p_uid uuid DEFAULT auth.uid())
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  IF p_uid IS NULL OR p_institution_id IS NULL THEN
    RETURN false;
  END IF;

  RETURN EXISTS (
    SELECT 1
    FROM public.institution_memberships m
    WHERE m.institution_id = p_institution_id
      AND m.user_id = p_uid
  );
END;
$$;

-- Disparador de integridad de cupo: impide reducir license_limit por debajo de licencias ocupadas incluso por UPDATE directo
CREATE OR REPLACE FUNCTION public.enforce_institution_quota_integrity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_occupied int;
BEGIN
  IF NEW.license_limit < 1 THEN
    RAISE EXCEPTION 'INVALID_LIMIT: El límite de licencias debe ser al menos 1.';
  END IF;

  SELECT count(*)::int INTO v_occupied
  FROM public.institution_memberships
  WHERE institution_id = NEW.id
    AND status IN ('active', 'reserved');

  IF NEW.license_limit < v_occupied THEN
    RAISE EXCEPTION 'QUOTA_BELOW_OCCUPIED: No se puede reducir el cupo (%) por debajo de las licencias ocupadas (%).', NEW.license_limit, v_occupied;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_institution_quota ON public.institutions;
CREATE TRIGGER trg_enforce_institution_quota
BEFORE UPDATE OF license_limit ON public.institutions
FOR EACH ROW EXECUTE FUNCTION public.enforce_institution_quota_integrity();

-- Helper interno de registro de auditoría compatible con esquema completo o mínimo sintético
CREATE OR REPLACE FUNCTION public.record_institutional_audit(
  p_actor_id uuid,
  p_event_type text,
  p_entity_type text,
  p_entity_id text,
  p_metadata jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'audit_events' AND column_name = 'metadata'
  ) THEN
    INSERT INTO public.audit_events (actor_id, event_type, entity_type, entity_id, metadata)
    VALUES (p_actor_id, p_event_type, p_entity_type, p_entity_id, COALESCE(p_metadata, '{}'::jsonb));
  ELSE
    INSERT INTO public.audit_events (actor_id, event_type)
    VALUES (p_actor_id, p_event_type);
  END IF;
END;
$$;

-- Función transaccional para asignar o reservar licencia con comprobación atómica de cupo y permisos
CREATE OR REPLACE FUNCTION public.assign_institution_license(
  p_institution_id uuid,
  p_email text,
  p_display_name text,
  p_role text DEFAULT 'teacher',
  p_user_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_caller_uid uuid := auth.uid();
  v_caller_role text := session_user;
  v_is_plat boolean := false;
  v_is_dir boolean := false;
  v_inst RECORD;
  v_occupied int;
  v_existing RECORD;
  v_normalized_email text := lower(trim(p_email));
  v_target_role text := COALESCE(p_role, 'teacher');
  v_result RECORD;
BEGIN
  -- 1. Verificación estricta de autorización del actor
  IF v_caller_role = 'anon' THEN
    RAISE EXCEPTION 'UNAUTHORIZED: Rol anónimo no autorizado.';
  END IF;

  IF v_caller_role = 'authenticated' OR v_caller_uid IS NOT NULL OR v_caller_role NOT IN ('service_role', 'postgres', 'antigravity') THEN
    IF v_caller_uid IS NULL THEN
      RAISE EXCEPTION 'UNAUTHORIZED: Sesión no autenticada.';
    END IF;
    v_is_plat := public.is_platform_admin(v_caller_uid);
    v_is_dir := public.is_institution_director(p_institution_id, v_caller_uid);

    IF NOT v_is_plat AND NOT v_is_dir THEN
      RAISE EXCEPTION 'FORBIDDEN: No tienes permisos administrativos sobre esta institución.';
    END IF;

    -- Un director institucional solo puede asignar rol teacher; no puede crear otros admins ni autoasignarse admin
    IF NOT v_is_plat AND v_target_role <> 'teacher' THEN
      RAISE EXCEPTION 'FORBIDDEN: Solo la administración de plataforma puede asignar rol directivo.';
    END IF;
  END IF;

  -- 2. Bloqueo pesimista de la institución para serializar peticiones concurrentes
  SELECT id, name, status, license_limit, valid_until
  INTO v_inst
  FROM public.institutions
  WHERE id = p_institution_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NOT_FOUND', 'message', 'Institución no encontrada.');
  END IF;

  IF v_inst.status <> 'active' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'INACTIVE', 'message', 'La institución no se encuentra activa.');
  END IF;

  IF v_inst.valid_until < now() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'EXPIRED', 'message', 'La suscripción institucional ha vencido.');
  END IF;

  -- 3. Comprobar si ya existe membresía para este email en la institución
  SELECT id, status, user_id, role INTO v_existing
  FROM public.institution_memberships
  WHERE institution_id = p_institution_id AND email = v_normalized_email
  FOR UPDATE;

  IF FOUND THEN
    -- Impedir que un director degrade o altere a otro admin
    IF v_existing.role = 'admin' AND NOT v_is_plat AND (v_caller_role = 'authenticated' OR v_caller_uid IS NOT NULL) THEN
      RAISE EXCEPTION 'FORBIDDEN: No puedes modificar una membresía directiva.';
    END IF;

    IF v_existing.status IN ('active', 'reserved') THEN
      UPDATE public.institution_memberships
      SET display_name = p_display_name,
          user_id = COALESCE(p_user_id, v_existing.user_id),
          status = CASE WHEN COALESCE(p_user_id, v_existing.user_id) IS NOT NULL THEN 'active' ELSE v_existing.status END,
          updated_at = now()
      WHERE id = v_existing.id
      RETURNING * INTO v_result;

      PERFORM public.record_institutional_audit(
        v_caller_uid,
        'institution_license_reused',
        'institution_membership',
        v_result.id::text,
        jsonb_build_object('institution_id', p_institution_id, 'email', v_normalized_email, 'status', v_result.status)
      );

      RETURN jsonb_build_object('ok', true, 'membership', to_jsonb(v_result), 'reused', true);
    END IF;

    -- Si estaba pausada o cancelada, reactivar verificando cupo
    SELECT count(*)::int INTO v_occupied
    FROM public.institution_memberships
    WHERE institution_id = p_institution_id AND status IN ('active', 'reserved');

    IF v_occupied >= v_inst.license_limit THEN
      RETURN jsonb_build_object('ok', false, 'error', 'LIMIT_REACHED', 'message', 'Límite de licencias alcanzado para la institución.');
    END IF;

    UPDATE public.institution_memberships
    SET status = CASE WHEN COALESCE(p_user_id, v_existing.user_id) IS NOT NULL THEN 'active' ELSE 'reserved' END,
        display_name = p_display_name,
        user_id = COALESCE(p_user_id, v_existing.user_id),
        updated_at = now()
    WHERE id = v_existing.id
    RETURNING * INTO v_result;

    PERFORM public.record_institutional_audit(
      v_caller_uid,
      'institution_license_reactivated',
      'institution_membership',
      v_result.id::text,
      jsonb_build_object('institution_id', p_institution_id, 'email', v_normalized_email, 'status', v_result.status)
    );

    RETURN jsonb_build_object('ok', true, 'membership', to_jsonb(v_result), 'reactivated', true);
  END IF;

  -- 4. Nueva membresía: verificar cupo
  SELECT count(*)::int INTO v_occupied
  FROM public.institution_memberships
  WHERE institution_id = p_institution_id AND status IN ('active', 'reserved');

  IF v_occupied >= v_inst.license_limit THEN
    RETURN jsonb_build_object('ok', false, 'error', 'LIMIT_REACHED', 'message', 'Límite de licencias alcanzado para la institución.');
  END IF;

  INSERT INTO public.institution_memberships (
    institution_id,
    user_id,
    email,
    display_name,
    role,
    status
  ) VALUES (
    p_institution_id,
    p_user_id,
    v_normalized_email,
    p_display_name,
    v_target_role,
    CASE WHEN p_user_id IS NULL THEN 'reserved' ELSE 'active' END
  )
  RETURNING * INTO v_result;

  PERFORM public.record_institutional_audit(
    v_caller_uid,
    'institution_license_assigned',
    'institution_membership',
    v_result.id::text,
    jsonb_build_object('institution_id', p_institution_id, 'email', v_normalized_email, 'role', v_target_role, 'status', v_result.status)
  );

  RETURN jsonb_build_object('ok', true, 'membership', to_jsonb(v_result), 'created', true);
END;
$$;

-- Función transaccional para pausar o reactivar membresía
CREATE OR REPLACE FUNCTION public.toggle_institution_membership_status(
  p_membership_id uuid,
  p_action text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_caller_uid uuid := auth.uid();
  v_caller_role text := session_user;
  v_is_plat boolean := false;
  v_is_dir boolean := false;
  v_mem RECORD;
  v_inst RECORD;
  v_occupied int;
  v_new_status text;
BEGIN
  SELECT * INTO v_mem
  FROM public.institution_memberships
  WHERE id = p_membership_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NOT_FOUND', 'message', 'Membresía no encontrada.');
  END IF;

  -- Verificación de permisos del actor sobre la institución de la membresía
  IF v_caller_role = 'anon' THEN
    RAISE EXCEPTION 'UNAUTHORIZED: Rol anónimo no autorizado.';
  END IF;

  IF v_caller_role = 'authenticated' OR v_caller_uid IS NOT NULL OR v_caller_role NOT IN ('service_role', 'postgres', 'antigravity') THEN
    IF v_caller_uid IS NULL THEN
      RAISE EXCEPTION 'UNAUTHORIZED: Sesión no autenticada.';
    END IF;
    v_is_plat := public.is_platform_admin(v_caller_uid);
    v_is_dir := public.is_institution_director(v_mem.institution_id, v_caller_uid);

    IF NOT v_is_plat AND NOT v_is_dir THEN
      RAISE EXCEPTION 'FORBIDDEN: No tienes permisos sobre la institución de esta membresía.';
    END IF;

    IF v_mem.user_id IS NOT NULL AND v_mem.user_id = v_caller_uid THEN
      RAISE EXCEPTION 'FORBIDDEN: No puedes pausar o modificar tu propia membresía.';
    END IF;

    IF v_mem.role = 'admin' AND NOT v_is_plat THEN
      RAISE EXCEPTION 'FORBIDDEN: Las membresías directivas están protegidas.';
    END IF;
  END IF;

  IF p_action = 'disable' THEN
    UPDATE public.institution_memberships
    SET status = 'paused', updated_at = now()
    WHERE id = p_membership_id;

    PERFORM public.record_institutional_audit(
      v_caller_uid,
      'institution_membership_paused',
      'institution_membership',
      p_membership_id::text,
      jsonb_build_object('institution_id', v_mem.institution_id, 'email', v_mem.email, 'status', 'paused')
    );

    RETURN jsonb_build_object('ok', true, 'status', 'paused');
  ELSIF p_action = 'enable' THEN
    -- Bloqueo de institución para verificar cupo
    SELECT id, status, license_limit, valid_until
    INTO v_inst
    FROM public.institutions
    WHERE id = v_mem.institution_id
    FOR UPDATE;

    IF v_inst.status <> 'active' OR v_inst.valid_until < now() THEN
      RETURN jsonb_build_object('ok', false, 'error', 'INSTITUTION_INACTIVE', 'message', 'La institución no está activa o su vigencia ha vencido.');
    END IF;

    SELECT count(*)::int INTO v_occupied
    FROM public.institution_memberships
    WHERE institution_id = v_mem.institution_id AND status IN ('active', 'reserved');

    IF v_occupied >= v_inst.license_limit THEN
      RETURN jsonb_build_object('ok', false, 'error', 'LIMIT_REACHED', 'message', 'No hay cupos disponibles. El colegio tiene ocupadas todas sus licencias.');
    END IF;

    v_new_status := CASE WHEN v_mem.user_id IS NULL THEN 'reserved' ELSE 'active' END;

    UPDATE public.institution_memberships
    SET status = v_new_status, updated_at = now()
    WHERE id = p_membership_id;

    PERFORM public.record_institutional_audit(
      v_caller_uid,
      'institution_membership_reactivated',
      'institution_membership',
      p_membership_id::text,
      jsonb_build_object('institution_id', v_mem.institution_id, 'email', v_mem.email, 'status', v_new_status)
    );

    RETURN jsonb_build_object('ok', true, 'status', v_new_status);
  ELSE
    RETURN jsonb_build_object('ok', false, 'error', 'INVALID_ACTION', 'message', 'Acción no válida.');
  END IF;
END;
$$;

-- Función transaccional exclusiva de Superadmin SaaS para actualizar cupo de institución
CREATE OR REPLACE FUNCTION public.update_institution_quota(
  p_institution_id uuid,
  p_new_license_limit int
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_caller_uid uuid := auth.uid();
  v_caller_role text := session_user;
  v_occupied int;
BEGIN
  -- Exclusivo para Superadmin de Plataforma o rol de servicio
  IF v_caller_role = 'anon' THEN
    RAISE EXCEPTION 'UNAUTHORIZED: Rol anónimo no autorizado.';
  END IF;

  IF v_caller_role = 'authenticated' OR v_caller_uid IS NOT NULL OR v_caller_role NOT IN ('service_role', 'postgres', 'antigravity') THEN
    IF v_caller_uid IS NULL THEN
      RAISE EXCEPTION 'UNAUTHORIZED: Sesión no autenticada.';
    END IF;
    IF NOT public.is_platform_admin(v_caller_uid) THEN
      RAISE EXCEPTION 'FORBIDDEN: Solo la administración de plataforma SaaS puede modificar cupos de instituciones.';
    END IF;
  END IF;

  IF p_new_license_limit < 1 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'INVALID_LIMIT', 'message', 'El cupo debe ser mayor o igual a 1.');
  END IF;

  PERFORM id FROM public.institutions WHERE id = p_institution_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NOT_FOUND', 'message', 'Institución no encontrada.');
  END IF;

  SELECT count(*)::int INTO v_occupied
  FROM public.institution_memberships
  WHERE institution_id = p_institution_id AND status IN ('active', 'reserved');

  IF p_new_license_limit < v_occupied THEN
    RETURN jsonb_build_object('ok', false, 'error', 'QUOTA_BELOW_OCCUPIED', 'message', 'No se puede reducir el cupo por debajo de las licencias ocupadas (' || v_occupied || ').');
  END IF;

  UPDATE public.institutions
  SET license_limit = p_new_license_limit, updated_at = now()
  WHERE id = p_institution_id;

  PERFORM public.record_institutional_audit(
    v_caller_uid,
    'institution_quota_updated',
    'institution',
    p_institution_id::text,
    jsonb_build_object('institution_id', p_institution_id, 'new_license_limit', p_new_license_limit, 'occupied', v_occupied)
  );

  RETURN jsonb_build_object('ok', true, 'new_license_limit', p_new_license_limit, 'occupied', v_occupied);
END;
$$;

-- RLS y revocación estricta de privilegios por defecto (PUBLIC y anon)
ALTER TABLE public.institutions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.institution_memberships ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.institutions FROM PUBLIC, anon;
REVOKE ALL ON TABLE public.institution_memberships FROM PUBLIC, anon;

REVOKE ALL ON FUNCTION public.is_platform_admin(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_institution_director(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_institution_member(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.record_institutional_audit(uuid, text, text, text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.assign_institution_license(uuid, text, text, text, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.toggle_institution_membership_status(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.update_institution_quota(uuid, int) FROM PUBLIC, anon;

GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.institutions TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.institution_memberships TO authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.is_platform_admin(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_institution_director(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_institution_member(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.record_institutional_audit(uuid, text, text, text, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.assign_institution_license(uuid, text, text, text, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.toggle_institution_membership_status(uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.update_institution_quota(uuid, int) TO authenticated, service_role;

-- Políticas RLS de aislamiento institucional estricto
DROP POLICY IF EXISTS institutions_select_policy ON public.institutions;
CREATE POLICY institutions_select_policy ON public.institutions
FOR SELECT TO authenticated
USING (
  public.is_platform_admin(auth.uid())
  OR public.is_institution_member(id, auth.uid())
);

DROP POLICY IF EXISTS institutions_modify_policy ON public.institutions;
CREATE POLICY institutions_modify_policy ON public.institutions
FOR ALL TO authenticated
USING (
  public.is_platform_admin(auth.uid())
)
WITH CHECK (
  public.is_platform_admin(auth.uid())
);

DROP POLICY IF EXISTS institution_memberships_select_policy ON public.institution_memberships;
CREATE POLICY institution_memberships_select_policy ON public.institution_memberships
FOR SELECT TO authenticated
USING (
  public.is_platform_admin(auth.uid())
  OR public.is_institution_director(institution_id, auth.uid())
  OR user_id = auth.uid()
);

DROP POLICY IF EXISTS institution_memberships_modify_policy ON public.institution_memberships;
CREATE POLICY institution_memberships_modify_policy ON public.institution_memberships
FOR ALL TO authenticated
USING (
  public.is_platform_admin(auth.uid())
  OR (
    public.is_institution_director(institution_id, auth.uid())
    AND role = 'teacher'
  )
)
WITH CHECK (
  public.is_platform_admin(auth.uid())
  OR (
    public.is_institution_director(institution_id, auth.uid())
    AND role = 'teacher'
  )
);
