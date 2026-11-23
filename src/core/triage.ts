// Triage: turns a set of signs and measurements into one level and what to do.
// Pure and deterministic. The AI never reaches this decision; it can only suggest signs,
// and those are filtered against the protocol before they arrive here.
import { COMBINATIONS, LEVEL_ORDER, PULSE, SIGN_BY_ID, SIGNS, type Lang, type Level, type SignId } from '../data/protocol';

export interface TriageInput {
  signs: SignId[];
  /** Resting pulse in beats per minute, if one was measured. */
  pulse?: number;
  ageYears?: number;
  /** How many days this has been going on. */
  days?: number;
}

export interface Reason {
  sign?: SignId;
  rule: string;
  level: Level;
  basis: string;
}

export interface TriageResult {
  level: Level;
  call: '911' | '811';
  reasons: Reason[];
  /** Keys into the i18n table, most important first. */
  actions: string[];
}

const rank = (level: Level) => LEVEL_ORDER.indexOf(level);
const higher = (a: Level, b: Level): Level => (rank(a) >= rank(b) ? a : b);
const VITALS = 'Adapted from public guidance on resting heart rate';

export function triage(input: TriageInput): TriageResult {
  const signs = [...new Set(input.signs)].filter(id => SIGN_BY_ID.has(id));
  const has = (id: SignId) => signs.includes(id);
  const reasons: Reason[] = signs.map(id => {
    const sign = SIGN_BY_ID.get(id)!;
    return { sign: id, rule: 'sign', level: sign.level, basis: sign.basis };
  });

  for (const combo of COMBINATIONS) {
    if (combo.all.every(group => group.some(has))) reasons.push({ rule: combo.rule, level: combo.level, basis: combo.basis });
  }

  const pulse = input.pulse;
  if (pulse !== undefined && Number.isFinite(pulse)) {
    if (pulse <= PULSE.emergencyLow || pulse >= PULSE.emergencyHigh) reasons.push({ rule: 'pulse_extreme', level: 'emergency', basis: VITALS });
    else if (pulse <= PULSE.urgentLow || pulse >= PULSE.urgentHigh) reasons.push({ rule: 'pulse_outside_range', level: 'urgent', basis: VITALS });
  }

  let level = reasons.reduce<Level>((top, reason) => higher(top, reason.level), 'routine');

  // Modifiers only ever raise a result, and only by one step.
  const age = input.ageYears;
  const frail = age !== undefined && (age < 1 || age >= 75);
  if (frail && signs.length > 0 && rank(level) < rank('urgent')) {
    reasons.push({ rule: age! < 1 ? 'age_infant' : 'age_75_plus', level: 'urgent', basis: 'Adapted from public guidance: infants and older adults are seen sooner' });
    level = 'urgent';
  }
  if ((input.days ?? 0) >= 7 && level === 'routine' && signs.length > 0) {
    reasons.push({ rule: 'lasting_a_week', level: 'soon', basis: 'Adapted from public guidance: symptoms that do not improve in a week' });
    level = 'soon';
  }

  reasons.sort((a, b) => rank(b.level) - rank(a.level));
  return { level, call: level === 'emergency' ? '911' : '811', reasons, actions: actionsFor(level, signs) };
}

function actionsFor(level: Level, signs: SignId[]): string[] {
  const has = (id: SignId) => signs.includes(id);
  if (level === 'emergency') {
    const actions = ['act.call911'];
    if (has('self_harm')) actions.push('act.call988');
    if (has('overdose')) actions.push('act.naloxone');
    if (has('bleeding')) actions.push('act.pressure');
    if (has('unresponsive') || has('blue_lips')) actions.push('act.cpr');
    if (has('chest_pain') || has('breathing')) actions.push('act.rest');
    actions.push('act.stayOnLine', 'act.unlockDoor');
    return actions;
  }
  if (level === 'urgent') return ['act.nurseToday', 'act.sendNote', 'act.ifWorse911'];
  if (level === 'soon') return ['act.bookVisit', 'act.sendNote', 'act.restFluids', 'act.checkAgain'];
  return signs.length ? ['act.restFluids', 'act.checkAgain', 'act.nurseIfWorried'] : ['act.tellMore'];
}

// ---- Matching free words to signs (the always-available tier) -----------------------

const NEGATIONS = new Set(['no', 'not', 'without', 'never', 'denies', 'pas', 'sans', 'aucun', 'aucune', 'ni', 'jamais']);

export function normalise(text: string): string {
  return text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[’`]/g, "'").replace(/\s+/g, ' ').trim();
}

/** Signs whose words appear in the text. A sign that is negated in the same clause is skipped. */
export function matchSigns(text: string, langs: Lang[] = ['en', 'fr']): SignId[] {
  const clean = normalise(text);
  const found: SignId[] = [];
  for (const sign of SIGNS) {
    const words = langs.flatMap(lang => sign.words[lang]);
    if (words.some(word => appears(clean, word))) found.push(sign.id);
  }
  return found;
}

function appears(clean: string, word: string): boolean {
  const whole = word.endsWith('$');
  const phrase = whole ? word.slice(0, -1) : word;
  let from = 0;
  for (;;) {
    const at = clean.indexOf(phrase, from);
    if (at < 0) return false;
    from = at + 1;
    const before = at === 0 ? ' ' : clean[at - 1];
    if (/[a-z0-9]/.test(before)) continue;
    if (whole && /[a-z0-9]/.test(clean[at + phrase.length] ?? ' ')) continue;
    const clause = clean.slice(0, at).split(/[.,;:!?]/).pop()!;
    const previous = clause.trim().split(' ').filter(Boolean).slice(-3).map(token => token.replace(/^[a-z]'/, ''));
    if (previous.some(token => NEGATIONS.has(token))) continue;
    return true;
  }
}
