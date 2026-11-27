---
id: emergencia-nombre-duplicado-intento
tipo: emergencia
titulo: "Nombre ya está participando o intento ya registrado (409)"
vistas: [rooms, play, results]
actividad: null
sinonimos:
  - "nombre duplicado"
  - "nombre ya esta participando"
  - "ya tienes un intento registrado"
  - "otro alumno puso su nombre"
  - "error 409"
  - "un solo intento"
sintomas:
  - "Ese nombre ya está participando en la sala."
  - "Ya tienes un intento registrado para esta sala."
  - "Usa una variante o recupera tu sesión con tu credencial original."
preguntas_ejemplo:
  - "A un estudiante le dice 'Ese nombre ya está participando en la sala'"
  - "Un alumno dice 'Ya tienes un intento registrado para esta sala', ¿qué hago?"
acciones:
  - label: "Ir a Resultados"
    target: "view:results"
  - label: "Ir a Salas"
    target: "view:rooms"
---

# Nombre ya está participando o intento ya registrado (409)

## Respuesta rápida
EvaluEdu protege contra suplantación y doble entrega garantizando **un solo intento por estudiante y sala**. La solución depende de cuál de los dos mensajes aparece:

## Caso 1 · `"Ese nombre ya está participando en la sala."`
1. **Si hay dos alumnos con el mismo nombre** (ej. dos "Juan Pérez") o alguien escribió mal el nombre: pide al estudiante que agregue su **segundo apellido o inicial** (ej. `Juan Pérez G.`).
2. **Si el mismo alumno cerró su navegador privado o cambió de celular** a mitad de la prueba (perdió su token de sesión local): para que pueda continuar, pídele que ingrese agregando una marca identificable (ej. `Ana López (2)`) y luego revisa o elimina el registro incompleto en **Resultados**.

## Caso 2 · `"Ya tienes un intento registrado para esta sala."`
- El servidor confirma que ese estudiante **ya entregó su evaluación completa**.
- Puedes verificarlo al instante en **Resultados → Ver resultados por estudiante**.
- Si fue un ensayo tuyo en modo prueba o un caso excepcional que autorizas repetir, ve a **Resultados** y elimina ese intento individual (ver [[Eliminar_Sala_Resultados_O_Intento]]).

## Relacionado
- [[MOC_Emergencias_Aula]] · [[Ingreso_Codigo_y_Modo_Prueba]] · [[Eliminar_Sala_Resultados_O_Intento]] · [[Emergencia_Alumno_Perdio_Conexion_O_Cerro_Pestana]]
