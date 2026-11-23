import { describe, expect, it } from 'vitest';
import { guardLabels, guardSigns, guardSummary } from '../src/ai/guard';
import { clusters, readiness, rotatingKey, type Signal } from '../src/core/community';
import { baseName, checkMedicines, classesOf, searchDrugs, type Drug, type Medicine } from '../src/core/meds';
import { buildNote, factsForSummary, type Profile } from '../src/core/note';
import { CompressionDetector, countCoughs, estimatePulse, fingerCovers, judgePace, paceOf, scorePractice } from '../src/core/signal';
import { matchSigns, triage } from '../src/core/triage';
import snapshot from '../src/data/drugs.json';
import { CLASSES, DOUBLE_UP, PAIRS } from '../src/data/interactions';
import { COMBINATIONS, LEVEL_ORDER, SIGNS, SIGN_BY_ID, type Level } from '../src/data/protocol';
import { SCRIPTS } from '../src/data/scripts';

const drugs = snapshot.drugs as Drug[];
const rank = (level: Level) => LEVEL_ORDER.indexOf(level);

describe('protocol data', () => {
  it('has unique ids and both languages for every sign', () => {
    expect(new Set(SIGNS.map(sign => sign.id)).size).toBe(SIGNS.length);
    for (const sign of SIGNS) {
      expect(sign.label.en && sign.label.fr, sign.id).toBeTruthy();
      expect(sign.words.en.length && sign.words.fr.length, sign.id).toBeGreaterThan(0);
      for (const word of [...sign.words.en, ...sign.words.fr]) expect(word, `${sign.id}: ${word}`).toBe(word.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''));
    }
  });
  it('only combines signs that exist', () => {
    for (const combo of COMBINATIONS) for (const id of combo.all.flat()) expect(SIGN_BY_ID.has(id), id).toBe(true);
  });
  it('gives every script step both languages', () => {
    for (const script of SCRIPTS) for (const step of script.steps) expect(step.say.en && step.say.fr && step.title.en && step.title.fr, script.skill).toBeTruthy();
    expect(SCRIPTS.find(script => script.skill === 'cpr')!.steps.some(step => step.beat)).toBe(true);
  });
});

describe('triage', () => {
  it('each sign alone reaches exactly its own level', () => {
    for (const sign of SIGNS) expect(triage({ signs: [sign.id] }).level, sign.id).toBe(sign.level);
  });
  it('sends every emergency sign to 911 and nothing else there', () => {
    for (const sign of SIGNS) expect(triage({ signs: [sign.id] }).call, sign.id).toBe(sign.level === 'emergency' ? '911' : '811');
  });
  it('never lowers a level when a sign is added', () => {
    for (const a of SIGNS) for (const b of SIGNS) {
      expect(rank(triage({ signs: [a.id, b.id] }).level), `${a.id}+${b.id}`).toBeGreaterThanOrEqual(Math.max(rank(a.level), rank(b.level)));
    }
  });
  it('raises combinations', () => {
    expect(triage({ signs: ['fever', 'stiff_neck'] }).level).toBe('emergency');
    expect(triage({ signs: ['head_injury', 'vomiting'] }).level).toBe('emergency');
    expect(triage({ signs: ['fever', 'rash'] }).level).toBe('urgent');
    expect(triage({ signs: ['diarrhea', 'dizzy'] }).level).toBe('urgent');
    expect(triage({ signs: ['fever'] }).level).toBe('soon');
  });
  it('raises on pulse, age and duration, and only raises', () => {
    expect(triage({ signs: ['cough'], pulse: 72 }).level).toBe('routine');
    expect(triage({ signs: ['cough'], pulse: 128 }).level).toBe('urgent');
    expect(triage({ signs: ['cough'], pulse: 44 }).level).toBe('urgent');
    expect(triage({ signs: ['cough'], pulse: 160 }).level).toBe('emergency');
    expect(triage({ signs: ['cough'], ageYears: 80 }).level).toBe('urgent');
    expect(triage({ signs: ['cough'], ageYears: 0 }).level).toBe('urgent');
    expect(triage({ signs: ['cough'], ageYears: 40 }).level).toBe('routine');
    expect(triage({ signs: ['cough'], days: 9 }).level).toBe('soon');
    expect(triage({ signs: ['chest_pain'], pulse: 72, ageYears: 30, days: 1 }).level).toBe('emergency');
  });
  it('ignores ids that are not in the protocol', () => {
    const result = triage({ signs: ['made_up', 'cough'] });
    expect(result.level).toBe('routine');
    expect(result.reasons.map(reason => reason.sign)).toEqual(['cough']);
  });
  it('tells a person in crisis about 9-8-8 and an overdose about naloxone', () => {
    expect(triage({ signs: ['self_harm'] }).actions).toContain('act.call988');
    expect(triage({ signs: ['overdose'] }).actions).toContain('act.naloxone');
    expect(triage({ signs: ['chest_pain'] }).actions[0]).toBe('act.call911');
  });
  it('with nothing reported asks for more and reassures nobody', () => {
    expect(triage({ signs: [] })).toMatchObject({ level: 'routine', actions: ['act.tellMore'] });
  });
});

