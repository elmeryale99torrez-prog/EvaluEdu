---
id: estudiante-sala-espera
tipo: guia
titulo: "Sala de Espera del Estudiante y Arranque Automático"
vistas: [play, rooms]
actividad: null
sinonimos:
  - "sala de espera"
  - "pantalla de espera"
  - "comprobar inicio ahora"
  - "cambiar de sala o nombre"
  - "cuando empieza el examen del alumno"
sintomas:
  - "SALA ABIERTA · EN ESPERA"
  - "Docente preparando el examen"
  - "Comprobar inicio ahora"
  - "Cambiar de sala o nombre"
preguntas_ejemplo:
  - "¿Qué ven mis alumnos cuando entran antes de que yo inicie la evaluación?"
  - "¿Tienen que recargar la página cuando pulso Iniciar evaluación?"
acciones:
  - label: "Ir a Salas"
    target: "view:rooms"
---

# Sala de Espera del Estudiante y Arranque Automático

## Respuesta rápida
Cuando la sala está **`En espera`**, cada estudiante que ingresa ve la pantalla **`SALA ABIERTA · EN ESPERA`** con el código y la cantidad de preguntas preparadas. **No necesita recargar**: en cuanto pulsas **`▶ Iniciar evaluación`**, su pantalla avanza sola en unos 2,5 segundos.

## Qué controles ve el estudiante en espera
- Mensaje de confirmación con su nombre y el título de la sala.
- **`🔄 Comprobar inicio ahora`**: consulta manualmente al servidor si el docente ya inició (útil si el Wi-Fi del aula está lento).
- **`Cambiar de sala o nombre`**: le permite salir antes de iniciar si escribió mal su nombre o el código.

## Regla clave
- Mientras estén en la sala de espera, el cronómetro **todavía no corre** y ninguna pregunta es visible. El reloj arranca recién cuando el docente pasa la sala a **`En curso`**.

## Relacionado
- [[MOC_Panel_Estudiante]] · [[Ciclo_Estados_Sala]] · [[Emergencia_Alumno_En_Pantalla_Espera]] · [[Navegacion_Stepper_y_Cronometro]]
