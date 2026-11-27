---
id: emergencia-google-drive-popup
tipo: emergencia
titulo: "Error al conectar con Google Drive o ventana emergente bloqueada"
vistas: [content]
actividad: null
sinonimos:
  - "error google drive"
  - "no abre google drive"
  - "ventana emergente bloqueada"
  - "popup bloqueado"
  - "acceso cancelado drive"
  - "no descarga de drive"
sintomas:
  - "Tu navegador bloqueó la ventana de Google Drive."
  - "Acceso cancelado. Si deseas adjuntar desde Drive, acepta el permiso de lectura del archivo elegido."
  - "No se pudo conectar con Google Drive en este momento."
  - "No se pudo autorizar el acceso a Google Drive."
preguntas_ejemplo:
  - "Me dice que el navegador bloqueó la ventana de Google Drive"
  - "No me deja adjuntar un archivo desde Google Drive en el celular"
acciones:
  - label: "Ir a Contenido"
    target: "view:content"
---

# Error al conectar con Google Drive o ventana emergente bloqueada

## Respuesta rápida
El selector oficial de Google Drive requiere permitir **ventanas emergentes (*pop-ups*)** para EvaluEdu y aceptar el permiso mínimo de lectura (`drive.file`, que solo accede al archivo que eliges).

## Solución según el mensaje que ves
1. **`"Tu navegador bloqueó la ventana de Google Drive."`**
   - En la barra de direcciones (PC) o aviso inferior (celular), toca el icono de ventana bloqueada y elige **Permitir siempre ventanas emergentes en este sitio**.
   - Vuelve a pulsar **`☁️ Adjuntar desde Google Drive`**.
2. **`"Acceso cancelado..."`**
   - Cerraste el permiso o pulsaste cancelar. Vuelve a intentar y acepta el permiso de lectura del archivo elegido (EvaluEdu no puede ver el resto de tu Drive).
3. **Si la ventana de Drive aparece detrás o tarda al descargar:**
   - Al elegir un archivo grande o un Google Doc/Slide, el modal reaparece de inmediato mostrando el estado mientras descarga y convierte el archivo. Espera unos segundos sin cerrar la ventana.
4. **Plan B inmediato en celular:**
   - Si tu red escolar bloquea Google OAuth, descarga el PDF/Word a tu dispositivo y usa **`📁 Adjuntar desde mi dispositivo`**.

## Relacionado
- [[MOC_Emergencias_Aula]] · [[Importar_Documentos_y_Google_Drive]] · [[Emergencia_Archivo_No_Admitido_O_Confirmacion_Cierre]]