describe('matching words to signs', () => {
  const cases: [string, string[]][] = [
    ["My chest hurts and I can't catch my breath", ['chest_pain', 'breathing']],
    ['I have had a cough and a sore throat for two days', ['cough', 'sore_throat']],
    ["J'ai mal à la poitrine et du mal à respirer", ['chest_pain', 'breathing']],
    ["J'ai de la fièvre et la nuque raide", ['stiff_neck', 'fever']],
    ['He hit his head and now he is throwing up', ['head_injury', 'vomiting']],
    ['There is pus coming from the wound', ['wound_infected', 'wound']],
    ['Elle a de la diarrhée et des vomissements', ['vomiting', 'diarrhea']],
  ];
  it.each(cases)('%s', (text, expected) => {
    expect(matchSigns(text).sort()).toEqual([...expected].sort());
  });
  it('skips a sign that is denied in the same clause', () => {
    expect(matchSigns('I have a cough but no chest pain')).toEqual(['cough']);
    expect(matchSigns("J'ai de la toux, pas de fièvre")).toEqual(['cough']);
    expect(matchSigns('No. Chest pain since this morning')).toEqual(['chest_pain']);
  });
  it('does not fire on look-alike words', () => {
    expect(matchSigns('I had to push the car and I am confused about my pills')).toEqual([]);
    expect(matchSigns('I think it was food poisoning from the fish')).toEqual([]);
    expect(matchSigns('That is a cute dog')).toEqual([]);
  });
  it('finds every sign from its own label in both languages', () => {
    for (const sign of SIGNS) {
      const first = sign.words.en[0].replace(/\$$/, ''), premier = sign.words.fr[0].replace(/\$$/, '');
      expect(matchSigns(`I have ${first} today`), sign.id).toContain(sign.id);
      expect(matchSigns(`Il y a ${premier} depuis hier`), sign.id).toContain(sign.id);
    }
  });
});

describe('pulse from camera samples', () => {
  const wave = (bpm: number, fps: number, seconds: number, noise = 0.15) => {
    let seed = 7;
    const random = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296 - 0.5; };
    return Array.from({ length: fps * seconds }, (_, i) => 180 + Math.sin((2 * Math.PI * bpm * i) / (fps * 60)) + 0.4 * Math.sin((4 * Math.PI * bpm * i) / (fps * 60)) + noise * random() + i * 0.002);
  };
  it.each([48, 60, 72, 95, 120, 150])('reads %i bpm within 3', bpm => {
    const reading = estimatePulse(wave(bpm, 30, 15), 30);
    expect(reading).not.toBeNull();
    expect(Math.abs(reading!.bpm - bpm)).toBeLessThanOrEqual(3);
  });
  it('refuses noise, a flat signal and a short recording', () => {
    let seed = 3;
    const noise = Array.from({ length: 450 }, () => { seed = (seed * 1103515245 + 12345) % 2147483648; return 180 + seed / 2147483648; });
    expect(estimatePulse(noise, 30)).toBeNull();
    expect(estimatePulse(new Array(450).fill(180), 30)).toBeNull();
    expect(estimatePulse(wave(72, 30, 3), 30)).toBeNull();
  });
  it('knows a covered lens from an open one', () => {
    expect(fingerCovers(210, 40, 30)).toBe(true);
    expect(fingerCovers(120, 118, 110)).toBe(false);
    expect(fingerCovers(20, 5, 5)).toBe(false);
  });
});

