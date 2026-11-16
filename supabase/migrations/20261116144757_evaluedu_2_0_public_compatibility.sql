-- Compatibilidad aditiva de EvaluEdu 2.0 con el catálogo productivo existente.
ALTER TABLE public.activities DROP CONSTRAINT IF EXISTS activities_type_check;
ALTER TABLE public.activities ADD CONSTRAINT activities_type_check CHECK (type IN (
  'trueFalse','singleChoice','matching','sorting','ordering','scenario','multiSelect',
  'fillBlanks','spotError','markWords','gridCheck','vennDiagram','shortAnswer'
));

ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_roles_valid;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_roles_valid CHECK (
  cardinality(roles) > 0 AND roles <@ ARRAY['admin','teacher','platform_admin','superadmin']::text[]
);
-- Conserva el alcance global de los administradores ya existentes mediante capacidad explícita.
UPDATE public.profiles SET roles = array_append(roles,'platform_admin')
WHERE (role='admin' OR 'admin'=ANY(roles)) AND NOT ('platform_admin'=ANY(roles));

DROP POLICY IF EXISTS profiles_self_insert ON public.profiles;
CREATE POLICY profiles_self_insert ON public.profiles FOR INSERT TO authenticated
WITH CHECK (id=auth.uid() AND role='teacher' AND roles=ARRAY['teacher']::text[]);

CREATE OR REPLACE FUNCTION public.is_platform_admin(p_uid uuid DEFAULT auth.uid())
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,auth AS $$
 SELECT EXISTS (SELECT 1 FROM public.profiles WHERE id=p_uid
 AND (role IN ('superadmin','platform_admin') OR roles && ARRAY['superadmin','platform_admin']::text[]));
$$;
REVOKE ALL ON FUNCTION public.is_platform_admin(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_platform_admin(uuid) TO authenticated, service_role;

-- Toda mutación de membresía del cliente pasa por las RPC con bloqueo y autorización.
REVOKE INSERT,UPDATE,DELETE ON public.institution_memberships FROM authenticated;
DROP POLICY IF EXISTS audit_events_admin_select ON public.audit_events;

-- El catálogo productivo usa UUID para entity_id.
CREATE OR REPLACE FUNCTION public.record_institutional_audit(
 p_actor_id uuid,p_event_type text,p_entity_type text,p_entity_id text,p_metadata jsonb
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,auth AS $$
BEGIN
 INSERT INTO public.audit_events(actor_id,event_type,entity_type,entity_id,metadata)
 VALUES(p_actor_id,p_event_type,p_entity_type,NULLIF(p_entity_id,'')::uuid,COALESCE(p_metadata,'{}'::jsonb));
END;
$$;
REVOKE ALL ON FUNCTION public.record_institutional_audit(uuid,text,text,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.record_institutional_audit(uuid,text,text,text,jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.audit_institution_changes()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,auth AS $$
BEGIN
 PERFORM public.record_institutional_audit(auth.uid(),
   CASE WHEN TG_OP='INSERT' THEN 'institution_created' ELSE 'institution_updated' END,
   'institution',NEW.id::text,jsonb_build_object('institution_id',NEW.id,'operation',TG_OP));
 RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.audit_institution_changes() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS trg_audit_institution_changes ON public.institutions;
CREATE TRIGGER trg_audit_institution_changes AFTER INSERT OR UPDATE ON public.institutions
FOR EACH ROW EXECUTE FUNCTION public.audit_institution_changes();
