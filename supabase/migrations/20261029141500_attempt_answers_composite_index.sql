-- Migración Fase 5 v1.2: Índice compuesto para attempt_answers
-- Optimiza la recuperación de respuestas por intento y question_index,
-- garantizando ordenamiento veloz, prevención de cuellos de botella en concurrencia
-- y consultas ágiles de reportes y auditoría docente.

CREATE INDEX IF NOT EXISTS idx_attempt_answers_attempt_qindex
ON public.attempt_answers(attempt_id, question_index);
