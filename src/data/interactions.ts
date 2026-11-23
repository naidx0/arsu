// A short list of well-known risky combinations, by drug class. It is deliberately small:
// each entry is a widely published warning. It is NOT a complete interaction database, and
// the app says so wherever a result is shown. See docs/SAFETY.md.
import type { Lang } from './protocol';

/** Class name to the active-ingredient names (lower case) that belong to it. */
export const CLASSES: Record<string, string[]> = {
  acetaminophen: ['acetaminophen'],
  opioid: ['codeine', 'morphine', 'oxycodone', 'hydromorphone', 'hydrocodone', 'fentanyl', 'tramadol', 'methadone', 'tapentadol', 'buprenorphine'],
  benzodiazepine: ['lorazepam', 'diazepam', 'clonazepam', 'alprazolam', 'temazepam', 'oxazepam', 'zopiclone', 'zolpidem'],
  sedatingAntihistamine: ['diphenhydramine', 'dimenhydrinate', 'doxylamine', 'chlorpheniramine', 'hydroxyzine'],
  anticoagulant: ['warfarin', 'apixaban', 'rivaroxaban', 'dabigatran', 'edoxaban'],
  warfarin: ['warfarin'],
  nsaid: ['ibuprofen', 'naproxen', 'acetylsalicylic acid', 'diclofenac', 'celecoxib', 'ketorolac', 'indomethacin', 'meloxicam'],
  ssri: ['sertraline', 'fluoxetine', 'citalopram', 'escitalopram', 'paroxetine', 'fluvoxamine', 'venlafaxine', 'desvenlafaxine', 'duloxetine'],
  maoi: ['phenelzine', 'tranylcypromine', 'moclobemide', 'selegiline', 'rasagiline'],
  serotonergicOther: ['tramadol', 'dextromethorphan'],
  decongestant: ['pseudoephedrine', 'phenylephrine'],
  nitrate: ['nitroglycerin', 'isosorbide'],
  pde5: ['sildenafil', 'tadalafil', 'vardenafil'],
  raas: ['ramipril', 'lisinopril', 'perindopril', 'enalapril', 'quinapril', 'trandolapril', 'candesartan', 'valsartan', 'losartan', 'irbesartan', 'telmisartan', 'olmesartan'],
  potassiumRaiser: ['spironolactone', 'eplerenone', 'amiloride', 'triamterene', 'potassium chloride', 'potassium citrate'],
  lithium: ['lithium'],
  methotrexate: ['methotrexate'],
  trimethoprim: ['trimethoprim'],
  warfarinBooster: ['sulfamethoxazole', 'metronidazole', 'fluconazole', 'clarithromycin', 'erythromycin', 'amiodarone'],
  statinCyp: ['simvastatin', 'atorvastatin', 'lovastatin'],
  macrolide: ['clarithromycin', 'erythromycin'],
};

export type Severity = 'high' | 'moderate';

export interface Pair {
  a: string;
  b: string;
  severity: Severity;
  why: Record<Lang, string>;
  basis: string;
}

const HC = 'Health Canada product monograph warnings';

