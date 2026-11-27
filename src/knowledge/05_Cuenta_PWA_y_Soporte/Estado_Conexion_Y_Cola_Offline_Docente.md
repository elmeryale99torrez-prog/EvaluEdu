---
id: cuenta-conexion-cola-offline
tipo: cuenta
titulo: "Estados de Conexión (En línea / Sin conexión / Modo local) y Cola Offline"
vistas: [overview, content, proposals, rooms, results]
actividad: null
sinonimos:
  - "sin conexion"
  - "modo local"
  - "en linea"
  - "cola de sincronizacion"
  - "se me fue el wifi"
  - "cambios pendientes"
  - "no sincroniza"
sintomas:
  - "Sin conexión"
  - "Modo local"
  - "En línea"
  - "Última sincronización"
preguntas_ejemplo:
  - "¿Qué significa que arriba diga Sin conexión o Modo local?"
  - "¿Pierdo mis plantillas o actividades si se corta el internet mientras edito?"
acciones:
  - label: "Ir a Inicio"
    target: "view:overview"
---

# Estados de Conexión y Cola Offline del Docente

## Respuesta rápida
Si pierdes señal temporalmente mientras trabajas en el Panel Docente, EvaluEdu guarda tus cambios en una **cola durable local** (`localStorage`) vinculada a tu cuenta y los sincroniza automáticamente cuando vuelve internet.

## Qué indica la píldora superior (en PC)
- **`En línea` (verde):** conectado a internet y sincronizado con Supabase (pasa el cursor sobre la píldora para ver la hora de última sincronización).
- **`Sin conexión`:** tu navegador perdió acceso a internet. Puedes seguir consultando tus plantillas/actividades cargadas y trabajar en borradores; al volver la señal, EvaluEdu reintenta subir los cambios pendientes.
- **`Modo local`:** la app corre en modo demostrativo sin backend conectado (no debería aparecer en tu entorno institucional publicado).

## Qué SÍ necesita conexión obligatoriamente
- **Abrir / Iniciar / Finalizar salas en vivo** para que los estudiantes en otros dispositivos reciban el cambio.
- **Recibir entregas** de estudiantes desde sus teléfonos.
- **Adjuntar desde Google Drive** y el análisis IA en la nube (`teacher-document-analyze`). *(Si estás sin conexión al importar un documento local, EvaluEdu aplica un respaldo estructurado local).*

## Relacionado
- [[MOC_Cuenta_PWA_y_Soporte]] · [[Emergencia_Alumno_Perdio_Conexion_O_Cerro_Pestana]] · [[Comprobante_Entrega_y_Respaldo_Offline]]
