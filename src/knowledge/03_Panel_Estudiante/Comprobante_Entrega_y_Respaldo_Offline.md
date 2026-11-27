---
id: estudiante-comprobante-offline
tipo: guia
titulo: "Comprobante de Entrega y Respaldo Offline del Estudiante"
vistas: [play, results]
actividad: null
sinonimos:
  - "comprobante de entrega"
  - "respaldo local"
  - "pending_sync"
  - "confirmada en servidor"
  - "reintentar envio"
  - "evidencia de entrega"
sintomas:
  - "COMPROBANTE OFICIAL DE ENTREGA"
  - "COMPROBANTE DE RESPALDO LOCAL"
  - "RESPALDO LOCAL NO CONFIRMADO"
  - "Pendiente de confirmación remota"
preguntas_ejemplo:
  - "¿Qué evidencia recibe el estudiante al terminar su evaluación?"
  - "¿Qué pasa si el alumno entrega justo cuando se corta el internet?"
acciones:
  - label: "Ir a Resultados"
    target: "view:results"
---

# Comprobante de Entrega y Respaldo Offline del Estudiante

## Respuesta rápida
Al terminar la evaluación, el estudiante ve su pantalla de cierre (`StudentCompletion`) donde puede descargar un **Comprobante de entrega** con su resumen de respuestas (sin puntaje ni soluciones). Si falla internet justo al entregar, sus respuestas quedan blindadas en una **cola durable local** para reenviarlas sin perder nada.

## Los 3 estados posibles al finalizar
1. **Confirmada (`confirmed`):** la entrega fue guardada y calificada en el servidor (`submit_student_attempt_atomic`). El estudiante puede descargar su **`COMPROBANTE OFICIAL DE ENTREGA`** (`.txt`) con fecha, código de sala, identificador de entrega y respuestas registradas.
2. **Pendiente de sincronización (`pending_sync`):** ocurrió un corte de red, saturación (`429`) o fallo temporal del servidor. Las respuestas están guardadas localmente en el dispositivo y el alumno ve el botón de reintento; apenas vuelva internet, se envía de forma idempotente (sin duplicar intentos). También puede descargar su **`COMPROBANTE DE RESPALDO LOCAL`**.
3. **Rechazada (`rejected`):** el servidor rechazó la entrega por una regla de negocio (por ejemplo, el docente ya finalizó la sala antes de entregar o venció totalmente el plazo). El alumno puede descargar un **`RESPALDO LOCAL NO CONFIRMADO`** con el motivo exacto para mostrártelo.

## Relacionado
- [[MOC_Panel_Estudiante]] · [[Emergencia_Entrega_Pendiente_O_Rechazada]] · [[Emergencia_Alumno_Perdio_Conexion_O_Cerro_Pestana]] · [[Resultados_Privados_y_Exportar_CSV]]