describe('compression pace', () => {
  const press = (rate: number, seconds: number) => {
    const detector = new CompressionDetector();
    for (let t = 0; t < seconds * 1000; t += 16) {
      const phase = ((t * rate) / 60000) % 1;
      detector.push(t, phase < 0.18 ? 9 * Math.sin((phase / 0.18) * Math.PI) : 0.2);
    }
    return detector.beats;
  };
  it.each([80, 100, 110, 120, 140])('measures %i a minute within 4', rate => {
    expect(Math.abs(paceOf(press(rate, 12))! - rate)).toBeLessThanOrEqual(4);
  });
  it('judges slow, good and fast', () => {
    expect(judgePace(paceOf(press(80, 12)))).toBe('slow');
    expect(judgePace(paceOf(press(110, 12)))).toBe('good');
    expect(judgePace(paceOf(press(140, 12)))).toBe('fast');
    expect(judgePace(null)).toBe('none');
  });
  it('counts nothing while the phone lies still', () => {
    const detector = new CompressionDetector();
    for (let t = 0; t < 8000; t += 16) detector.push(t, 0.15 * Math.sin(t / 90));
    expect(detector.beats).toHaveLength(0);
  });
  it('scores the share of compressions in the target pace', () => {
    expect(scorePractice(press(110, 20)).inTarget).toBeGreaterThanOrEqual(95);
    expect(scorePractice(press(70, 20)).inTarget).toBeLessThanOrEqual(5);
    expect(scorePractice([])).toMatchObject({ compressions: 0, averageRate: null });
  });
});

describe('cough counter', () => {
  const recording = (coughsAt: number[], frames = 200) => Array.from({ length: frames }, (_, i) => (coughsAt.some(at => i >= at && i < at + 6) ? 0.4 : 0.01));
  it('counts separate bursts', () => {
    expect(countCoughs(recording([20, 60, 120]), 50)).toBe(3);
    expect(countCoughs(recording([]), 50)).toBe(0);
  });
  it('ignores a long steady sound such as speech or a fan', () => {
    expect(countCoughs(Array.from({ length: 200 }, (_, i) => (i > 40 && i < 140 ? 0.4 : 0.01)), 50)).toBe(0);
  });
});

