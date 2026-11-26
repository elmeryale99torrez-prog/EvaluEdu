# EvaluEdu · Plataforma de Evaluación Activa (PWA)

**EvaluEdu** es una Progressive Web App (PWA) de alto rendimiento diseñada para crear, estructurar y ejecutar evaluaciones formativas activas en entornos escolares, universitarios y corporativos.

---

## 🚀 Arranque Rápido

### Requisitos
- **Node.js**: v20+ LTS
- **npm**: v10+

### Comandos de desarrollo

```powershell
# Instalar dependencias
npm install

# Iniciar servidor local de desarrollo
npm run dev

# Ejecutar suite de pruebas unitarias e integración (Vitest)
npm run test

# Compilación de producción (TypeScript + Vite)
npm run build

# Previsualizar el bundle de producción
npm run preview
```

---

## 🎯 Catálogo Oficial de 13 Actividades Formativas

EvaluEdu cuenta con un catálogo consolidado de **13 formatos de interacción cognitiva**, abarcando desde la recuperación conceptual hasta la discriminación crítica y la evocación pura:

| # | Tipo | Nombre | Descripción Pedagógica |
|---|---|---|---|
| 1 | `trueFalse` | **Falso / Verdadero** | Afirmación verificable con explicación sustentada y valor esperado. |
| 2 | `singleChoice` | **Selección Única** | Pregunta conceptual con distractores plausibles y una única respuesta válida. |
| 3 | `matching` | **Asociación de Ideas** | Emparejamiento por columnas entre conceptos y sus definiciones o aplicaciones. |
| 4 | `sorting` | **Clasificación por Categorías** | Asignación de elementos a categorías mutuamente excluyentes (táctil / drag & drop). |
| 5 | `ordering` | **Ordenamiento de Procesos** | Secuenciación de pasos temporales, históricos o procedimentales en el orden correcto. |
| 6 | `scenario` | **Escenario de Decisiones** | Análisis de casos por etapas donde cada decisión desencadena consecuencias formativas. |
| 7 | `multiSelect` | **Selección Múltiple** | Elección simultánea de múltiples alternativas correctas sin inducción del número de aciertos. |
| 8 | `fillBlanks` | **Completar Espacios** | Párrafo con ranuras y banco cerrado de fichas táctiles barajadas con distractores. |
| 9 | `spotError` | **Identificación del Error** | Auditoría crítica de fragmentos o pasos para señalar exactamente la inconsistencia conceptual. |
| 10 | `markWords` | **Marcar Palabras Clave** | Resaltado táctil en texto fluido de términos diana válidos diferenciados de distractores. |
| 11 | `gridCheck` | **Matriz de Doble Entrada** | Tabla de cotejo bidimensional para contrastar propiedades de múltiples elementos. |
| 12 | `vennDiagram` | **Diagrama de Venn** | Discriminación simultánea de atributos exclusivos de dos conjuntos y su intersección central. |
| 13 | `shortAnswer` | **Respuesta Corta** | Evocación activa pura (*pure recall*): escritura precisa del término con normalización tolerante. |

---

## 🏛️ Arquitectura de Roles

### 1. Estudiante (Móvil y Escritorio)
- **Ingreso instantáneo:** Sin registro previo ni contraseñas; basta el código de la sala y un nombre de identificación.
- **Seguridad en red:** Respuestas correctas protegidas en el backend; las evaluaciones se califican en servidor.
- **Experiencia adaptativa:** Controles táctiles optimizados (>44px), cronómetro sincronizado con el servidor, alertas de tiempo y feedback orientador sin revelar respuestas.

### 2. Docente (Gestión y Cátedra)
- **Plantillas pedagógicas:** Creación manual o importación de contenidos JSON v2 estructurados con apoyo de IA externa.
- **Editores a medida:** 13 interfaces de edición especializadas con previsualización en vivo y demostraciones interactivas.
- **Modo Simulador:** Botón *Probar como alumno* para experimentar el examen en un entorno interactivo idéntico al del estudiante.
- **Salas en vivo:** Control de inicio/cierre en tiempo real, mezcla de preguntas, límites de cupo y tiempo.
- **Exportación formal:** Vales de examen en tamaño Carta para impresión (`@media print`) y descarga analítica en CSV/Excel con neutralización segura.

### 3. Administración (SaaS e Institucional)
- **Cero espionaje docente:** La dirección no accede a notas ni exámenes de alumnos, salvaguardando la autonomía pedagógica y la privacidad del aula.
- **Panel Maestro SaaS:** Supervisión de colegios clientes, cupos contratados y métricas de plataforma.
- **Panel Institucional del Colegio:** Control de licencias docentes, alta por credencial directa o invitación, pausas por suplencia médica y reactivaciones.
- **Auditoría forense inmutable:** Registro estricto de eventos de seguridad (`audit_events`) protegido contra alteraciones o borrado a nivel de base de datos.

---

## 🛠️ Stack Tecnológico

- **Frontend:** React 19, TypeScript 6, Vite 8.
- **Pruebas Automatizadas:** Vitest 5 (40 suites, 280 pruebas unitarias y de integración).
- **Estilos:** CSS nativo con arquitectura de tokens, variables semánticas y soporte fluido para **Modo Día** y **Modo Noche**.
- **PWA:** Service Worker con estrategia network-first para navegación, manifest interactivo e instalación en Android / Escritorio.
- **Backend:** Supabase (PostgreSQL 15+, Row Level Security - RLS, Realtime, Edge Functions seguras y función RPC transaccional atómica `submit_student_attempt_atomic`).
- **Respaldo Offline:** Cola de sincronización local idempotente en `localStorage` con reintento automático.

---

## 📋 Documentación de Referencia

En la carpeta [`docs/`](docs/) se encuentran las especificaciones activas del sistema:
- [`IMPORTACION_JSON.md`](docs/IMPORTACION_JSON.md): Guía del formato de intercambio `edueval.content` v2.
- [`SKILL_IMPORTACION_EDUEVAL_V1.md`](docs/SKILL_IMPORTACION_EDUEVAL_V1.md): Prompt oficial para asistentes de IA externos.
- [`MATRIZ_ACTIVIDADES_V12.md`](docs/MATRIZ_ACTIVIDADES_V12.md): Requisitos mínimos de datos por actividad.
- [`PUBLICACION_PWA.md`](docs/PUBLICACION_PWA.md): Guía de despliegue en producción y configuración PWA.
- [`DIAGNOSTICO_FINAL_ACTIVIDADES_V12.md`](docs/DIAGNOSTICO_FINAL_ACTIVIDADES_V12.md): Registro de pruebas de validación con salas y estudiantes.
