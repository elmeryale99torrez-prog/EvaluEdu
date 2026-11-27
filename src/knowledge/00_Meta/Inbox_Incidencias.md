---
id: inbox-incidencias
tipo: inbox
titulo: "Bandeja de Entrada · Incidencias y Dudas por Incorporar"
vistas: []
---

# Bandeja de Entrada · Incidencias del Asistente

Este documento centraliza preguntas nuevas, errores inéditos o síntomas que la **Capa 1** no pudo resolver con alta confianza o donde un docente indicó *"Esto no resolvió mi problema"*.

> **Regla de privacidad estricta:** nunca registrar aquí nombres de estudiantes, correos personales, contraseñas ni contenido privado de evaluaciones. Solo síntoma técnico, pantalla y solución general.

---

## Flujo para enseñar algo nuevo al bot (sin tocar TypeScript)

1. Revisa un caso pendiente en la sección **Pendientes por analizar**.
2. Decide si corresponde:
   - **Actualizar una nota existente** (añadiendo nuevos `sinonimos` o `sintomas` en su frontmatter YAML), o
   - **Crear una nota nueva** usando [[Tpl_Emergencia]] o [[Tpl_Guia_Flujo]] dentro de la carpeta adecuada (`01_Panel_Docente/`, `04_Emergencias_Aula/`, etc.).
3. Enlaza la nota nueva desde su MOC correspondiente ([[MOC_Panel_Docente]], [[MOC_Panel_Estudiante]], [[MOC_13_Actividades]], [[MOC_Emergencias_Aula]] o [[MOC_Cuenta_PWA_y_Soporte]]).
4. Mueve el caso a **Resueltos e incorporados**.
5. Ejecuta `npm run test` para validar integridad del vault y publica: el bot auto-detectará el nuevo archivo `.md`.

---

## Pendientes por analizar

*(Sin incidencias pendientes al cierre de la construcción inicial del vault).*

<!--
Plantilla de registro rápido:
- [ ] **Fecha:** YYYY-MM-DD | **Vista:** `rooms` | **Dispositivo:** Móvil / PC
  - **Consulta sanitizada:** "..."
  - **Síntoma / Error observado:** "..."
  - **Acción requerida:** Crear nota en `04_Emergencias_Aula/` o ampliar `sinonimos` en `[[...]]`.
-->

---

## Resueltos e incorporados

- [x] **Base inicial v2.0:** Incorporado el flujo actualizado de [[Importar_Documentos_y_Google_Drive]], salas de 1 a 6 formatos en [[Crear_y_Configurar_Sala]] y reglas reales de `student-room-guest` en [[MOC_Emergencias_Aula]].

## Relacionado
- [[Dashboard_Cerebro_EvaluEdu]] · [[Diccionario_Sinonimos]] · [[Escalamiento_Direccion_Y_Sugerencias]]
