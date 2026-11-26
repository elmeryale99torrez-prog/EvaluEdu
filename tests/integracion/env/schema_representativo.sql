-- LAB-RC-001 · Esquema base REPRESENTATIVO para el entorno aislado.
-- LIMITACIÓN DE PROCEDENCIA: el repositorio no contiene la migración inicial (0000_init.sql).
-- Este archivo reconstruye tablas, RLS de propietario y privilegios a partir del uso real en
-- src/App.tsx, src/lib/auth.ts y supabase/functions/*. NO es el esquema productivo: tipos de
-- columnas, FKs, cascadas, triggers y políticas reales son DESCONOCIDOS hasta que ATLAS autorice
-- la exportación de solo lectura descrita en MATRIZ_COMPATIBILIDAD_ESQUEMA.md.
-- Encima se aplican, sin modificar, las 5 migraciones reales del repositorio.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Roles al estilo Supabase (emulación local).
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN NOINHERIT; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN NOINHERIT; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN NOINHERIT BYPASSRLS; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticator') THEN CREATE ROLE authenticator LOGIN NOINHERIT; END IF;
END $$;
GRANT anon, authenticated, service_role TO authenticator;

-- ---------------------------------------------------------------- auth (emulado)
CREATE SCHEMA IF NOT EXISTS auth;
CREATE TABLE auth.users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  aud text NOT NULL DEFAULT 'authenticated',
  role text NOT NULL DEFAULT 'authenticated',
  email text UNIQUE,
  encrypted_password text,
  email_confirmed_at timestamptz,
  invited_at timestamptz,
  banned_until timestamptz,
  is_anonymous boolean NOT NULL DEFAULT false,
  raw_user_meta_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  raw_app_meta_data jsonb NOT NULL DEFAULT '{"provider":"email","providers":["email"]}'::jsonb,
  last_sign_in_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE auth.refresh_tokens (
  token text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  revoked boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
-- Buzón de correo falso: el emulador registra aquí invitaciones/recuperaciones (no hay SMTP).
CREATE TABLE auth.mail_outbox (
  id bigserial PRIMARY KEY,
  kind text NOT NULL,
  email text NOT NULL,
  redirect_to text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
$$;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT coalesce(
    nullif(auth.jwt() ->> 'sub', ''),
    nullif(current_setting('request.jwt.claim.sub', true), '')
  )::uuid
$$;
CREATE OR REPLACE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$
  SELECT coalesce(nullif(auth.jwt() ->> 'role', ''), nullif(current_setting('request.jwt.claim.role', true), ''))
$$;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.jwt(), auth.uid(), auth.role() TO anon, authenticated, service_role;

-- ---------------------------------------------------------------- public
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

CREATE TABLE public.profiles (
  id uuid PRIMARY KEY,
  display_name text,
  role text NOT NULL DEFAULT 'teacher',
  roles text[] NOT NULL DEFAULT ARRAY['teacher'],
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.evaluation_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL DEFAULT auth.uid(),
  title text NOT NULL,
  subject text,
  description text,
  objective text,
  competency text,
  difficulty text,
  content jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'draft',
  accepted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.activities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL DEFAULT auth.uid(),
  template_id uuid REFERENCES public.evaluation_templates(id) ON DELETE SET NULL,
  type text NOT NULL,
  title text NOT NULL,
  topic text,
  difficulty text,
  prompt text NOT NULL,
  options text[],
  answer text,
  feedback text,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'review',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.rooms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL DEFAULT auth.uid(),
  name text NOT NULL,
  code text UNIQUE NOT NULL,
  instructions text,
  status text NOT NULL DEFAULT 'ready',
  question_count integer NOT NULL DEFAULT 5,
  student_limit integer NOT NULL DEFAULT 40,
  time_minutes integer DEFAULT 30,
  score_per_question numeric NOT NULL DEFAULT 10,
  shuffle_questions boolean NOT NULL DEFAULT true,
  allow_back boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  finished_at timestamptz,
  archived_at timestamptz
);

CREATE TABLE public.room_activities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id uuid NOT NULL REFERENCES public.rooms(id),
  activity_id uuid NOT NULL REFERENCES public.activities(id),
  position integer NOT NULL
);

CREATE TABLE public.room_participants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id uuid NOT NULL REFERENCES public.rooms(id),
  auth_user_id uuid,
  user_id uuid,
  display_name text NOT NULL,
  name_normalized text NOT NULL,
  guest_token_hash text,
  guest_token_expires_at timestamptz,
  joined_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'joined',
  CONSTRAINT room_participants_status_check CHECK (status IN ('joined', 'in_progress', 'completed', 'abandoned'))
);

CREATE TABLE public.attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id uuid NOT NULL REFERENCES public.rooms(id),
  participant_id uuid REFERENCES public.room_participants(id),
  started_at timestamptz,
  finished_at timestamptz,
  status text,
  total_questions integer,
  answered_count integer,
  omitted_count integer,
  correct_count integer,
  score numeric,
  max_score numeric,
  events jsonb NOT NULL DEFAULT '[]'::jsonb
);

CREATE TABLE public.attempt_answers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  attempt_id uuid NOT NULL REFERENCES public.attempts(id) ON DELETE CASCADE,
  activity_id uuid,
  question_index integer,
  response jsonb,
  response_text text,
  status text,
  correct boolean,
  score numeric,
  time_seconds numeric
);

CREATE TABLE public.audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid,
  event_type text NOT NULL,
  entity_type text,
  entity_id text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Privilegios por defecto al estilo Supabase (ALL a los tres roles; RLS restringe).
GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated, service_role;

-- RLS de propietario representativa.
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.evaluation_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.activities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.room_activities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.room_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attempt_answers ENABLE ROW LEVEL SECURITY;
-- audit_events: RLS y políticas las crea la migración real 20261029160000.

CREATE POLICY profiles_own_select ON public.profiles FOR SELECT TO authenticated USING (id = auth.uid());
CREATE POLICY profiles_own_insert ON public.profiles FOR INSERT TO authenticated WITH CHECK (id = auth.uid());
CREATE POLICY profiles_own_update ON public.profiles FOR UPDATE TO authenticated USING (id = auth.uid()) WITH CHECK (id = auth.uid());

CREATE POLICY evaluation_templates_owner_all ON public.evaluation_templates FOR ALL TO authenticated
  USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid());
CREATE POLICY activities_owner_all ON public.activities FOR ALL TO authenticated
  USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid());
CREATE POLICY rooms_owner_all ON public.rooms FOR ALL TO authenticated
  USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid());
CREATE POLICY room_activities_owner_all ON public.room_activities FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.rooms r WHERE r.id = room_activities.room_id AND r.owner_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.rooms r WHERE r.id = room_activities.room_id AND r.owner_id = auth.uid()));
CREATE POLICY room_participants_owner_select ON public.room_participants FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.rooms r WHERE r.id = room_participants.room_id AND r.owner_id = auth.uid()));
CREATE POLICY room_participants_owner_delete ON public.room_participants FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.rooms r WHERE r.id = room_participants.room_id AND r.owner_id = auth.uid()));
CREATE POLICY attempts_owner_select ON public.attempts FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.rooms r WHERE r.id = attempts.room_id AND r.owner_id = auth.uid()));
CREATE POLICY attempts_owner_delete ON public.attempts FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.rooms r WHERE r.id = attempts.room_id AND r.owner_id = auth.uid()));
CREATE POLICY attempt_answers_owner_select ON public.attempt_answers FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.attempts a JOIN public.rooms r ON r.id = a.room_id
                 WHERE a.id = attempt_answers.attempt_id AND r.owner_id = auth.uid()));
CREATE POLICY attempt_answers_owner_delete ON public.attempt_answers FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.attempts a JOIN public.rooms r ON r.id = a.room_id
                 WHERE a.id = attempt_answers.attempt_id AND r.owner_id = auth.uid()));
