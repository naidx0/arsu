// The demo journey, driven in installed Chrome at phone size against the production build.
// Start `npm run build && npm run preview` first (port 4790). Uses ?demo so no call is ever placed.
// Reads: the rendered DOM of the built app and its service worker. Does not prove sensors on a real phone.
import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { chromium, expect, type Page } from '@playwright/test';

const url = process.env.KIN_URL ?? 'http://127.0.0.1:4790';
assert(['127.0.0.1', 'localhost'].includes(new URL(url).hostname), 'The journey test only runs against a local build');
const artifacts = process.env.KIN_ARTIFACTS ?? path.join(tmpdir(), `kin-e2e-${Date.now()}`);
await mkdir(artifacts, { recursive: true });
const shot = (page: Page, name: string) => page.screenshot({ path: path.join(artifacts, `${name}.png`) });

// Two products that share acetaminophen, derived from the snapshot so the test follows the data.
const { drugs } = JSON.parse(await readFile(new URL('../../src/data/drugs.json', import.meta.url), 'utf8')) as { drugs: { brand: string; din: string; ingredients: { name: string }[] }[] };
const withAcetaminophen = drugs.filter(drug => drug.ingredients.some(part => part.name === 'ACETAMINOPHEN'));
const preferred = (list: typeof drugs) => list.find(drug => drug.brand.startsWith('TYLENOL')) ?? list[0];
const plain = preferred(withAcetaminophen.filter(drug => drug.ingredients.length === 1)), combo = withAcetaminophen.find(drug => drug.ingredients.length > 1 && !drug.brand.startsWith('TYLENOL'))!;
assert(plain && combo, 'snapshot needs a plain and a combination acetaminophen product');

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
const problems: string[] = [];
try {
  const context = await browser.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2, hasTouch: true, locale: 'en-CA', reducedMotion: 'reduce', geolocation: { latitude: 49.5, longitude: -81.5 }, permissions: ['geolocation', 'camera', 'microphone'] });
  const page = await context.newPage();
  page.on('console', message => { if (message.type() === 'error' && !/ERR_INTERNET_DISCONNECTED|Failed to load resource/.test(message.text())) problems.push(message.text()); });
  page.on('pageerror', error => problems.push(String(error)));
  const noOverflow = async (label: string) => assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), `${label} scrolls sideways`);
  const nav = (name: string) => page.getByRole('navigation').getByRole('button', { name, exact: true }).click();

  // ---- First run ---------------------------------------------------------------------
  await page.goto(`${url}/?demo`);
  await expect(page.getByRole('heading', { name: 'Welcome to Kin' })).toBeVisible();
  await expect(page.getByText('Kin is not a doctor and never diagnoses')).toBeVisible();
  await shot(page, '01-welcome');
  await page.getByRole('button', { name: 'Get started' }).click();
  await expect(page.getByRole('heading', { name: 'How are you feeling?' })).toBeVisible();
  await noOverflow('Today');
  await shot(page, '02-today');

  // ---- Medicine: the same drug in two products ------------------------------------------
  await nav('Medicine');
  for (const drug of [plain, combo]) {
    await page.getByRole('searchbox').fill(drug.din);
    await page.locator('.result-row').first().click();
  }
  const finding = page.locator('.finding').first();
  await expect(finding).toContainText('Do not take these together before asking a pharmacist');
  await expect(finding).toContainText('acetaminophen');
  await expect(page.getByText('It never says medicines are safe together')).toBeVisible();
  await noOverflow('Medicine');
  await shot(page, '03-medicine');
  // One medicine alone raises nothing: remove the combination product.
  await page.getByRole('button', { name: /^Remove / }).last().click();
  await expect(page.locator('.finding')).toHaveCount(0);
  await page.getByRole('searchbox').fill(combo.din);
  await page.locator('.result-row').first().click();
  await expect(page.locator('.finding').first()).toBeVisible();

  // ---- Airplane mode --------------------------------------------------------------------
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
  await context.setOffline(true);
  await page.reload();
  // The app opens with no network, on the screen it was on, with the medicines still there.
  await expect(page.getByRole('heading', { name: 'Medicine', exact: true })).toBeVisible();
  await expect(page.locator('.finding').first()).toContainText('acetaminophen');
  await nav('Today');
  await expect(page.getByRole('status')).toContainText('No signal. Kin still works.');
  await shot(page, '04-offline-today');

  // An emergency, said in plain words, offline.
  await nav('Check');
  await page.getByRole('textbox').fill("My chest hurts and I can't catch my breath");
  await expect(page.getByText('This can be an emergency')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Chest pain or pressure' })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'See what to do now' }).click();
  await expect(page.locator('.result h2')).toHaveAttribute('data-level', 'emergency');
  await expect(page.locator('.result h2')).toHaveText('Call 911 now');
  await expect(page.locator('.steps li').first()).toHaveText('Call 911 now.');
  await noOverflow('Emergency result');
  await shot(page, '05-offline-emergency');
  page.once('dialog', dialog => { assert.match(dialog.message(), /Demo: no call is placed/); void dialog.accept(); });
  await page.locator('.result').getByRole('button', { name: 'Call 911' }).click();

  // A routine check with a pulse, sent while offline.
  await nav('Today');
  await nav('Check');
  await page.getByRole('textbox').fill('I have had a cough and a sore throat since Tuesday, no fever');
  await expect(page.getByRole('button', { name: 'Cough', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: 'Fever', exact: true })).toHaveAttribute('aria-pressed', 'false');
  await page.getByRole('button', { name: '2 to 3 days' }).click();
  await shot(page, '06-check-tell');
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('button', { name: 'Pulse' }).click();
  await expect(page.getByText('Cover the back camera and the light with your fingertip.')).toBeVisible({ timeout: 15_000 });
  await shot(page, '07-pulse');
  await page.locator('#pulse-manual').fill('78');
  await page.getByRole('button', { name: 'Use this' }).click();
  await expect(page.getByText('Pulse 78 a minute')).toBeVisible();
  await page.getByRole('button', { name: 'See what to do', exact: true }).click();
  await expect(page.locator('.result h2')).toHaveAttribute('data-level', 'routine');
  await expect(page.locator('.result')).not.toContainText(/you are fine|nothing to worry/i);
  await page.getByRole('button', { name: 'Send to nurse' }).click();
  await expect(page.getByText('Saved. It will send by itself when signal returns.')).toBeVisible();
  await shot(page, '08-result-routine');
  await nav('Today');
  await expect(page.getByText('Waiting for signal')).toBeVisible();

  // ---- Ready: the pace coach --------------------------------------------------------------
  await nav('Ready');
  await page.getByRole('button', { name: 'CPR' }).click();
  for (let i = 0; i < 3; i++) await page.getByRole('button', { name: 'Next' }).click();
  await expect(page.getByRole('heading', { name: 'Push hard, push fast' })).toBeVisible();
  await page.getByLabel('Play the beat').uncheck();
  await page.getByRole('button', { name: 'Start 60 seconds' }).click();
  const tapAt = (perMinute: number, pushes: number) => page.evaluate(({ gap, pushes }) => new Promise<void>(resolve => {
    let done = 0;
    const timer = setInterval(() => {
      document.querySelector('.tap-pad')!.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
      if (++done >= pushes) { clearInterval(timer); resolve(); }
    }, gap);
  }), { gap: 60000 / perMinute, pushes });
  await tapAt(75, 9);
  await expect(page.locator('.pace-word')).toHaveAttribute('data-pace', 'slow');
  await expect(page.locator('.pace-word')).toHaveText('Push faster');
  await tapAt(110, 12);
  await expect(page.locator('.pace-word')).toHaveAttribute('data-pace', 'good');
  const rate = Number(await page.getByTestId('pace-rate').textContent());
  assert(rate >= 100 && rate <= 120, `pace coach read ${rate} for 110 a minute`);
  await shot(page, '09-pace-coach');
  await page.getByRole('button', { name: 'Stop' }).click();
  await expect(page.locator('.score')).toContainText('of your pushes were on pace');
  await noOverflow('Coach');

  // ---- Signal returns: the note reaches the clinic -----------------------------------------
  const clinic = await context.newPage();
  await clinic.setViewportSize({ width: 1440, height: 900 });
  await clinic.goto(`${url}/#/clinic`);
  await expect(clinic.getByRole('heading', { name: 'Kin Clinic' })).toBeVisible();
  await expect(clinic.locator('.note-item')).toHaveCount(0);
  await context.setOffline(false);
  await expect(clinic.locator('.note-item')).toHaveCount(1, { timeout: 15_000 });
  await clinic.locator('.note-item').click();
  await expect(clinic.locator('.note')).toContainText('Pulse 78 a minute');
  await expect(clinic.locator('.note')).toContainText('I have had a cough and a sore throat');
  await expect(clinic.locator('.note')).toContainText('acetaminophen');
  await expect(clinic.locator('.note')).toContainText('Facts only. No AI summary was added.');
  await clinic.getByRole('button', { name: 'Load a sample month' }).click();
  const flagged = clinic.locator('.cluster', { hasText: 'Cluster' });
  await expect(flagged).toHaveCount(1);
  await expect(flagged).toContainText('East Side');
  await expect(clinic.getByText('Sample data', { exact: true })).toBeVisible();
  await shot(clinic, '10-clinic');
  await clinic.getByRole('button', { name: 'Mark as seen' }).click();
  await nav('Today');
  await expect(page.getByText('Seen by nurse')).toBeVisible();
  await expect(page.getByRole('status')).toContainText('Connected.');

  // ---- Emergency screen, French, dark, small phone -----------------------------------------
  await page.getByRole('button', { name: 'Emergency' }).click();
  await expect(page.getByRole('button', { name: 'Call 911' })).toBeVisible();
  await expect(page.locator('.coords')).toHaveText('49.50000, -81.50000');
  await noOverflow('Emergency');
  await shot(page, '11-emergency');
  await page.getByRole('button', { name: 'Close' }).click();

  await clinic.getByRole('button', { name: 'FR', exact: true }).click();
  await expect(clinic.getByRole('heading', { name: 'Kin Clinique' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Comment vous sentez-vous?' })).toBeVisible();
  await page.setViewportSize({ width: 360, height: 740 });
  await page.emulateMedia({ colorScheme: 'dark' });
  for (const [tab, name] of [['Bilan', 'check'], ['Médicaments', 'medicine'], ['Prêt', 'ready'], ['Aujourd’hui', 'today']] as const) {
    await nav(tab);
    await noOverflow(`${name} (fr, 360, dark)`);
    await shot(page, `12-fr-dark-${name}`);
  }
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

  assert.deepEqual(problems, [], 'console errors during the journey');
  console.log('Kin journey: medicine flag, offline emergency, offline note delivered on reconnect, pace coach, clinic cluster, French, dark: PASS');
  console.log(`Artifacts: ${artifacts}`);
} finally {
  await browser.close();
}
