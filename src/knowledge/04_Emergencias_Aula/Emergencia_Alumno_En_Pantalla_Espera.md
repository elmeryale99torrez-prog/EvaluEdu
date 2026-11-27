---
id: emergencia-alumno-pantalla-espera
tipo: emergencia
titulo: "Estudiante atrapado en la pantalla de espera"
vistas: [rooms, play]
actividad: null
sinonimos:
  - "alumno en espera"
  - "pantalla de espera"
  - "no le cargan las preguntas"
  - "no le empieza el examen"
  - "se quedo esperando"
sintomas:
  - "SALA ABIERTA · EN ESPERA"
  - "Docente preparando el examen"
  - "La evaluación comenzará automáticamente cuando el docente dé inicio"
preguntas_ejemplo:
  - "Mis alumnos ya metieron el código pero se quedaron en pantalla de espera"
  - "¿Por qué a un estudiante no le cargan las preguntas todavía?"
acciones:
  - label: "Ir a Salas"
    target: "view:rooms"
---

# Estudiante atrapado en la pantalla de espera

## Respuesta rápida
Tu sala todavía está en estado **`En espera`** (o el celular del alumno perdió señal temporalmente). En **Salas**, pulsa el botón **`▶ Iniciar evaluación`** para que a todo el grupo le aparezcan las preguntas automáticamente.

## Paso a paso para resolverlo
1. Entra a **Salas** y revisa el estado de la tarjeta de tu evaluación:
   - Si dice **`En espera`**, pulsa **`▶ Iniciar evaluación`**.
   - En ~2,5 segundos el celular de cada estudiante cambiará solo a la primera actividad.
2. Si ya pulsaste **`▶ Iniciar evaluación`** (la sala dice **`En curso`**) y solo **un** alumno sigue viendo la pantalla de espera:
   - Pídele que toque el botón **`🔄 Comprobar inicio ahora`** en su pantalla.
   - Si no cambia, verifica que su teléfono tenga Wi-Fi o datos activos.

## Por qué ocurre
- EvaluEdu separa **`Abrir sala`** (admite alumnos sin correr el reloj) de **`▶ Iniciar evaluación`** (arranca el examen y el cronómetro para todos al mismo tiempo).

## Relacionado
- [[MOC_Emergencias_Aula]] · [[Ciclo_Estados_Sala]] · [[Sala_de_Espera_y_Sondeo]]
