-- Migración Fase C (LAB-C-001): Guardado autoritativo atómico, modelo de ocurrencias y revocación de permisos
-- Propietario Técnico: CENTINELA (Seguridad y Backend)
-- Fecha: 2026-11-12
--
-- 1. Incorporar columnas de ocurrencia en attempt_answers si no existen.
-- 2. Asegurar que la función submit_student_attempt_atomic registre la ocurrencia y garantice idempotencia transaccional.
-- 3. Revocar permisos de ejecución a anon, authenticated y PUBLIC, reservando la RPC estrictamente a service_role.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'room_participants' AND column_name = 'activities_snapshot'
  ) THEN
    ALTER TABLE public.room_participants ADD COLUMN activities_snapshot jsonb;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'attempt_answers' AND column_name = 'occurrence_id'
  ) THEN
    ALTER TABLE public.attempt_answers ADD COLUMN occurrence_id text;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'attempt_answers' AND column_name = 'room_activity_id'
  ) THEN
    ALTER TABLE public.attempt_answers ADD COLUMN room_activity_id uuid;
  END IF;
END $$;

-- Índice para unicidad estricta de intento por participante a nivel de almacenamiento
-- Contempla bases heredadas con duplicados históricos sin borrar registros automáticamente
DO $$
DECLARE
  v_dup_count integer := 0;
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'attempts'
  ) THEN
    SELECT count(*) INTO v_dup_count
    FROM (
      SELECT participant_id
      FROM public.attempts
      WHERE participant_id IS NOT NULL
      GROUP BY participant_id
      HAVING count(*) > 1
    ) dups;
  END IF;

  IF v_dup_count = 0 THEN
    CREATE UNIQUE INDEX IF NOT EXISTS uidx_attempts_participant_id ON public.attempts(participant_id);
  ELSE
    RAISE NOTICE 'Existen % participantes con intentos duplicados históricos; se crea índice regular preservando los registros.', v_dup_count;
    CREATE INDEX IF NOT EXISTS idx_attempts_participant_id ON public.attempts(participant_id);
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.submit_student_attempt_atomic(
  p_room_id uuid,
  p_participant_id uuid,
  p_started_at timestamptz,
  p_finished_at timestamptz,
  p_status text,
  p_total_questions integer,
  p_answered_count integer,
  p_omitted_count integer,
  p_correct_count integer,
  p_score numeric,
  p_max_score numeric,
  p_events jsonb DEFAULT '[]'::jsonb,
  p_answers jsonb DEFAULT '[]'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_existing_attempt_id uuid;
  v_existing_score numeric;
  v_existing_max_score numeric;
  v_existing_status text;
  v_existing_correct integer;
  v_existing_answered integer;
  v_existing_omitted integer;
  v_attempt_id uuid;
BEGIN
  -- Serialización de concurrencia mediante bloqueo consultivo a nivel de transacción
  -- Garantiza que transacciones simultáneas para el mismo estudiante se ejecuten en serie
  PERFORM pg_advisory_xact_lock(hashtext(p_participant_id::text));

  -- 1. Control de Idempotencia: Si ya existe un intento registrado para este participante,
  -- retornar inmediatamente el acuse autoritativo persistido con su puntaje original
  SELECT id, score, max_score, status, correct_count, answered_count, omitted_count
  INTO v_existing_attempt_id, v_existing_score, v_existing_max_score, v_existing_status,
       v_existing_correct, v_existing_answered, v_existing_omitted
  FROM public.attempts
  WHERE participant_id = p_participant_id
  LIMIT 1;

  IF v_existing_attempt_id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'ok', true,
      'attemptId', v_existing_attempt_id,
      'alreadySaved', true,
      'score', v_existing_score,
      'maxScore', v_existing_max_score,
      'status', v_existing_status,
      'correctCount', v_existing_correct,
      'answeredCount', v_existing_answered,
      'omittedCount', v_existing_omitted
    );
  END IF;

  -- 2. Inserción atómica del intento principal en 'attempts'
  BEGIN
    INSERT INTO public.attempts (
      room_id,
      participant_id,
      started_at,
      finished_at,
      status,
      total_questions,
      answered_count,
      omitted_count,
      correct_count,
      score,
      max_score,
      events
    ) VALUES (
      p_room_id,
      p_participant_id,
      COALESCE(p_started_at, now()),
      COALESCE(p_finished_at, now()),
      COALESCE(p_status, 'completed'),
      p_total_questions,
      p_answered_count,
      p_omitted_count,
      p_correct_count,
      p_score,
      p_max_score,
      COALESCE(p_events, '[]'::jsonb)
    )
    RETURNING id INTO v_attempt_id;
  EXCEPTION WHEN unique_violation THEN
    -- Ante condición de carrera extrema interceptada por la restricción única, devolver el existente
    SELECT id, score, max_score, status, correct_count, answered_count, omitted_count
    INTO v_existing_attempt_id, v_existing_score, v_existing_max_score, v_existing_status,
         v_existing_correct, v_existing_answered, v_existing_omitted
    FROM public.attempts
    WHERE participant_id = p_participant_id
    LIMIT 1;

    RETURN jsonb_build_object(
      'ok', true,
      'attemptId', v_existing_attempt_id,
      'alreadySaved', true,
      'score', v_existing_score,
      'maxScore', v_existing_max_score,
      'status', v_existing_status,
      'correctCount', v_existing_correct,
      'answeredCount', v_existing_answered,
      'omittedCount', v_existing_omitted
    );
  END;

  -- 3. Inserción masiva indivisible de respuestas vinculadas con soporte de occurrence_id
  IF p_answers IS NOT NULL AND jsonb_array_length(p_answers) > 0 THEN
    INSERT INTO public.attempt_answers (
      attempt_id,
      activity_id,
      question_index,
      occurrence_id,
      response,
      response_text,
      status,
      correct,
      score,
      time_seconds
    )
    SELECT
      v_attempt_id,
      (item->>'activity_id')::uuid,
      COALESCE((item->>'question_index')::integer, (item->>'index')::integer, 0),
      COALESCE(item->>'occurrence_id', item->>'occurrenceId'),
      item->'response',
      COALESCE(item->>'response_text', ''),
      COALESCE(item->>'status', 'answered'),
      COALESCE((item->>'correct')::boolean, false),
      COALESCE((item->>'score')::numeric, 0),
      COALESCE((item->>'time_seconds')::numeric, 0)
    FROM jsonb_array_elements(p_answers) AS item;
  END IF;

  -- 4. Actualización del estado del participante a 'completed'
  UPDATE public.room_participants
  SET status = 'completed', last_seen_at = now()
  WHERE id = p_participant_id;

  -- 5. Respuesta atómica exitosa
  RETURN jsonb_build_object(
    'ok', true,
    'attemptId', v_attempt_id,
    'alreadySaved', false,
    'score', p_score,
    'maxScore', p_max_score,
    'status', COALESCE(p_status, 'completed'),
    'correctCount', p_correct_count,
    'answeredCount', p_answered_count,
    'omittedCount', p_omitted_count
  );
