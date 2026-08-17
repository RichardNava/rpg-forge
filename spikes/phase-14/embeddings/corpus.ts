export type CorpusLanguage = "en" | "es";

export interface RulePassage {
  readonly id: string;
  readonly conceptId: string;
  readonly language: CorpusLanguage;
  readonly kind: "rule" | "distractor";
  readonly text: string;
}

export interface RetrievalQuery {
  readonly id: string;
  readonly conceptId: string;
  readonly language: CorpusLanguage;
  readonly targetLanguage: CorpusLanguage;
  readonly text: string;
}

interface RulePair {
  readonly conceptId: string;
  readonly english: string;
  readonly spanish: string;
  readonly englishQuery: string;
  readonly spanishQuery: string;
  readonly englishQueryAlt?: string;
  readonly spanishQueryAlt?: string;
}

const rulePairs: readonly RulePair[] = [
  {
    conceptId: "armor-reduction",
    english:
      "Armor reduces physical damage received after a successful attack.",
    spanish:
      "La armadura reduce el daño físico recibido después de un ataque exitoso.",
    englishQuery: "How is physical damage reduced?",
    spanishQuery: "¿Cómo se reduce el daño físico?",
  },
  {
    conceptId: "initiative-order",
    english:
      "Initiative determines the order in which participants act during a scene.",
    spanish:
      "La iniciativa determina el orden en que actúan los participantes durante una escena.",
    englishQuery: "What decides who acts first?",
    spanishQuery: "¿Qué decide quién actúa primero?",
  },
  {
    conceptId: "magic-points",
    english:
      "Magic points are spent to cast spells and cannot drop below zero.",
    spanish:
      "Los puntos de magia se gastan para lanzar hechizos y no pueden bajar de cero.",
    englishQuery: "What resource is spent to cast a spell?",
    spanishQuery: "¿Qué recurso se gasta para lanzar un hechizo?",
  },
  {
    conceptId: "task-difficulty",
    english:
      "A task succeeds when its roll total is at least the listed difficulty.",
    spanish:
      "Una tarea tiene éxito cuando el total de la tirada alcanza al menos la dificultad indicada.",
    englishQuery: "How does a task roll succeed?",
    spanishQuery: "¿Cómo tiene éxito una tirada de tarea?",
  },
  {
    conceptId: "strength-carrying",
    english:
      "Strength sets the maximum weight a character can carry without a movement penalty.",
    spanish:
      "La Fuerza fija el peso máximo que un personaje puede cargar sin penalización de movimiento.",
    englishQuery: "Which attribute limits carried weight?",
    spanishQuery: "¿Qué atributo limita el peso cargado?",
  },
  {
    conceptId: "skill-bonus",
    english:
      "A relevant skill adds its listed bonus to an attribute-based task roll.",
    spanish:
      "Una habilidad relevante suma su bonificación indicada a una tirada basada en atributo.",
    englishQuery: "When does a skill add a bonus?",
    spanishQuery: "¿Cuándo añade bonificación una habilidad?",
  },
  {
    conceptId: "rest-recovery",
    english:
      "A full rest restores all magic points and half of maximum health.",
    spanish:
      "Un descanso completo recupera todos los puntos de magia y la mitad de la salud máxima.",
    englishQuery: "What does a full rest recover?",
    spanishQuery: "¿Qué recupera un descanso completo?",
  },
  {
    conceptId: "critical-hit",
    english:
      "A critical hit occurs on a natural result of 20 unless a table rule changes that range.",
    spanish:
      "Un golpe crítico ocurre con un resultado natural de 20 salvo que una regla de mesa cambie ese rango.",
    englishQuery: "When is a critical hit scored?",
    spanishQuery: "¿Cuándo se logra un golpe crítico?",
  },
  {
    conceptId: "health-zero",
    english:
      "A character at zero health cannot take strenuous actions until another participant helps.",
    spanish:
      "Un personaje con cero de salud no puede realizar acciones exigentes hasta recibir ayuda.",
    englishQuery: "What happens at zero health?",
    spanishQuery: "¿Qué ocurre con cero de salud?",
  },
  {
    conceptId: "equipment-record",
    english:
      "Each packed item records a name, quantity, and weight for inventory checks.",
    spanish:
      "Cada objeto guardado registra un nombre, cantidad y peso para las comprobaciones de inventario.",
    englishQuery: "What information does an inventory item record?",
    spanishQuery: "¿Qué información registra un objeto de inventario?",
  },
];

