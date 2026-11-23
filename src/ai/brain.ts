// The Brain: one interface over three tiers of understanding.
//
//   cloud   Gemini through Firebase AI Logic. Online, Firebase configured.
//   device  Gemini Nano through Chrome's built-in Prompt API. No signal needed.
//   rules   Keyword matching and templates. Always there.
//
// Whatever tier answers, its output passes src/ai/guard.ts, and the rules tier's findings
// are always kept: a model can add a sign from the protocol but can never remove one.
import { factsForSummary, type AiTier, type Note } from '../core/note';
import { matchSigns } from '../core/triage';
import { SIGNS, type Lang, type SignId } from '../data/protocol';
import { firebaseReady } from '../store/shared';
import { guardDescription, guardLabels, guardSigns, guardSummary, type LabelRead } from './guard';

const MODEL = (import.meta.env.VITE_GEMINI_MODEL as string | undefined) || 'gemini-3.5-flash';

const SIGN_LIST = SIGNS.map(sign => `${sign.id}: ${sign.label.en}`).join('\n');
const SIGNS_PROMPT = `You match what a person says about how they feel to items on a fixed list.
Return only ids from this list that the person clearly reports. Do not infer, do not diagnose,
do not add anything that is not on the list. If they deny something, leave it out.
The person may write in any language.

List (id: meaning):
${SIGN_LIST}`;
const SUMMARY_PROMPT = `You write a short handoff for a nurse from recorded facts. Two or three plain sentences.
Restate only the facts given. Do not diagnose, do not name a likely condition, do not suggest a
cause, do not reassure, and do not recommend a medicine or dose. Write in the language requested.`;
const LABEL_PROMPT = `These are photos of medicine packages. For each distinct product, read the brand name exactly as
printed and the 8-digit DIN if one is visible (it follows the letters "DIN"). Do not guess a
product that is not shown. Return nothing else.`;
const PHOTO_PROMPT = `Describe what is visible in this photo for a nurse, in one or two plain sentences: location on
the body if clear, colour, approximate size, and whether the skin is broken. Describe only.
Do not diagnose, do not name a condition, and do not say whether it is serious.`;

function timeout<T>(work: Promise<T>, ms: number): Promise<T> {
  return Promise.race([work, new Promise<T>((_, reject) => setTimeout(() => reject(new Error('timeout')), ms))]);
}

async function blobPart(blob: Blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return { inlineData: { data: btoa(binary), mimeType: blob.type || 'image/jpeg' } };
}

// ---- Cloud: Gemini through Firebase AI Logic ------------------------------------------

async function cloudJson<T>(system: string, parts: unknown[], schema: (S: typeof import('firebase/ai').Schema) => unknown, ms: number): Promise<T> {
  const [{ getAI, getGenerativeModel, GoogleAIBackend, Schema }, { firebaseApp }] = await Promise.all([import('firebase/ai'), import('../store/firestore')]);
  const model = getGenerativeModel(getAI(firebaseApp(), { backend: new GoogleAIBackend() }), {
    model: MODEL,
    systemInstruction: system,
    generationConfig: { responseMimeType: 'application/json', responseSchema: schema(Schema) as never, temperature: 0.1 },
  });
  const result = await timeout(model.generateContent(parts as never), ms);
  return JSON.parse(result.response.text()) as T;
}

const cloudOn = () => firebaseReady && navigator.onLine;

// ---- Device: Gemini Nano through Chrome's Prompt API ----------------------------------

interface NanoSession { prompt(input: string, options?: { responseConstraint?: object; signal?: AbortSignal }): Promise<string>; destroy(): void }
interface NanoApi {
  availability(options?: object): Promise<'unavailable' | 'downloadable' | 'downloading' | 'available'>;
  create(options?: object): Promise<NanoSession>;
}
const nano = (): NanoApi | undefined => (globalThis as { LanguageModel?: NanoApi }).LanguageModel;
const NANO_OPTIONS = { expectedInputs: [{ type: 'text', languages: ['en'] }], expectedOutputs: [{ type: 'text', languages: ['en'] }] };

export type DeviceState = 'unsupported' | 'downloadable' | 'downloading' | 'ready';

export async function deviceState(): Promise<DeviceState> {
  const api = nano();
  if (!api) return 'unsupported';
  try {
    const state = await api.availability(NANO_OPTIONS);
    return state === 'available' ? 'ready' : state === 'unavailable' ? 'unsupported' : state;
  } catch { return 'unsupported'; }
}

