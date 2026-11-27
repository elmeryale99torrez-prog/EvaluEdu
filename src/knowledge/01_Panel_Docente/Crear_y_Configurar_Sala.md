---
id: docente-crear-configurar-sala
tipo: guia
titulo: "Crear y Configurar una Sala de Evaluación"
vistas: [rooms]
actividad: null
sinonimos:
  - "crear sala"
  - "nueva sala"
  - "ajustes del examen"
  - "configurar sala"
  - "cuantos formatos puedo mezclar"
  - "tiempo de sala"
  - "puntaje por pregunta"
  - "mezclar orden"
  - "volver atras"
  - "limite de estudiantes"
sintomas:
  - "Prepara tu sala"
  - "Combina libremente de 1 a 6 formatos"
  - "No hay actividades publicadas"
  - "Ajustes del examen"
preguntas_ejemplo:
  - "¿Cómo creo una nueva sala para mis estudiantes?"
  - "¿Cuántos tipos de actividades puedo combinar en una misma sala?"
  - "¿Cómo configuro el tiempo límite, el puntaje y el cupo de estudiantes?"
acciones:
  - label: "Ir a Salas"
    target: "view:rooms"
  - label: "Ir a Contenido"
    target: "view:content"
---

# Crear y Configurar una Sala de Evaluación

## Respuesta rápida
En **Salas** puedes crear una evaluación desde **`＋ Nueva sala`** (eligiendo primero tu plantilla) o directo desde **`⚙ Ajustes del examen`**. Puedes combinar libremente **de 1 a 6 formatos** distintos y definir cupo, puntaje, tiempo opcional, mezcla y navegación.

## Paso a paso
1. Ve a **Salas** y elige una opción:
   - **`＋ Nueva sala`**: abre el selector de contenido para elegir una plantilla y precargar sus actividades publicadas.
   - **`⚙ Ajustes del examen`**: abre directamente el configurador técnico con todo tu banco publicado.
2. Configura los parámetros generales:
   - **Nombre de la evaluación \*** y **Instrucciones para el grupo**.
   - **Estudiantes máx.**: de `1` a `200` (por defecto `30`).
   - **Puntos por pregunta**: de `0` a `1000` (por defecto `10`). El sistema calcula automáticamente el puntaje total (`preguntas × puntos`).
   - **Tiempo total**: `Sin límite de tiempo`, o `5`, `10`, `15`, `20`, `30`, `45` o `60 minutos`.
   - **Mezclar orden**: baraja el orden de las preguntas para cada estudiante con aleatoriedad criptográfica.
   - **Volver atrás**: permite o bloquea regresar a preguntas anteriores en el Stepper del alumno.
3. Marca las actividades en **BANCO DE PREGUNTAS** (cada actividad marcada es 1 pregunta real; el botón `Destacadas` selecciona rápido las primeras 4 publicadas).
4. Pulsa **`Crear sala (N preguntas)`**. Se generará un código único (ej. `EDU-590`) y la sala quedará en estado **`Lista para iniciar`**.

## Regla importante
- Solo aparecen actividades en estado **Publicada**. Si ves *"No hay actividades publicadas"*, aprueba primero tus propuestas o acepta una plantilla en **Contenido**.
- Una vez iniciada la sala (`En curso`), su configuración y preguntas quedan bloqueadas para garantizar equidad.

## Relacionado
- [[MOC_Panel_Docente]] · [[Ciclo_Estados_Sala]] · [[Examen_en_Blanco_PDF]] · [[Propuestas_Variantes_y_Reparacion]] · [[Emergencia_No_Puedo_Editar_Sala_O_Actividad_Atenuada]]
