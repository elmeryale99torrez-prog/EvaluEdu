---
id: emergencia-sala-capacidad-maxima
tipo: emergencia
titulo: "La sala alcanzó su capacidad máxima de estudiantes (403)"
vistas: [rooms, play]
actividad: null
sinonimos:
  - "sala llena"
  - "capacidad maxima"
  - "cupo lleno"
  - "limite de estudiantes alcanzado"
  - "no pueden entrar mas alumnos"
sintomas:
  - "La sala alcanzó su capacidad máxima de estudiantes."
preguntas_ejemplo:
  - "A los últimos alumnos les sale que la sala alcanzó su capacidad máxima"
  - "¿Puedo aumentar el límite de estudiantes si la sala ya empezó?"
acciones:
  - label: "Ir a Salas"
    target: "view:rooms"
---

# La sala alcanzó su capacidad máxima de estudiantes (403)

## Respuesta rápida
Se alcanzó el número configurado en **`Estudiantes máx.`** (por defecto 30). Como una sala ya iniciada no puede editarse, la solución inmediata para los estudiantes faltantes es abrir una **sala gemela rápida** (ej. *Grupo B*) con las mismas actividades.

## Paso a paso para resolverlo en clase
1. Verifica si algún alumno que no puede entrar **ya había ingresado antes desde el mismo navegador**: si solo recargó la página, su reconexión con token válido **no consume un cupo nuevo**.
2. Si faltan estudiantes nuevos por ingresar:
   - Ve a **Salas → `＋ Nueva sala`** (elige la misma plantilla) o **`⚙ Ajustes del examen`**.
   - Define un **`Estudiantes máx.`** suficiente (hasta **200**) y nómbrala ej. `Evaluación · Grupo 2`.
   - Pulsa **`Abrir sala`** y luego **`▶ Iniciar evaluación`** y comparte el nuevo código solo con los estudiantes faltantes.

## Prevención para próximas clases
- Configura siempre **`Estudiantes máx.`** con un margen extra (+5 o +10 lugares sobre la lista real) por si algún estudiante cambia de dispositivo.

## Relacionado
- [[MOC_Emergencias_Aula]] · [[Crear_y_Configurar_Sala]] · [[Emergencia_No_Puedo_Editar_Sala_O_Actividad_Atenuada]]
