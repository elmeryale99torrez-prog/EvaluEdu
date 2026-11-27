---
id: moc-emergencias-aula
tipo: moc
titulo: "Centro de Emergencias en Clase (Diagnóstico Rápido)"
vistas: [rooms, play, content, proposals, results]
sinonimos:
  - "emergencia"
  - "problema en clase"
  - "error"
  - "alumno no puede entrar"
  - "no funciona"
  - "ayuda urgente"
preguntas_ejemplo:
  - "Tengo un problema en clase con un estudiante, ¿cómo lo resuelvo?"
  - "¿Qué significan los errores de ingreso o entrega en EvaluEdu?"
diagnostico_botones:
  - label: "Alumno en pantalla de espera"
    target_note: "Emergencia_Alumno_En_Pantalla_Espera"
  - label: "Código inválido o sala cerrada"
    target_note: "Emergencia_Codigo_Invalido_O_Sala_Cerrada"
  - label: "Nombre duplicado o intento registrado"
    target_note: "Emergencia_Nombre_Duplicado_O_Intento_Registrado"
  - label: "Alumno perdió conexión o cerró pestaña"
    target_note: "Emergencia_Alumno_Perdio_Conexion_O_Cerro_Pestana"
  - label: "Error al importar o con Google Drive"
    target_note: "Emergencia_Google_Drive_O_Popup_Bloqueado"
---

# Centro de Emergencias en Clase

## Respuesta rápida
Selecciona o describe el síntoma exacto que aparece en pantalla para recibir la solución inmediata paso a paso.

## Problemas de ingreso del estudiante
- [[Emergencia_Alumno_En_Pantalla_Espera]] — El alumno entró pero no le salen las preguntas.
- [[Emergencia_Codigo_Invalido_O_Sala_Cerrada]] — *"No encontramos ninguna sala con ese código"* o *"Esta sala no está abierta actualmente"*.
- [[Emergencia_Nombre_Duplicado_O_Intento_Registrado]] — Error `409`: nombre en uso o intento ya registrado.
- [[Emergencia_Sala_Capacidad_Maxima]] — Error `403`: *"La sala alcanzó su capacidad máxima de estudiantes"*.
- [[Emergencia_Token_Expirado_Y_Limite_429]] — Sesión vencida tras 6 horas (`401`) o *"Demasiadas solicitudes"* (`429`) en Wi-Fi escolar.

## Problemas durante o al finalizar el examen
- [[Emergencia_Alumno_Perdio_Conexion_O_Cerro_Pestana]] — Reconexión en vivo y recuperación de respuestas.
- [[Emergencia_Entrega_Pendiente_O_Rechazada]] — Estados `pending_sync` vs `rejected` y comprobante local.
- [[Emergencia_Tiempo_Agotado_Y_Gracia]] — Cierre automático en `00:00`, 60 s de gracia y plazo vencido.
- [[Emergencia_Alumno_No_Ve_Nota_Ni_Solucion]] — Por qué el estudiante no ve puntaje final ni respuestas correctas.

## Problemas del docente (Importación, Plantillas y Salas)
- [[Emergencia_Google_Drive_O_Popup_Bloqueado]] — Ventana emergente bloqueada o permiso cancelado en Drive.
- [[Emergencia_Archivo_No_Admitido_O_Confirmacion_Cierre]] — Límites de 150 MB, formatos válidos y aviso de confirmación de seguridad.
- [[Emergencia_No_Puedo_Editar_Sala_O_Actividad_Atenuada]] — Sala bloqueada al iniciar o formato deshabilitado en plantilla.

## Relacionado
- [[Dashboard_Cerebro_EvaluEdu]] · [[MOC_Panel_Estudiante]] · [[MOC_Cuenta_PWA_y_Soporte]] · [[Inbox_Incidencias]]
