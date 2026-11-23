// The triage protocol's vocabulary. Every sign Kin can act on is listed here, with the
// level it reaches by itself. This file is written to be read and signed by a clinical
// lead: it is plain data, and nothing outside it can add a sign or change a level.
//
// DEMONSTRATION PROTOCOL. Adapted from public first-aid and when-to-seek-care guidance.
// Not clinically reviewed. See docs/SAFETY.md.

export type Level = 'routine' | 'soon' | 'urgent' | 'emergency';
export type Group = 'respiratory' | 'stomach' | 'fever' | 'skin' | 'other';
export type Lang = 'en' | 'fr';

export interface Sign {
  id: string;
  level: Level;
  group: Group;
  label: Record<Lang, string>;
  /** Lower-case, accent-free phrases. A phrase matches at the start of a word, so stems work.
   *  A trailing `$` means the phrase must also end at a word boundary. */
  words: Record<Lang, string[]>;
  basis: string;
}

const RED_CROSS = 'Adapted from Canadian Red Cross first aid: when to call 911';
const HEART = 'Adapted from Heart & Stroke: signs of heart attack and stroke (FAST)';
const TODAY = 'Adapted from public guidance on when to see a provider the same day';
const HOME = 'Adapted from public self-care guidance';

export const SIGNS: Sign[] = [
  // ---- Call 911 now ---------------------------------------------------------------
  { id: 'chest_pain', level: 'emergency', group: 'other', basis: HEART,
    label: { en: 'Chest pain or pressure', fr: 'Douleur ou pression à la poitrine' },
    words: { en: ['chest pain', 'chest hurt', 'chest pressure', 'chest is tight', 'chest feels tight', 'tight chest', 'pain in my chest', 'pain in the chest', 'tightness in my chest', 'pressure in my chest', 'heart attack'],
      fr: ['douleur a la poitrine', 'mal a la poitrine', 'douleur thoracique', 'poitrine serree', 'pression dans la poitrine', 'serrement dans la poitrine', 'crise cardiaque'] } },
  { id: 'breathing', level: 'emergency', group: 'respiratory', basis: RED_CROSS,
    label: { en: 'Trouble breathing', fr: 'Difficulté à respirer' },
    words: { en: ["can't breathe", 'cant breathe', 'cannot breathe', 'trouble breathing', 'hard to breathe', 'difficulty breathing', 'short of breath', 'shortness of breath', "can't catch my breath", 'cant catch my breath', 'cannot catch my breath', 'gasping', 'struggling to breathe'],
      fr: ['du mal a respirer', 'difficulte a respirer', 'peine a respirer', "n'arrive pas a respirer", 'arrive plus a respirer', 'souffle court', "manque d'air", 'tres essouffle'] } },
  { id: 'stroke', level: 'emergency', group: 'other', basis: HEART,
    label: { en: 'Face drooping, arm weakness or slurred speech', fr: 'Visage affaissé, bras faible ou parole difficile' },
    words: { en: ['face droop', 'face is droop', 'drooping', 'slurred', 'slurring', 'trouble speaking', 'arm is weak', 'arm weak', 'weak arm', 'numb on one side', 'weak on one side', 'stroke'],
      fr: ['visage affaisse', 'bouche tordue', 'bras faible', 'faiblesse du bras', "n'arrive pas a parler", 'parole difficile', "engourdi d'un cote", 'avc'] } },
  { id: 'unresponsive', level: 'emergency', group: 'other', basis: RED_CROSS,
    label: { en: 'Fainted or not responding', fr: 'Évanoui ou ne répond pas' },
    words: { en: ['fainted', 'passed out', 'unconscious', 'not responding', 'unresponsive', 'collapsed', "won't wake", 'wont wake', 'not waking'],
      fr: ['evanoui', 'perdu connaissance', 'inconscient', 'ne repond pas', 'ne repond plus', 'effondre', 'ne se reveille pas'] } },
  { id: 'bleeding', level: 'emergency', group: 'other', basis: RED_CROSS,
    label: { en: 'Bleeding that will not stop', fr: 'Saignement qui ne s’arrête pas' },
    words: { en: ['bleeding heavily', 'bleeding a lot', 'bleeding badly', 'heavy bleeding', "won't stop bleeding", 'wont stop bleeding', 'will not stop bleeding', 'lots of blood', 'blood everywhere', 'spurting'],
      fr: ['saigne beaucoup', 'saignement abondant', 'hemorragie', "n'arrete pas de saigner", 'plein de sang'] } },
  { id: 'allergy', level: 'emergency', group: 'other', basis: RED_CROSS,
    label: { en: 'Swelling of the face, lips or throat', fr: 'Enflure du visage, des lèvres ou de la gorge' },
    words: { en: ['throat is swelling', 'throat swelling', 'throat is closing', 'throat closing', 'swollen tongue', 'tongue is swelling', 'swollen lips', 'lips are swelling', 'face is swelling', 'allergic reaction', 'anaphyla'],
      fr: ['gorge enflee', 'gorge qui enfle', 'gorge se serre', 'langue enflee', 'levres enflees', 'visage enfle', 'reaction allergique', 'anaphyla'] } },
  { id: 'seizure', level: 'emergency', group: 'other', basis: RED_CROSS,
    label: { en: 'Seizure', fr: 'Convulsions' },
    words: { en: ['seizure', 'convuls'], fr: ['convuls', "crise d'epilepsie", 'crise epileptique'] } },
  { id: 'overdose', level: 'emergency', group: 'other', basis: RED_CROSS,
    label: { en: 'Overdose or poisoning', fr: 'Surdose ou empoisonnement' },
    words: { en: ['overdos', 'took too many', 'took too much', 'poisoned', 'swallowed poison', 'drank bleach'],
      fr: ['surdose', 'overdose', 'trop de pilules', 'trop de comprimes', 'avale du poison'] } },
  { id: 'self_harm', level: 'emergency', group: 'other', basis: 'Adapted from 9-8-8 Suicide Crisis Helpline guidance',
    label: { en: 'Thoughts of ending your life', fr: 'Pensées de mettre fin à ses jours' },
    words: { en: ['kill myself', 'suicid', 'end my life', 'want to die', 'harm myself'],
      fr: ['me tuer', 'suicid', 'veux mourir', 'envie de mourir', 'en finir avec la vie'] } },
  { id: 'blue_lips', level: 'emergency', group: 'respiratory', basis: RED_CROSS,
    label: { en: 'Blue or grey lips or face', fr: 'Lèvres ou visage bleus ou gris' },
    words: { en: ['blue lips', 'lips are blue', 'lips turning blue', 'grey lips', 'turning blue'], fr: ['levres bleues', 'levres grises', 'devient bleu'] } },
  { id: 'confusion', level: 'emergency', group: 'other', basis: RED_CROSS,
    label: { en: 'Sudden confusion', fr: 'Confusion soudaine' },
    words: { en: ['suddenly confused', 'sudden confusion', 'very confused', 'disoriented', "doesn't know where", 'does not know where', 'not making sense'], fr: ['confusion soudaine', 'tres confus', 'desorient', 'ne sait plus ou'] } },
  { id: 'choking', level: 'emergency', group: 'respiratory', basis: RED_CROSS,
    label: { en: 'Choking', fr: 'Étouffement' },
    words: { en: ['choking'], fr: ["s'etouffe", "m'etouffe", 'etouffement'] } },

  // ---- Speak to a nurse today -----------------------------------------------------
  { id: 'high_fever', level: 'urgent', group: 'fever', basis: TODAY,
    label: { en: 'Fever of 39°C or more, or for 3 days', fr: 'Fièvre de 39 °C ou plus, ou depuis 3 jours' },
    words: { en: ['high fever', 'burning up', '39 degrees', '40 degrees', '39.', '40.', 'fever for three', 'fever for 3', 'fever for days'],
      fr: ['forte fievre', 'fievre elevee', '39 degres', '40 degres', 'fievre depuis trois', 'fievre depuis 3', 'fievre depuis des jours'] } },
  { id: 'cant_keep_fluids', level: 'urgent', group: 'stomach', basis: TODAY,
    label: { en: 'Cannot keep fluids down', fr: 'Ne garde aucun liquide' },
    words: { en: ["can't keep anything down", 'cant keep anything down', 'cannot keep anything down', 'keep fluids down', 'keep water down', 'vomiting all day', 'throwing up all day', 'vomiting nonstop'],
      fr: ['ne garde rien', 'vomit sans arret', 'vomis sans arret', 'vomit toute la journee'] } },
  { id: 'dehydration', level: 'urgent', group: 'stomach', basis: TODAY,
    label: { en: 'Very dry mouth, hardly peeing', fr: 'Bouche très sèche, urine très peu' },
    words: { en: ['dehydrat', 'not peeing', 'hardly peeing', 'barely peeing', 'very dry mouth'], fr: ['deshydrat', "n'urine presque", 'urine presque plus', 'bouche tres seche'] } },
  { id: 'wound_infected', level: 'urgent', group: 'skin', basis: TODAY,
    label: { en: 'Wound that is hot, swollen or leaking pus', fr: 'Plaie chaude, enflée ou avec du pus' },
    words: { en: ['pus$', 'infected', 'red streak', 'redness is spreading', 'spreading redness'], fr: ['pus$', 'infecte', 'rougeur qui s', 'trainee rouge'] } },
  { id: 'severe_pain', level: 'urgent', group: 'other', basis: TODAY,
    label: { en: 'Severe pain', fr: 'Douleur intense' },
    words: { en: ['severe pain', 'worst pain', 'unbearable', 'excruciating', '10 out of 10', 'ten out of ten'], fr: ['douleur intense', 'douleur severe', 'insupportable', 'pire douleur', '10 sur 10', 'dix sur dix'] } },
  { id: 'blood', level: 'urgent', group: 'other', basis: TODAY,
    label: { en: 'Blood in vomit, stool, urine or cough', fr: 'Sang dans les vomissements, les selles, l’urine ou la toux' },
    words: { en: ['coughing up blood', 'cough up blood', 'blood in my stool', 'blood in the stool', 'blood in stool', 'blood in my urine', 'blood in my pee', 'blood in urine', 'vomiting blood', 'throwing up blood', 'black stool', 'bloody stool'],
      fr: ['crache du sang', 'tousse du sang', 'sang dans les selles', 'sang dans mes selles', "sang dans l'urine", 'sang dans mon urine', 'vomit du sang', 'vomis du sang', 'selles noires'] } },
  { id: 'stiff_neck', level: 'urgent', group: 'other', basis: TODAY,
    label: { en: 'Stiff neck', fr: 'Raideur de la nuque' },
    words: { en: ['stiff neck', 'neck is stiff', "can't bend my neck", 'cant bend my neck'], fr: ['nuque raide', 'raideur de la nuque', 'cou raide', 'raideur au cou'] } },
  { id: 'head_injury', level: 'urgent', group: 'other', basis: TODAY,
    label: { en: 'Blow to the head', fr: 'Coup à la tête' },
    words: { en: ['hit my head', 'hit his head', 'hit her head', 'hit their head', 'head injury', 'banged my head', 'concussion'], fr: ['coup a la tete', 'cogne la tete', 'frappe la tete', 'commotion'] } },

  // ---- Book a visit in the next few days ------------------------------------------
  { id: 'fever', level: 'soon', group: 'fever', basis: HOME,
    label: { en: 'Fever', fr: 'Fièvre' },
    words: { en: ['fever', 'feverish', 'chills'], fr: ['fievre', 'fievreux', 'frissons'] } },
  { id: 'cough_long', level: 'soon', group: 'respiratory', basis: TODAY,
    label: { en: 'Cough for more than 3 weeks', fr: 'Toux depuis plus de 3 semaines' },
    words: { en: ['coughing for weeks', 'cough for weeks', 'cough for three weeks', 'cough for 3 weeks', "cough won't go away", 'cough wont go away', 'cough for a month'], fr: ['toux depuis des semaines', 'tousse depuis des semaines', 'toux depuis trois semaines', 'toux depuis 3 semaines', 'toux qui ne part pas', 'toux depuis un mois'] } },
  { id: 'painful_urination', level: 'soon', group: 'other', basis: HOME,
    label: { en: 'Pain when peeing', fr: 'Douleur en urinant' },
    words: { en: ['burns when i pee', 'hurts to pee', 'hurts when i pee', 'pain when i pee', 'painful urination', 'pain when urinating'], fr: ["brule quand j'urine", 'douleur en urinant', "mal quand j'urine", 'brulure en urinant'] } },
  { id: 'ear_pain', level: 'soon', group: 'other', basis: HOME,
    label: { en: 'Ear pain', fr: 'Mal d’oreille' },
    words: { en: ['earache', 'ear ache', 'ear pain', 'ear hurts', 'ear is sore'], fr: ["mal a l'oreille", "mal d'oreille", 'otite'] } },
  { id: 'rash', level: 'soon', group: 'skin', basis: HOME,
    label: { en: 'Rash', fr: 'Éruption cutanée' },
    words: { en: ['rash', 'hives', 'itchy skin', 'spots on my skin', 'red spots'], fr: ['eruption', 'urticaire', 'plaques rouges', 'boutons', 'peau qui pique', 'demangeaison'] } },
  { id: 'vomiting', level: 'soon', group: 'stomach', basis: HOME,
    label: { en: 'Vomiting', fr: 'Vomissements' },
    words: { en: ['vomit', 'throwing up', 'threw up', 'puking', 'puked'], fr: ['vomi'] } },
  { id: 'diarrhea', level: 'soon', group: 'stomach', basis: HOME,
    label: { en: 'Diarrhea', fr: 'Diarrhée' },
    words: { en: ['diarrhea', 'diarrhoea', 'the runs', 'loose stool'], fr: ['diarrhee', 'selles liquides'] } },
  { id: 'dizzy', level: 'soon', group: 'other', basis: HOME,
    label: { en: 'Dizziness', fr: 'Étourdissements' },
    words: { en: ['dizzy', 'dizziness', 'lightheaded', 'light-headed'], fr: ['etourdi', 'vertige'] } },

  // ---- Care at home ----------------------------------------------------------------
  { id: 'cough', level: 'routine', group: 'respiratory', basis: HOME,
    label: { en: 'Cough', fr: 'Toux' },
    words: { en: ['cough'], fr: ['toux', 'tousse'] } },
  { id: 'sore_throat', level: 'routine', group: 'respiratory', basis: HOME,
    label: { en: 'Sore throat', fr: 'Mal de gorge' },
    words: { en: ['sore throat', 'throat hurts', 'throat is sore', 'scratchy throat'], fr: ['mal a la gorge', 'mal de gorge', 'gorge irritee'] } },
  { id: 'runny_nose', level: 'routine', group: 'respiratory', basis: HOME,
    label: { en: 'Runny or blocked nose', fr: 'Nez qui coule ou bouché' },
    words: { en: ['runny nose', 'stuffy', 'congested', 'congestion', 'sneezing', 'blocked nose'], fr: ['nez qui coule', 'nez bouche', 'congestion', 'eternue'] } },
  { id: 'headache', level: 'routine', group: 'other', basis: HOME,
    label: { en: 'Headache', fr: 'Mal de tête' },
    words: { en: ['headache', 'head hurts', 'head is pounding', 'migraine'], fr: ['mal de tete', 'mal a la tete', 'migraine'] } },
  { id: 'nausea', level: 'routine', group: 'stomach', basis: HOME,
    label: { en: 'Nausea', fr: 'Nausée' },
    words: { en: ['nausea', 'nauseous', 'queasy', 'sick to my stomach'], fr: ['nausee', 'mal au coeur', 'envie de vomir'] } },
  { id: 'tired', level: 'routine', group: 'other', basis: HOME,
    label: { en: 'Very tired', fr: 'Grande fatigue' },
    words: { en: ['tired', 'exhausted', 'fatigue', 'no energy', 'worn out'], fr: ['fatigue', 'epuise', 'sans energie', "pas d'energie"] } },
  { id: 'aches', level: 'routine', group: 'other', basis: HOME,
    label: { en: 'Body aches', fr: 'Courbatures' },
    words: { en: ['body aches', 'body ache', 'muscle ache', 'sore muscles', 'aching all over', 'achy'], fr: ['courbature', 'douleurs musculaires', 'mal partout'] } },
  { id: 'wound', level: 'routine', group: 'skin', basis: HOME,
    label: { en: 'Small cut or scrape', fr: 'Petite coupure ou éraflure' },
    words: { en: ['a cut$', 'cut my', 'cut on', 'small cut$', 'scrape', 'wound'], fr: ['coupure', 'eraflure', 'egratignure', 'plaie'] } },
];

export const SIGN_BY_ID = new Map(SIGNS.map(sign => [sign.id, sign]));
export type SignId = string;

/** Signs that together reach a higher level than either does alone. */
export const COMBINATIONS: { all: SignId[][]; level: Level; rule: string; basis: string }[] = [
  { all: [['fever', 'high_fever'], ['stiff_neck']], level: 'emergency', rule: 'fever_stiff_neck', basis: RED_CROSS },
  { all: [['head_injury'], ['vomiting', 'cant_keep_fluids', 'confusion', 'unresponsive', 'seizure']], level: 'emergency', rule: 'head_injury_plus', basis: RED_CROSS },
  { all: [['fever', 'high_fever'], ['rash']], level: 'urgent', rule: 'fever_rash', basis: TODAY },
  { all: [['vomiting', 'diarrhea'], ['dizzy']], level: 'urgent', rule: 'fluid_loss_dizzy', basis: TODAY },
];

/** Resting pulse limits, beats per minute. Outside these a result is raised. */
export const PULSE = { urgentLow: 45, urgentHigh: 120, emergencyLow: 35, emergencyHigh: 150 } as const;
export const LEVEL_ORDER: Level[] = ['routine', 'soon', 'urgent', 'emergency'];
