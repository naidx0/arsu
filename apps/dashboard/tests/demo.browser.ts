// Demo director on autopilot: every beat opens its view, runs its action, and
// lands on live evidence, ending on a verified hub-outage recovery.
// Needs a FRESH `--recording` host with ARSU_PROVIDER=sim (default port 4783).
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { chromium, expect } from '@playwright/test';
import { BEATS } from '../src/demo-script';

const url = process.env.ARSU_UI_URL ?? 'http://127.0.0.1:4783';
assert(['127.0.0.1', 'localhost'].includes(new URL(url).hostname), 'Demo rehearsal must use an isolated loopback host');
const artifacts = process.env.ARSU_UI_ARTIFACTS ?? path.join(tmpdir(), `arsu-demo-${Date.now()}`);
await mkdir(artifacts, { recursive: true });

const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce', acceptDownloads: true });
  const state = async () => (await page.request.get(`${url}/api/state`)).json();
  const initial = await state();
  assert(initial.rehearsal?.recording && !initial.practice && initial.provider === 'sim', 'Use an isolated --recording host with ARSU_PROVIDER=sim');
  assert(!initial.mission.launched, 'Start a fresh recording host: the demo begins before launch');

  await page.goto(`${url}/?demo`);
  const director = page.getByRole('region', { name: 'Demo director' });
  await expect(director).toHaveAttribute('data-beat', BEATS[0].id);
  const downloads: string[] = [];
  page.on('download', d => downloads.push(d.suggestedFilename()));
  await director.getByRole('button', { name: 'Autopilot' }).click();
  await expect(director.getByRole('button', { name: /^Autopilot/ })).toHaveAttribute('aria-pressed', 'true');

  for (const [i, beat] of BEATS.entries()) {
    await expect(director).toHaveAttribute('data-beat', beat.id, { timeout: 240_000 });
    await expect(page.locator('.breadcrumbs strong')).toHaveText(beat.view);
    if (beat.radar) await expect(page.getByRole('button', { name: '2D radar', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(director).toHaveAttribute('data-state', 'landed', { timeout: 240_000 });
    if (beat.focus) await expect(page.locator(beat.focus).first()).toBeInViewport({ timeout: 5_000 });
    await page.screenshot({ path: path.join(artifacts, `${String(i + 1).padStart(2, '0')}-${beat.id}.png`) });
    console.log(`beat ${i + 1} ${beat.id}: ${(await director.getByRole('status').innerText()).split('\n')[0]}`);
  }

  // The director must not cover the view: the content area ends where it begins.
  const overlap = await page.evaluate(() => {
    const d = document.querySelector('.demo-director')!.getBoundingClientRect();
    const m = document.querySelector('.workspace-content')!.getBoundingClientRect();
    return m.bottom - d.top;
  });
  assert(overlap <= 1, `Director covers ${overlap}px of the view`);

  const run = (await state()).rehearsal.runs.find((r: { scenario: string }) => r.scenario === 'hub-outage');
  assert.equal(run?.outcome, 'verified', 'Demo run must end verified');
  assert(downloads.length === 1, `Evidence beat downloads one file, saw ${downloads.length}`);
  console.log(`Demo director: ${BEATS.length} beats landed, hub-outage verified (${run.violationIds.length} violations, ${run.actionIds.length} actions): PASS`);
  console.log(`Artifacts: ${artifacts}`);
} finally {
  await browser.close();
}
