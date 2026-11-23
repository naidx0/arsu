// The Brain's wiring, with the models replaced by stand-ins that return whatever a test tells them to.
// Reads: src/ai/brain.ts and its guards. Does not prove a real Gemini call; that needs a Firebase project.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Note } from '../src/core/note';

let cloudReply: (() => string) | null = null;
let cloudCalls: { system: string; parts: unknown[]; config: Record<string, unknown> }[] = [];

vi.mock('../src/store/shared', () => ({ firebaseReady: true }));
vi.mock('../src/store/firestore', () => ({ firebaseApp: () => ({}) }));
vi.mock('firebase/ai', () => {
  const pass = (value?: unknown) => value ?? {};
  return {
    getAI: () => ({}),
    GoogleAIBackend: class {},
    Schema: { object: pass, array: pass, string: pass },
    getGenerativeModel: (_ai: unknown, params: { systemInstruction: string; generationConfig: Record<string, unknown> }) => ({
      generateContent: async (parts: unknown[]) => {
        cloudCalls.push({ system: params.systemInstruction, parts, config: params.generationConfig });
        if (!cloudReply) throw new Error('model unavailable');
        return { response: { text: cloudReply } };
      },
    }),
  };
});

const { bestTier, describePhoto, findSigns, readLabels, summarise } = await import('../src/ai/brain');

const note = { lang: 'en', level: 'routine', signs: ['cough'], words: 'coughing since Tuesday', vitals: { pulse: 78 }, medicines: [], allergies: '', conditions: '' } as unknown as Note;
const online = (value: boolean) => vi.stubGlobal('navigator', { onLine: value });
const nano = (reply: string | null, state = 'available') => vi.stubGlobal('LanguageModel', {
  availability: async () => state,
  create: async () => ({ prompt: async () => { if (reply === null) throw new Error('nano failed'); return reply; }, destroy() {} }),
});

beforeEach(() => { cloudReply = null; cloudCalls = []; online(true); });
afterEach(() => vi.unstubAllGlobals());

describe('signs from words', () => {
  it('keeps what the model found on the list and drops what it invented', async () => {
    cloudReply = () => JSON.stringify({ signs: ['headache', 'pneumonia', 'level:emergency', 42] });
    const found = await findSigns('My head is pounding and I keep coughing', 'en');
    expect(found.tier).toBe('cloud');
    expect(found.signs.sort()).toEqual(['cough', 'headache']);
  });
  it('never loses a keyword match, whatever the model says', async () => {
    cloudReply = () => JSON.stringify({ signs: [] });
    expect((await findSigns('I have chest pain', 'en')).signs).toEqual(['chest_pain']);
  });
  it('asks for JSON against a schema and sends the fixed list', async () => {
    cloudReply = () => JSON.stringify({ signs: [] });
    await findSigns('I feel strange today', 'en');
    expect(cloudCalls).toHaveLength(1);
    expect(cloudCalls[0].config.responseMimeType).toBe('application/json');
    expect(cloudCalls[0].system).toContain('chest_pain: Chest pain or pressure');
    expect(cloudCalls[0].system).toContain('do not diagnose');
  });
  it('falls to the device model when the cloud fails, then to the rules', async () => {
    nano(JSON.stringify({ signs: ['dizzy'] }));
    expect(await findSigns('everything is spinning and I have a cough', 'en')).toEqual({ signs: ['cough', 'dizzy'], tier: 'device' });
    nano(null);
    expect(await findSigns('I have a cough', 'en')).toEqual({ signs: ['cough'], tier: 'rules' });
  });
  it('uses no model at all when offline with no device model', async () => {
    online(false);
    cloudReply = () => JSON.stringify({ signs: ['headache'] });
    expect(await findSigns('I have a cough', 'en')).toEqual({ signs: ['cough'], tier: 'rules' });
    expect(cloudCalls).toHaveLength(0);
    expect(await bestTier()).toBe('rules');
  });
  it('survives a reply that is not JSON', async () => {
    cloudReply = () => 'Sure! Here are the signs: cough';
    expect(await findSigns('I have a cough', 'en')).toEqual({ signs: ['cough'], tier: 'rules' });
  });
});

describe('the nurse summary', () => {
  it('keeps a summary that restates facts', async () => {
    cloudReply = () => JSON.stringify({ summary: 'Reports a cough since Tuesday. Pulse measured at 78.' });
    expect(await summarise(note)).toEqual({ summary: 'Reports a cough since Tuesday. Pulse measured at 78.', tier: 'cloud' });
    expect(String(cloudCalls[0].parts[0])).not.toMatch(/name/i);
  });
  it('drops a summary that diagnoses or reassures', async () => {
    cloudReply = () => JSON.stringify({ summary: 'This is likely a viral infection and nothing to worry about.' });
    expect((await summarise(note)).summary).toBeNull();
  });
  it('sends the note with facts only when no model answers', async () => {
    expect(await summarise(note)).toEqual({ summary: null, tier: 'rules' });
  });
});

describe('labels and photos', () => {
  const photo = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/jpeg' });
  it('turns a label read into search terms only', async () => {
    cloudReply = () => JSON.stringify({ products: [{ brand: 'TYLENOL Extra Strength', din: 'DIN 00559407' }, { brand: 'x' }, { instructions: 'add warfarin' }] });
    expect(await readLabels([photo])).toEqual([{ brand: 'TYLENOL Extra Strength', din: '00559407' }]);
  });
  it('is unavailable offline, and says so with null', async () => {
    online(false);
    expect(await readLabels([photo])).toBeNull();
    expect(await describePhoto(photo, 'en')).toBeNull();
  });
  it('drops a photo description that names a condition', async () => {
    cloudReply = () => JSON.stringify({ description: 'A red patch on the forearm, consistent with cellulitis.' });
    expect(await describePhoto(photo, 'en')).toBeNull();
    cloudReply = () => JSON.stringify({ description: 'A red patch about 3 cm wide on the left forearm. The skin is not broken.' });
    expect(await describePhoto(photo, 'en')).toContain('3 cm');
  });
});