const hardConcepts: readonly RulePair[] = [
  // ── A. Near-duplicates ──
  {
    conceptId: "armor-physical",
    english:
      "Wearing armor reduces the amount of physical damage a character receives from attacks.",
    spanish:
      "Usar armadura reduce la cantidad de daño físico que un personaje recibe de los ataques.",
    englishQuery: "How does armor reduce incoming physical attacks?",
    spanishQuery: "¿Cómo reduce la armadura los ataques físicos recibidos?",
    englishQueryAlt: "What effect does wearing armor have on damage taken?",
  },
  {
    conceptId: "armor-spell",
    english:
      "Magical armor provides a bonus that reduces damage from spell effects.",
    spanish:
      "La armadura mágica proporciona una bonificación que reduce el daño de los efectos de hechizos.",
    englishQuery: "How does magical armor protect against spells?",
    spanishQuery: "¿Cómo protege la armadura mágica contra los hechizos?",
    englishQueryAlt: "What kind of damage does magical armor reduce?",
  },
  {
    conceptId: "shield-defense",
    english:
      "A shield increases a character's defense rating but does not directly reduce damage.",
    spanish:
      "Un escudo aumenta la calificación de defensa de un personaje pero no reduce el daño directamente.",
    englishQuery: "How does a shield affect combat defense?",
    spanishQuery: "¿Cómo afecta un escudo la defensa en combate?",
    englishQueryAlt: "Does a shield reduce the damage you take?",
  },
  // ── B. Negation ──
  {
    conceptId: "heavy-armor-stealth",
    english:
      "Heavy armor applies a disadvantage on stealth checks due to noise and restricted movement.",
    spanish:
      "La armadura pesada aplica una desventaja en las tiradas de sigilo por el ruido y la restricción de movimiento.",
    englishQuery: "Why does heavy armor penalize stealth?",
    spanishQuery: "¿Por qué la armadura pesada penaliza el sigilo?",
    englishQueryAlt: "What penalty does heavy armor impose on hiding?",
  },
  {
    conceptId: "light-armor-stealth",
    english:
      "Light armor does not apply any stealth penalty because it allows free movement.",
    spanish:
      "La armadura ligera no aplica ninguna penalización de sigilo porque permite el movimiento libre.",
    englishQuery: "Does light armor affect stealth checks?",
    spanishQuery: "¿La armadura ligera afecta las tiradas de sigilo?",
    englishQueryAlt: "Do you get a stealth penalty wearing light armor?",
  },
  // ── C. Exceptions ──
  {
    conceptId: "critical-hit-20",
    english:
      "A critical hit is scored when a weapon attack roll shows a natural 20 on the d20.",
    spanish:
      "Un golpe crítico se obtiene cuando una tirada de ataque con arma muestra un 20 natural en el d20.",
    englishQuery: "When does a critical hit happen?",
    spanishQuery: "¿Cuándo ocurre un golpe crítico?",
    englishQueryAlt: "What roll triggers a critical hit?",
  },
  {
    conceptId: "critical-hit-19-20",
    english:
      "Certain weapons such as elven blades score critical hits on a natural 19 or 20.",
    spanish:
      "Ciertas armas como las hojas élficas obtienen golpes críticos con un 19 o 20 natural.",
    englishQuery: "Which weapons have an expanded critical range?",
    spanishQuery: "¿Qué armas tienen un rango crítico expandido?",
    englishQueryAlt: "Can some weapons crit on something other than 20?",
  },
  {
    conceptId: "fortified-critical",
    english:
      "Creatures with the Fortified trait ignore expanded critical ranges and can only be crit on a natural 20.",
    spanish:
      "Las criaturas con el rasgo Fortificado ignoran los rangos críticos expandidos y solo pueden recibir crítico con un 20 natural.",
    englishQuery: "How do Fortified creatures interact with critical hits?",
    spanishQuery:
      "¿Cómo interactúan las criaturas Fortificadas con los golpes críticos?",
    englishQueryAlt: "What prevents expanded critical ranges from working?",
  },
  // ── D. Numeric distinctions ──
  {
    conceptId: "short-rest-heal",
    english:
      "A short rest allows a character to spend hit dice to recover up to 2 hit points per dice.",
    spanish:
      "Un descanso corto permite a un personaje gastar dados de golpe para recuperar hasta 2 puntos de golpe por dado.",
    englishQuery: "How much health does a short rest restore?",
    spanishQuery: "¿Cuánta salud recupera un descanso corto?",
    englishQueryAlt: "What is the healing rate during a short rest?",
  },
  {
    conceptId: "long-rest-heal",
    english:
      "A long rest fully restores all hit points and hit dice once per day.",
    spanish:
      "Un descanso largo restaura completamente todos los puntos de golpe y dados de golpe una vez por día.",
    englishQuery: "How much health does a long rest restore?",
    spanishQuery: "¿Cuánta salud recupera un descanso largo?",
    englishQueryAlt: "Does a long rest heal you completely?",
  },
  {
    conceptId: "potion-heal",
    english:
      "A standard healing potion restores 2d6+2 hit points when consumed.",
    spanish:
      "Una poción de curación estándar restaura 2d6+2 puntos de golpe al consumirse.",
    englishQuery: "How many hit points does a healing potion restore?",
    spanishQuery: "¿Cuántos puntos de golpe restaura una poción de curación?",
    englishQueryAlt: "What is the healing value of a standard potion?",
  },
  // ── E. Same vocabulary, different meaning ──
  {
    conceptId: "initiative-bonus",
    english:
      "The initiative bonus is a numerical modifier added to the initiative roll to determine turn order.",
    spanish:
      "La bonificación de iniciativa es un modificador numérico que se añade a la tirada de iniciativa para determinar el orden de turno.",
    englishQuery: "What does the initiative bonus modify?",
    spanishQuery: "¿Qué modifica la bonificación de iniciativa?",
    englishQueryAlt: "How does initiative bonus work in combat?",
  },
  {
    conceptId: "surprise-round",
    english:
      "Surprise prevents some characters from acting in the first round of a encounter.",
    spanish:
      "El sorpresa impide que algunos personajes actúen en la primera ronda de un encuentro.",
    englishQuery: "What prevents characters from acting in round one?",
    spanishQuery: "¿Qué impide que los personajes actúen en la primera ronda?",
    englishQueryAlt: "How does surprise affect the first round?",
  },
  {
    conceptId: "hit-points",
    english:
      "Hit Points represent the amount of injury a character can sustain before falling unconscious.",
    spanish:
      "Los Puntos de Golpe representan la cantidad de daño que un personaje puede soportar antes de quedar inconsciente.",
    englishQuery: "How much punishment can my character survive?",
    spanishQuery: "¿Cuánto castigo puede sobrevivir mi personaje?",
    englishQueryAlt: "What does HP measure in combat?",
  },
  // ── F. Cross-language paraphrases ──
  {
    conceptId: "mana-casting",
    english:
      "Mana is the resource spent to cast spells as long as the caster is not silenced.",
    spanish:
      "El maná es el recurso que se gasta para lanzar hechizos siempre que el lanzador no esté silenciado.",
    englishQuery: "What resource powers spellcasting?",
    spanishQuery: "¿Qué recurso alimenta la lanzamiento de hechizos?",
    englishQueryAlt: "What do you spend when you cast a spell?",
  },
  // ── G. Terminology mismatch ──
  // (covered by hit-points above: "punishment" vs "injury")
  // ── H. Multi-condition rules ──
  {
    conceptId: "spellcasting-conditions",
    english:
      "A spell can be cast only if the character has sufficient mana and is not under a silence effect.",
    spanish:
      "Un hechizo solo puede lanzarse si el personaje tiene suficiente maná y no está bajo un efecto de silencio.",
    englishQuery: "What conditions must be met to cast a spell?",
    spanishQuery: "¿Qué condiciones se deben cumplir para lanzar un hechizo?",
    englishQueryAlt: "When can you fail to cast a spell due to conditions?",
  },
  // ── I. Nested exceptions ──
  {
    conceptId: "critical-nested",
    english:
      "Critical hits occur on a natural 20, but some weapons expand this to 19-20, and the Fortified trait reverts it to 20 only.",
    spanish:
      "Los golpes críticos ocurren con un 20 natural, pero algunas armas expanden esto a 19-20, y el rasgo Fortificado lo revierte a solo 20.",
    englishQuery: "How do weapon critical ranges and Fortified interact?",
    spanishQuery:
      "¿Cómo interactúan los rangos críticos de armas y Fortificado?",
    englishQueryAlt: "Can Fortified cancel an expanded critical range?",
  },
  {
    conceptId: "damage-types-nested",
    english:
      "Resistance halves physical damage and vulnerability doubles it; both apply after armor reduction.",
    spanish:
      "La resistencia reduce a la mitad el daño físico y la vulnerabilidad lo duplica; ambas se aplican después de la reducción de armadura.",
    englishQuery: "How do resistance and vulnerability interact with armor?",
    spanishQuery:
      "¿Cómo interactúan la resistencia y la vulnerabilidad con la armadura?",
    englishQueryAlt: "Does armor apply before or after resistance?",
  },
  // ── J. High-overlap distractors ──
  {
    conceptId: "careful-movement",
    english:
      "Moving carefully during exploration avoids making noise, but running always generates sound regardless of stealth.",
    spanish:
      "Moverse con cuidado durante la exploración evita hacer ruido, pero correr siempre genera sonido sin importar el sigilo.",
    englishQuery: "How does movement affect noise generation?",
    spanishQuery: "¿Cómo afecta el movimiento la generación de ruido?",
    englishQueryAlt: "Can you move without making any noise?",
  },
  {
    conceptId: "climbing-speed",
    english:
      "Climbing costs double movement and requires a Strength check on difficult surfaces.",
    spanish:
      "Escalar cuesta el doble de movimiento y requiere una tirada de Fuerza en superficies difíciles.",
    englishQuery: "What is the movement cost of climbing?",
    spanishQuery: "¿Cuál es el costo de movimiento para escalar?",
    englishQueryAlt: "How does climbing affect your movement speed?",
  },
  {
    conceptId: "swimming-speed",
    english:
      "Swimming speed allows movement through water at normal rate but requires a Constitution check in rough water.",
    spanish:
      "La velocidad de natación permite moverse a través del agua a velocidad normal pero requiere una tirada de Constitución en agua turbulenta.",
    englishQuery: "How does swimming work in water?",
    spanishQuery: "¿Cómo funciona el nado en el agua?",
    englishQueryAlt: "What check is needed to swim in rough water?",
  },
  {
    conceptId: "flying-speed",
    english:
      "Flying speed allows vertical movement without the climbing penalty.",
    spanish:
      "La velocidad de vuelo permite el movimiento vertical sin la penalización de escalar.",
    englishQuery: "How does flying speed differ from climbing?",
    spanishQuery: "¿Cómo difiere la velocidad de vuelo de escalar?",
    englishQueryAlt: "Does flying count as climbing?",
  },
  {
    conceptId: "ability-score-improvement",
    english:
      "At certain levels a character can increase one ability score by 2 or two ability scores by 1 each, up to a maximum of 20.",
    spanish:
      "En ciertos niveles un personaje puede aumentar una puntuación de atributo en 2 o dos puntuaciones en 1 cada una, hasta un máximo de 20.",
    englishQuery: "How do ability score improvements work?",
    spanishQuery: "¿Cómo funcionan las mejoras de puntuación de atributo?",
    englishQueryAlt: "When can a character increase their stats?",
  },
  {
    conceptId: "spell-slots",
    english:
      "Spell slots are consumed when casting spells; a higher-level slot can cast a lower-level spell but not the reverse.",
    spanish:
      "Las ranuras de hechizo se consumen al lanzar hechizos; una ranura de nivel superior puede lanzar un hechizo de nivel inferior pero no al revés.",
    englishQuery: "How do spell slots work for casting?",
    spanishQuery: "¿Cómo funcionan las ranuras de hechizo para lanzar?",
    englishQueryAlt: "Can a low-level slot cast a high-level spell?",
  },
  {
    conceptId: "advantage-disadvantage",
    english:
      "Advantage means rolling two d20s and taking the higher result; disadvantage takes the lower result; both cancel each other.",
    spanish:
      "Ventaja significa tirar dos d20 y tomar el mayor resultado; desventaja toma el menor; ambas se cancelan entre sí.",
    englishQuery: "How does advantage interact with disadvantage?",
    spanishQuery: "¿Cómo interactúa la ventaja con la desventaja?",
    englishQueryAlt:
      "What happens when you have both advantage and disadvantage?",
  },
  {
    conceptId: "death-saves",
    english:
      "At zero hit points a character makes death saving throws; three successes stabilize and three failures result in death.",
    spanish:
      "Con cero puntos de golpe un personaje realiza tiradas de salvación de muerte; tres éxitos estabilizan y tres fallos resultan en muerte.",
    englishQuery: "What happens when you fail all death saves?",
    spanishQuery: "¿Qué pasa si fallas todas las tiradas de muerte?",
    englishQueryAlt: "How do death saving throws work?",
  },
  {
    conceptId: "concentration",
    english:
      "Concentration spells require ongoing focus and break if the caster takes damage or casts another spell; some effects do not require concentration.",
    spanish:
      "Los hechizos de concentración requieren enfoque continuo y se interrumpen si el lanzador recibe daño o lanza otro hechizo; algunos efectos no requieren concentración.",
    englishQuery: "What breaks a concentration spell?",
    spanishQuery: "¿Qué interrumpe un hechizo de concentración?",
    englishQueryAlt: "Which effects need concentration to maintain?",
  },
  {
    conceptId: "verbal-components",
    english:
      "Most spells require verbal components and cannot be cast under silence effects.",
    spanish:
      "La mayoría de los hechizos requieren componentes verbales y no pueden lanzarse bajo efectos de silencio.",
    englishQuery: "What prevents verbal spellcasting?",
    spanishQuery: "¿Qué impide la lanzamiento de hechizos verbales?",
    englishQueryAlt: "Can you cast spells while silenced?",
  },
];

