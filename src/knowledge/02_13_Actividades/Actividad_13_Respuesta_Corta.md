---
id: actividad-short-answer
tipo: actividad
titulo: "Actividad 13 · Respuesta Corta Conceptual (shortAnswer)"
vistas: [overview, content, proposals, rooms, play]
actividad: shortAnswer
sinonimos:
  - "respuesta corta"
  - "shortAnswer"
  - "evocacion activa"
  - "tildes en respuesta corta"
  - "mayusculas en respuesta corta"
  - "sinonimos aceptados"
sintomas:
  - "Respuesta corta"
  - "80 caracteres"
preguntas_ejemplo:
  - "¿Si el estudiante escribe sin tilde o en mayúsculas en Respuesta Corta, se lo cuenta bien?"
  - "¿Cuántas respuestas válidas o sinónimos puedo aceptar en Respuesta Corta?"
acciones:
  - label: "Ir a Propuestas"
    target: "view:proposals"
---

# Actividad 13 · Respuesta Corta Conceptual (`shortAnswer`)

## Respuesta rápida
Es la única actividad de **evocación activa pura**: el estudiante redacta el término o concepto preciso sin opciones visibles. Incluye normalización inteligente de espacios, tildes y mayúsculas.

## Reglas y límites exactos (Editor docente)
- **Consigna (`prompt`):** obligatoria, de **5 a 300 caracteres**.
- **Respuestas aceptadas (`acceptedAnswers`):** mínimo **1**, máximo **6** variantes o sinónimos válidos (cada uno de **1 a 80 caracteres**).
- **Tolerancias configurables:**
  - **`ignoreAccents` (por defecto activado):** acepta la respuesta con o sin tildes (ej. `mitocondria` = `mitocóndria`).
  - **`caseSensitive` (por defecto desactivado):** ignora mayúsculas y minúsculas (ej. `Mitocondria` = `MITOCONDRIA`).
  - Los espacios al inicio, al final o repetidos en el medio se limpian automáticamente.
- **Pista orientadora (`hint`):** **5 a 300 caracteres** · **Explicación privada:** **10 a 600 caracteres**.

## Cómo lo responde el estudiante (PC y celular)
- Escribe en un campo limpio con contador en tiempo real (`X / 80 caracteres`) y botón táctil **`Limpiar`**.
- Las respuestas aceptadas nunca viajan al navegador del estudiante.

## Cómo califica EvaluEdu
- Coincidir (tras normalización) con cualquiera de las respuestas aceptadas otorga puntaje completo.
- Dejar el campo vacío o solo con espacios se clasifica limpiamente como **`omitted`**.

## Relacionado
- [[MOC_13_Actividades]] · [[Elegir_Formato_Adecuado]] · [[Actividad_08_Completar_Espacios]]
