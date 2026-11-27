// Records the demo journey as video against the local preview build (?demo, so 911 never dials).
// Writes phone.webm, clinic.webm and marks.json (scene start times, ms from phone recording start) to KIN_REC.
import { mkdir, readFile, writeFile, readdir, rename } from 'node:fs/promises';
import path from 'node:path';
import { chromium, expect, type Page } from '@playwright/test';

const url = 'http://127.0.0.1:4790';
const out = process.env.KIN_REC ?? '/tmp/kin-rec';
await mkdir(out, { recursive: true });

const { drugs } = JSON.parse(await readFile(new URL('../src/data/drugs.json', import.meta.url), 'utf8')) as { drugs: { brand: string; din: string; ingredients: { name: string }[] }[] };
const aceta = drugs.filter(d => d.ingredients.some(p => p.name === 'ACETAMINOPHEN'));
const plain = aceta.find(d => d.ingredients.length === 1 && d.brand.startsWith('TYLENOL')) ?? aceta.find(d => d.ingredients.length === 1)!;
const combo = aceta.find(d => d.ingredients.length > 1 && !d.brand.startsWith('TYLENOL'))!;

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
const marks: { scene: string; at: number }[] = [];
let t0 = 0;
const mark = (scene: string) => marks.push({ scene, at: Date.now() - t0 });
const pause = (ms: number) => new Promise(r => setTimeout(r, ms));

try {
  const context = await browser.newContext({
    viewport: { width: 412, height: 860 }, deviceScaleFactor: 2, hasTouch: true, locale: 'en-CA',
    geolocation: { latitude: 49.5, longitude: -81.5 }, permissions: ['geolocation', 'camera', 'microphone'],
    recordVideo: { dir: path.join(out, 'phone'), size: { width: 412, height: 860 } },
  });
  const page = await context.newPage();
  t0 = Date.now();
  const nav = (name: string) => page.getByRole('navigation').getByRole('button', { name, exact: true }).click();
  const slowType = async (target: ReturnType<Page['getByRole']>, text: string) => { await target.click(); await target.pressSequentially(text, { delay: 45 }); };

  mark('welcome');
  await page.goto(`${url}/?demo`);
  await expect(page.getByRole('heading', { name: 'Welcome to Kin' })).toBeVisible();
  await pause(2800);
  await page.getByRole('button', { name: 'Get started' }).click();
  await pause(1500);

  mark('medicine');
  await nav('Medicine');
  await pause(800);
  for (const drug of [plain, combo]) {
    await slowType(page.getByRole('searchbox'), drug.din);
    await pause(700);
    await page.locator('.result-row').first().click();
    await pause(900);
  }
  await expect(page.locator('.finding').first()).toContainText('acetaminophen');
  await page.locator('.finding').first().scrollIntoViewIfNeeded();
  await pause(3500);

  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
  mark('offline');
  await context.setOffline(true);
  await page.reload();
  await nav('Today');
  await expect(page.getByRole('status')).toContainText('No signal');
  await pause(3000);

  mark('emergency');
  await nav('Check');
  await slowType(page.getByRole('textbox'), "My chest hurts and I can't catch my breath");
  await pause(1500);
  await page.getByRole('button', { name: 'See what to do now' }).click();
  await expect(page.locator('.result h2')).toHaveText('Call 911 now');
  await pause(3500);

  mark('check');
  await nav('Today');
  await nav('Check');
  await slowType(page.getByRole('textbox'), 'I have had a cough and a sore throat since Tuesday, no fever');
  await pause(1200);
  await page.getByRole('button', { name: '2 to 3 days' }).click();
  await pause(1500);
  await page.getByRole('button', { name: 'Next' }).click();
  mark('pulse');
  await page.getByRole('button', { name: 'Pulse' }).click();
  await expect(page.getByText('Cover the back camera')).toBeVisible({ timeout: 15_000 });
  await pause(2500);
  await slowType(page.locator('#pulse-manual') as never, '78');
  await page.getByRole('button', { name: 'Use this' }).click();
  await pause(1200);
  await page.getByRole('button', { name: 'See what to do', exact: true }).click();
  await pause(2000);
  mark('send');
  await page.getByRole('button', { name: 'Send to nurse' }).click();
  await expect(page.getByText('Saved. It will send by itself')).toBeVisible();
  await pause(3000);

  mark('cpr');
  await nav('Ready');
  await page.getByRole('button', { name: 'CPR' }).click();
  for (let i = 0; i < 3; i++) { await pause(700); await page.getByRole('button', { name: 'Next' }).click(); }
  await page.getByLabel('Play the beat').uncheck();
  await page.getByRole('button', { name: 'Start 60 seconds' }).click();
  const tap = (perMinute: number, pushes: number) => page.evaluate(({ gap, pushes }) => new Promise<void>(resolve => {
    let n = 0; const t = setInterval(() => { document.querySelector('.tap-pad')!.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); if (++n >= pushes) { clearInterval(t); resolve(); } }, gap);
  }), { gap: 60000 / perMinute, pushes });
  await tap(75, 9);
  await expect(page.locator('.pace-word')).toHaveText('Push faster');
  await pause(800);
  await tap(110, 16);
  await expect(page.locator('.pace-word')).toHaveAttribute('data-pace', 'good');
  await pause(1500);
  await page.getByRole('button', { name: 'Stop' }).click();
  await pause(2500);

  // Clinic: its own recording, started when signal returns.
  mark('clinic');
  // Demo mode keeps shared data in this browser context, so the clinic opens here and is
  // captured as a frame sequence at its own desktop size (context video size is the phone's).
  const clinic = await context.newPage();
  await clinic.setViewportSize({ width: 1440, height: 900 });
  const frames = path.join(out, 'clinic');
  await mkdir(frames, { recursive: true });
  let n = 0, filming = true;
  const film = (async () => { while (filming) { await clinic.screenshot({ path: path.join(frames, `${String(n++).padStart(4, '0')}.png`) }).catch(() => {}); await pause(100); } })();
  const clinicStart = Date.now();
  await clinic.goto(`${url}/#/clinic`);
  await pause(1500);
  await context.setOffline(false);
  await expect(clinic.locator('.note-item')).toHaveCount(1, { timeout: 15_000 });
  await pause(1500);
  await clinic.locator('.note-item').click();
  await pause(4000);
  await clinic.getByRole('button', { name: 'Load a sample month' }).click();
  await pause(5000);
  filming = false;
  await film;
  await writeFile(path.join(out, 'clinic.json'), JSON.stringify({ frames: n, seconds: (Date.now() - clinicStart) / 1000 }));
  mark('end');
  await context.close();
} finally {
  await browser.close();
}

// Name the two recordings: the phone page was opened first.
const phoneFiles = (await readdir(path.join(out, 'phone'))).filter(f => f.endsWith('.webm'));
await writeFile(path.join(out, 'marks.json'), JSON.stringify({ marks, files: phoneFiles }, null, 2));
console.log(JSON.stringify(marks), phoneFiles);
void rename;