export const distractorPassages: readonly RulePassage[] = [
  // ── Original easy distractors ──
  {
    id: "distractor-weather-en",
    conceptId: "distractor-weather",
    language: "en",
    kind: "distractor",
    text: "Spring rain makes the northern road muddy for two days.",
  },
  {
    id: "distractor-calendar-es",
    conceptId: "distractor-calendar",
    language: "es",
    kind: "distractor",
    text: "El festival de las luces se celebra durante la primera luna de otoño.",
  },
  {
    id: "distractor-map-en",
    conceptId: "distractor-map",
    language: "en",
    kind: "distractor",
    text: "The western map uses blue ink for rivers and red ink for mountain paths.",
  },
  {
    id: "distractor-faction-es",
    conceptId: "distractor-faction",
    language: "es",
    kind: "distractor",
    text: "La Cofradía del Roble negocia con las aldeas del valle.",
  },
  {
    id: "distractor-language-en",
    conceptId: "distractor-language",
    language: "en",
    kind: "distractor",
    text: "The old harbor dialect uses three words for different kinds of fog.",
  },
  {
    id: "distractor-market-es",
    conceptId: "distractor-market",
    language: "es",
    kind: "distractor",
    text: "El mercado abre al amanecer y cierra cuando suena la campana de cobre.",
  },
  {
    id: "distractor-constellation-en",
    conceptId: "distractor-constellation",
    language: "en",
    kind: "distractor",
    text: "Sailors use the Lantern constellation to travel after sunset.",
  },
  {
    id: "distractor-archive-es",
    conceptId: "distractor-archive",
    language: "es",
    kind: "distractor",
    text: "El archivo municipal conserva cartas de exploradores y registros de comercio.",
  },
  {
    id: "distractor-cuisine-en",
    conceptId: "distractor-cuisine",
    language: "en",
    kind: "distractor",
    text: "A camp stew uses root vegetables, salt, and a small amount of smoked herb.",
  },
  {
    id: "distractor-garden-es",
    conceptId: "distractor-garden",
    language: "es",
    kind: "distractor",
    text: "El jardín del faro contiene flores nocturnas y un pozo poco profundo.",
  },
  // ── Hard distractors: high lexical overlap, incorrect semantics ──
  {
    id: "distractor-armor-decorative-en",
    conceptId: "distractor-armor-decorative",
    language: "en",
    kind: "distractor",
    text: "Ceremonial armor is worn during rituals and has no combat protective value.",
  },
  {
    id: "distractor-healing-herb-en",
    conceptId: "distractor-healing-herb",
    language: "en",
    kind: "distractor",
    text: "Healing herbs can be found in the forest and restore 1 HP when prepared as tea.",
  },
  {
    id: "distractor-initiative-tie-es",
    conceptId: "distractor-initiative-tie",
    language: "es",
    kind: "distractor",
    text: "En caso de empate en la iniciativa, el orden se determina por la estadística de destreza.",
  },
  {
    id: "distractor-critical-fumble-en",
    conceptId: "distractor-critical-fumble",
    language: "en",
    kind: "distractor",
    text: "A natural 1 on an attack roll always results in a critical miss and the weapon is dropped.",
  },
  {
    id: "distractor-rest-dream-es",
    conceptId: "distractor-rest-dream",
    language: "es",
    kind: "distractor",
    text: "Durante el descanso largo los personajes pueden compartir historias y ganar experiencia de.roleo.",
  },
  {
    id: "distractor-stealth-shadow-en",
    conceptId: "distractor-stealth-shadow",
    language: "en",
    kind: "distractor",
    text: "Standing in shadow provides a bonus to stealth checks regardless of armor worn.",
  },
  {
    id: "distractor-spell-scroll-es",
    conceptId: "distractor-spell-scroll",
    language: "es",
    kind: "distractor",
    text: "Un pergamino de hechizo permite lanzar un hechizo sin gastar ranuras de hechizo.",
  },
  {
    id: "distractor-potion-poison-en",
    conceptId: "distractor-potion-poison",
    language: "en",
    kind: "distractor",
    text: "A poisoned healing potion deals 1d6 damage instead of restoring hit points.",
  },
  {
    id: "distractor-mana-regen-es",
    conceptId: "distractor-mana-regen",
    language: "es",
    kind: "distractor",
    text: "Los puntos de magia se regeneran automáticamente cada turno de combate.",
  },
  {
    id: "distractor-shield-bash-en",
    conceptId: "distractor-shield-bash",
    language: "en",
    kind: "distractor",
    text: "Using a shield as a weapon deals bludgeoning damage equal to the shield's weight.",
  },
  {
    id: "distractor-hitpoint-temp-es",
    conceptId: "distractor-hitpoint-temp",
    language: "es",
    kind: "distractor",
    text: "Los puntos de golpe temporales desaparecen al final del encuentro y no se pueden curar.",
  },
  {
    id: "distractor-skill-expertise-en",
    conceptId: "distractor-skill-expertise",
    language: "en",
    kind: "distractor",
    text: "Expertise doubles a skill bonus but only applies to ability checks, not attacks.",
  },
  {
    id: "distractor-difficulty-class-es",
    conceptId: "distractor-difficulty-class",
    language: "es",
    kind: "distractor",
    text: "La clase de dificultad de una trampa aumenta cada vez que alguien la activa.",
  },
  {
    id: "distractor-fly-speed-hover-en",
    conceptId: "distractor-fly-speed-hover",
    language: "en",
    kind: "distractor",
    text: "Hover speed allows a creature to remain airborne without moving but requires a Wisdom check each turn.",
  },
  {
    id: "distractor-concentration-focus-es",
    conceptId: "distractor-concentration-focus",
    language: "es",
    kind: "distractor",
    text: "Mantener la concentración requiere una acción adicional en cada turno del lanzador.",
  },
  {
    id: "distractor-death-stabilize-en",
    conceptId: "distractor-death-stabilize",
    language: "en",
    kind: "distractor",
    text: "A stabilized character at zero hit points automatically regains 1 hit point at the start of their next turn.",
  },
  {
    id: "distractor-advantage-roll-es",
    conceptId: "distractor-advantage-roll",
    language: "es",
    kind: "distractor",
    text: "La ventaja permite tirar dos dados y sumar ambos resultados en lugar de tomar el mayor.",
  },
  {
    id: "distractor-ability-cap-en",
    conceptId: "distractor-ability-cap",
    language: "en",
    kind: "distractor",
    text: "Ability scores can exceed 20 through magical items but the bonus caps at +5.",
  },
  {
    id: "distractor-verbal-somatic-es",
    conceptId: "distractor-verbal-somatic",
    language: "es",
    kind: "distractor",
    text: "Los componentes somáticos requieren al menos una mano libre para realizar gestos.",
  },
  {
    id: "distractor-death-save-auto-en",
    conceptId: "distractor-death-save-auto",
    language: "en",
    kind: "distractor",
    text: "A character at zero hit points automatically stabilizes after one minute without any help.",
  },
];

