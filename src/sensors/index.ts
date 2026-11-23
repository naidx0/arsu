// Thin wrappers over the phone's sensors. They collect samples; src/core/signal.ts does the maths.
import type { Drug } from '../core/meds';
import { CompressionDetector, countCoughs, estimatePulse, fingerCovers, type PulseReading } from '../core/signal';
import type { Lang } from '../data/protocol';

// ---- Speech ------------------------------------------------------------------------------

interface Recogniser { lang: string; continuous: boolean; interimResults: boolean; start(): void; stop(): void; onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null; onend: (() => void) | null; onerror: (() => void) | null }
const Recognition = (): (new () => Recogniser) | undefined => {
  const scope = globalThis as { SpeechRecognition?: new () => Recogniser; webkitSpeechRecognition?: new () => Recogniser };
  return scope.SpeechRecognition ?? scope.webkitSpeechRecognition;
};
export const canListen = () => Boolean(Recognition());

/** Listens until stopped. Calls back with everything heard so far. */
export function listen(lang: Lang, onText: (text: string) => void, onEnd: () => void): () => void {
  const Maker = Recognition();
  if (!Maker) { onEnd(); return () => {}; }
  const recogniser = new Maker();
  recogniser.lang = lang === 'fr' ? 'fr-CA' : 'en-CA';
  recogniser.continuous = true;
  recogniser.interimResults = true;
  recogniser.onresult = event => onText(Array.from(event.results).map(result => result[0].transcript).join(' ').replace(/\s+/g, ' ').trim());
  recogniser.onend = onEnd;
  recogniser.onerror = onEnd;
  try { recogniser.start(); } catch { onEnd(); }
  return () => { try { recogniser.stop(); } catch { /* already stopped */ } };
}

export function speak(text: string, lang: Lang) {
  if (!('speechSynthesis' in window)) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = lang === 'fr' ? 'fr-CA' : 'en-CA';
  utterance.rate = 1;
  window.speechSynthesis.speak(utterance);
}
export const hush = () => { if ('speechSynthesis' in window) window.speechSynthesis.cancel(); };

// ---- Pulse from the rear camera --------------------------------------------------------

export interface PulseSession { stop(): void }
export interface PulseUpdate { covered: boolean; seconds: number; reading: PulseReading | null; trace: number[] }

/** Streams the rear camera into `video`, samples its colour, and reports a pulse once it is steady. */
export async function measurePulse(video: HTMLVideoElement, onUpdate: (update: PulseUpdate) => void): Promise<PulseSession> {
  const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 320 }, height: { ideal: 240 }, frameRate: { ideal: 30 } }, audio: false });
  const track = stream.getVideoTracks()[0];
  // The torch lights the fingertip. Not every phone or browser allows it.
  await track.applyConstraints({ advanced: [{ torch: true } as MediaTrackConstraintSet] }).catch(() => undefined);
  video.srcObject = stream;
  video.playsInline = true;
  await video.play().catch(() => undefined);

  const canvas = document.createElement('canvas');
  canvas.width = 32; canvas.height = 24;
  const context = canvas.getContext('2d', { willReadFrequently: true })!;
  const samples: number[] = [], times: number[] = [];
  let running = true, coveredSince = 0;

  const tick = () => {
    if (!running) return;
    if (video.readyState >= 2) {
      context.drawImage(video, 0, 0, 32, 24);
      const pixels = context.getImageData(0, 0, 32, 24).data;
      let red = 0, green = 0, blue = 0;
      for (let i = 0; i < pixels.length; i += 4) { red += pixels[i]; green += pixels[i + 1]; blue += pixels[i + 2]; }
      const count = pixels.length / 4, now = performance.now();
      const covered = fingerCovers(red / count, green / count, blue / count);
      if (!covered) { samples.length = 0; times.length = 0; coveredSince = 0; }
      else {
        coveredSince ||= now;
        samples.push(red / count); times.push(now);
        while (times.length && now - times[0] > 15_000) { times.shift(); samples.shift(); }
      }
      const span = times.length > 1 ? (times[times.length - 1] - times[0]) / 1000 : 0;
      const fps = span > 0 ? (times.length - 1) / span : 0;
      onUpdate({ covered, seconds: coveredSince ? (now - coveredSince) / 1000 : 0, reading: span >= 8 ? estimatePulse(samples, fps) : null, trace: samples.slice(-90) });
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  return { stop() { running = false; stream.getTracks().forEach(item => item.stop()); video.srcObject = null; } };
}

// ---- Compressions from the motion sensor -------------------------------------------------

export const hasMotion = () => 'DeviceMotionEvent' in window && matchMedia('(pointer: coarse)').matches;

/** Calls back on every compression. Returns a stop function, or null when motion is unavailable or refused. */
export async function watchCompressions(onBeat: (timeMs: number) => void): Promise<(() => void) | null> {
  if (!('DeviceMotionEvent' in window)) return null;
  const request = (DeviceMotionEvent as unknown as { requestPermission?: () => Promise<string> }).requestPermission;
  if (request && (await request().catch(() => 'denied')) !== 'granted') return null;
  const detector = new CompressionDetector();
  let gravity = 9.81;
  const handler = (event: DeviceMotionEvent) => {
    const free = event.acceleration;
    let magnitude: number;
    if (free && free.x !== null) magnitude = Math.hypot(free.x ?? 0, free.y ?? 0, free.z ?? 0);
    else {
      const raw = event.accelerationIncludingGravity;
      if (!raw || raw.x === null) return;
      const total = Math.hypot(raw.x ?? 0, raw.y ?? 0, raw.z ?? 0);
      gravity = gravity * 0.95 + total * 0.05;
      magnitude = Math.abs(total - gravity);
    }
    const now = performance.now();
    if (detector.push(now, magnitude)) onBeat(now);
  };
  window.addEventListener('devicemotion', handler);
  return () => window.removeEventListener('devicemotion', handler);
}

// ---- Sound: a steady beat, and counting coughs --------------------------------------------

let audio: AudioContext | null = null;
const audioContext = () => (audio ??= new AudioContext());

/** A click at `perMinute`. Returns a stop function. */
export function metronome(perMinute: number, onTick?: () => void): () => void {
  const context = audioContext();
  void context.resume();
  const click = () => {
    const oscillator = context.createOscillator(), gain = context.createGain();
    oscillator.frequency.value = 880;
    gain.gain.setValueAtTime(0.25, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.06);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + 0.07);
    onTick?.();
  };
  click();
  const timer = setInterval(click, 60000 / perMinute);
  return () => clearInterval(timer);
}

