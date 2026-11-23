// The nurse's note. Its facts are written by code from what was recorded, so they are the
// same every time. Gemini may add a short plain summary, which must pass a guard first.
import { SIGN_BY_ID, type Lang, type Level, type SignId } from '../data/protocol';
import { describeIngredients, titleCase, type Finding, type Medicine } from './meds';
import type { TriageResult } from './triage';

export interface Profile {
  name: string;
  birthYear?: number;
  area: string;
  allergies: string;
  conditions: string;
  contact: string;
  lang: Lang;
}

export interface Vitals { pulse?: number; pulseQuality?: number; coughs?: number; coughSeconds?: number }
export type AiTier = 'cloud' | 'device' | 'rules';

export interface Note {
  id: string;
  ownerId: string;
  area: string;
  createdAt: number;
  level: Level;
  call: '911' | '811';
  lang: Lang;
  who: string;
  age?: number;
  signs: SignId[];
  /** What the person said or typed, unchanged. */
  words: string;
  days?: number;
  vitals: Vitals;
  medicines: string[];
  flags: string[];
  allergies: string;
  conditions: string;
  reasons: string[];
  /** Optional plain summary written by Gemini. Absent when the AI was unavailable or the guard refused it. */
  summary?: string;
  aiTier: AiTier;
  hasPhoto: boolean;
  status: 'sent' | 'seen';
  /** Local only: true until the note has reached the shared store. */
  pending?: boolean;
}

export interface NoteInput {
  id: string;
  ownerId: string;
  now: number;
  profile: Profile;
  signs: SignId[];
  words: string;
  days?: number;
  vitals: Vitals;
  medicines: Medicine[];
  findings: Finding[];
  result: TriageResult;
  aiTier: AiTier;
  hasPhoto: boolean;
  summary?: string;
}

const RULE_TEXT: Record<string, Record<Lang, string>> = {
  fever_stiff_neck: { en: 'Fever with a stiff neck', fr: 'Fièvre avec raideur de la nuque' },
  head_injury_plus: { en: 'Blow to the head with vomiting, confusion or fainting', fr: 'Coup à la tête avec vomissements, confusion ou évanouissement' },
  fever_rash: { en: 'Fever with a rash', fr: 'Fièvre avec éruption cutanée' },
  fluid_loss_dizzy: { en: 'Vomiting or diarrhea with dizziness', fr: 'Vomissements ou diarrhée avec étourdissements' },
  pulse_extreme: { en: 'Pulse far outside the resting range', fr: 'Pouls très en dehors des valeurs au repos' },
  pulse_outside_range: { en: 'Pulse outside the resting range', fr: 'Pouls en dehors des valeurs au repos' },
  age_infant: { en: 'Under 1 year old', fr: 'Moins de 1 an' },
  age_75_plus: { en: '75 or older', fr: '75 ans ou plus' },
  lasting_a_week: { en: 'Lasting a week or more', fr: 'Dure depuis une semaine ou plus' },
};

export function reasonText(reason: { sign?: SignId; rule: string }, lang: Lang): string {
  if (reason.sign) return SIGN_BY_ID.get(reason.sign)?.label[lang] ?? reason.sign;
  return RULE_TEXT[reason.rule]?.[lang] ?? reason.rule;
}

export function buildNote(input: NoteInput): Note {
  const { profile, result } = input;
  const lang = profile.lang;
  const nameOf = new Map(input.medicines.map(medicine => [medicine.id, titleCase(medicine.brand)]));
  return {
    id: input.id,
    ownerId: input.ownerId,
    area: profile.area,
    createdAt: input.now,
    level: result.level,
    call: result.call,
    lang,
    who: profile.name.trim() || (lang === 'fr' ? 'Sans nom' : 'No name given'),
    age: profile.birthYear ? new Date(input.now).getFullYear() - profile.birthYear : undefined,
    signs: input.signs,
    words: input.words.trim().slice(0, 600),
    days: input.days,
    vitals: input.vitals,
    medicines: input.medicines.map(medicine => `${titleCase(medicine.brand)} (${describeIngredients(medicine)})`),
    flags: input.findings.map(finding => `${finding.medicines.map(id => nameOf.get(id) ?? id).join(' + ')}: ${finding.why[lang]}`),
    allergies: profile.allergies.trim(),
    conditions: profile.conditions.trim(),
    reasons: result.reasons.filter(reason => reason.level === result.level || !reason.sign).map(reason => reasonText(reason, lang)),
    summary: input.summary,
    aiTier: input.aiTier,
    hasPhoto: input.hasPhoto,
    status: 'sent',
  };
}

/** The facts handed to Gemini when it writes the plain summary. No names. */
export function factsForSummary(note: Note): string {
  const lines = [
    `Protocol result: ${note.level}.`,
    `Signs reported: ${note.signs.map(id => SIGN_BY_ID.get(id)?.label.en ?? id).join('; ') || 'none'}.`,
    note.words ? `In their words: "${note.words}"` : '',
    note.days ? `Duration: ${note.days} day(s).` : '',
    note.age !== undefined ? `Age: ${note.age}.` : '',
    note.vitals.pulse ? `Pulse measured by phone camera: ${note.vitals.pulse} bpm.` : '',
    note.vitals.coughs !== undefined ? `Coughs counted: ${note.vitals.coughs} in ${note.vitals.coughSeconds ?? 20} seconds.` : '',
    note.medicines.length ? `Medicines: ${note.medicines.join('; ')}.` : '',
    note.allergies ? `Allergies: ${note.allergies}.` : '',
    note.conditions ? `Conditions: ${note.conditions}.` : '',
  ];
  return lines.filter(Boolean).join('\n');
}
