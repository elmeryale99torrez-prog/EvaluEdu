---
id: emergencia-tiempo-agotado-gracia
tipo: emergencia
titulo: "Tiempo agotado, 60 segundos de gracia y plazo expirado"
vistas: [play, rooms, results]
actividad: null
sinonimos:
  - "tiempo agotado"
  - "se acabo el tiempo"
  - "reloj llego a cero"
  - "plazo expirado"
  - "timeout"
  - "ventana de gracia"
sintomas:
  - "Tiempo agotado"
  - "El plazo para entregar esta evaluación ha expirado completamente."
  - "Tiempo límite completado"
preguntas_ejemplo:
  - "¿Qué pasa si el cronómetro llega a cero antes de que el estudiante termine?"
  - "¿Por qué aparece 'El plazo para entregar esta evaluación ha expirado completamente'?"
acciones:
  - label: "Ir a Resultados"
    target: "view:results"
---

# Tiempo agotado, 60 segundos de gracia y plazo expirado

## Respuesta rápida
Cuando el cronómetro llega a **`00:00`**, EvaluEdu envía automáticamente todas las respuestas que el estudiante ya registró y marca el intento como **`Tiempo agotado`** en Resultados.

## Reglas exactas del reloj en servidor (`student-room-guest`)
- **Alertas visuales previas:** el reloj se vuelve **ámbar** al faltar ≤ 5 minutos y **rojo pulsante** al faltar ≤ 1 minuto.
- **60 segundos de gracia:** tras vencer el tiempo límite configurado (`time_minutes`), el servidor concede **60 segundos de tolerancia** por latencia de red para recibir el envío automático como `completed` o `timeout`.
- **Rechazo tras expiración total (+6 minutos):** si un dispositivo quedó desconectado y recién intenta entregar **más de 6 minutos después** de vencido el tiempo límite (`límite + 1 min gracia + 5 min`), el servidor responde `409`: *"El plazo para entregar esta evaluación ha expirado completamente."*
- En ese caso extremo, el estudiante conserva la opción de descargar su **Respaldo local** para mostrártelo.

## Consejo docente
- Si quieres evitar cierres bruscos mientras el grupo aprende a usar la plataforma, crea las primeras salas con **`Sin límite de tiempo`** y ciérralas manualmente con **`Finalizar evaluación`**.

## Relacionado
- [[MOC_Emergencias_Aula]] · [[Navegacion_Stepper_y_Cronometro]] · [[Emergencia_Entrega_Pendiente_O_Rechazada]] · [[Crear_y_Configurar_Sala]]
