---
id: estudiante-ingreso-codigo
tipo: guia
titulo: "Ingreso del Estudiante por Código y Modo de Prueba Docente"
vistas: [play, rooms]
actividad: null
sinonimos:
  - "como entra el estudiante"
  - "ingresar codigo de sala"
  - "estudiante necesita cuenta"
  - "entrar a la sala"
  - "modo de prueba para docentes"
  - "nombre completo estudiante"
sintomas:
  - "ENTRADA DE ESTUDIANTES"
  - "Entrar a la sala"
  - "Modo de prueba para docentes"
  - "El código de sala es obligatorio"
  - "Escribe tu nombre para ingresar"
preguntas_ejemplo:
  - "¿Los estudiantes necesitan crear una cuenta o correo para entrar?"
  - "¿Cómo le indico a mis alumnos cómo entrar a la sala?"
  - "¿Qué es el aviso de Modo de prueba para docentes?"
acciones:
  - label: "Probar como Estudiante"
    target: "role:student"
  - label: "Ir a Salas"
    target: "view:rooms"
---

# Ingreso del Estudiante por Código y Modo de Prueba Docente

## Respuesta rápida
El estudiante **no necesita cuenta, correo ni contraseña**. Solo abre EvaluEdu, elige **Estudiante**, escribe su **Nombre completo** y el **Código de sala** (ej. `EDU-590`) y pulsa **`Entrar a la sala →`**.

## Paso a paso para guiar a tu clase
1. Asegúrate de que tu sala esté al menos en estado **`En espera`** (o **`En curso`**) y comparte el código (ver [[Ciclo_Estados_Sala]]).
2. En el celular o computadora del alumno, pídele que seleccione **Estudiante**.
3. Debe completar:
   - **Nombre completo** (conviene pedir *Nombre y Apellido* para evitar conflictos si dos alumnos se llaman igual).
   - **Código de sala** (se convierte automáticamente a mayúsculas).
4. Al pulsar **`Entrar a la sala →`**, el servidor (`student-room-guest`) genera una sesión efímera segura (válida por **6 horas**), sella su orden de preguntas y lo lleva a la sala de espera o directo al examen si ya iniciaste.

## Si entras tú desde `📱 Probar como Estudiante`
- Verás el recuadro **`Modo de prueba para docentes`** y el botón superior **`↩ Volver a Panel Docente`**.
- **Importante:** este asistente flotante solo es visible para ti como docente autenticado; tus estudiantes reales **nunca** lo ven.

## Relacionado
- [[MOC_Panel_Estudiante]] · [[Sala_de_Espera_y_Sondeo]] · [[Probar_Como_Estudiante_vs_Simulador]] · [[Emergencia_Codigo_Invalido_O_Sala_Cerrada]] · [[Emergencia_Nombre_Duplicado_O_Intento_Registrado]]
