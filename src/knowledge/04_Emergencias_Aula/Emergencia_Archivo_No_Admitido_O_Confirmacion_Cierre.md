---
id: emergencia-archivo-no-admitido-confirmacion
tipo: emergencia
titulo: "Archivo no admitido, límite de 150 MB, sin propuestas o confirmación de cierre"
vistas: [content]
actividad: null
sinonimos:
  - "formato no admitido"
  - "supera el limite de 150 mb"
  - "archivo danado o con contrasena"
  - "falta contenido suficiente"
  - "confirmacion de seguridad importar"
  - "boton importar deshabilitado"
  - "no se activa el boton importar"
  - "boton importar no se activa"
  - "pdf escaneado como imagen"
sintomas:
  - "tiene un formato no admitido. Usa PDF, PowerPoint, Word, Excel o texto."
  - "supera el límite de 150 MB por archivo."
  - "Verifica que el archivo no esté dañado ni protegido con contraseña."
  - "El material se analizó, pero falta contenido suficiente para proponer actividades."
  - "Confirmación de seguridad"
  - "Mantener análisis actual"
preguntas_ejemplo:
  - "¿Por qué el botón Importar documento no se activa aunque ya subí mi PDF?"
  - "Me dice que mi archivo no tiene formato admitido o falta contenido suficiente"
  - "¿Por qué me sale 'Confirmación de seguridad' al intentar cerrar la ventana de importar?"
acciones:
  - label: "Ir a Contenido"
    target: "view:content"
---

# Problemas al Importar Documentos y Confirmación de Seguridad

## Respuesta rápida
Verifica primero estos 4 puntos exactos del importador: formato admitido, peso ≤ **150 MB**, casilla **`Listo para importar`** marcada y que el PDF contenga **texto seleccionable** (no solo fotos escaneadas).

## Diagnóstico según lo que ocurre
1. **El botón `Importar documento →` está deshabilitado:**
   - Debes marcar la casilla **`Listo para importar`** debajo de la lista de documentos adjuntados.
2. **`"formato no admitido"` o `"supera el límite de 150 MB"`:**
   - Usa únicamente `.pdf`, `.pptx`, `.docx`, `.xlsx`, `.txt`, `.md`, `.csv`, `.html` (o Google Docs/Slides/Sheets vía Drive).
   - Archivos antiguos `.doc` o `.ppt` (sin la `x`) deben guardarse primero como `.docx` / `.pptx` o `.pdf`.
3. **`"falta contenido suficiente"` o `"no se pudieron procesar"`:**
   - Ocurre si el PDF está protegido con contraseña o es un **escaneo de puras imágenes sin texto**. Convierte o adjunta un archivo con texto seleccionable (conceptos, definiciones, pasos o casos).
4. **`"Confirmación de seguridad"` (`Mantener análisis actual` vs `Sí, descartar y continuar`):**
   - Aparece cuando tus documentos **ya fueron analizados** y tocas cerrar, quitar un archivo o cambiar documentos. Si quieres conservar el resultado, pulsa **`Mantener análisis actual`** y luego **`Aceptar e ir a propuestas →`**.

## Relacionado
- [[MOC_Emergencias_Aula]] · [[Importar_Documentos_y_Google_Drive]] · [[Emergencia_Google_Drive_O_Popup_Bloqueado]] · [[Propuestas_Variantes_y_Reparacion]]
