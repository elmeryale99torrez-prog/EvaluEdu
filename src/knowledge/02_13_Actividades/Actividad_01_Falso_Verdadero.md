---
id: actividad-true-false
tipo: actividad
titulo: "Actividad 01 · Falso o Verdadero (trueFalse)"
vistas: [overview, content, proposals, rooms, play]
actividad: trueFalse
sinonimos:
  - "falso o verdadero"
  - "verdadero y falso"
  - "trueFalse"
  - "afirmacion verdadero falso"
sintomas: []
preguntas_ejemplo:
  - "¿Cómo se configura y califica Falso o Verdadero?"
  - "¿Si un estudiante omite una pregunta de Falso o Verdadero cuenta como Falso?"
acciones:
  - label: "Ir a Propuestas"
    target: "view:proposals"
---

# Actividad 01 · Falso o Verdadero (`trueFalse`)

## Respuesta rápida
Presenta una **afirmación verificable** que el estudiante valida en un clic (`Verdadero` o `Falso`). Ideal para comprobar comprensión conceptual rápida y detectar mitos o errores frecuentes.

## Reglas y límites exactos (Editor docente)
- **Afirmación (`statement`):** obligatoria, máximo **500 caracteres**.
- **Contexto opcional:** máximo **1.500 caracteres**.
- **Respuesta clave (`correct`):** obligatoria (`Verdadero` o `Falso`); nunca se asume un valor por defecto.
- **Pista orientadora (`hint`):** obligatoria, máximo **400 caracteres**. Se muestra al estudiante tras confirmar (idéntica acierte o falle, sin revelar la respuesta).
- **Explicación privada (`explanation`):** opcional, máximo **1.000 caracteres**; visible solo en Resultados y CSV.

## Cómo lo responde el estudiante (PC y celular)
- Toca **`○ Verdadero`** o **`○ Falso`** (pasa a `✓`) y pulsa **`Comprobar respuesta`**.
- En celular se muestran como dos tarjetas grandes de ancho completo.

## Cómo califica EvaluEdu
- **Acierto:** coincide con la clave → puntaje completo.
- **Omisión:** nunca equivale a "Falso"; se registra como `omitted` con 0 puntos.
- La clave y la explicación jamás viajan al navegador del estudiante.

## Relacionado
- [[MOC_13_Actividades]] · [[Elegir_Formato_Adecuado]] · [[Actividad_02_Seleccion_Unica]] · [[Agregar_Actividad_Manual]]
