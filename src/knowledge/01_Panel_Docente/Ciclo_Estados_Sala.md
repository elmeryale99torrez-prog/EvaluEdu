---
id: docente-ciclo-estados-sala
tipo: guia
titulo: "Ciclo de Estados de una Sala y Cómo Iniciar"
vistas: [rooms, play]
actividad: null
sinonimos:
  - "estados de sala"
  - "abrir sala"
  - "iniciar evaluacion"
  - "finalizar evaluacion"
  - "copiar codigo"
  - "lista para iniciar"
  - "en espera"
  - "en curso"
  - "finalizada"
  - "archivada"
sintomas:
  - "Lista para iniciar"
  - "Abrir sala"
  - "Iniciar evaluación"
  - "Finalizar evaluación"
  - "Evaluación finalizada"
preguntas_ejemplo:
  - "¿Qué botón debo presionar para que mis estudiantes puedan entrar y empezar?"
  - "¿Cuál es la diferencia entre Abrir sala e Iniciar evaluación?"
  - "¿Qué pasa cuando pulso Finalizar evaluación?"
acciones:
  - label: "Ir a Salas"
    target: "view:rooms"
---

# Ciclo de Estados de una Sala y Cómo Iniciar

## Respuesta rápida
Una sala avanza en **4 pasos claros**: **`Lista para iniciar`** → pulsas **`Abrir sala`** (pasa a **`En espera`** para que los alumnos ingresen el código) → pulsas **`▶ Iniciar evaluación`** (pasa a **`En curso`** y arrancan todos a la vez) → pulsas **`Finalizar evaluación`** (cierra entregas).

## Significado de cada estado
1. **`Lista para iniciar` (`ready`):** la sala está creada pero todavía **cerrada** para estudiantes. Si un alumno ingresa el código en este estado verá *"Esta sala no está abierta actualmente"*.
   - **Acción:** pulsa **`Abrir sala`**.
2. **`En espera` (`waiting`):** la sala ya acepta ingresos. Comparte el **CÓDIGO DE ACCESO** con **`Copiar código`**. Los estudiantes ingresan y aguardan en su pantalla de espera sin ver aún las preguntas ni iniciar el cronómetro.
   - **Acción:** cuando tu grupo esté listo, pulsa **`▶ Iniciar evaluación`**.
3. **`En curso` (`active`):** la evaluación arranca automáticamente en los dispositivos de los estudiantes y comienza a correr el cronómetro oficial del servidor (si definiste tiempo límite). La sala queda **bloqueada** contra cambios.
   - **Acción:** cuando termine la clase o hayan entregado todos, pulsa **`Finalizar evaluación`**.
4. **`Finalizada` (`finished`) / `Archivada` (`archived`):** no se admiten más ingresos ni entregas; todos los resultados quedan disponibles en privado en **Resultados**.

## Consejo de aula
- Para evitar retrasos con el cronómetro, abre primero la sala (`En espera`), deja que todos entren con el código, y recién cuando la mayoría esté conectada pulsa **`▶ Iniciar evaluación`**.

## Relacionado
- [[MOC_Panel_Docente]] · [[Crear_y_Configurar_Sala]] · [[Sala_de_Espera_y_Sondeo]] · [[Emergencia_Alumno_En_Pantalla_Espera]] · [[Emergencia_Codigo_Invalido_O_Sala_Cerrada]]
