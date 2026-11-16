import type { Activity } from '../../../src/lib/activityEngine'

export interface ActivityTestCase {
  activity: Activity
  validResponse: any
  incorrectResponse: any
  omittedResponse: any
  manipulatedResponse: any
  edgeCaseResponses?: Array<{
    label: string
    response: any
    expectedCorrectClient: boolean
    expectedCorrectBackendObjective: boolean
  }>
}

export const activitiesFixtures: Record<string, ActivityTestCase> = {
  trueFalse: {
    activity: {
      id: 'act-tf-01',
      title: 'Fotosíntesis y Clorofila',
      type: 'trueFalse',
      topic: 'Biología Celular',
      difficulty: 'easy',
      prompt: '¿La clorofila es el principal pigmento fotosintético en las plantas verdes?',
      options: ['Verdadero', 'Falso'],
      feedback: 'La clorofila a y b absorben luz en las longitudes de onda azul y roja.',
      details: {
        trueFalse: {
          statement: 'La clorofila es el principal pigmento fotosintético en las plantas verdes.',
          correct: true,
          explanation: 'La clorofila absorbe fotones en los tilacoides para desencadenar la fase luminosa.',
          hint: 'Recuerda el pigmento verde que se ubica en los cloroplastos.',
          context: 'Fisiología vegetal y energética molecular.',
        },
      },
    },
    validResponse: { type: 'trueFalse', value: 'Verdadero' },
    incorrectResponse: { type: 'trueFalse', value: 'Falso' },
    omittedResponse: { type: 'trueFalse', value: '' },
    manipulatedResponse: { type: 'trueFalse', value: 'injected_hack_payload' },
  },

  singleChoice: {
    activity: {
      id: 'act-sc-01',
      title: 'Organelo de Respiración',
      type: 'singleChoice',
      topic: 'Biología Celular',
      difficulty: 'medium',
      prompt: '¿Cuál de los siguientes organelos es responsable de la producción de ATP mediante fosforilación oxidativa?',
      options: ['Ribosoma', 'Mitocondria', 'Lisosoma', 'Aparato de Golgi'],
      feedback: 'La mitocondria genera la mayor parte del ATP celular.',
      details: {
        singleChoice: {
          options: [
            { id: 'opt-rib', label: 'Ribosoma', correct: false },
            { id: 'opt-mit', label: 'Mitocondria', correct: true },
            { id: 'opt-lis', label: 'Lisosoma', correct: false },
            { id: 'opt-gol', label: 'Aparato de Golgi', correct: false },
          ],
          hint: 'Es la central energética de la célula eucariota.',
          explanation: 'La cadena de transporte de electrones opera en la membrana interna mitocondrial.',
        },
      },
    },
    validResponse: { type: 'singleChoice', value: 'opt-mit' },
    incorrectResponse: { type: 'singleChoice', value: 'opt-rib' },
    omittedResponse: { type: 'singleChoice', value: '' },
    manipulatedResponse: { type: 'singleChoice', value: 'opt-fake-999' },
  },

  matching: {
    activity: {
      id: 'act-mat-01',
      title: 'Emparejamiento de Macromoléculas',
      type: 'matching',
      topic: 'Bioquímica',
      difficulty: 'medium',
      prompt: 'Relaciona cada macromolécula con su monómero constituyente:',
      options: ['Proteínas → Aminoácidos', 'Polisacáridos → Monosacáridos', 'Ácidos Nucleicos → Nucleótidos'],
      feedback: 'Los monómeros se unen por enlaces covalentes específicos.',
      details: {
        matching: {
          pairs: [
            { id: 'pair-1', left: 'Proteínas', right: 'Aminoácidos' },
            { id: 'pair-2', left: 'Polisacáridos', right: 'Monosacáridos' },
            { id: 'pair-3', left: 'Ácidos Nucleicos', right: 'Nucleótidos' },
          ],
          hint: 'Considera los enlaces peptídicos, glucosídicos y fosfodiéster.',
        },
      },
    },
    validResponse: {
      type: 'matching',
      pairs: {
        Proteínas: 'Aminoácidos',
        Polisacáridos: 'Monosacáridos',
        'Ácidos Nucleicos': 'Nucleótidos',
      },
    },
    incorrectResponse: {
      type: 'matching',
      pairs: {
        Proteínas: 'Monosacáridos',
        Polisacáridos: 'Aminoácidos',
        'Ácidos Nucleicos': 'Nucleótidos',
      },
    },
    omittedResponse: { type: 'matching', pairs: {} },
    manipulatedResponse: {
      type: 'matching',
      pairs: { 'Inyección Extra': 'Valor Falso', Proteínas: 'Aminoácidos' },
    },
  },

  sorting: {
    activity: {
      id: 'act-srt-01',
      title: 'Clasificación Celular',
      type: 'sorting',
      topic: 'Citología',
      difficulty: 'medium',
      prompt: 'Clasifica las siguientes estructuras según pertenezcan exclusivamente a células procariotas, eucariotas o ambas:',
      options: ['Nucleoide', 'Mitocondria', 'Ribosoma 70S', 'Aparato de Golgi'],
      feedback: 'Las procariotas carecen de organelos membranosos.',
      details: {
        sorting: {
          categories: ['Procariota', 'Eucariota'],
          items: [
            { id: 'it-1', label: 'Nucleoide', category: 'Procariota' },
            { id: 'it-2', label: 'Mitocondria', category: 'Eucariota' },
            { id: 'it-3', label: 'Ribosoma 70S', category: 'Procariota' },
            { id: 'it-4', label: 'Aparato de Golgi', category: 'Eucariota' },
          ],
          hint: 'Recuerda qué dominio celular posee endomembranas.',
        },
      },
    },
    validResponse: {
      type: 'sorting',
      assignments: {
        'it-1': 'Procariota',
        'it-2': 'Eucariota',
        'it-3': 'Procariota',
        'it-4': 'Eucariota',
      },
    },
    incorrectResponse: {
      type: 'sorting',
      assignments: {
        'it-1': 'Eucariota',
        'it-2': 'Procariota',
        'it-3': 'Procariota',
        'it-4': 'Eucariota',
      },
    },
    omittedResponse: { type: 'sorting', assignments: {} },
    manipulatedResponse: {
      type: 'sorting',
      assignments: { 'it-1': 'Categoría Inexistente' },
    },
  },

  ordering: {
    activity: {
      id: 'act-ord-01',
      title: 'Fases del Ciclo de División Mitótica',
      type: 'ordering',
      topic: 'Genética y Citología',
      difficulty: 'medium',
      prompt: 'Ordena cronológicamente las cuatro fases canónicas de la mitosis:',
      options: ['Profase', 'Metafase', 'Anafase', 'Telofase'],
      feedback: 'Comienza con la condensación cromatínica y culmina con la reconstitución nuclear.',
      details: {
        ordering: {
          steps: ['Profase', 'Metafase', 'Anafase', 'Telofase'],
          hint: 'PMAT es la regla nemotécnica tradicional.',
        },
      },
    },
    validResponse: {
      type: 'ordering',
      order: ['Profase', 'Metafase', 'Anafase', 'Telofase'],
    },
    incorrectResponse: {
      type: 'ordering',
      order: ['Telofase', 'Anafase', 'Metafase', 'Profase'],
    },
    omittedResponse: { type: 'ordering', order: [] },
    manipulatedResponse: {
      type: 'ordering',
      order: ['Profase', 'Metafase', 'Paso Inventado', 'Telofase'],
    },
  },

  scenario: {
    activity: {
      id: 'act-scn-01',
      title: 'Brote Infeccioso Hospitalario',
      type: 'scenario',
      topic: 'Microbiología Clínica',
      difficulty: 'hard',
      prompt: 'Analiza el caso y selecciona la medida clínica protocolar adecuada en cada etapa.',
      options: [],
      feedback: 'El aislamiento de contacto temprano previene la transmisión nosocomial.',
      details: {
        scenario: {
          situation: 'Se detecta un paciente con diarrea intrahospitalaria severa post-antibioticoterapia prolongada.',
          stages: [
            {
              id: 'stg-1',
              title: 'Etapa 1: Aislamiento',
              prompt: '¿Qué medida inmediata de contención microbiológica se debe ordenar?',
              options: [
                {
                  id: 'opt-s1-a',
                  text: 'Aislamiento de contacto estricto y lavado con agua y jabón',
                  consequence: 'Se previene la dispersión de esporas en el pabellón.',
                  feedback: 'Medida correcta recomendada por los CDC.',
                  recommended: true,
                },
                {
                  id: 'opt-s1-b',
                  text: 'Uso exclusivo de alcohol gel al salir de la habitación',
                  consequence: 'El alcohol gel no destruye eficazmente las endosporas de C. difficile.',
                  feedback: 'Riesgo alto de colonización nosocomial.',
                  recommended: false,
                },
              ],
            },
            {
              id: 'stg-2',
              title: 'Etapa 2: Confirmación Diagnóstica',
              prompt: '¿Qué prueba diagnóstica rápida inicial tiene mayor sensibilidad?',
              options: [
                {
                  id: 'opt-s2-a',
                  text: 'NAAT / PCR para toxina B de C. difficile',
                  consequence: 'Diagnóstico molecular de alta sensibilidad en menos de 2 horas.',
                  feedback: 'Permite instaurar tratamiento dirigido de inmediato.',
                  recommended: true,
                },
                {
                  id: 'opt-s2-b',
                  text: 'Coprocultivo bacteriano convencional de rutina',
                  consequence: 'Demora de 48 a 72 horas con baja sensibilidad inicial.',
                  feedback: 'Retrasa el tratamiento específico.',
                  recommended: false,
                },
              ],
            },
          ],
          hint: 'Considera que ciertas bacterias forman endosporas resistentes al alcohol.',
        },
      },
    },
    validResponse: {
      type: 'scenario',
      choices: {
        'stg-1': 'opt-s1-a',
        'stg-2': 'opt-s2-a',
      },
    },
    incorrectResponse: {
      type: 'scenario',
      choices: {
        'stg-1': 'opt-s1-b',
        'stg-2': 'opt-s2-a',
      },
    },
    omittedResponse: { type: 'scenario', choices: {} },
    manipulatedResponse: {
      type: 'scenario',
      choices: { 'stg-1': 'opcion-no-existente' },
    },
  },

  multiSelect: {
    activity: {
      id: 'act-ms-01',
      title: 'Bases Nitrogenadas Púricas',
      type: 'multiSelect',
      topic: 'Biología Molecular',
      difficulty: 'medium',
      prompt: 'Selecciona todas las bases nitrogenadas que poseen estructura de doble anillo purínico:',
      options: ['Adenina', 'Guanina', 'Citosina', 'Timina'],
      feedback: 'La adenina y la guanina son purinas; citosina y timina son pirimidinas.',
      details: {
        multiSelect: {
          options: [
            { id: 'ms-ade', label: 'Adenina', correct: true },
            { id: 'ms-gua', label: 'Guanina', correct: true },
            { id: 'ms-cit', label: 'Citosina', correct: false },
            { id: 'ms-tim', label: 'Timina', correct: false },
          ],
          hint: 'Recuerda: Pur As Gold (Purinas = Adenina y Guanina).',
        },
      },
    },
    validResponse: { type: 'multiSelect', values: ['ms-ade', 'ms-gua'] },
    incorrectResponse: { type: 'multiSelect', values: ['ms-ade', 'ms-cit'] },
    omittedResponse: { type: 'multiSelect', values: [] },
    manipulatedResponse: { type: 'multiSelect', values: ['ms-ade', 'ms-ade', 'ms-fake'] },
  },

  fillBlanks: {
    activity: {
      id: 'act-fb-01',
      title: 'Transporte Activo Transmembrana',
      type: 'fillBlanks',
      topic: 'Fisiología Celular',
      difficulty: 'hard',
      prompt: 'Completa el enunciado sobre la bomba sodio-potasio:',
      options: ['sodio', 'potasio', 'ATP', 'glucosa'],
      feedback: 'La bomba Na+/K+ ATPasa bombea 3 iones sodio y 2 iones potasio.',
      details: {
        fillBlanks: {
          textWithBlanks: 'La bomba expulsa 3 iones {{1}} e ingresa 2 iones {{2}} hidrolizando una molécula de {{3}}.',
          blanks: [
            { id: 'b1', answer: 'sodio' },
            { id: 'b2', answer: 'potasio' },
            { id: 'b3', answer: 'ATP' },
          ],
          distractors: ['glucosa', 'calcio'],
          bank: ['sodio', 'potasio', 'ATP', 'glucosa', 'calcio'],
          hint: 'Identifica los cationes y la moneda energética celular.',
        },
      },
    },
    validResponse: {
      type: 'fillBlanks',
      answers: { b1: 'sodio', b2: 'potasio', b3: 'ATP' },
    },
    incorrectResponse: {
      type: 'fillBlanks',
      answers: { b1: 'potasio', b2: 'sodio', b3: 'ATP' },
    },
    omittedResponse: { type: 'fillBlanks', answers: {} },
    manipulatedResponse: {
      type: 'fillBlanks',
      answers: { b1: 'sustancia_ajena' },
    },
    edgeCaseResponses: [
      {
        label: 'fillBlanks con slots con la misma palabra repetida (Defecto UNI-P1-05)',
        response: {
          type: 'fillBlanks',
          answers: { b1: 'positivo', b2: 'positivo' },
        },
        expectedCorrectClient: false, // para este fixture es false porque b1 es sodio, pero prueba el parser
        expectedCorrectBackendObjective: false,
      },
    ],
  },

  spotError: {
    activity: {
      id: 'act-se-01',
      title: 'Termodinámica Biológica',
      type: 'spotError',
      topic: 'Biofísica',
      difficulty: 'medium',
      prompt: 'Identifica el fragmento que contiene una afirmación termodinámicamente errónea:',
      options: [
        'La primera ley establece que la energía no se crea ni se destruye.',
        'La entropía de un sistema aislado tiende a disminuir espontáneamente con el tiempo.',
        'Las reacciones exergónicas liberan energía libre de Gibbs.',
      ],
      feedback: 'La segunda ley establece que la entropía del universo siempre aumenta en procesos espontáneos.',
      details: {
        spotError: {
          segments: [
            { id: 'seg-1', text: 'La primera ley establece que la energía no se crea ni se destruye.', hasError: false },
            { id: 'seg-2', text: 'La entropía de un sistema aislado tiende a disminuir espontáneamente con el tiempo.', hasError: true },
            { id: 'seg-3', text: 'Las reacciones exergónicas liberan energía libre de Gibbs.', hasError: false },
          ],
          correction: 'La entropía tiende a aumentar en sistemas espontáneos.',
          hint: 'Revisa el enunciado de la segunda ley de la termodinámica.',
        },
      },
    },
    validResponse: { type: 'spotError', value: 'seg-2' },
    incorrectResponse: { type: 'spotError', value: 'seg-1' },
    omittedResponse: { type: 'spotError', value: '' },
    manipulatedResponse: { type: 'spotError', value: 'seg-hack-999' },
  },

  markWords: {
    activity: {
      id: 'act-mw-01',
      title: 'Factores de Transcripción',
      type: 'markWords',
      topic: 'Genética Molecular',
      difficulty: 'medium',
      prompt: 'Marca en el siguiente texto únicamente las enzimas responsables de la síntesis de ARN:',
      options: ['ARN polimerasa II', 'ADN helicasa', 'ARN polimerasa I'],
      feedback: 'Las ARN polimerasas sintetizan ARN a partir de un molde de ADN.',
      details: {
        markWords: {
          text: 'Durante la transcripción eucariota actúan la [ARN polimerasa II*], la [ADN helicasa] desenrollando la doble hebra y la [ARN polimerasa I*] transcribiendo ARNr.',
          words: [
            { id: 'mw-1', text: 'ARN polimerasa II', correct: true },
            { id: 'mw-2', text: 'ADN helicasa', correct: false },
            { id: 'mw-3', text: 'ARN polimerasa I', correct: true },
          ],
          hint: 'Distingue entre polimerasas de ARN y enzimas de mantenimiento del ADN.',
        },
      },
    },
    validResponse: { type: 'markWords', values: ['mw-1', 'mw-3'] },
    incorrectResponse: { type: 'markWords', values: ['mw-1', 'mw-2'] },
    omittedResponse: { type: 'markWords', values: [] },
    manipulatedResponse: { type: 'markWords', values: ['mw-1', 'mw-fake'] },
  },

  gridCheck: {
    activity: {
      id: 'act-gc-01',
      title: 'Comparativa de Reinos Biológicos',
      type: 'gridCheck',
      topic: 'Taxonomía y Evolución',
      difficulty: 'hard',
      prompt: 'Marca en la matriz las características celulares presentes en cada taxón:',
      options: [],
      feedback: 'Las plantas y hongos poseen pared celular, pero con distinta composición química.',
      details: {
        gridCheck: {
          rows: [
            { id: 'r-pla', label: 'Plantae' },
            { id: 'r-ani', label: 'Animalia' },
            { id: 'r-fun', label: 'Fungi' },
          ],
          columns: [
            { id: 'c-par', label: 'Pared Celular' },
            { id: 'c-clo', label: 'Cloroplastos' },
          ],
          expectedCells: ['r-pla:c-par', 'r-pla:c-clo', 'r-fun:c-par'],
          hint: 'Recuerda que los hongos no fotosintetizan y los animales no tienen pared celular.',
        },
      },
    },
    validResponse: { type: 'gridCheck', values: ['r-pla:c-par', 'r-pla:c-clo', 'r-fun:c-par'] },
    incorrectResponse: { type: 'gridCheck', values: ['r-pla:c-par', 'r-ani:c-par'] },
    omittedResponse: { type: 'gridCheck', values: [] },
    manipulatedResponse: { type: 'gridCheck', values: ['r-invalido:c-invalido'] },
  },

  vennDiagram: {
    activity: {
      id: 'act-vn-01',
      title: 'Procariotas vs Eucariotas',
      type: 'vennDiagram',
      topic: 'Citología Comparada',
      difficulty: 'medium',
      prompt: 'Ubica cada característica en la región correspondiente del diagrama de Venn:',
      options: ['Membrana plasmática', 'Envoltura nuclear', 'ADN circular libre'],
      feedback: 'Ambas comparten membrana y ribosomas, pero difieren en la compartimentación.',
      details: {
        vennDiagram: {
          setA: 'Célula Procariota',
          setB: 'Célula Eucariota',
          intersectionLabel: 'Ambos',
          items: [
            { id: 'vn-1', label: 'ADN circular libre', zone: 'left' },
            { id: 'vn-2', label: 'Membrana plasmática', zone: 'both' },
            { id: 'vn-3', label: 'Envoltura nuclear', zone: 'right' },
          ],
          hint: 'Analiza qué estructuras son universales a toda célula viva.',
        },
      },
    },
    validResponse: {
      type: 'vennDiagram',
      assignments: {
        'vn-1': 'left',
        'vn-2': 'both',
        'vn-3': 'right',
      },
    },
    incorrectResponse: {
      type: 'vennDiagram',
      assignments: {
        'vn-1': 'both',
        'vn-2': 'left',
        'vn-3': 'right',
      },
    },
    omittedResponse: { type: 'vennDiagram', assignments: {} },
    manipulatedResponse: {
      type: 'vennDiagram',
      assignments: { 'vn-1': 'invalid_zone' as any },
    },
  },

  shortAnswer: {
    activity: {
      id: 'act-sa-01',
      title: 'Proceso Bioquímico de Fijación de Carbono',
      type: 'shortAnswer',
      topic: 'Fisiología Vegetal',
      difficulty: 'medium',
      prompt: '¿Cómo se denomina el proceso biológico mediante el cual los organismos autótrofos convierten dióxido de carbono y agua en glucosa utilizando energía lumínica?',
      options: [],
      feedback: 'La fotosíntesis es fundamental para el flujo energético en la biosfera.',
      details: {
        shortAnswer: {
          prompt: '¿Cómo se denomina el proceso biológico mediante el cual los organismos autótrofos convierten dióxido de carbono y agua en glucosa utilizando energía lumínica?',
          acceptedAnswers: ['fotosíntesis', 'la fotosíntesis', 'fotosintesis'],
          caseSensitive: false,
          ignoreAccents: true,
          placeholder: 'Escribe tu respuesta aquí...',
          hint: 'Palabra de origen griego que significa síntesis con luz.',
          explanation: 'La fotosíntesis ocurre en los cloroplastos de las células vegetales.',
        },
      },
    },
    validResponse: { type: 'shortAnswer', value: 'fotosíntesis' },
    incorrectResponse: { type: 'shortAnswer', value: 'respiración celular' },
    omittedResponse: { type: 'shortAnswer', value: '   ' },
    manipulatedResponse: { type: 'shortAnswer', value: 'a'.repeat(200) },
    edgeCaseResponses: [
      {
        label: 'Sin tilde cuando ignoreAccents es true ("fotosintesis")',
        response: { type: 'shortAnswer', value: 'fotosintesis' },
        expectedCorrectClient: true,
        expectedCorrectBackendObjective: true,
      },
      {
        label: 'Con mayúsculas mixtas cuando caseSensitive es false ("FoToSíNtEsIs")',
        response: { type: 'shortAnswer', value: 'FoToSíNtEsIs' },
        expectedCorrectClient: true,
        expectedCorrectBackendObjective: true,
      },
      {
        label: 'Con espacios redundantes al inicio, medio y final ("  fotosíntesis  ")',
        response: { type: 'shortAnswer', value: '  fotosíntesis  ' },
        expectedCorrectClient: true,
        expectedCorrectBackendObjective: true,
      },
      {
        label: 'Espacios en blanco puros clasificados como omitido ("     ")',
        response: { type: 'shortAnswer', value: '     ' },
        expectedCorrectClient: false,
        expectedCorrectBackendObjective: false,
      },
    ],
  },
}