export const PAIRS: Pair[] = [
  { a: 'opioid', b: 'benzodiazepine', severity: 'high', basis: 'Health Canada advisory: opioids with benzodiazepines',
    why: { en: 'Together these can cause deep sleepiness and dangerously slow breathing.', fr: 'Ensemble, ils peuvent causer une forte somnolence et ralentir dangereusement la respiration.' } },
  { a: 'opioid', b: 'sedatingAntihistamine', severity: 'moderate', basis: HC,
    why: { en: 'Both cause drowsiness. Together the effect is stronger and breathing can slow.', fr: 'Les deux causent de la somnolence. Ensemble, l’effet est plus fort et la respiration peut ralentir.' } },
  { a: 'benzodiazepine', b: 'sedatingAntihistamine', severity: 'moderate', basis: HC,
    why: { en: 'Both cause drowsiness. Together they raise the risk of falls and confusion.', fr: 'Les deux causent de la somnolence. Ensemble, ils augmentent le risque de chutes et de confusion.' } },
  { a: 'anticoagulant', b: 'nsaid', severity: 'high', basis: HC,
    why: { en: 'A blood thinner with an anti-inflammatory painkiller raises the risk of serious bleeding.', fr: 'Un anticoagulant avec un anti-inflammatoire augmente le risque de saignement grave.' } },
  { a: 'warfarin', b: 'warfarinBooster', severity: 'high', basis: HC,
    why: { en: 'This medicine can make warfarin much stronger and cause bleeding.', fr: 'Ce médicament peut rendre la warfarine beaucoup plus forte et causer des saignements.' } },
  { a: 'nitrate', b: 'pde5', severity: 'high', basis: HC,
    why: { en: 'Together these can cause a sudden, dangerous drop in blood pressure.', fr: 'Ensemble, ils peuvent causer une chute soudaine et dangereuse de la tension artérielle.' } },
  { a: 'maoi', b: 'ssri', severity: 'high', basis: HC,
    why: { en: 'Together these can cause serotonin syndrome, which can be life-threatening.', fr: 'Ensemble, ils peuvent causer un syndrome sérotoninergique, qui peut être mortel.' } },
  { a: 'maoi', b: 'serotonergicOther', severity: 'high', basis: HC,
    why: { en: 'Together these can cause serotonin syndrome, which can be life-threatening.', fr: 'Ensemble, ils peuvent causer un syndrome sérotoninergique, qui peut être mortel.' } },
  { a: 'maoi', b: 'decongestant', severity: 'high', basis: HC,
    why: { en: 'Together these can cause a dangerous rise in blood pressure.', fr: 'Ensemble, ils peuvent causer une hausse dangereuse de la tension artérielle.' } },
  { a: 'ssri', b: 'serotonergicOther', severity: 'moderate', basis: HC,
    why: { en: 'Together these raise the risk of serotonin syndrome.', fr: 'Ensemble, ils augmentent le risque de syndrome sérotoninergique.' } },
  { a: 'raas', b: 'potassiumRaiser', severity: 'moderate', basis: HC,
    why: { en: 'Together these can raise potassium in the blood to an unsafe level.', fr: 'Ensemble, ils peuvent faire monter le potassium dans le sang à un niveau dangereux.' } },
  { a: 'raas', b: 'nsaid', severity: 'moderate', basis: HC,
    why: { en: 'Anti-inflammatory painkillers can weaken this blood pressure medicine and strain the kidneys.', fr: 'Les anti-inflammatoires peuvent affaiblir ce médicament pour la tension et fatiguer les reins.' } },
  { a: 'lithium', b: 'nsaid', severity: 'high', basis: HC,
    why: { en: 'Anti-inflammatory painkillers can raise lithium to a toxic level.', fr: 'Les anti-inflammatoires peuvent faire monter le lithium à un niveau toxique.' } },
  { a: 'lithium', b: 'raas', severity: 'high', basis: HC,
    why: { en: 'This blood pressure medicine can raise lithium to a toxic level.', fr: 'Ce médicament pour la tension peut faire monter le lithium à un niveau toxique.' } },
  { a: 'methotrexate', b: 'trimethoprim', severity: 'high', basis: HC,
    why: { en: 'Together these can seriously harm the bone marrow.', fr: 'Ensemble, ils peuvent gravement nuire à la moelle osseuse.' } },
  { a: 'methotrexate', b: 'nsaid', severity: 'moderate', basis: HC,
    why: { en: 'Anti-inflammatory painkillers can raise methotrexate to a harmful level.', fr: 'Les anti-inflammatoires peuvent faire monter le méthotrexate à un niveau nocif.' } },
  { a: 'statinCyp', b: 'macrolide', severity: 'high', basis: HC,
    why: { en: 'This antibiotic can raise the cholesterol medicine to a level that damages muscle.', fr: 'Cet antibiotique peut faire monter le médicament pour le cholestérol à un niveau qui endommage les muscles.' } },
];

/** Classes where two different members together are themselves a risk. */
export const DOUBLE_UP: { cls: string; severity: Severity; why: Record<Lang, string>; basis: string }[] = [
  { cls: 'nsaid', severity: 'moderate', basis: HC,
    why: { en: 'Two anti-inflammatory painkillers together raise the risk of stomach bleeding and kidney harm.', fr: 'Deux anti-inflammatoires ensemble augmentent le risque de saignement de l’estomac et de dommages aux reins.' } },
  { cls: 'opioid', severity: 'high', basis: HC,
    why: { en: 'Two opioid medicines together raise the risk of overdose.', fr: 'Deux opioïdes ensemble augmentent le risque de surdose.' } },
  { cls: 'benzodiazepine', severity: 'high', basis: HC,
    why: { en: 'Two sedatives together raise the risk of deep sleepiness and slow breathing.', fr: 'Deux sédatifs ensemble augmentent le risque de forte somnolence et de respiration lente.' } },
  { cls: 'anticoagulant', severity: 'high', basis: HC,
    why: { en: 'Two blood thinners together greatly raise the risk of bleeding.', fr: 'Deux anticoagulants ensemble augmentent beaucoup le risque de saignement.' } },
];

/** Why the same ingredient twice matters, for the ingredients where the reason is well known. */
export const DUPLICATE_WHY: Record<string, Record<Lang, string>> = {
  acetaminophen: { en: 'Too much acetaminophen can cause serious liver damage. Many cold and pain medicines contain it.', fr: 'Trop d’acétaminophène peut causer de graves dommages au foie. Plusieurs médicaments contre le rhume et la douleur en contiennent.' },
};
