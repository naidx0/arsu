// Guards. Everything an AI model returns passes through here before Kin uses it.
// The model may suggest signs from the protocol and word a summary. It may not add a sign,
// set a level, or diagnose.
import { SIGN_BY_ID, type SignId } from '../data/protocol';

/** Keeps only ids that exist in the protocol. Anything else the model returned is dropped. */
export function guardSigns(value: unknown): SignId[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((id): id is string => typeof id === 'string' && SIGN_BY_ID.has(id)))];
}

const DIAGNOSTIC = [
  /\bdiagnos/i,
  /\b(you|they|he|she|the patient|patient)\s+(probably\s+|likely\s+|may\s+|might\s+|could\s+)?(has|have|is having|are having|is suffering|suffers)\b/i,
  /\b(is|are|it's|its|looks|sounds|seems)\s+(likely|probably|consistent with|suggestive of|like (a|an)\b)/i,
  /\b(consistent with|suggestive of|indicative of|suggests|indicates|points to|rule out|rules out)\b/i,
  /\b(nothing to worry|no need to (see|call|worry)|is (fine|safe|harmless|not serious)|safe to (take|combine|ignore))\b/i,
  /\b(vous avez|il a|elle a|le patient a|la patiente a)\s+(probablement\s+|sans doute\s+)?(une?|la|le|l'|des)\b/i,
  /\b(compatible avec|evocateur|évocateur|suggere|suggère|indique|probablement|sans gravit)/i,
  /\b(take|prenez|prendre)\s+\d+\s*(mg|ml|tablet|comprim)/i,
];

export const SUMMARY_MAX = 480;

/**
 * Returns the summary if it only restates facts, or null if it diagnoses, reassures,
 * gives a dose, or is empty or too long. A null means the note goes out without it.
 */
export function guardSummary(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const text = value.replace(/\s+/g, ' ').trim();
  if (text.length < 12 || text.length > SUMMARY_MAX) return null;
  if (DIAGNOSTIC.some(pattern => pattern.test(text))) return null;
  return text;
}

export interface LabelRead { brand: string; din?: string }

/** A label read is only ever a search term: a brand in plain characters and an 8-digit DIN. */
export function guardLabels(value: unknown): LabelRead[] {
  if (!Array.isArray(value)) return [];
  const reads: LabelRead[] = [];
  for (const item of value.slice(0, 12)) {
    if (!item || typeof item !== 'object') continue;
    const { brand, din } = item as Record<string, unknown>;
    const name = typeof brand === 'string' ? brand.replace(/[^\p{L}\p{N} '&+\-./]/gu, '').trim().slice(0, 60) : '';
    const digits = typeof din === 'string' ? din.replace(/\D/g, '') : '';
    if (name.length < 2 && digits.length !== 8) continue;
    reads.push({ brand: name, din: digits.length === 8 ? digits : undefined });
  }
  return reads;
}

/** A photo description must describe, not diagnose. Same rule as the summary. */
export const guardDescription = guardSummary;
