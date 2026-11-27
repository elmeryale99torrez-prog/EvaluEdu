---
id: emergencia-entrega-pendiente-rechazada
tipo: emergencia
titulo: "Entrega pendiente de sincronización (pending_sync) o rechazada (rejected)"
vistas: [play, results]
actividad: null
sinonimos:
  - "pending_sync"
  - "entrega pendiente"
  - "entrega rechazada"
  - "no se envio el examen"
  - "respaldo local no confirmado"
  - "reintentar sincronizacion"
sintomas:
  - "COMPROBANTE DE RESPALDO LOCAL"
  - "RESPALDO LOCAL NO CONFIRMADO"
  - "La sala ya no acepta más entregas porque fue finalizada por el docente."
  - "La sala no se encuentra en curso para recibir entregas."
  - "Pendiente de confirmación remota"
preguntas_ejemplo:
  - "Al estudiante le sale entrega pendiente de sincronización al finalizar, ¿se perdió?"
  - "¿Por qué dice que la entrega fue rechazada por el servidor?"
acciones:
  - label: "Ir a Resultados"
    target: "view:results"
  - label: "Ir a Salas"
    target: "view:rooms"
---

# Entrega pendiente (`pending_sync`) o rechazada (`rejected`)

## Respuesta rápida
- **`pending_sync` (Pendiente):** las respuestas están **a salvo** en el dispositivo del estudiante. Solo falta conexión estable y pulsar el botón de reintento mientras la sala siga **`En curso`**.
- **`rejected` (Rechazada):** el servidor bloqueó la entrega porque la sala ya fue **`Finalizada`**, expiró totalmente el tiempo o venció la sesión. Pide al estudiante descargar su **`RESPALDO LOCAL NO CONFIRMADO`** como evidencia.

## Qué hacer en cada caso
1. **Si está en `pending_sync`:**
   - **No cierres todavía la sala** (déjala en `En curso`).
   - Verifica que el celular del alumno vuelva a tener señal (Wi-Fi o datos) y pídele tocar el botón de **reintento** en la pantalla final.
   - Si el servidor ya había recibido el intento en un intento previo sin acuse de recibo, responderá confirmación automática (`alreadySaved`) sin duplicarlo.
   - Como precaución adicional, puede descargar el **`COMPROBANTE DE RESPALDO LOCAL`**.
2. **Si está en `rejected`:**
   - Lee el **Motivo del rechazo** en pantalla (por ejemplo: *"La sala ya no acepta más entregas porque fue finalizada por el docente."* o *"El plazo para entregar esta evaluación ha expirado completamente."*).
   - Pídele descargar el **`RESPALDO LOCAL NO CONFIRMADO`** (`.txt`), que contiene cada pregunta y la respuesta registrada en su dispositivo para que puedas valorarlo según tu criterio docente.

## Relacionado
- [[MOC_Emergencias_Aula]] · [[Comprobante_Entrega_y_Respaldo_Offline]] · [[Emergencia_Tiempo_Agotado_Y_Gracia]] · [[Ciclo_Estados_Sala]]
