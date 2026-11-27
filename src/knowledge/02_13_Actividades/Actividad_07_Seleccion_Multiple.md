---
id: actividad-multi-select
tipo: actividad
titulo: "Actividad 07 · Selección de Opción Múltiple (multiSelect)"
vistas: [overview, content, proposals, rooms, play]
actividad: multiSelect
sinonimos:
  - "seleccion multiple"
  - "opcion multiple"
  - "varias correctas"
  - "multiSelect"
  - "multiples respuestas"
sintomas: []
preguntas_ejemplo:
  - "¿Cuántas opciones correctas debe tener Selección de Opción Múltiple?"
  - "¿El estudiante sabe cuántas opciones correctas debe marcar?"
  - "¿Da puntaje parcial si el estudiante acierta solo una de dos correctas?"
acciones:
  - label: "Ir a Propuestas"
    target: "view:proposals"
---

# Actividad 07 · Selección de Opción Múltiple (`multiSelect`)

## Respuesta rápida
Evalúa discriminación analítica donde **2 o más opciones son correctas** y existe al menos 1 distractor. El estudiante **nunca ve cuántas opciones son verdaderas**, evitando adivinación.

## Reglas y límites exactos (Editor docente)
- **Opciones:** mínimo **3**, máximo **6** (etiqueta máximo **300 caracteres**, sin duplicados).
- **Balance obligatorio:** mínimo **2 opciones correctas** y mínimo **1 distractor** (no pueden ser todas correctas ni solo una).
- **Consigna:** máximo **600 caracteres** · **Contexto opcional:** máximo **1.500 caracteres**.
- **Pista orientadora (`hint`):** obligatoria, máximo **400 caracteres** (no debe mencionar cuántas son correctas).
- **Explicación privada:** opcional, máximo **1.000 caracteres**.

## Cómo lo responde el estudiante (PC y celular)
- Ve casillas seleccionables con la indicación *"Selecciona todas las opciones correctas"*. Puede marcar o desmarcar varias tarjetas táctiles antes de pulsar **`Comprobar respuesta`**.

## Cómo califica EvaluEdu
- **Coincidencia exacta (sin puntaje parcial):** marcar el **100% de las opciones correctas y 0 distractores** otorga puntaje completo. Cualquier selección incompleta o con un distractor otorga 0 puntos. Sin marcar ninguna cuenta como `omitted`.

## Relacionado
- [[MOC_13_Actividades]] · [[Actividad_02_Seleccion_Unica]] · [[Elegir_Formato_Adecuado]]
