---
id: docente-borrador-vs-aceptar
tipo: guia
titulo: "Guardar Borrador vs Aceptar Contenido"
vistas: [content, proposals]
actividad: null
sinonimos:
  - "guardar borrador"
  - "aceptar contenido"
  - "continuar borrador"
  - "descartar borrador"
  - "borrador guardado automaticamente"
  - "no aparecen mis actividades de la plantilla"
sintomas:
  - "Tienes un borrador pendiente"
  - "Tienes una plantilla en borrador"
  - "Borrador guardado automáticamente"
preguntas_ejemplo:
  - "¿Cuál es la diferencia entre Guardar borrador y Aceptar contenido?"
  - "¿Por qué guardé mi plantilla pero no me aparecen actividades para abrir sala?"
  - "¿Cómo elimino el aviso de borrador pendiente?"
acciones:
  - label: "Ir a Contenido"
    target: "view:content"
---

# Guardar Borrador vs Aceptar Contenido

## Respuesta rápida
**Guardar borrador** conserva tu plantilla en edición sin generar todavía las actividades finales. **Aceptar contenido** aprueba la plantilla y genera de inmediato las actividades compatibles listas para usar en salas.

## Diferencias clave
- **Guardado automático:** mientras escribes en `＋ Nueva plantilla`, EvaluEdu guarda un respaldo local automático (`edueval-template-draft`). Si cierras la pestaña o recargas, verás el aviso **`Tienes un borrador pendiente`** con botones **`Continuar borrador`** y **`Descartar borrador`**.
- **Guardar borrador:** almacena la plantilla en estado `BORRADOR` en tu lista de Contenido para que la termines después. No crea aún las actividades automáticas.
- **Aceptar contenido:** cambia la plantilla a `CONTENIDO ACEPTADO` / `CONTENIDO APROBADO`, crea automáticamente las actividades compatibles y las sincroniza con tu cuenta en Supabase.

## Si no ves tus actividades al crear una sala
1. Ve a **Contenido** y verifica la etiqueta de tu plantilla.
2. Si dice `BORRADOR`, pulsa **`✎ Editar plantilla`** y luego **`Aceptar contenido`**.
3. Si fue importada desde un documento y dice `IMPORTADO · N PENDIENTES`, pulsa **`Ver propuestas`** para aprobar las actividades en [[Propuestas_Variantes_y_Reparacion]].

## Relacionado
- [[MOC_Panel_Docente]] · [[Plantilla_Manual_y_Compatibilidad]] · [[Propuestas_Variantes_y_Reparacion]] · [[Crear_y_Configurar_Sala]]