describe('medicines', () => {
  const med = (din: string, id = din): Medicine => {
    const drug = drugs.find(item => item.din === din);
    if (!drug) throw new Error(`DIN ${din} is not in the snapshot`);
    return { ...drug, id, times: [], addedAt: 0 };
  };
  const byIngredient = (name: string, not: string[] = []) => {
    const drug = drugs.find(item => item.ingredients.length === 1 && baseName(item.ingredients[0].name) === name && !not.includes(item.din!));
    if (!drug) throw new Error(`no single-ingredient ${name} in the snapshot`);
    return { ...drug, id: drug.din!, times: [], addedAt: 0 } as Medicine;
  };
  const withAll = (names: string[]) => {
    const drug = drugs.find(item => names.every(name => item.ingredients.some(part => baseName(part.name) === name)));
    if (!drug) throw new Error(`no product with ${names.join('+')}`);
    return { ...drug, id: drug.din!, times: [], addedAt: 0 } as Medicine;
  };

  it('reduces salts to the base name', () => {
    expect(baseName('CODEINE PHOSPHATE')).toBe('codeine');
    expect(baseName('SERTRALINE (SERTRALINE HYDROCHLORIDE)')).toBe('sertraline');
    expect(baseName('NAPROXEN SODIUM')).toBe('naproxen');
    expect(baseName('POTASSIUM CHLORIDE')).toBe('potassium chloride');
    expect(baseName('ACETYLSALICYLIC ACID')).toBe('acetylsalicylic acid');
  });
  it('puts every snapshot ingredient it claims to know in a class', () => {
    expect(classesOf('OXYCODONE HYDROCHLORIDE')).toContain('opioid');
    expect(classesOf('WARFARIN SODIUM')).toEqual(expect.arrayContaining(['anticoagulant', 'warfarin']));
    expect(classesOf('HYDROMORPHONE HYDROCHLORIDE')).toEqual(['opioid']);
    expect(classesOf('NALOXONE HYDROCHLORIDE')).toEqual([]);
  });
  it('only pairs classes that exist', () => {
    for (const pair of PAIRS) { expect(CLASSES[pair.a], pair.a).toBeTruthy(); expect(CLASSES[pair.b], pair.b).toBeTruthy(); }
    for (const rule of DOUBLE_UP) expect(CLASSES[rule.cls], rule.cls).toBeTruthy();
  });
  it('flags acetaminophen in two products as high', () => {
    const plain = byIngredient('acetaminophen');
    const cold = drugs.find(item => item.ingredients.length > 1 && item.ingredients.some(part => baseName(part.name) === 'acetaminophen'))!;
    const findings = checkMedicines([plain, { ...cold, id: 'cold', times: [], addedAt: 0 }]);
    expect(findings.find(finding => finding.kind === 'duplicate')).toMatchObject({ subject: 'acetaminophen', severity: 'high' });
  });
  it('flags a blood thinner with an anti-inflammatory', () => {
    const findings = checkMedicines([byIngredient('warfarin'), byIngredient('ibuprofen')]);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ kind: 'pair', severity: 'high' });
  });
  it('flags an opioid with a sedative, and two anti-inflammatories', () => {
    expect(checkMedicines([byIngredient('oxycodone'), byIngredient('lorazepam')])[0]).toMatchObject({ kind: 'pair', severity: 'high' });
    expect(checkMedicines([byIngredient('ibuprofen'), byIngredient('naproxen')])[0]).toMatchObject({ kind: 'double', subject: 'nsaid' });
  });
  it('flags a nitrate with sildenafil and warfarin with an antibiotic that boosts it', () => {
    expect(checkMedicines([withAll(['nitroglycerin']), withAll(['sildenafil'])])[0].severity).toBe('high');
    expect(checkMedicines([byIngredient('warfarin'), withAll(['sulfamethoxazole', 'trimethoprim'])])[0].severity).toBe('high');
  });
  it('raises nothing for unrelated medicines or one medicine alone', () => {
    expect(checkMedicines([byIngredient('metformin'), byIngredient('levothyroxine'), byIngredient('amoxicillin')])).toEqual([]);
    expect(checkMedicines([withAll(['tramadol'])])).toEqual([]);
    expect(checkMedicines([])).toEqual([]);
  });
  it('reports the same two products once per reason', () => {
    const a = byIngredient('ibuprofen'), b = byIngredient('ibuprofen', [a.din!]);
    const findings = checkMedicines([a, b]);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ kind: 'duplicate', subject: 'ibuprofen' });
  });
  it('searches the snapshot by brand, ingredient and DIN', () => {
    expect(searchDrugs('tyl', drugs)[0].brand).toMatch(/^TYLENOL/);
    expect(searchDrugs('warfarin', drugs).length).toBeGreaterThan(0);
    expect(searchDrugs(med(drugs[0].din!).din!, drugs)[0].din).toBe(drugs[0].din);
    expect(searchDrugs('t', drugs)).toEqual([]);
  });
  it('holds a real snapshot', () => {
    expect(drugs.length).toBeGreaterThan(120);
    for (const drug of drugs) { expect(drug.din).toMatch(/^\d{8}$/); expect(drug.ingredients.length).toBeGreaterThan(0); }
  });
});

describe('community', () => {
  const today = '2026-11-23';
  const day = (ago: number) => new Date(Date.parse(today) - ago * 86_400_000).toISOString().slice(0, 10);
  const many = (area: string, count: number, ago: number, prefix: string): Signal[] => Array.from({ length: count }, (_, i) => ({ area, group: 'respiratory' as const, day: day(ago), key: `${prefix}${i}` }));
  it('flags a jump and stays quiet on a steady week', () => {
    const signals = [...many('East Side', 7, 2, 'e'), ...many('East Side', 1, 10, 'x'), ...many('Hilltop', 4, 2, 'h'), ...many('Old Town', 6, 1, 'o'), ...many('Old Town', 6, 9, 'p'), ...many('Old Town', 6, 16, 'q'), ...many('Old Town', 6, 23, 'r')];
    const result = clusters(signals, today);
    expect(result.find(item => item.area === 'East Side')).toMatchObject({ thisWeek: 7, flagged: true });
    expect(result.find(item => item.area === 'Hilltop')).toMatchObject({ thisWeek: 4, flagged: false });
    expect(result.find(item => item.area === 'Old Town')).toMatchObject({ thisWeek: 6, earlier: 6, flagged: false });
    expect(result[0].area).toBe('East Side');
  });
  it('counts a household once however often it reports', () => {
    const repeats: Signal[] = Array.from({ length: 9 }, (_, i) => ({ area: 'Lakeshore', group: 'fever' as const, day: day(i % 5), key: 'same' }));
    expect(clusters(repeats, today)[0]).toMatchObject({ thisWeek: 1, flagged: false });
  });
  it('counts trained households in the last year only', () => {
    const training = [{ area: 'Hilltop', skill: 'cpr', day: day(3), key: 'a' }, { area: 'Hilltop', skill: 'cpr', day: day(30), key: 'a' }, { area: 'Hilltop', skill: 'cpr', day: day(40), key: 'b' }, { area: 'Hilltop', skill: 'cpr', day: day(400), key: 'c' }, { area: 'Hilltop', skill: 'naloxone', day: day(2), key: 'd' }];
    expect(readiness(training, today)).toEqual({ Hilltop: 2 });
  });
  it('rotates the household key by period and never exposes the secret', () => {
    const now = Date.parse(today);
    expect(rotatingKey('secret', now, 7)).toBe(rotatingKey('secret', now + 3600_000, 7));
    expect(rotatingKey('secret', now, 7)).not.toBe(rotatingKey('secret', now + 8 * 86_400_000, 7));
    expect(rotatingKey('secret', now, 7)).not.toBe(rotatingKey('other', now, 7));
    expect(rotatingKey('secret', now, 7)).not.toContain('secret');
  });
});

