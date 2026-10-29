-- Migración Fase 5 v1.2: Función RPC para guardado atómico e idempotente de intentos
-- Garantiza que la inserción de 'attempts', todas sus respuestas en 'attempt_answers'
-- y la actualización de estado en 'room_participants' se ejecuten en una sola
-- transacción ACID indivisible ("todo o nada") a nivel de base de datos PostgreSQL.

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
SET search_path = public
AS $$
DECLARE
  v_existing_attempt_id uuid;
  v_existing_score numeric;
  v_existing_max_score numeric;
  v_attempt_id uuid;
BEGIN
  -- 1. Idempotencia: Si ya existe un intento registrado para este participante, retornarlo de inmediato
  SELECT id, score, max_score
  INTO v_existing_attempt_id, v_existing_score, v_existing_max_score
  FROM public.attempts
  WHERE participant_id = p_participant_id
  LIMIT 1;

  IF v_existing_attempt_id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'ok', true,
      'attemptId', v_existing_attempt_id,
      'alreadySaved', true,
      'score', v_existing_score,
      'maxScore', v_existing_max_score
    );
  END IF;

  -- 2. Insertar registro principal del intento en 'attempts'
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

  -- 3. Inserción masiva de respuestas asociadas en 'attempt_answers' en la misma transacción
  IF p_answers IS NOT NULL AND jsonb_array_length(p_answers) > 0 THEN
    INSERT INTO public.attempt_answers (
      attempt_id,
      activity_id,
      question_index,
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
      COALESCE((item->>'question_index')::integer, 0),
      item->'response',
      COALESCE(item->>'response_text', ''),
      COALESCE(item->>'status', 'answered'),
      (item->>'correct')::boolean,
      COALESCE((item->>'score')::numeric, 0),
      COALESCE((item->>'time_seconds')::numeric, 0)
    FROM jsonb_array_elements(p_answers) AS item;
  END IF;

  -- 4. Actualizar estado del participante a 'completed'
  UPDATE public.room_participants
  SET status = 'completed', last_seen_at = now()
  WHERE id = p_participant_id;

  -- 5. Retornar resultado atómico exitoso
  RETURN jsonb_build_object(
    'ok', true,
    'attemptId', v_attempt_id,
    'alreadySaved', false,
    'score', p_score,
    'maxScore', p_max_score
  );
END;
$$;
