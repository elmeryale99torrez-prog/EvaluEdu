---
id: actividad-fill-blanks
tipo: actividad
titulo: "Actividad 08 · Completar Espacios Guiado (fillBlanks)"
vistas: [overview, content, proposals, rooms, play]
actividad: fillBlanks
sinonimos:
  - "completar espacios"
  - "fillBlanks"
  - "llenar huecos"
  - "banco de palabras"
  - "fichas tactiles"
  - "marcadores {{1}}"
sintomas:
  - "{{1}}"
  - "Completar espacios"
preguntas_ejemplo:
  - "¿Cómo escribo los espacios en blanco en Completar Espacios?"
  - "¿Cómo coloca o quita fichas el estudiante en el celular?"
acciones:
  - label: "Ir a Propuestas"
    target: "view:proposals"
---

# Actividad 08 · Completar Espacios Guiado (`fillBlanks`)

## Respuesta rápida
Párrafo con marcadores numerados (`{{1}}`, `{{2}}`, ...) y un **banco cerrado de fichas táctiles barajadas** (respuestas correctas + distractores), eliminando errores de tipeo en celular.

## Reglas y límites exactos (Editor docente)
- **Texto con espacios (`textWithBlanks`):** máximo **1.600 caracteres**, usando marcadores consecutivos **`{{1}}`**, **`{{2}}`**, etc.
- **Cantidad de espacios (`blanks`):** mínimo **1**, máximo **6** (`blanks[0]` corresponde a `{{1}}`).
- **Distractores (`distractors`):** mínimo **1**, máximo **6** palabras (etiqueta máximo **120 caracteres**).
- **Consigna:** máximo **600 caracteres** · **Pista obligatoria:** máximo **400 caracteres** · **Explicación privada:** máximo **1.000 caracteres**.

## Cómo lo responde el estudiante (PC y celular)
- Toca una ficha del banco de palabras y toca el espacio numerado donde desea ubicarla (también funciona arrastrando en escritorio).
- **Para corregir:** toca un espacio ya ocupado para devolver la ficha al banco inmediatamente.
- Las fichas aparecen barajadas sin distinguir correctas de distractores.

## Cómo califica EvaluEdu
- **Coincidencia exacta:** completar el **100% de los espacios** con su palabra exacta otorga el puntaje completo; si algún espacio es incorrecto otorga 0 puntos; todos vacíos se registran como `omitted`.

## Relacionado
- [[MOC_13_Actividades]] · [[Actividad_10_Marcar_Palabras]] · [[Actividad_13_Respuesta_Corta]] · [[Diferencias_PC_y_Celular]]
