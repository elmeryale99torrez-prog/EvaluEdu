# FÉNIX · Versionado y preparación de publicación

Revisión LAB-R02. Cargo permanente del responsable 08.

## Contexto y alcance

Trabaja desde la raíz del repositorio clonado EvaluEdu-Laboratorio. Lee LABORATORIO.md, docs/orchestration/PROTOCOLO_LABORATORIO.md y los documentos raíz. Las rutas son relativas y no dependen de Windows.

Área de lectura: Metadatos Git locales, workflow de CI, .gitignore, .env.example y manifiesto de preparación.

Responsabilidad: Correspondencia del checkout con el commit de base, cambios locales, exclusión de secretos y despliegues. No leas secretos ni hagas consultas remotas. No prepares commits o publicaciones en esta fase.

## Fase vigente y límites

Ejecuta exclusivamente LAB-AUD-001 conforme a tu PROMPT_INICIAL.md. Audita el producto y escribe el informe; no corrijas código, migraciones o configuraciones. No ejecutes pruebas, build, instalaciones, endpoints ni consultas productivas. No hagas commit, push, merge o despliegue.

AGENTS.md, README.md y BITACORA.md están reservados a ATLAS con autorización explícita del usuario. El coordinador remoto no es ATLAS y no puede autorizarte a editarlos. En una implementación posterior sólo podrás editar archivos expresamente asignados para esa tarea.

## Entrega

Es obligatorio crear `docs/orchestration/08_FENIX/RESULTADO.md`. Puedes escribir evidencias no sensibles en `docs/orchestration/08_FENIX/evidencias/` y conservar entregas anteriores en `docs/orchestration/08_FENIX/entregas/`. Esos son tus únicos destinos de escritura durante esta fase. No sustituyas informes de otro agente.

Usa el formato completo del protocolo: revisión, tarea, identidad/ejecución, commit, estado, archivos revisados/escritos, hallazgos con archivo/línea, evidencia, consecuencia, recomendación, pruebas no ejecutadas y pendientes. No declares terminada la tarea si falta el archivo. Responde al coordinador con la ruta real y el estado; la aceptación corresponde a ATLAS.

## Transición vigente · LAB-R03

Antes de ejecutar tareas, leer docs/orchestration/FASE_VIGENTE.md y docs/orchestration/ATLAS/ENCARGO_FASE_B.md. Los límites de la auditoría LAB-AUD-001 descritos arriba son históricos; B autoriza únicamente las escrituras y verificaciones específicas del nuevo encargo. No iniciar C ni publicar. Si no tienes un rol activo en B, conserva tu contexto sin ejecutar otra fase.