export interface CoughResult { coughs: number; seconds: number }

/** Records the microphone for `seconds` and counts coughs. Reports loudness as it goes. */
export async function recordCoughs(seconds: number, onLevel: (level: number, remaining: number) => void): Promise<CoughResult> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
  const context = audioContext();
  await context.resume();
  const source = context.createMediaStreamSource(stream), analyser = context.createAnalyser();
  analyser.fftSize = 2048;
  source.connect(analyser);
  const buffer = new Float32Array(analyser.fftSize), envelope: number[] = [], FRAME = 50;
  const started = performance.now();
  return new Promise(resolve => {
    const timer = setInterval(() => {
      analyser.getFloatTimeDomainData(buffer);
      let sum = 0;
      for (const value of buffer) sum += value * value;
      const level = Math.sqrt(sum / buffer.length);
      envelope.push(level);
      const elapsed = (performance.now() - started) / 1000;
      onLevel(level, Math.max(0, seconds - elapsed));
      if (elapsed >= seconds) {
        clearInterval(timer);
        stream.getTracks().forEach(track => track.stop());
        source.disconnect();
        resolve({ coughs: countCoughs(envelope, FRAME), seconds });
      }
    }, FRAME);
  });
}

// ---- Location ---------------------------------------------------------------------------

export interface Place { latitude: number; longitude: number; accuracy: number }
export function locate(): Promise<Place | null> {
  if (!('geolocation' in navigator)) return Promise.resolve(null);
  return new Promise(resolve => navigator.geolocation.getCurrentPosition(
    position => resolve({ latitude: position.coords.latitude, longitude: position.coords.longitude, accuracy: position.coords.accuracy }),
    () => resolve(null), { enableHighAccuracy: true, timeout: 12_000, maximumAge: 60_000 }));
}

// ---- Health Canada Drug Product Database (live lookup when online) -----------------------

const DPD = 'https://health-products.canada.ca/api/drug';
interface DpdProduct { drug_code: number; class_name: string; drug_identification_number: string; brand_name: string; company_name: string; last_update_date: string }
interface DpdIngredient { ingredient_name: string; strength: string; strength_unit: string }

/** Looks a brand or DIN up in the live database. Returns [] offline or on any failure. */
export async function lookupDrug(query: string, limit = 5): Promise<Drug[]> {
  if (!navigator.onLine) return [];
  const digits = query.replace(/\D/g, '');
  const param = digits.length === 8 && digits.length === query.trim().length ? `din=${digits}` : `brandname=${encodeURIComponent(query.trim())}`;
  try {
    const response = await fetch(`${DPD}/drugproduct/?${param}&lang=en&type=json`, { signal: AbortSignal.timeout(8000) });
    const found = (await response.json()) as DpdProduct[] | DpdProduct;
    const products = (Array.isArray(found) ? found : [found]).filter(item => item?.class_name === 'Human')
      .sort((a, b) => String(b.last_update_date).localeCompare(String(a.last_update_date))).slice(0, limit);
    const drugs = await Promise.all(products.map(async product => {
      const parts = (await (await fetch(`${DPD}/activeingredient/?id=${product.drug_code}&lang=en&type=json`, { signal: AbortSignal.timeout(8000) })).json()) as DpdIngredient[];
      return { din: product.drug_identification_number, brand: product.brand_name.trim(), company: product.company_name.trim(), ingredients: (Array.isArray(parts) ? parts : []).map(part => ({ name: part.ingredient_name.trim(), strength: `${part.strength} ${part.strength_unit}`.trim() })) };
    }));
    return drugs.filter(drug => drug.ingredients.length > 0);
  } catch { return []; }
}
