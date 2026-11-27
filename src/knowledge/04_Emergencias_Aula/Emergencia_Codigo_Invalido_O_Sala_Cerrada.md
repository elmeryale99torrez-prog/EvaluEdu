---
id: emergencia-codigo-invalido-sala-cerrada
tipo: emergencia
titulo: "Código no encontrado (404) o sala no abierta (403)"
vistas: [rooms, play]
actividad: null
sinonimos:
  - "codigo no encontrado"
  - "codigo invalido"
  - "no encuentra la sala"
  - "sala no esta abierta"
  - "sala cerrada"
  - "no deja entrar con el codigo"
sintomas:
  - "No encontramos ninguna sala con ese código."
  - "Esta sala no está abierta actualmente."
  - "No se encontró la sala solicitada."
  - "Sala no encontrada."
preguntas_ejemplo:
  - "Al alumno le sale 'No encontramos ninguna sala con ese código'"
  - "Dice 'Esta sala no está abierta actualmente' aunque ya la creé"
acciones:
  - label: "Ir a Salas"
    target: "view:rooms"
---

# Código no encontrado (404) o sala no abierta (403)

## Respuesta rápida
- Si dice **"Esta sala no está abierta actualmente."** → la sala sigue en **`Lista para iniciar`** (o ya fue **`Finalizada`**). Pulsa **`Abrir sala`** en **Salas**.
- Si dice **"No encontramos ninguna sala con ese código."** → hay un error de tipeo en el código (confusión entre `0` y `O`, espacio extra o guion faltante) o la sala aún no terminó de sincronizarse desde tu dispositivo.

## Paso a paso para resolverlo
1. Verifica el **estado de la sala** en **Salas**:
   - Si dice **`Lista para iniciar`**, pulsa **`Abrir sala`** (pasa a `En espera`) o luego **`▶ Iniciar evaluación`**.
   - Si dice **`Finalizada`** o **`Archivada`**, ya no admite nuevos ingresos; deberás crear una nueva sala.
2. Verifica el **código exacto** (ej. `EDU-590`) y usa **`Copiar código`** si lo envías por WhatsApp o pizarra digital.
3. Confirma que tu indicador superior diga **`En línea`** (si creaste la sala sin internet, todavía está en tu cola local y el servidor aún no la conoce).

## Relacionado
- [[MOC_Emergencias_Aula]] · [[Ciclo_Estados_Sala]] · [[Ingreso_Codigo_y_Modo_Prueba]] · [[Estado_Conexion_Y_Cola_Offline_Docente]]
