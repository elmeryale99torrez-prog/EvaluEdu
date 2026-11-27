---
id: emergencia-alumno-perdio-conexion
tipo: emergencia
titulo: "El estudiante perdió conexión o cerró la pestaña en medio del examen"
vistas: [play, rooms]
actividad: null
sinonimos:
  - "cerro la pestana"
  - "recargo la pagina"
  - "se le apago el celular"
  - "perdio conexion"
  - "se le fue el wifi al alumno"
  - "perdio sus respuestas"
  - "puede reconectarse"
sintomas:
  - "Cargando actividades de la sala"
  - "Sin conexión"
preguntas_ejemplo:
  - "Un alumno cerró sin querer el navegador en medio del examen, ¿perdió todo?"
  - "¿Puede reconectarse un estudiante si se le cortó el Wi-Fi?"
acciones:
  - label: "Ir a Salas"
    target: "view:rooms"
---

# El estudiante perdió conexión o cerró la pestaña en medio del examen

## Respuesta rápida
**No pierde su progreso** si vuelve a abrir EvaluEdu en el **mismo navegador** (sin modo incógnito) mientras la sala siga **`En curso`**: la app restaura automáticamente su sesión, sus respuestas guardadas y el tiempo real restante.

## Paso a paso según lo que ocurrió
1. **Si solo se cortó el Wi-Fi pero la pestaña sigue abierta:**
   - El estudiante puede seguir respondiendo las preguntas ya cargadas en pantalla.
   - Al terminar, si aún no volvió internet, la entrega se guarda en su **respaldo local durable (`pending_sync`)** para reenviarse apenas recupere señal (ver [[Emergencia_Entrega_Pendiente_O_Rechazada]]).
2. **Si recargó la página o volvió a abrir la pestaña:**
   - EvaluEdu lee la sesión guardada (`edueval-student-session`) y recupera su participante y su **snapshot inmutable** desde `student-room-guest` sin ocupar un nuevo cupo.
   - El cronómetro continúa desde la hora real del servidor (`started_at`), no se reinicia.
3. **Si usó modo incógnito, borró caché o cambió a otro celular:**
   - Ese nuevo navegador no tendrá el token original (ver [[Emergencia_Nombre_Duplicado_O_Intento_Registrado]]). Pídele entrar con una variante identificable del nombre (ej. `María Soto (2)`).

## Relacionado
- [[MOC_Emergencias_Aula]] · [[Comprobante_Entrega_y_Respaldo_Offline]] · [[Emergencia_Entrega_Pendiente_O_Rechazada]] · [[Emergencia_Tiempo_Agotado_Y_Gracia]]
