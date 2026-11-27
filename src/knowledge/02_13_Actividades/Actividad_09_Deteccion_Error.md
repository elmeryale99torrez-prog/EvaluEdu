---
id: actividad-spot-error
tipo: actividad
titulo: "Actividad 09 · Detección del Error (spotError)"
vistas: [overview, content, proposals, rooms, play]
actividad: spotError
sinonimos:
  - "deteccion del error"
  - "identificacion del error"
  - "spotError"
  - "encontrar el error"
  - "fragmento erroneo"
sintomas:
  - "Error señalado"
preguntas_ejemplo:
  - "¿Cuántos fragmentos con error puede tener Detección del Error?"
  - "¿El estudiante ve la corrección privada que escribí en Detección del Error?"
acciones:
  - label: "Ir a Propuestas"
    target: "view:proposals"
---

# Actividad 09 · Detección del Error (`spotError`)

## Respuesta rápida
Auditoría crítica de **3 a 6 fragmentos, pasos o enunciados** donde todos son válidos excepto **exactamente 1 que contiene un error conceptual o procedimental**.

## Reglas y límites exactos (Editor docente)
- **Fragmentos (`segments`):** mínimo **3**, máximo **6** fragmentos únicos (cada uno máximo **300 caracteres**).
- **Clave (`hasError`):** debe marcarse **exactamente 1 fragmento** como el erróneo.
- **Corrección pedagógica (`correction`):** opcional, máximo **500 caracteres**; es **privada** (solo aparece para el docente y en el CSV, nunca viaja al estudiante).
- **Consigna:** máximo **600 caracteres** · **Pista obligatoria (`hint`):** máximo **400 caracteres** · **Explicación privada:** máximo **1.000 caracteres**.

## Cómo lo responde el estudiante (PC y celular)
- Ve una lista táctil de fragmentos identificados con letras (A, B, C...).
- Toca el fragmento donde detecta el error (queda marcado con la insignia **`Error señalado`**) y pulsa **`Comprobar respuesta`**.

## Cómo califica EvaluEdu
- **Acierto:** señalar el fragmento exacto con `hasError: true` otorga puntaje completo; otro fragmento otorga 0 puntos; sin selección se registra como `omitted`.

## Relacionado
- [[MOC_13_Actividades]] · [[Actividad_10_Marcar_Palabras]] · [[Elegir_Formato_Adecuado]]
