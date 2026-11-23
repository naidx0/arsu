// Medicine checks. The drug record comes from Health Canada's database; the checks here
// are set logic over its active ingredients. Kin never says a combination is safe.
import { CLASSES, DOUBLE_UP, DUPLICATE_WHY, PAIRS, type Severity } from '../data/interactions';
import type { Lang } from '../data/protocol';

export interface Ingredient { name: string; strength: string }
export interface Drug { din?: string; brand: string; company?: string; ingredients: Ingredient[] }
export interface Medicine extends Drug { id: string; times: string[]; addedAt: number }

export interface Finding {
  kind: 'duplicate' | 'pair' | 'double';
  severity: Severity;
  /** Ids of the two or more medicines involved. */
  medicines: string[];
  /** The shared ingredient or the two classes, for display. */
  subject: string;
  why: Record<Lang, string>;
  basis: string;
}

const SALTS = new Set(['hydrochloride', 'hydrobromide', 'sodium', 'disodium', 'phosphate', 'sulfate', 'sulphate', 'maleate', 'succinate', 'fumarate', 'tartrate', 'besylate', 'calcium', 'carbonate', 'cilexetil', 'erbumine', 'etexilate', 'citrate', 'oxalate', 'magnesium', 'trihydrate', 'dihydrate', 'monohydrate', 'mesilate', 'mesylate', 'potassium', 'acetate', 'bromide', 'chloride', 'arginine']);
const MINERALS = new Set(['potassium', 'sodium', 'calcium', 'magnesium', 'zinc', 'ferrous']);

/** "CODEINE PHOSPHATE" and "Codeine (codeine sulfate)" are both "codeine". */
export function baseName(ingredient: string): string {
  const words = ingredient.toLowerCase().replace(/\(.*$/, '').trim().split(/\s+/);
  if (MINERALS.has(words[0])) return words.join(' ');
  while (words.length > 1 && SALTS.has(words[words.length - 1])) words.pop();
  return words.join(' ');
}

export function classesOf(ingredient: string): string[] {
  const name = baseName(ingredient);
  return Object.keys(CLASSES).filter(cls => CLASSES[cls].some(member => name === member || name.startsWith(`${member} `) || name.endsWith(` ${member}`)));
}

const order = (severity: Severity) => (severity === 'high' ? 0 : 1);

export function checkMedicines(medicines: Medicine[]): Finding[] {
  const findings: Finding[] = [];
  const bases = medicines.map(medicine => new Set(medicine.ingredients.map(item => baseName(item.name))));
  const classes = medicines.map(medicine => new Set(medicine.ingredients.flatMap(item => classesOf(item.name))));

  // 1. The same active ingredient in two or more medicines.
  const holders = new Map<string, string[]>();
  medicines.forEach((medicine, i) => bases[i].forEach(base => holders.set(base, [...(holders.get(base) ?? []), medicine.id])));
  for (const [base, ids] of holders) {
    if (ids.length < 2) continue;
    const known = DUPLICATE_WHY[base];
    const risky = known || classesOf(base).some(cls => DOUBLE_UP.some(rule => rule.cls === cls && rule.severity === 'high'));
    findings.push({
      kind: 'duplicate', severity: risky ? 'high' : 'moderate', medicines: ids, subject: base,
      why: known ?? { en: `These contain the same medicine (${base}). Taking both can mean a double dose.`, fr: `Ils contiennent le même médicament (${base}). Les prendre ensemble peut donner une double dose.` },
      basis: 'Health Canada Drug Product Database: active ingredients',
    });
  }

  for (let i = 0; i < medicines.length; i++) {
    for (let j = i + 1; j < medicines.length; j++) {
      const shared = [...bases[i]].some(base => bases[j].has(base));
      // 2. Two different members of a class that should not be doubled.
      for (const rule of DOUBLE_UP) {
        if (classes[i].has(rule.cls) && classes[j].has(rule.cls) && !sameMembers(medicines[i], medicines[j], rule.cls)) {
          findings.push({ kind: 'double', severity: rule.severity, medicines: [medicines[i].id, medicines[j].id], subject: rule.cls, why: rule.why, basis: rule.basis });
        }
      }
      // 3. Known risky class pairs, in either direction.
      for (const pair of PAIRS) {
        const forward = classes[i].has(pair.a) && classes[j].has(pair.b), backward = classes[i].has(pair.b) && classes[j].has(pair.a);
        if (!forward && !backward) continue;
        // One ingredient can sit in both classes (tramadol). That is not a pair by itself.
        if (shared && pair.a !== pair.b && onlyViaShared(medicines[i], medicines[j], pair.a, pair.b)) continue;
        findings.push({ kind: 'pair', severity: pair.severity, medicines: [medicines[i].id, medicines[j].id], subject: `${pair.a}+${pair.b}`, why: pair.why, basis: pair.basis });
      }
    }
  }

  const seen = new Set<string>();
  return findings
    .filter(finding => { const key = `${finding.kind}|${finding.subject}|${[...finding.medicines].sort().join(',')}`; if (seen.has(key)) return false; seen.add(key); return true; })
    .sort((a, b) => order(a.severity) - order(b.severity));
}

function membersIn(medicine: Drug, cls: string): Set<string> {
  return new Set(medicine.ingredients.map(item => baseName(item.name)).filter(base => classesOf(base).includes(cls)));
}

function sameMembers(a: Drug, b: Drug, cls: string): boolean {
  const first = membersIn(a, cls), second = membersIn(b, cls);
  return first.size === second.size && [...first].every(member => second.has(member));
}

function onlyViaShared(a: Drug, b: Drug, clsA: string, clsB: string): boolean {
  const all = (medicine: Drug, cls: string) => [...membersIn(medicine, cls)];
  const pairs = [...all(a, clsA).flatMap(x => all(b, clsB).map(y => [x, y])), ...all(a, clsB).flatMap(x => all(b, clsA).map(y => [x, y]))];
  return pairs.length > 0 && pairs.every(([x, y]) => x === y);
}

/** Search the offline snapshot by brand, ingredient or DIN. Brand prefix matches come first. */
export function searchDrugs(query: string, drugs: Drug[], limit = 8): Drug[] {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return [];
  const scored: { drug: Drug; score: number }[] = [];
  for (const drug of drugs) {
    const brand = drug.brand.toLowerCase();
    const score = drug.din === q ? 0 : brand.startsWith(q) ? 1 : brand.includes(q) ? 2 : drug.ingredients.some(item => item.name.toLowerCase().includes(q)) ? 3 : drug.din?.startsWith(q) ? 4 : -1;
    if (score >= 0) scored.push({ drug, score });
  }
  return scored.sort((a, b) => a.score - b.score || a.drug.brand.length - b.drug.brand.length).slice(0, limit).map(item => item.drug);
}

/** "ACETAMINOPHEN 500 MG" in sentence case for display. */
export function describeIngredients(drug: Drug): string {
  return drug.ingredients.map(item => `${titleCase(baseName(item.name))} ${item.strength.toLowerCase().replace(/\s+/g, ' ')}`).join(' · ');
}

export function titleCase(text: string): string {
  return text.toLowerCase().replace(/(^|[\s\-/(])([a-zà-ÿ])/g, (_, lead: string, letter: string) => lead + letter.toUpperCase());
}
