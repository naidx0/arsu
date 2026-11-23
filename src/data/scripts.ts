// First-aid scripts. Kin reads these out word for word and never adds a step.
//
// DEMONSTRATION TEXT. Adapted from public first-aid guidance. Before real use it must be
// replaced with licensed text from the Canadian Red Cross or Heart & Stroke and signed by
// a clinical lead. See docs/SAFETY.md.
import type { Lang } from './protocol';

export type Skill = 'cpr' | 'naloxone' | 'bleeding' | 'choking';

export interface Step {
  title: Record<Lang, string>;
  say: Record<Lang, string>;
  /** This step is done to a beat; the screen shows the pace coach. */
  beat?: boolean;
}

export interface Script {
  skill: Skill;
  icon: string;
  name: Record<Lang, string>;
  about: Record<Lang, string>;
  steps: Step[];
}

export const SCRIPTS: Script[] = [
  {
    skill: 'cpr', icon: 'cardiology',
    name: { en: 'CPR', fr: 'RCR' },
    about: { en: 'For an adult who is not responding and not breathing normally.', fr: 'Pour un adulte qui ne répond pas et ne respire pas normalement.' },
    steps: [
      { title: { en: 'Check', fr: 'Vérifiez' }, say: { en: 'Tap their shoulders and shout. If there is no response and they are not breathing normally, start now.', fr: 'Tapez sur ses épaules et criez. S’il n’y a pas de réponse et que la personne ne respire pas normalement, commencez maintenant.' } },
      { title: { en: 'Call 911', fr: 'Appelez le 911' }, say: { en: 'Call 911 or have someone call. Put the phone on speaker. Send someone for a defibrillator if there is one.', fr: 'Appelez le 911 ou demandez à quelqu’un de le faire. Mettez le haut-parleur. Envoyez quelqu’un chercher un défibrillateur s’il y en a un.' } },
      { title: { en: 'Hands', fr: 'Mains' }, say: { en: 'Kneel beside them. Put the heel of one hand on the centre of the chest, your other hand on top. Keep your arms straight.', fr: 'Agenouillez-vous à côté. Placez le talon d’une main au centre de la poitrine, l’autre main par-dessus. Gardez les bras droits.' } },
      { title: { en: 'Push hard, push fast', fr: 'Poussez fort, poussez vite' }, beat: true, say: { en: 'Push down at least 5 centimetres, then let the chest come all the way back up. Follow the beat: 100 to 120 pushes a minute.', fr: 'Enfoncez d’au moins 5 centimètres, puis laissez la poitrine remonter complètement. Suivez le rythme : 100 à 120 poussées par minute.' } },
      { title: { en: 'Keep going', fr: 'Continuez' }, say: { en: 'Do not stop until help takes over, a defibrillator tells you to pause, or the person starts breathing. Swap with someone every 2 minutes if you can.', fr: 'N’arrêtez pas avant que les secours prennent le relais, qu’un défibrillateur vous dise de faire une pause ou que la personne respire. Changez de place toutes les 2 minutes si possible.' } },
    ],
  },
  {
    skill: 'naloxone', icon: 'medication',
    name: { en: 'Overdose: naloxone', fr: 'Surdose : naloxone' },
    about: { en: 'For someone who may have taken opioids and will not wake up or is breathing very slowly.', fr: 'Pour une personne qui a peut-être pris des opioïdes et qui ne se réveille pas ou respire très lentement.' },
    steps: [
      { title: { en: 'Shake and shout', fr: 'Secouez et criez' }, say: { en: 'Shake their shoulders and shout their name.', fr: 'Secouez ses épaules et criez son nom.' } },
      { title: { en: 'Call 911', fr: 'Appelez le 911' }, say: { en: 'Call 911 if they do not respond. Say that someone is not responding and not breathing well.', fr: 'Appelez le 911 si la personne ne répond pas. Dites qu’une personne ne répond pas et respire mal.' } },
      { title: { en: 'Give naloxone', fr: 'Donnez la naloxone' }, say: { en: 'Nasal spray: tilt the head back, put the tip in one nostril and press the plunger. Follow the instructions in your kit.', fr: 'Vaporisateur nasal : penchez la tête vers l’arrière, insérez l’embout dans une narine et appuyez sur le piston. Suivez les instructions de votre trousse.' } },
      { title: { en: 'Chest compressions', fr: 'Compressions thoraciques' }, beat: true, say: { en: 'If they are not breathing normally, start chest compressions and follow the beat. Give rescue breaths if you are trained.', fr: 'Si la personne ne respire pas normalement, commencez les compressions et suivez le rythme. Donnez des insufflations si vous êtes formé.' } },
      { title: { en: 'Check after 2 to 3 minutes', fr: 'Vérifiez après 2 à 3 minutes' }, say: { en: 'If there is no change, give a second dose in the other nostril. Stay with them. If they wake, place them on their side.', fr: 'S’il n’y a pas de changement, donnez une deuxième dose dans l’autre narine. Restez avec la personne. Si elle se réveille, placez-la sur le côté.' } },
    ],
  },
  {
    skill: 'bleeding', icon: 'healing',
    name: { en: 'Severe bleeding', fr: 'Saignement grave' },
    about: { en: 'For bleeding that is heavy or will not stop.', fr: 'Pour un saignement abondant ou qui ne s’arrête pas.' },
    steps: [
      { title: { en: 'Call 911', fr: 'Appelez le 911' }, say: { en: 'Call 911 or have someone call.', fr: 'Appelez le 911 ou demandez à quelqu’un de le faire.' } },
      { title: { en: 'Press hard', fr: 'Appuyez fort' }, say: { en: 'Press firmly on the wound with a clean cloth or your hand. Do not let go.', fr: 'Appuyez fermement sur la plaie avec un linge propre ou votre main. Ne relâchez pas.' } },
      { title: { en: 'Add, do not remove', fr: 'Ajoutez, ne retirez pas' }, say: { en: 'If blood soaks through, put another cloth on top. Do not lift the first one.', fr: 'Si le sang traverse, ajoutez un autre linge par-dessus. Ne soulevez pas le premier.' } },
      { title: { en: 'Keep them still', fr: 'Gardez la personne immobile' }, say: { en: 'Have them lie down and keep them warm. Keep pressing until help arrives.', fr: 'Faites-la s’allonger et gardez-la au chaud. Continuez d’appuyer jusqu’à l’arrivée des secours.' } },
    ],
  },
  {
    skill: 'choking', icon: 'pulmonology',
    name: { en: 'Choking', fr: 'Étouffement' },
    about: { en: 'For an adult who cannot cough, speak or breathe.', fr: 'Pour un adulte qui ne peut ni tousser, ni parler, ni respirer.' },
    steps: [
      { title: { en: 'Ask', fr: 'Demandez' }, say: { en: 'Ask "Are you choking?" If they can cough or speak, encourage them to keep coughing.', fr: 'Demandez « Vous étouffez-vous? » Si la personne peut tousser ou parler, encouragez-la à continuer de tousser.' } },
      { title: { en: 'Call 911', fr: 'Appelez le 911' }, say: { en: 'If they cannot cough, speak or breathe, have someone call 911.', fr: 'Si elle ne peut ni tousser, ni parler, ni respirer, demandez à quelqu’un d’appeler le 911.' } },
      { title: { en: '5 back blows', fr: '5 tapes dans le dos' }, say: { en: 'Lean them forward. Give 5 firm blows between the shoulder blades with the heel of your hand.', fr: 'Penchez la personne vers l’avant. Donnez 5 tapes fermes entre les omoplates avec le talon de la main.' } },
      { title: { en: '5 abdominal thrusts', fr: '5 poussées abdominales' }, say: { en: 'Stand behind them. Put a fist just above the belly button, hold it with your other hand, and pull sharply in and up 5 times.', fr: 'Placez-vous derrière. Mettez un poing juste au-dessus du nombril, tenez-le de l’autre main et tirez vivement vers l’intérieur et vers le haut 5 fois.' } },
      { title: { en: 'Repeat', fr: 'Répétez' }, say: { en: 'Alternate back blows and thrusts until the object comes out. If they stop responding, start CPR.', fr: 'Alternez les tapes et les poussées jusqu’à ce que l’objet sorte. Si la personne ne répond plus, commencez la RCR.' } },
    ],
  },
];

export const SCRIPT_BY_SKILL = new Map(SCRIPTS.map(script => [script.skill, script]));
