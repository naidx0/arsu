// Every word key a screen asks for exists in both languages, and no entry is left empty.
// The key set is derived from the source, so a new screen cannot ship an untranslated string.
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { STRINGS } from '../src/i18n';

const files = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? files(path.join(dir, entry.name)) : /\.tsx?$/.test(entry.name) ? [path.join(dir, entry.name)] : []);
const source = files('src').filter(file => !file.endsWith('i18n.ts')).map(file => readFileSync(file, 'utf8')).join('\n');

const literal = [...source.matchAll(/'((?:nav|common|today|tier|data|note|level|check|act|pulse|cough|sos|med|ready|pace|settings|welcome|clinic|group)\.[A-Za-z0-9.]+)'/g)].map(match => match[1]);
const families = [...source.matchAll(/`((?:[a-z]+\.)+)\$\{[^}]+\}((?:\.[a-z]+)*)`/g)].map(match => ({ prefix: match[1], suffix: match[2] }));

describe('words', () => {
  it('finds the keys the screens use', () => {
    expect(new Set(literal).size).toBeGreaterThan(150);
    expect(families.length).toBeGreaterThan(8);
  });
  it('has every literal key', () => {
    expect([...new Set(literal)].filter(key => !STRINGS[key])).toEqual([]);
  });
  it('has at least two entries for every templated family', () => {
    for (const { prefix, suffix } of families) {
      const members = Object.keys(STRINGS).filter(key => key.startsWith(prefix) && key.endsWith(suffix) && key.length > prefix.length + suffix.length);
      expect(members.length, `${prefix}*${suffix}`).toBeGreaterThanOrEqual(2);
    }
  });
  it('fills both languages and keeps the same placeholders', () => {
    for (const [key, [en, fr]] of Object.entries(STRINGS)) {
      expect(en.trim() && fr.trim(), key).toBeTruthy();
      const holes = (text: string) => (text.match(/\{[a-z]+\}/g) ?? []).sort().join();
      expect(holes(fr), key).toBe(holes(en));
    }
  });
  it('uses every entry', () => {
    const used = new Set(literal);
    const unused = Object.keys(STRINGS).filter(key => !used.has(key) && !families.some(({ prefix, suffix }) => key.startsWith(prefix) && key.endsWith(suffix)));
    expect(unused).toEqual([]);
  });
});
