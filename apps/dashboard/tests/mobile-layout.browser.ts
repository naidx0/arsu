import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { chromium, expect } from '@playwright/test';
import ts from 'typescript';

const url = process.env.ARSU_UI_URL ?? 'http://127.0.0.1:4782';
assert(['127.0.0.1', 'localhost'].includes(new URL(url).hostname), 'Browser rehearsal must use an isolated loopback host');
const artifacts = process.env.ARSU_UI_ARTIFACTS ?? path.join(tmpdir(), `arsu-mobile-review-${Date.now()}`);
await mkdir(artifacts, { recursive: true });
const source = await readFile(new URL('./mobile-layout.audit.ts', import.meta.url), 'utf8');
const audit = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
const views = ['Mission Control', 'Airspace', 'Topology', 'Verification', 'Swarm', 'Pipeline', 'Blackboard'];
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const context = await browser.newContext({ reducedMotion: 'reduce' });
  const page = await context.newPage();
  const stateResponse = await page.request.get(`${url}/api/state`);
  assert(stateResponse.ok(), 'Practice host must be running');
  const state = await stateResponse.json();
  assert(state.rehearsal?.recording && state.practice && state.provider === 'sim', 'Use an isolated --practice host with ARSU_PROVIDER=sim');
  await page.goto(url);
  await expect(page.getByRole('region', { name: 'Executable mission rehearsal' })).toBeVisible();
  const launch = page.getByRole('button', { name: 'Launch environment', exact: true });
  if (await launch.isVisible()) await launch.click();
  await expect(page.getByRole('button', { name: 'Change a message payload', exact: true })).toBeEnabled({ timeout: 90_000 });
  for (const viewport of [{ width: 320, height: 740 }, { width: 390, height: 844 }, { width: 768, height: 1024 }, { width: 1440, height: 900 }]) {
    await page.setViewportSize(viewport);
    for (const view of views) {
      const navigation = page.getByRole('navigation', { name: 'Workspace navigation' });
      const button = navigation.getByRole('button', { name: view, exact: true });
      await button.click();
      await expect(button).toHaveAttribute('aria-current', 'page');
      await page.evaluate(() => document.fonts.ready.then(() => undefined));
      await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
      const result = await page.evaluate(audit) as { passed: boolean; failures: string[] };
      if (!result.passed) {
        console.error(JSON.stringify(result));
        await page.screenshot({ path: path.join(artifacts, `failure-${viewport.width}-${view.replaceAll(' ', '-')}.png`) });
        console.error(await page.locator('main').evaluate(root => {
          const area = root.querySelector('.mission-control, .content-scroll, .pipeline-workspace') ?? root;
          const boundary = area.getBoundingClientRect().left + area.clientWidth - parseFloat(getComputedStyle(area).paddingRight);
          return [...area.querySelectorAll('*')].filter(element => !element.closest('svg') && element.getBoundingClientRect().right > boundary + 1).slice(0, 30).map(element => ({ class: element.className, parent: element.parentElement?.className, right: element.getBoundingClientRect().right, boundary, text: element.textContent?.slice(0, 70) }));
        }));
        console.error(`Failure artifacts: ${artifacts}`);
      }
      assert(result.passed, `${viewport.width}px ${view}: ${result.failures.join('; ')}`);
      if (view === 'Airspace') {
        const controlsFit = await page.locator('.map-toolbar').evaluate(element => [...element.querySelectorAll('button,select')].every(control => {
          const rect = control.getBoundingClientRect();
          return rect.left >= 0 && rect.right <= innerWidth + 1 && (innerWidth > 760 || rect.height >= 44);
        }));
        assert(controlsFit, `Airspace controls must fit at ${viewport.width}px`);
        const overview = page.locator('.overview-card');
        await expect(overview).toHaveJSProperty('open', viewport.width > 760);
        for (const mode of ['3D globe', '2D radar']) {
          await page.getByRole('button', { name: mode, exact: true }).click();
          await expect(page.getByRole('button', { name: mode, exact: true })).toHaveAttribute('aria-pressed', 'true');
          const clearControls = await page.evaluate(() => {
            const toolbar = document.querySelector('.map-toolbar')!.getBoundingClientRect();
            return [...document.querySelectorAll('.globe-controls')].every(element => {
              const rect = element.getBoundingClientRect();
              return rect.right <= innerWidth + 1 && rect.left >= 0 && (rect.top >= toolbar.bottom || rect.bottom <= toolbar.top || rect.left >= toolbar.right || rect.right <= toolbar.left);
            });
          });
          assert(clearControls, `${viewport.width}px ${mode}: camera controls must not overlap the toolbar`);
        }
        if (viewport.width <= 760) {
          await overview.locator('summary').first().click();
          await expect(overview).toHaveJSProperty('open', true);
          await overview.locator('summary').first().click();
          await expect(overview).toHaveJSProperty('open', false);
        }
      }
      if (viewport.width === 1440 && ['Mission Control', 'Airspace'].includes(view)) await page.screenshot({ path: path.join(artifacts, `desktop-${view.replaceAll(' ', '-').toLowerCase()}.png`) });
      console.log(`${viewport.width}px ${view}: PASS`);
    }
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('navigation', { name: 'Workspace navigation' }).getByRole('button', { name: 'Airspace', exact: true }).click();
  await page.getByRole('button', { name: '2D radar', exact: true }).click();
  await expect(page.getByRole('button', { name: '2D radar', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Inject fault', exact: true }).click();
  const faults = page.locator('.fault-popover');
  await expect(faults).toBeVisible();
  const faultsFit = await faults.evaluate(element => {
    const rect = element.getBoundingClientRect();
    return rect.left >= 0 && rect.right <= innerWidth && rect.bottom <= innerHeight;
  });
  assert(faultsFit, 'Fault menu must fit the mobile viewport');
  await faults.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(faults).not.toBeVisible();
  await page.screenshot({ path: path.join(artifacts, 'mobile-airspace.png') });
  await context.close();

  const fallback = await browser.newContext({ viewport: { width: 320, height: 740 }, reducedMotion: 'reduce' });
  await fallback.route(url => ['fonts.googleapis.com', 'fonts.gstatic.com'].includes(url.hostname), route => route.abort());
  const fallbackPage = await fallback.newPage();
  await fallbackPage.goto(url);
  await expect(fallbackPage.getByRole('region', { name: 'Executable mission rehearsal' })).toBeVisible();
  for (const view of ['Mission Control', 'Swarm']) {
    await fallbackPage.getByRole('navigation', { name: 'Workspace navigation' }).getByRole('button', { name: view, exact: true }).click();
    await fallbackPage.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    const result = await fallbackPage.evaluate(audit) as { passed: boolean; failures: string[] };
    if (!result.passed) console.error(JSON.stringify(result));
    assert(result.passed, `Fallback fonts, ${view}: ${result.failures.join('; ')}`);
    console.log(`320px fallback fonts, ${view}: PASS`);
  }
  await fallback.close();

  const recorded = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce', recordVideo: { dir: artifacts, size: { width: 390, height: 844 } } });
  const walkthrough = await recorded.newPage();
  await walkthrough.goto(url);
  await expect(walkthrough.getByRole('button', { name: 'Change a message payload', exact: true })).toBeEnabled({ timeout: 90_000 });
  const verified = walkthrough.locator('.rehearsal-history article[data-outcome="verified"]');
  const count = await verified.count();
  await walkthrough.getByRole('button', { name: 'Change a message payload', exact: true }).click();
  await expect(verified).toHaveCount(count + 1, { timeout: 90_000 });
  const latest = verified.first();
  await latest.scrollIntoViewIfNeeded();
  const [download] = await Promise.all([walkthrough.waitForEvent('download'), latest.getByRole('link', { name: 'Download evidence JSON' }).click()]);
  await download.saveAs(path.join(artifacts, 'verified-communications-evidence.json'));
  await walkthrough.screenshot({ path: path.join(artifacts, 'mobile-verified-recovery.png') });
  await walkthrough.locator('.practice-disclosure > summary').click();
  await walkthrough.getByRole('navigation', { name: 'System layers' }).getByRole('button').nth(1).click();
  await walkthrough.locator('.practice-components button').first().click();
  const inspector = walkthrough.locator('.object-inspector');
  await expect(inspector).toBeVisible();
  const inspectorFits = await inspector.evaluate(element => {
    const rect = element.getBoundingClientRect();
    return rect.left >= 0 && rect.right <= innerWidth && rect.top >= 0 && rect.bottom <= innerHeight && element.scrollWidth <= element.clientWidth + 1;
  });
  assert(inspectorFits, 'Mobile inspector must fit and wrap its content');
  await walkthrough.screenshot({ path: path.join(artifacts, 'mobile-inspector.png') });
  await walkthrough.keyboard.press('Escape');
  await expect(inspector).not.toBeVisible();
  const video = walkthrough.video();
  await recorded.close();
  if (video) await video.saveAs(path.join(artifacts, 'mobile-recovery-walkthrough.webm'));
  console.log(`Browser checks and communications walkthrough: PASS\nArtifacts: ${artifacts}`);
} finally {
  await browser.close();
}