/** Starts the one-time model download. Chrome requires this to follow a tap. */
export async function downloadDeviceModel(onProgress: (share: number) => void): Promise<boolean> {
  const api = nano();
  if (!api) return false;
  try {
    const session = await api.create({ ...NANO_OPTIONS, monitor(monitor: EventTarget) { monitor.addEventListener('downloadprogress', event => onProgress((event as ProgressEvent).loaded)); } });
    session.destroy();
    return true;
  } catch { return false; }
}

async function deviceJson<T>(system: string, input: string, constraint: object, ms: number): Promise<T> {
  const api = nano();
  if (!api || (await deviceState()) !== 'ready') throw new Error('on-device model not ready');
  const session = await api.create({ ...NANO_OPTIONS, initialPrompts: [{ role: 'system', content: system }] });
  try {
    return JSON.parse(await timeout(session.prompt(input, { responseConstraint: constraint }), ms)) as T;
  } finally { session.destroy(); }
}

// ---- The interface the screens use ------------------------------------------------------

export async function bestTier(): Promise<AiTier> {
  if (cloudOn()) return 'cloud';
  return (await deviceState()) === 'ready' ? 'device' : 'rules';
}

/** Signs found in free words. The keyword matches are always included. */
export async function findSigns(text: string, _lang: Lang): Promise<{ signs: SignId[]; tier: AiTier }> {
  const fromRules = matchSigns(text);
  if (text.trim().length < 3) return { signs: fromRules, tier: 'rules' };
  const merge = (value: unknown) => [...new Set([...fromRules, ...guardSigns(value)])];
  if (cloudOn()) {
    try {
      const out = await cloudJson<{ signs: unknown }>(SIGNS_PROMPT, [text], S => S.object({ properties: { signs: S.array({ items: S.string() }) } }), 9000);
      return { signs: merge(out.signs), tier: 'cloud' };
    } catch { /* fall through */ }
  }
  try {
    const out = await deviceJson<{ signs: unknown }>(SIGNS_PROMPT, text, { type: 'object', properties: { signs: { type: 'array', items: { type: 'string', enum: SIGNS.map(sign => sign.id) } } }, required: ['signs'] }, 12000);
    return { signs: merge(out.signs), tier: 'device' };
  } catch { /* fall through */ }
  return { signs: fromRules, tier: 'rules' };
}

/** Brand names and DINs read from photos of labels. Cloud only; null when unavailable. */
export async function readLabels(photos: Blob[]): Promise<LabelRead[] | null> {
  if (!cloudOn() || !photos.length) return null;
  try {
    const parts = [...(await Promise.all(photos.slice(0, 4).map(blobPart))), 'Read the labels.'];
    const out = await cloudJson<{ products: unknown }>(LABEL_PROMPT, parts, S => S.object({ properties: { products: S.array({ items: S.object({ properties: { brand: S.string(), din: S.string() }, optionalProperties: ['din'] }) }) } }), 20000);
    return guardLabels(out.products);
  } catch { return null; }
}

/** A plain description of a photo for the nurse, or null. Cloud only. */
export async function describePhoto(photo: Blob, lang: Lang): Promise<string | null> {
  if (!cloudOn()) return null;
  try {
    const out = await cloudJson<{ description: unknown }>(PHOTO_PROMPT, [await blobPart(photo), `Write in ${lang === 'fr' ? 'French' : 'English'}.`], S => S.object({ properties: { description: S.string() } }), 15000);
    return guardDescription(out.description);
  } catch { return null; }
}

/** A short plain summary for the nurse's note, or null when no model is available or the guard refuses it. */
export async function summarise(note: Note): Promise<{ summary: string | null; tier: AiTier }> {
  const input = `${factsForSummary(note)}\n\nWrite in ${note.lang === 'fr' ? 'French' : 'English'}.`;
  if (cloudOn()) {
    try {
      const out = await cloudJson<{ summary: unknown }>(SUMMARY_PROMPT, [input], S => S.object({ properties: { summary: S.string() } }), 9000);
      return { summary: guardSummary(out.summary), tier: 'cloud' };
    } catch { /* fall through */ }
  }
  if (note.lang === 'en') {
    try {
      const out = await deviceJson<{ summary: unknown }>(SUMMARY_PROMPT, input, { type: 'object', properties: { summary: { type: 'string' } }, required: ['summary'] }, 15000);
      return { summary: guardSummary(out.summary), tier: 'device' };
    } catch { /* fall through */ }
  }
  return { summary: null, tier: 'rules' };
}
