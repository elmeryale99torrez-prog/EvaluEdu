import { describe, expect, it } from 'vitest'
import {
  CONTENT_SCHEMA_ID,
  CONTENT_SCHEMA_VERSION_V1,
  CONTENT_SCHEMA_VERSION_V2,
  detectContentCompatibility,
  OFFICIAL_IMPORT_PROMPT,
  parseContentImport,
  validateContentDocument,
  type ContentImportDocumentV1,
} from './contentImport'

const validDocumentV1: ContentImportDocumentV1 = {
  schema: CONTENT_SCHEMA_ID,
  version: CONTENT_SCHEMA_VERSION_V1,
  content: {
    title: 'Cuidado del agua',
    subject: 'Ciencias naturales',
    description: 'Contenido sobre el uso responsable del agua.',
    objective: 'Explicar acciones para cuidar el agua.',
    competency: 'Analiza decisiones cotidianas y sus consecuencias.',
    difficulty: 'Inicial',
    concepts: [
      { name: 'Reutilización', definition: 'Volver a usar un recurso antes de desecharlo.', example: 'Usar un recipiente varias veces.' },
      { name: 'Consumo responsable', definition: 'Usar solo la cantidad necesaria de agua.', example: 'Cerrar el grifo al cepillarse.' },
    ],
    situations: [{ title: 'Grifo abierto', context: 'Un grifo queda abierto durante el recreo.', decision: 'Cerrar el grifo y avisar.', consequence: 'Se evita desperdiciar agua y se informa del problema.' }],
    processSteps: ['Observar el consumo', 'Identificar el desperdicio', 'Proponer una acción'],
    categories: ['Ahorro', 'Reutilización'],
  },
}

const validDocumentV2 = {
  schema: CONTENT_SCHEMA_ID,
  version: CONTENT_SCHEMA_VERSION_V2,
  topic: {
    title: 'Salud Ambiental, Agua y Nutrición',
    subject: 'Educación Ambiental',
    objective: 'Evaluar la comprensión de los conceptos y riesgos.',
    competency: 'Analiza problemas de salud ambiental y coordina prevención.',
    summary: 'La salud ambiental estudia el entorno y los riesgos sanitarios.',
  },
  activities: [
    {
      id: 'act-1',
      type: 'trueFalse',
      statement: 'La salud ambiental se limita a la limpieza personal.',
      correct: false,
      hint: 'Revisa los componentes de la higiene ambiental.',
    },
    {
      id: 'act-2',
      type: 'trueFalse',
      statement: 'El riesgo ambiental surge de peligro, exposición y vulnerabilidad.',
      correct: true,
      hint: 'Considera los tres componentes explicados.',
    },
    {
      id: 'act-3',
      type: 'singleChoice',
      prompt: '¿Cuál corresponde a una dimensión de la seguridad alimentaria?',
      options: [
        { id: 'opt-1', label: 'Estabilidad', correct: true },
        { id: 'opt-2', label: 'Radiación', correct: false },
        { id: 'opt-3', label: 'Urbanización', correct: false },
      ],
      hint: 'Recuerda las cuatro dimensiones.',
    },
    {
      id: 'act-4',
      type: 'matching',
      prompt: 'Relaciona cada concepto con su definición.',
      pairs: [
        { id: 'p-1', left: 'Peligro', right: 'Capacidad de causar daño.' },
        { id: 'p-2', left: 'Exposición', right: 'Contacto con el agente.' },
      ],
      hint: 'Diferencia peligro de exposición.',
    },
    {
      id: 'act-5',
      type: 'sorting',
      prompt: 'Clasifica según factor biótico o abiótico.',
      categories: ['Factor biótico', 'Factor abiótico'],
      items: [
        { id: 'it-1', label: 'Microorganismos', category: 'Factor biótico' },
        { id: 'it-2', label: 'Agua', category: 'Factor abiótico' },
      ],
      hint: 'Los bióticos son organismos vivos.',
    },
    {
      id: 'act-6',
      type: 'ordering',
      prompt: 'Ordena la secuencia de evaluación de riesgo.',
      steps: ['Identificar peligro', 'Analizar exposición', 'Caracterizar riesgo'],
      hint: 'Sigue la secuencia metodológica.',
    },
    {
      id: 'act-7',
      type: 'scenario',
      situation: 'En una comunidad hay agua de calidad incierta y aumento de vectores.',
      stages: [
        {
          id: 'stg-1',
          title: 'Decisión',
          prompt: '¿Cuál es la respuesta más coherente?',
          options: [
            { id: 'sc-1', text: 'Coordinar evaluación integral y prevención.', consequence: 'Aborda la causa.', feedback: 'Correcto', recommended: true },
            { id: 'sc-2', text: 'Esperar que aumenten los casos.', consequence: 'Retrasa la ayuda.', feedback: 'Inadecuado', recommended: false },
          ],
        },
      ],
      hint: 'Considera el enfoque integral preventivo.',
    },
    {
      id: 'act-8',
      type: 'multiSelect',
      prompt: '¿Cuáles de los siguientes elementos forman parte de los determinantes de salud ambiental?',
      options: [
        { id: 'ms-1', label: 'Calidad del agua potable', correct: true },
        { id: 'ms-2', label: 'Control sanitario de vectores', correct: true },
        { id: 'ms-3', label: 'Propaganda comercial televisiva', correct: false },
      ],
      hint: 'Analiza los factores físicos y biológicos del entorno que inciden en la salud.',
    },
    {
      id: 'act-9',
      type: 'fillBlanks',
      prompt: 'Completa el enunciado sobre riesgo sanitario.',
      textWithBlanks: 'El riesgo ambiental depende de la amenaza o {{1}} y del nivel de {{2}} de la población.',
      blanks: [
        { id: 'fb-1', answer: 'peligro' },
        { id: 'fb-2', answer: 'vulnerabilidad' },
      ],
      distractors: ['urbanización', 'radiación'],
      hint: 'Recuerda qué factor representa al agente dañino y cuál la susceptibilidad de la comunidad.',
    },
  ],
}