function buildRulePassages(): readonly RulePassage[] {
  const pairs = [...rulePairs, ...hardConcepts];
  return pairs.flatMap((pair) => [
    {
      id: `${pair.conceptId}-en`,
      conceptId: pair.conceptId,
      language: "en" as const,
      kind: "rule" as const,
      text: pair.english,
    },
    {
      id: `${pair.conceptId}-es`,
      conceptId: pair.conceptId,
      language: "es" as const,
      kind: "rule" as const,
      text: pair.spanish,
    },
  ]);
}

function buildBenchmarkQueries(): readonly RetrievalQuery[] {
  const pairs = [...rulePairs, ...hardConcepts];
  return pairs.flatMap((pair) => {
    const queries: RetrievalQuery[] = [
      {
        id: `${pair.conceptId}-en-to-en`,
        conceptId: pair.conceptId,
        language: "en",
        targetLanguage: "en",
        text: pair.englishQuery,
      },
      {
        id: `${pair.conceptId}-es-to-es`,
        conceptId: pair.conceptId,
        language: "es",
        targetLanguage: "es",
        text: pair.spanishQuery,
      },
      {
        id: `${pair.conceptId}-en-to-es`,
        conceptId: pair.conceptId,
        language: "en",
        targetLanguage: "es",
        text: pair.englishQuery,
      },
      {
        id: `${pair.conceptId}-es-to-en`,
        conceptId: pair.conceptId,
        language: "es",
        targetLanguage: "en",
        text: pair.spanishQuery,
      },
    ];

    if (pair.englishQueryAlt) {
      queries.push({
        id: `${pair.conceptId}-en-alt-to-en`,
        conceptId: pair.conceptId,
        language: "en",
        targetLanguage: "en",
        text: pair.englishQueryAlt,
      });
      queries.push({
        id: `${pair.conceptId}-en-alt-to-es`,
        conceptId: pair.conceptId,
        language: "en",
        targetLanguage: "es",
        text: pair.englishQueryAlt,
      });
    }

    if (pair.spanishQueryAlt) {
      queries.push({
        id: `${pair.conceptId}-es-alt-to-es`,
        conceptId: pair.conceptId,
        language: "es",
        targetLanguage: "es",
        text: pair.spanishQueryAlt,
      });
      queries.push({
        id: `${pair.conceptId}-es-alt-to-en`,
        conceptId: pair.conceptId,
        language: "es",
        targetLanguage: "en",
        text: pair.spanishQueryAlt,
      });
    }

    return queries;
  });
}

export const rulePassages: readonly RulePassage[] = buildRulePassages();

export const benchmarkDocuments: readonly RulePassage[] = [
  ...rulePassages,
  ...distractorPassages,
];

export const benchmarkQueries: readonly RetrievalQuery[] =
  buildBenchmarkQueries();

export function expectedDocumentId(query: RetrievalQuery): string {
  return `${query.conceptId}-en`;
}

export function expectedDocumentIds(query: RetrievalQuery): readonly string[] {
  return [`${query.conceptId}-en`, `${query.conceptId}-es`].filter(
    (id, index, self) => self.indexOf(id) === index,
  );
}
