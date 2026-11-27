---
id: estudiante-stepper-cronometro
tipo: guia
titulo: "Navegación (Stepper), Cronómetro, Omisiones y Entrega"
vistas: [play, rooms]
actividad: null
sinonimos:
  - "stepper"
  - "barra de progreso"
  - "cronometro estudiante"
  - "omitir por ahora"
  - "comprobar respuesta"
  - "entregar evaluacion"
  - "preguntas sin responder"
  - "alerta de tiempo"
sintomas:
  - "ACTIVIDAD"
  - "Omitir por ahora"
  - "Comprobar respuesta"
  - "Respuesta registrada"
  - "¿Entregar ahora tus respuestas?"
  - "Preguntas sin responder o pendientes"
  - "Ir a responder"
preguntas_ejemplo:
  - "¿Cómo navega el estudiante entre preguntas y cómo funciona el cronómetro?"
  - "¿Qué pasa si el alumno intenta entregar dejando preguntas sin responder?"
  - "¿Recargar la página reinicia el cronómetro del estudiante?"
acciones:
  - label: "Probar como Estudiante"
    target: "role:student"
---

# Navegación (Stepper), Cronómetro, Omisiones y Entrega

## Respuesta rápida
Durante el examen (`PlayView`), el estudiante ve una **barra superior numerada (Stepper)**, el **cronómetro sincronizado con el servidor**, el botón **`Comprobar respuesta`** (que muestra la pista orientadora) y un **diálogo de confirmación inteligente** antes de finalizar si dejó preguntas pendientes.

## Elementos clave de la pantalla de examen
1. **Barra de progreso (Stepper):** cada círculo numerado representa una actividad (cambia a `✓` cuando queda respondida). Si habilitaste **Volver atrás**, puede tocar cualquier número para regresar; si lo desactivaste, los números anteriores quedan bloqueados.
2. **Cronómetro del servidor:** se calcula usando la hora real de inicio de la sala (`started_at`). **Recargar la página NO reinicia el reloj.**
   - **≤ 5 minutos restantes:** el reloj cambia a tono **ámbar** de advertencia.
   - **≤ 1 minuto restante:** cambia a **rojo pulsante**.
   - **00:00:** entrega automáticamente lo respondido hasta ese instante.
3. **Flujo por pregunta:**
   - Selecciona o completa su respuesta → pulsa **`Comprobar respuesta`**.
   - Aparece la caja **`✦ Respuesta registrada.`** con tu pista orientadora (`hint`), sin revelar la clave correcta.
   - Pulsa **`Siguiente actividad →`** (o **`Omitir por ahora`** si prefiere dejarla para después).
4. **Confirmación antes de entregar:** al llegar a la última pregunta y pulsar **`Finalizar evaluación →`**, si quedaron actividades sin responder aparece el modal **`¿Entregar ahora tus respuestas?`** listando cada una con un botón directo **`Pregunta X · Ir a responder →`**.

## Relacionado
- [[MOC_Panel_Estudiante]] · [[Comprobante_Entrega_y_Respaldo_Offline]] · [[Emergencia_Tiempo_Agotado_Y_Gracia]] · [[Emergencia_Alumno_No_Ve_Nota_Ni_Solucion]]
