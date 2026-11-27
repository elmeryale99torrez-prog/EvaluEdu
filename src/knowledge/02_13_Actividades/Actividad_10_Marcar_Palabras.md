---
id: actividad-mark-words
tipo: actividad
titulo: "Actividad 10 · Marcar Palabras Clave (markWords)"
vistas: [overview, content, proposals, rooms, play]
actividad: markWords
sinonimos:
  - "marcar palabras"
  - "markWords"
  - "resaltar palabras"
  - "corchetes asterisco"
  - "sintaxis marcar palabras"
sintomas:
  - "[palabra*]"
  - "Marcar palabras clave"
preguntas_ejemplo:
  - "¿Cómo indico qué palabras son correctas y cuáles distractores en Marcar Palabras Clave?"
  - "¿Cuál es el mínimo y máximo de palabras interactivas en Marcar Palabras?"
acciones:
  - label: "Ir a Propuestas"
    target: "view:proposals"
---

# Actividad 10 · Marcar Palabras Clave (`markWords`)

## Respuesta rápida
Párrafo de lectura continua donde el estudiante resalta con un toque los **términos diana correctos** diferenciándolos de distractores plausibles.

## Sintaxis amigable y límites exactos (Editor docente)
- **Sintaxis dentro del texto:**
  - **`[término*]`** (con asterisco al final) → término **correcto**.
  - **`[término]`** (sin asterisco) → término **distractor**.
- **Cantidad de términos interactivos:** mínimo **3**, máximo **10** por párrafo (cada término máximo **100 caracteres**), con al menos **1 correcto** y al menos **1 distractor**.
- **Párrafo (`text`):** máximo **2.500 caracteres**.
- **Consigna:** máximo **600** · **Pista obligatoria (`hint`):** máximo **400** · **Explicación privada:** máximo **1.000**.
- El editor muestra en tiempo real la barra de balance de términos detectados.

## Cómo lo responde el estudiante (PC y celular)
- Lee el párrafo fluido y toca directamente los términos interactivos para resaltarlos (volver a tocar desmarca).
- No ve asteriscos ni cuáles son correctos.

## Cómo califica EvaluEdu
- **Coincidencia exacta:** debe resaltar el **100% de los términos correctos y 0 distractores** para obtener el puntaje completo. Selección vacía se califica como `omitted`.

## Relacionado
- [[MOC_13_Actividades]] · [[Actividad_09_Deteccion_Error]] · [[Actividad_08_Completar_Espacios]] · [[Elegir_Formato_Adecuado]]
