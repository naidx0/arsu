// Measurements from the phone's own sensors. Pure maths: the screens feed samples in,
// these functions say what was measured and how far to trust it. Nothing here guesses.

// ---- Pulse from a fingertip over the camera (photoplethysmography) -------------------

export interface PulseReading {
  bpm: number;
  /** 0 to 1. How strongly the signal repeats at the reported rate. */
  quality: number;
}

export const PULSE_MIN_BPM = 40;
export const PULSE_MAX_BPM = 200;
export const PULSE_MIN_QUALITY = 0.45;

/**
 * Estimates heart rate from the mean red brightness of successive camera frames.
 * Returns null unless the signal clearly repeats: a reading is never invented.
 */
export function estimatePulse(samples: number[], fps: number): PulseReading | null {
  if (fps < 10 || samples.length < fps * 6) return null;
  // Remove slow drift (finger pressure, exposure) with a one-second moving average.
  const window = Math.max(3, Math.round(fps));
  const detrended = samples.map((value, i) => {
    const from = Math.max(0, i - window), to = Math.min(samples.length, i + window + 1);
    let sum = 0;
    for (let j = from; j < to; j++) sum += samples[j];
    return value - sum / (to - from);
  });
  // Smooth over about 60 ms to drop sensor noise.
  const smooth = movingAverage(detrended, Math.max(1, Math.round(fps * 0.06)));
  const energy = smooth.reduce((sum, value) => sum + value * value, 0);
  if (energy < 1e-9) return null;

  const minLag = Math.floor((fps * 60) / PULSE_MAX_BPM), maxLag = Math.ceil((fps * 60) / PULSE_MIN_BPM);
  let bestLag = 0, best = -Infinity;
  const scores: number[] = [];
  for (let lag = minLag; lag <= maxLag && lag < smooth.length / 2; lag++) {
    let sum = 0, a = 0, b = 0;
    for (let i = 0; i + lag < smooth.length; i++) { sum += smooth[i] * smooth[i + lag]; a += smooth[i] ** 2; b += smooth[i + lag] ** 2; }
    const score = sum / (Math.sqrt(a * b) || 1);
    scores[lag] = score;
    if (score > best) { best = score; bestLag = lag; }
  }
  if (!bestLag || best < PULSE_MIN_QUALITY) return null;
  // A slow pulse also correlates at half its period. Prefer the shortest lag that is nearly as good.
  for (let lag = minLag; lag < bestLag; lag++) {
    const isPeak = (scores[lag] ?? -1) >= (scores[lag - 1] ?? -1) && (scores[lag] ?? -1) >= (scores[lag + 1] ?? -1);
    if (isPeak && scores[lag] > best * 0.9) { bestLag = lag; best = scores[lag]; break; }
  }
  // Refine between frames with a parabola through the peak.
  const left = scores[bestLag - 1] ?? best, right = scores[bestLag + 1] ?? best;
  const shift = left + right - 2 * best === 0 ? 0 : (0.5 * (left - right)) / (left - 2 * best + right);
  const bpm = (fps * 60) / (bestLag + shift);
  if (bpm < PULSE_MIN_BPM || bpm > PULSE_MAX_BPM) return null;
  return { bpm: Math.round(bpm), quality: Math.min(1, Math.max(0, best)) };
}

/** True when a frame looks like a fingertip pressed on a lit lens: bright, and mostly red. */
export function fingerCovers(red: number, green: number, blue: number): boolean {
  return red > 90 && red > green * 1.6 && red > blue * 1.6;
}

function movingAverage(values: number[], half: number): number[] {
  if (half < 1) return values.slice();
  return values.map((_, i) => {
    const from = Math.max(0, i - half), to = Math.min(values.length, i + half + 1);
    let sum = 0;
    for (let j = from; j < to; j++) sum += values[j];
    return sum / (to - from);
  });
}

// ---- Chest compression pace from the motion sensor (or taps) -------------------------

export const CPR_MIN = 100;
export const CPR_MAX = 120;
export type Pace = 'none' | 'slow' | 'good' | 'fast';

/** Finds compressions in a stream of acceleration magnitudes (m/s², gravity removed). */
export class CompressionDetector {
  private level = 0;       // slow-moving size of recent movement
  private above = false;
  private last = -Infinity;
  private peak = 0;
  readonly beats: number[] = [];

  /** Returns true when this sample completes a compression. */
  push(timeMs: number, magnitude: number): boolean {
    const size = Math.abs(magnitude);
    this.level = this.level * 0.98 + size * 0.02;
    const threshold = Math.max(1.5, this.level * 1.6);
    if (!this.above && size > threshold && timeMs - this.last > 300) {
      this.above = true;
      this.peak = size;
      this.last = timeMs;
      this.beats.push(timeMs);
      return true;
    }
    if (this.above) {
      this.peak = Math.max(this.peak, size);
      if (size < threshold * 0.5) this.above = false;
    }
    return false;
  }
}

/** Compressions per minute over the most recent beats, or null with fewer than four. */
export function paceOf(beats: number[], recent = 8): number | null {
  const tail = beats.slice(-recent);
  if (tail.length < 4) return null;
  const gaps = tail.slice(1).map((time, i) => time - tail[i]).sort((a, b) => a - b);
  const median = gaps[Math.floor(gaps.length / 2)];
  return median > 0 ? Math.round(60000 / median) : null;
}

export function judgePace(rate: number | null): Pace {
  if (rate === null) return 'none';
  return rate < CPR_MIN ? 'slow' : rate > CPR_MAX ? 'fast' : 'good';
}

export interface PracticeScore {
  compressions: number;
  averageRate: number | null;
  /** Share of compressions made inside the target pace, 0 to 100. */
  inTarget: number;
  seconds: number;
}

export function scorePractice(beats: number[]): PracticeScore {
  if (beats.length < 2) return { compressions: beats.length, averageRate: null, inTarget: 0, seconds: 0 };
  const gaps = beats.slice(1).map((time, i) => time - beats[i]);
  const good = gaps.filter(gap => { const rate = 60000 / gap; return rate >= CPR_MIN && rate <= CPR_MAX; }).length;
  const seconds = (beats[beats.length - 1] - beats[0]) / 1000;
  return { compressions: beats.length, averageRate: Math.round(((beats.length - 1) / seconds) * 60), inTarget: Math.round((good / gaps.length) * 100), seconds: Math.round(seconds) };
}

// ---- Counting coughs in a recording ---------------------------------------------------

/**
 * Counts short loud bursts in a recording. `envelope` is the loudness (RMS) of consecutive
 * frames and `frameMs` their length. This counts coughs; it does not say what causes them.
 */
export function countCoughs(envelope: number[], frameMs: number): number {
  if (envelope.length < 5) return 0;
  const sorted = [...envelope].sort((a, b) => a - b);
  const floor = sorted[Math.floor(sorted.length * 0.3)];
  const threshold = Math.max(0.04, floor * 5);
  // Loud runs, with gaps shorter than 80 ms bridged so one cough is not counted twice.
  const bridge = Math.max(1, Math.round(80 / frameMs));
  const bursts: number[] = [];
  let run = 0, gap = 0;
  for (const value of envelope) {
    if (value > threshold) { run += gap + 1; gap = 0; continue; }
    if (run === 0) continue;
    if (++gap > bridge) { bursts.push(run); run = 0; gap = 0; }
  }
  if (run > 0) bursts.push(run);
  return bursts.filter(length => length * frameMs >= 60 && length * frameMs <= 900).length;
}