describe('guards', () => {
  it('keeps only protocol signs from a model', () => {
    expect(guardSigns(['cough', 'cough', 'pneumonia', 42, 'chest_pain', { id: 'fever' }])).toEqual(['cough', 'chest_pain']);
    expect(guardSigns('cough')).toEqual([]);
    expect(guardSigns({ level: 'routine' })).toEqual([]);
  });
  it('lets a factual summary through', () => {
    expect(guardSummary('Reports a cough and sore throat for two days. Pulse measured at 78. Takes ramipril daily.')).toBeTruthy();
    expect(guardSummary('Signale une toux et un mal de gorge depuis deux jours. Pouls mesuré à 78.')).toBeTruthy();
  });
  it.each([
    'This is likely pneumonia and should be treated.',
    'The patient has bronchitis.',
    'Symptoms are consistent with a chest infection.',
    'Diagnosis: viral infection.',
    'It is probably nothing to worry about.',
    'These two are safe to take together.',
    'Take 500 mg of acetaminophen every four hours.',
    'Vous avez probablement une bronchite.',
    'Tableau compatible avec une infection.',
    '',
    'ok',
  ])('refuses: %s', text => {
    expect(guardSummary(text)).toBeNull();
  });
  it('refuses a summary that is too long or not text', () => {
    expect(guardSummary('Reports a cough. '.repeat(60))).toBeNull();
    expect(guardSummary({ text: 'cough' })).toBeNull();
  });
  it('reduces a label read to a search term', () => {
    expect(guardLabels([{ brand: 'TYLENOL <script>', din: 'DIN 00559407' }, { brand: '', din: '12' }, 'x', { brand: 'Advil' }])).toEqual([{ brand: 'TYLENOL script', din: '00559407' }, { brand: 'Advil', din: undefined }]);
    expect(guardLabels(null)).toEqual([]);
  });
});

describe('nurse note', () => {
  const profile: Profile = { name: 'Rose', birthYear: 1948, area: 'East Side', allergies: 'penicillin', conditions: 'high blood pressure', contact: '', lang: 'en' };
  it('carries the facts and never the level-lowering ones', () => {
    const result = triage({ signs: ['cough', 'high_fever'], pulse: 104, ageYears: 78 });
    const note = buildNote({ id: 'n1', ownerId: 'u1', now: Date.parse('2026-11-23T15:00:00Z'), profile, signs: ['cough', 'high_fever'], words: 'I have been burning up', days: 3, vitals: { pulse: 104 }, medicines: [], findings: [], result, aiTier: 'rules', hasPhoto: false });
    expect(note).toMatchObject({ level: 'urgent', call: '811', who: 'Rose', age: 78, area: 'East Side', status: 'sent' });
    expect(note.reasons).toContain('Fever of 39°C or more, or for 3 days');
    expect(note.reasons).not.toContain('Cough');
    expect(factsForSummary(note)).not.toContain('Rose');
    expect(factsForSummary(note)).toContain('104 bpm');
  });
  it('writes the note in the person’s language', () => {
    const result = triage({ signs: ['chest_pain'] });
    const note = buildNote({ id: 'n2', ownerId: 'u1', now: 0, profile: { ...profile, name: '', lang: 'fr' }, signs: ['chest_pain'], words: '', vitals: {}, medicines: [], findings: [], result, aiTier: 'rules', hasPhoto: false });
    expect(note.who).toBe('Sans nom');
    expect(note.reasons).toEqual(['Douleur ou pression à la poitrine']);
  });
});