describe('importación JSON de contenido (v1 y v2)', () => {
  describe('contrato v2 con banco de actividades', () => {
    it('valida con éxito un documento v2 completo y agrupa variantes por tipo', () => {
      const result = validateContentDocument(validDocumentV2)
      expect(result.ok).toBe(true)
      if (result.ok && result.version === 2) {
        expect(result.validActivities.length).toBe(9)
        expect(result.activitiesNeedingRepair.length).toBe(0)
        expect(result.variantsByType.trueFalse.valid.length).toBe(2)
        expect(result.variantsByType.singleChoice.valid.length).toBe(1)
        expect(result.variantsByType.multiSelect.valid.length).toBe(1)
        expect(result.variantsByType.fillBlanks.valid.length).toBe(1)
        expect(result.variantsByType.matching.valid.length).toBe(1)
        expect(result.variantsByType.sorting.valid.length).toBe(1)
        expect(result.variantsByType.ordering.valid.length).toBe(1)
        expect(result.variantsByType.scenario.valid.length).toBe(1)
        expect(result.compatibility.trueFalse.available).toBe(true)
        expect(result.compatibility.multiSelect.available).toBe(true)
        expect(result.compatibility.fillBlanks.available).toBe(true)
      }
    })

    it('aplica importación resiliente cuando una actividad tiene un error, permitiendo corregirla en el editor', () => {
      const docWithFlaw = {
        ...validDocumentV2,
        activities: [
          ...validDocumentV2.activities,
          {
            id: 'flawed-sc',
            type: 'singleChoice',
            prompt: 'Pregunta con dos respuestas correctas por error de la IA',
            options: [
              { id: 'f-1', label: 'Opción A', correct: true },
              { id: 'f-2', label: 'Opción B', correct: true }, // Error: dos correctas
              { id: 'f-3', label: 'Opción C', correct: false },
            ],
            hint: 'Pista válida',
          },
        ],
      }
      const result = validateContentDocument(docWithFlaw)
      expect(result.ok).toBe(true)
      if (result.ok && result.version === 2) {
        expect(result.validActivities.length).toBe(9)
        expect(result.activitiesNeedingRepair.length).toBe(1)
        const repaired = result.activitiesNeedingRepair[0]
        expect(repaired.type).toBe('singleChoice')
        expect(repaired.reason).toContain('exactamente 1 respuesta correcta')
        expect(repaired.reason).toContain('editor de actividades')
        expect(result.variantsByType.singleChoice.needsRepair.length).toBe(1)
      }
    })

    it('detecta error en clasificación cuando un ítem tiene una categoría no declarada', () => {
      const docWithSortingError = {
        ...validDocumentV2,
        activities: [
          {
            id: 'bad-sorting',
            type: 'sorting',
            prompt: 'Clasifica elementos',
            categories: ['Química', 'Física'],
            items: [
              { id: 'it-1', label: 'Átomo', category: 'Química' },
              { id: 'it-2', label: 'Célula', category: 'Biología' }, // Error: 'Biología' no está en categories
            ],
            hint: 'Revisa las categorías.',
          },
        ],
      }
      const result = validateContentDocument(docWithSortingError)
      expect(result.ok).toBe(true)
      if (result.ok && result.version === 2) {
        expect(result.validActivities.length).toBe(0)
        expect(result.activitiesNeedingRepair.length).toBe(1)
        expect(result.activitiesNeedingRepair[0].reason).toContain('Biología')
      }
    })

    it('importa correctamente actividades spotError válidas y marca para reparar si no hay exactamente 1 error', () => {
      const docWithSpotError = {
        ...validDocumentV2,
        activities: [
          {
            id: 'se-ok',
            type: 'spotError',
            prompt: 'Identifica el paso erróneo del protocolo:',
            segments: [
              { id: 's1', text: '1. Verificar las evidencias.', hasError: false },
              { id: 's2', text: '2. Ignorar el registro documental.', hasError: true },
              { id: 's3', text: '3. Comunicar los acuerdos.', hasError: false },
            ],
            correction: 'El registro documental es obligatorio.',
            hint: 'Analiza qué paso omite el respaldo documental.',
          },
          {
            id: 'se-bad',
            type: 'spotError',
            prompt: 'Identifica el error:',
            segments: [
              { id: 's1', text: '1. Paso A.', hasError: false },
              { id: 's2', text: '2. Paso B.', hasError: false },
              { id: 's3', text: '3. Paso C.', hasError: false },
            ],
            hint: 'Pista.',
          },
        ],
      }
      const result = validateContentDocument(docWithSpotError)
      expect(result.ok).toBe(true)
      if (result.ok && result.version === 2) {
        expect(result.validActivities).toHaveLength(1)
        expect(result.validActivities[0].type).toBe('spotError')
        expect(result.compatibility.spotError.available).toBe(true)
        expect(result.activitiesNeedingRepair).toHaveLength(1)
        expect(result.activitiesNeedingRepair[0].reason).toContain('exactamente 1 fragmento con error')
      }
    })

    it('importa correctamente actividades markWords válidas y marca para reparar si no cumple límites', () => {
      const docWithMarkWords = {
        ...validDocumentV2,
        activities: [
          {
            id: 'mw-ok',
            type: 'markWords',
            prompt: 'Resalta todas las fuentes renovables en el texto:',
            text: 'En el informe, la [energía eólica*] y la [solar*] destacan como alternativas limpias frente al [petróleo].',
            hint: 'Identifica las fuentes de generación limpia.',
          },
          {
            id: 'mw-bad',
            type: 'markWords',
            prompt: 'Resalta:',
            text: 'Texto sin corchetes suficientes ni distractores.',
            hint: 'Pista.',
          },
        ],
      }
      const result = validateContentDocument(docWithMarkWords)
      expect(result.ok).toBe(true)
      if (result.ok && result.version === 2) {
        expect(result.validActivities).toHaveLength(1)
        expect(result.validActivities[0].type).toBe('markWords')
        expect(result.compatibility.markWords.available).toBe(true)
        expect(result.activitiesNeedingRepair).toHaveLength(1)
        expect(result.activitiesNeedingRepair[0].reason).toContain('entre 3 y 10 términos interactivos')
      }
    })

    it('importa correctamente actividades gridCheck válidas y detecta errores de matriz', () => {
      const docWithGridCheck = {
        ...validDocumentV2,
        activities: [
          {
            id: 'gc-ok',
            type: 'gridCheck',
            prompt: 'Marca en la matriz las estructuras de cada célula:',
            rows: [
              { id: 'r1', label: 'Célula Vegetal' },
              { id: 'r2', label: 'Célula Animal' },
            ],
            columns: [
              { id: 'c1', label: 'Pared' },
              { id: 'c2', label: 'Núcleo' },
            ],
            expectedCells: ['r1:c1', 'r1:c2', 'r2:c2'],
            hint: 'Analiza la presencia de pared celular.',
          },
          {
            id: 'gc-bad',
            type: 'gridCheck',
            prompt: 'Matriz incompleta:',
            rows: [{ id: 'r1', label: 'Única fila' }],
            columns: [{ id: 'c1', label: 'Única columna' }],
            expectedCells: [],
            hint: 'Pista.',
          },
        ],
      }
      const result = validateContentDocument(docWithGridCheck)
      expect(result.ok).toBe(true)
      if (result.ok && result.version === 2) {
        expect(result.validActivities).toHaveLength(1)
        expect(result.validActivities[0].type).toBe('gridCheck')
        expect(result.compatibility.gridCheck.available).toBe(true)
        expect(result.activitiesNeedingRepair).toHaveLength(1)
        expect(result.activitiesNeedingRepair[0].reason).toContain('entre 2 y 6 filas')
      }
    })

    it('importa correctamente actividades shortAnswer válidas y marca para reparar si no tiene respuestas aceptadas', () => {
      const docWithShortAnswer = {
        ...validDocumentV2,
        activities: [
          {
            id: 'sa-ok',
            type: 'shortAnswer',
            prompt: '¿Quién formuló la teoría de la relatividad general?',
            acceptedAnswers: ['Albert Einstein', 'Einstein'],
            hint: 'Científico de origen alemán.',
          },
          {
            id: 'sa-bad',
            type: 'shortAnswer',
            prompt: '¿Cuál es la capital de Bolivia?',
            acceptedAnswers: [],
            hint: 'Pista.',
          },
        ],
      }
      const result = validateContentDocument(docWithShortAnswer)
      expect(result.ok).toBe(true)
      if (result.ok && result.version === 2) {
        expect(result.validActivities).toHaveLength(1)
        expect(result.validActivities[0].type).toBe('shortAnswer')
        expect(result.compatibility.shortAnswer.available).toBe(true)
        expect(result.activitiesNeedingRepair).toHaveLength(1)
        expect(result.activitiesNeedingRepair[0].reason).toContain('al menos una respuesta válida')
      }
    })

    it('rechaza si falta el objeto topic en v2', () => {
      const docWithoutTopic = {
        schema: CONTENT_SCHEMA_ID,
        version: CONTENT_SCHEMA_VERSION_V2,
        activities: [],
      }
      const result = validateContentDocument(docWithoutTopic)
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.issues[0].path).toBe('topic')
      }
    })
  })

  describe('retrocompatibilidad v1 heredada', () => {
    it('acepta un documento v1 completo y detecta los seis formatos compatibles', () => {
      const result = validateContentDocument(validDocumentV1)
      expect(result.ok).toBe(true)
      if (result.ok && result.version === 1) {
        expect(Object.values(result.compatibility).every((item) => item.available)).toBe(true)
      }
    })

    it('asigna dificultad interna por defecto en v1 cuando no se envía en el JSON', () => {
      const { difficulty: _omitted, ...contentWithoutDifficulty } = validDocumentV1.content
      const result = validateContentDocument({ ...validDocumentV1, content: contentWithoutDifficulty })
      expect(result.ok).toBe(true)
      if (result.ok && result.version === 1) {
        expect(result.document.content.difficulty).toBe('Intermedio')
      }
    })

    it('calcula compatibilidad v1 a partir de contenido normalizado', () => {
      const compatibility = detectContentCompatibility(validDocumentV1.content)
      expect(compatibility.matching.available).toBe(true)
      expect(compatibility.ordering.available).toBe(true)
      expect(compatibility.sorting.available).toBe(true)
    })
  })

  describe('errores generales de sintaxis y esquema', () => {
    it('rechaza JSON inválido con un mensaje orientado al docente', () => {
      const result = parseContentImport('{ contenido roto')
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.issues[0].message).toContain('JSON válido')
    })

    it('rechaza una versión o identificador de esquema no admitidos', () => {
      const result = validateContentDocument({ schema: 'otro.formato', version: 99 })
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.issues.map((issue) => issue.path)).toEqual(expect.arrayContaining(['schema']))
      }
    })
  })

  describe('prompt oficial v1.2', () => {
    it('valida e importa correctamente la actividad vennDiagram en v2', () => {
      const doc = {
        schema: CONTENT_SCHEMA_ID,
        version: CONTENT_SCHEMA_VERSION_V2,
        topic: {
          title: 'Biología Celular',
          subject: 'Ciencias',
          objective: 'Contrastar tipos celulares.',
          competency: 'Identifica estructuras exclusivas y comunes.',
          summary: 'Estudio de células eucariotas y procariotas.',
        },
        activities: [
          {
            id: 'v-1',
            type: 'vennDiagram',
            prompt: 'Clasifica los siguientes elementos en el diagrama de Venn:',
            setA: 'Célula Eucariota',
            setB: 'Célula Procariota',
            intersectionLabel: 'Ambos / Compartido',
            items: [
              { id: 'i1', label: 'Núcleo delimitado por membrana', zone: 'left' },
              { id: 'i2', label: 'Ribosomas', zone: 'both' },
              { id: 'i3', label: 'Nucloide sin membrana', zone: 'right' },
            ],
            hint: 'Recuerda qué organelo no membranoso sintetiza proteínas en ambos tipos celulares.',
            explanation: 'El núcleo es eucariota, el nucleoide procariota y los ribosomas están en ambos.',
          },
        ],
      }

      const res = validateContentDocument(doc)
      expect(res.ok).toBe(true)
      if (res.ok && res.version === 2) {
        expect(res.validActivities).toHaveLength(1)
        expect(res.validActivities[0].type).toBe('vennDiagram')
        expect(res.variantsByType.vennDiagram.valid).toHaveLength(1)
        expect(res.compatibility.vennDiagram.available).toBe(true)
      }
    })

    it('envía a reparación si la actividad vennDiagram no tiene elementos en la intersección', () => {
      const doc = {
        schema: CONTENT_SCHEMA_ID,
        version: CONTENT_SCHEMA_VERSION_V2,
        topic: {
          title: 'Biología',
          subject: 'Ciencias',
          objective: 'Obj',
          competency: 'Comp',
          summary: 'Summ',
        },
        activities: [
          {
            id: 'v-bad',
            type: 'vennDiagram',
            setA: 'Conjunto A',
            setB: 'Conjunto B',
            items: [
              { id: 'i1', label: 'Elemento 1', zone: 'left' },
              { id: 'i2', label: 'Elemento 2', zone: 'left' },
              { id: 'i3', label: 'Elemento 3', zone: 'right' },
            ],
            hint: 'Pista',
          },
        ],
      }

      const res = validateContentDocument(doc)
      expect(res.ok).toBe(true)
      if (res.ok && res.version === 2) {
        expect(res.validActivities).toHaveLength(0)
        expect(res.activitiesNeedingRepair).toHaveLength(1)
        expect(res.activitiesNeedingRepair[0].reason).toContain('intersección')
      }
    })

    it('contiene las directivas universitarias, de variantes y los 6 contratos', () => {
      expect(OFFICIAL_IMPORT_PROMPT).toContain('especialista en evaluación y pedagogía universitaria')
      expect(OFFICIAL_IMPORT_PROMPT).toContain('BANCO DE VARIANTES (OBJETIVO PRIORITARIO: 2 A 4 POR TIPO)')
      expect(OFFICIAL_IMPORT_PROMPT).toContain('CONFINAMIENTO DOCUMENTAL Y CERO INVENCIÓN')
      expect(OFFICIAL_IMPORT_PROMPT).toContain('"schema": "edueval.content"')
      expect(OFFICIAL_IMPORT_PROMPT).toContain('"version": 2')
      expect(OFFICIAL_IMPORT_PROMPT).not.toContain('"difficulty"')
    })
  })
})
