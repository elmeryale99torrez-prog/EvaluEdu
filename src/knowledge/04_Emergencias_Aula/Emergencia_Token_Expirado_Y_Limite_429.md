---
id: emergencia-token-expirado-429
tipo: emergencia
titulo: "Sesión estudiantil expirada (6 horas / 401) o Demasiadas solicitudes (429)"
vistas: [play, rooms]
actividad: null
sinonimos:
  - "demasiadas solicitudes"
  - "error 429"
  - "sesion estudiantil expiro"
  - "wifi del colegio"
  - "todos entraron al mismo tiempo"
  - "token expirado"
  - "snapshot heredado"
sintomas:
  - "Demasiadas solicitudes. Por favor, espera antes de reintentar."
  - "Demasiadas solicitudes. Espera unos segundos antes de reintentar."
  - "Sesión no válida o expirada."
  - "Tu sesión estudiantil expiró o no es válida."
  - "SNAPSHOT_MISSING_RECOVERABLE"
preguntas_ejemplo:
  - "Varios alumnos en el Wi-Fi del colegio ven 'Demasiadas solicitudes', ¿qué hago?"
  - "Un estudiante intentó entrar horas después y le dice 'Sesión no válida o expirada'"
acciones:
  - label: "Ir a Salas"
    target: "view:rooms"
---

# Sesión estudiantil expirada (401) o Demasiadas solicitudes (429)

## Respuesta rápida
- **`429 · Demasiadas solicitudes`:** ocurre por el escudo antispam (`rateLimiter`) cuando decenas de celulares comparten la **misma IP del Wi-Fi escolar** e intentan entrar o tocar botones en el mismo segundo. Espera **10–15 segundos** y haz que ingresen en grupos pequeños (de 5 a 10).
- **`401 · Sesión no válida o expirada`:** el token opaco del estudiante dura exactamente **6 horas**.

## Paso a paso para resolver cada error
1. **Si sale `Demasiadas solicitudes` (`429`):**
   - No cierres ni borres la sala; nadie perdió sus respuestas.
   - Pide a los alumnos afectados que esperen **15 segundos** sin tocar repetidamente `Entrar` o `Comprobar inicio ahora`, y luego reintenten.
   - Si ocurre al finalizar, el envío pasa solo a `pending_sync` y reintenta automáticamente respetando el tiempo de espera (`Retry-After`).
2. **Si sale `Sesión no válida o expirada` (`401`):**
   - Pasaron más de **6 horas** desde que ingresó por primera vez o cambió de dispositivo.
   - Si la sala sigue activa y el alumno aún no entregó, pídele reingresar (con una variante de nombre si el anterior quedó activo).
3. **Si sale aviso de `snapshot autoritativo` (`SNAPSHOT_MISSING_RECOVERABLE`):**
   - Pide al alumno recargar o salir y reingresar a la sala para sellar correctamente su paquete de preguntas antes de entregar.

## Relacionado
- [[MOC_Emergencias_Aula]] · [[Ingreso_Codigo_y_Modo_Prueba]] · [[Emergencia_Entrega_Pendiente_O_Rechazada]]