END;
$$;

-- Revocación estricta de permisos públicos y anónimos
REVOKE ALL ON FUNCTION public.submit_student_attempt_atomic(
  uuid, uuid, timestamptz, timestamptz, text, integer, integer, integer, integer, numeric, numeric, jsonb, jsonb
) FROM PUBLIC;

REVOKE ALL ON FUNCTION public.submit_student_attempt_atomic(
  uuid, uuid, timestamptz, timestamptz, text, integer, integer, integer, integer, numeric, numeric, jsonb, jsonb
) FROM anon;

REVOKE ALL ON FUNCTION public.submit_student_attempt_atomic(
  uuid, uuid, timestamptz, timestamptz, text, integer, integer, integer, integer, numeric, numeric, jsonb, jsonb
) FROM authenticated;

-- Asignación exclusiva al rol de servicio del backend
GRANT EXECUTE ON FUNCTION public.submit_student_attempt_atomic(
  uuid, uuid, timestamptz, timestamptz, text, integer, integer, integer, integer, numeric, numeric, jsonb, jsonb
) TO service_role;

-- Confidencialidad de almacenamiento para room_participants (Q1):
-- Impide la lectura directa de activities_snapshot y secretos de token desde anon o authenticated.
DO $$
DECLARE
  v_safe_cols text;
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'room_participants'
  ) THEN
    REVOKE ALL ON public.room_participants FROM PUBLIC, anon;
    REVOKE SELECT, INSERT, UPDATE ON public.room_participants FROM authenticated;

    SELECT string_agg(quote_ident(column_name), ', ' ORDER BY ordinal_position)
    INTO v_safe_cols
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'room_participants'
      AND column_name NOT IN ('activities_snapshot', 'guest_token_hash', 'guest_token_expires_at');

    IF v_safe_cols IS NOT NULL THEN
      EXECUTE format('GRANT SELECT (%s) ON public.room_participants TO authenticated', v_safe_cols);
    END IF;

    GRANT SELECT, INSERT, UPDATE, DELETE ON public.room_participants TO service_role;
  END IF;
END $$;
