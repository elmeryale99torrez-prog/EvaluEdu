---
id: actividad-single-choice
tipo: actividad
titulo: "Actividad 02 · Selección Única (singleChoice)"
vistas: [overview, content, proposals, rooms, play]
actividad: singleChoice
sinonimos:
  - "seleccion unica"
  - "opcion unica"
  - "singleChoice"
  - "una sola respuesta correcta"
sintomas: []
preguntas_ejemplo:
  - "¿Cuántas opciones permite Selección Única?"
  - "¿Cómo marco cuál opción es la correcta en Selección Única?"
acciones:
  - label: "Ir a Propuestas"
    target: "view:proposals"
---

# Actividad 02 · Selección Única (`singleChoice`)

## Respuesta rápida
Pregunta conceptual con entre **2 y 6 opciones** donde **exactamente 1 opción es correcta** y las demás actúan como distractores fundamentados.

## Reglas y límites exactos (Editor docente)
- **Consigna (`prompt`):** obligatoria, máximo **600 caracteres**.
- **Contexto opcional:** máximo **1.500 caracteres**.
- **Opciones:** mínimo **2**, máximo **6** (cada etiqueta máximo **300 caracteres**, sin duplicados ni rellenos como `"n/a"` o `"..."`).
- **Clave:** debe marcarse **exactamente 1** opción como `Correcta`.
- **Pista orientadora (`hint`):** obligatoria, máximo **400 caracteres** (no debe delatar la opción ganadora).
- **Explicación privada (`explanation`):** opcional, máximo **1.000 caracteres**.

## Cómo lo responde el estudiante (PC y celular)
- Toca una sola tarjeta de opción (tocar otra cambia la elección) y confirma con **`Comprobar respuesta`**.
- Al confirmar aparece únicamente la pista orientadora neutral.

## Cómo califica EvaluEdu
- **Acierto:** seleccionar la opción correcta otorga el puntaje completo en servidor.
- **Sin selección:** se clasifica como `omitted`.

## Relacionado
- [[MOC_13_Actividades]] · [[Elegir_Formato_Adecuado]] · [[Actividad_07_Seleccion_Multiple]] · [[Actividad_01_Falso_Verdadero]]
