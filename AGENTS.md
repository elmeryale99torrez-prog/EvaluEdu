# Instrucciones de Trabajo para Desarrolladores y Agentes · EvaluEdu

Este documento define las reglas de ingeniería, arquitectura técnica y estándares operativos de **EvaluEdu**. Todo agente o desarrollador que intervenga en el código debe seguir estas directrices sin excepción.

---

## 1. Fuente de Verdad y Documentación

- **`AGENTS.md`**: Reglas operativas, estándares de código, seguridad y arquitectura.
- **`README.md`**: Especificación general, catálogo de actividades, arranque y comandos.
- **`BITACORA.md`**: Memoria técnica de decisiones arquitectónicas y estado del desarrollo.

---

## 2. Catálogo Oficial Definitivo (13 Actividades)

El catálogo de EvaluEdu está formalmente cerrado y consolidado en **13 actividades formativas**. No se admiten formatos redundantes o clones cosméticos:

1. `trueFalse` — Falso / Verdadero
2. `singleChoice` — Selección Única
3. `matching` — Asociación por Columnas
4. `sorting` — Clasificación por Categorías
5. `ordering` — Ordenamiento de Procesos
6. `scenario` — Escenario de Decisiones por Etapas
7. `multiSelect` — Selección de Opción Múltiple
8. `fillBlanks` — Completar Espacios con Fichas Táctiles
9. `spotError` — Identificación / Detección del Error
10. `markWords` — Marcar Palabras Clave en el Texto
11. `gridCheck` — Matriz de Doble Entrada
12. `vennDiagram` — Diagrama de Venn (Comparación, Contraste e Intersección)
13. `shortAnswer` — Respuesta Corta Conceptual (Evocación Activa Pura)

Cada actividad posee su propio contrato modular en `src/lib/activities/<tipo>.ts`, validación estricta, editor docente específico (`SpecificActivityEditor`), proyección pública antitrampas y componente interactivo para el estudiante (`PlayView`).

---

## 3. Arquitectura de Roles y Seguridad

### Estudiante (Acceso Rápido y Privacidad Absoluta)
- **Cero cuentas:** Los alumnos ingresan mediante código de sala y su nombre. No crean usuarios en Supabase.
- **Token seguro de sesión:** La Edge Function `student-room-guest` genera un token opaco efímero y guarda únicamente su hash (expira en 6 horas).
- **Evaluación del lado del servidor:** La proyección pública enviada al alumno (`to*Public`) elimina respuestas correctas, soluciones y explicaciones. El puntaje se recalcula exclusivamente en backend (`student-room-sync` o RPC).
- **Retroalimentación formativa:** El estudiante recibe pistas orientadoras (`hint`) sin revelar jamás la respuesta correcta de forma directa. No hay rankings públicos que promuevan la competencia desleal.

### Docente (Autonomía de Cátedra)
- Acceso autenticado mediante Supabase Auth y verificación de perfil (`role: 'teacher'`).
- Gestión de plantillas pedagógicas e importación de contenido JSON v2 (`edueval.content` v2).
- Editores específicos para las 13 actividades con modo simulador (*Probar como alumno*).
- Configuración de salas: código único, mezcla de preguntas, tiempo general y límites.
- Descarga de actas en tamaño Carta (`@media print`) y reportes analíticos en CSV/Excel.

### Administración (Modelo SaaS e Institucional)
- **Cero espionaje docente:** El rol administrador no tiene acceso a salas activas, respuestas ni calificaciones de alumnos. Se preserva la privacidad del aula y la autonomía de cátedra.
- **Doble ámbito operativo:**
  - *Superadministrador SaaS:* Métricas globales de instituciones clientes, cupos de licencias vendidas y disponibilidad.
  - *Panel Institucional (Director):* Control riguroso de cupos y licencias docentes, altas por credencial directa o invitación, pausas por suplencia y reactivaciones.
- **Auditoría inmutable:** La tabla PostgreSQL `audit_events` cuenta con un disparador estricto (`trg_prevent_audit_events_mutation`) que bloquea todo `UPDATE` o `DELETE`.

---

## 4. Tubería Pedagógica e Importación JSON

```text
Contenido docente → IA externa con prompt oficial → JSON `edueval.content` v2
→ Validación estricta local → Plantilla interna → Propuestas compatibles
→ Revisión y aprobación docente → Selección para sala de evaluación
```

- **IA externa desacoplada:** EvaluEdu no envía datos de los docentes a APIs externas. La IA externa es solo una herramienta del docente para estructurar su material en JSON.
- **Autoridad del validador local:** El validador en `src/lib/contentImport.ts` es la autoridad final y rechaza esquemas no conformes o datos inventados.

---

## 5. Estándares de Código y Verificación Técnica

- **TypeScript estricto:** Cero `any` injustificados; contratos fuertemente tipados.
- **Modo Día y Noche:** Todos los estilos en `src/index.css` y `src/theme.css` deben respetar las variables de tema (`var(--paper)`, `var(--ink)`, `var(--line)`). No usar colores hexadecimales fijos sobre fondos adaptativos.
- **Verificación obligatoria previa a cualquier entrega:**
  1. `npm run test`: Todas las suites de Vitest deben pasar (40/40 suites, 280/280 pruebas).
  2. `npm run build`: Compilación de tipos (`tsc -b`) y empaquetado de producción con Vite (`vite build`) limpios sin errores.
