// Stage run on the aviation estate: the exact path a presenter clicks.
// Needs a separate `--recording` host with ARSU_PROVIDER=sim (default port 4783).
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { chromium, expect, type Page } from '@playwright/test';

const url = process.env.ARSU_UI_URL ?? 'http://127.0.0.1:4783';
assert(['127.0.0.1', 'localhost'].includes(new URL(url).hostname), 'Stage rehearsal must use an isolated loopback host');
const artifacts = process.env.ARSU_UI_ARTIFACTS ?? path.join(tmpdir(), `arsu-stage-${Date.now()}`);
await mkdir(artifacts, { recursive: true });

type Box = { left: number; right: number; top: number; bottom: number };
const overlaps = (a: Box, b: Box) => a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1;
const nav = (page: Page, view: string) => page.getByRole('navigation', { name: 'Workspace navigation' }).getByRole('button', { name: view, exact: true }).click();

const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
  const state = async () => (await page.request.get(`${url}/api/state`)).json();
  const initial = await state();
  assert(initial.rehearsal?.recording && !initial.practice && initial.provider === 'sim', 'Use an isolated --recording host with ARSU_PROVIDER=sim');
  await page.goto(url);
  if (!initial.mission.launched) await page.getByRole('button', { name: 'Launch environment', exact: true }).click();
  await expect.poll(async () => (await state()).rehearsal?.ready, { timeout: 120_000 }).toBe(true);
  const before = (await state()).rehearsal.runs.length as number;

  // Icon rail: narrow, and no rail control spills text sideways (dividers hang below by design).
  const rail = await page.locator('.app-sidebar').evaluate(aside => ({
    width: aside.getBoundingClientRect().width,
    spills: [...aside.querySelectorAll('button')].filter(b => { const r = b.getBoundingClientRect(); return r.width > 0 && b.scrollWidth > b.clientWidth + 1; }).map(b => b.getAttribute('aria-label') ?? b.textContent),
  }));
  assert(rail.width <= 90, `Icon rail is ${rail.width}px wide`);
  assert.deepEqual(rail.spills, [], 'Rail controls spill text');

  // Topology: edge labels never sit on a tier title or a system card.
  await nav(page, 'Topology');
  await page.getByRole('button', { name: 'FIT' }).click().catch(() => undefined);
  // Browser callbacks stay free of named helpers: tsx wraps those in __name, which the page lacks.
  const boxes = await page.locator('svg.topology-dag').evaluate(svg => ({
    labels: [...svg.querySelectorAll('.dag-edge-label rect')].map(e => { const r = e.getBoundingClientRect(); return { text: e.parentElement!.textContent!, left: r.left, right: r.right, top: r.top, bottom: r.bottom }; }),
    blockers: [...svg.querySelectorAll('.dag-tier text, g[role="button"] > rect')].map(e => { const r = e.getBoundingClientRect(); return { text: e.textContent || e.parentElement!.getAttribute('aria-label')!, left: r.left, right: r.right, top: r.top, bottom: r.bottom }; }),
  }));
  assert(boxes.labels.length >= 4, `expected topology edge labels, saw ${boxes.labels.length}`);
  const topologyClashes = boxes.labels.flatMap(l => boxes.blockers.filter(b => overlaps(l, b)).map(b => `${l.text} × ${b.text}`));
  assert.deepEqual(topologyClashes, [], 'Topology edge labels collide');
  // Canvas overlays (zoom dock, legend, readout) never cover a system card.
  const overlays = await page.locator('.topology-hud, .graph-legend, .topology-readout').evaluateAll(els => els.map(e => { const r = e.getBoundingClientRect(); return { text: e.className, left: r.left, right: r.right, top: r.top, bottom: r.bottom }; }));
  const cards = boxes.blockers.filter(b => !b.text.startsWith('TIER'));
  const overlayClashes = overlays.flatMap(o => cards.filter(c => overlaps(o, c)).map(c => `${o.text} × ${c.text}`));
  assert.deepEqual(overlayClashes, [], 'Topology overlays cover system cards');

  // Mission Control: four KPI cards whose meters stay inside the card.
  await nav(page, 'Mission Control');
  const kpis = await page.locator('.kpi-row .kpi-card').evaluateAll(cards => cards.map(card => { const c = card.getBoundingClientRect(); const t = card.querySelector('.kpi-ticks')!.getBoundingClientRect(); return { label: card.querySelector('.kpi-label')!.textContent, inside: t.left >= c.left && t.right <= c.right, ticks: card.querySelectorAll('.kpi-ticks i').length }; }));
  assert.equal(kpis.length, 4, 'Mission Control shows four KPI cards');
  assert(kpis.every(k => k.inside && k.ticks === 36), `KPI meters overflow: ${JSON.stringify(kpis)}`);

  // The menu fault runs as a tracked stress test.
  await nav(page, 'Airspace');
  await page.getByRole('button', { name: '2D radar', exact: true }).click();
  await page.getByRole('button', { name: 'Inject fault', exact: true }).click();
  await page.locator('.fault-popover button').filter({ hasText: 'Take Unimatic hub offline' }).click();
  await expect.poll(async () => (await state()).flights.groundStop, { timeout: 30_000 }).toBe(true);

  // During the outage: one ground-stop banner, hub labels apart, stat tiles fit.
  await expect(page.locator('.ground-stop, .map-banner.stop')).toHaveCount(1);
  const hubLabels = await page.locator('.leaflet-tooltip.ap').evaluateAll(els => els.filter(e => e.querySelector('strong')).map(e => { const r = e.getBoundingClientRect(); return { text: e.querySelector('strong')!.textContent!, left: r.left, right: r.right, top: r.top, bottom: r.bottom }; }));
  assert(hubLabels.length >= 8, `expected 8 hub labels, saw ${hubLabels.length}`);
  const labelClashes = hubLabels.flatMap((a, i) => hubLabels.slice(i + 1).filter(b => overlaps(a, b)).map(b => `${a.text} × ${b.text}`));
  assert.deepEqual(labelClashes, [], 'Radar hub labels overlap');
  const tileOverflow = await page.locator('.overview-metrics .stat-card').evaluateAll(cards => cards.filter(card => { const c = card.getBoundingClientRect(); const s = card.querySelector('strong')!; return s.scrollWidth > s.clientWidth + 1 || [...s.querySelectorAll('*')].some(e => e.getBoundingClientRect().right > c.right); }).map(card => card.textContent));
  assert.deepEqual(tileOverflow, [], 'Airspace stat tiles overflow');
  await page.screenshot({ path: path.join(artifacts, 'stage-ground-stop.png') });

  await expect.poll(async () => { const runs = (await state()).rehearsal.runs; return runs.length > before ? runs[0].outcome : 'none'; }, { timeout: 200_000 }).toBe('verified');
  const run = (await state()).rehearsal.runs[0];
  assert.equal(run.scenario, 'hub-outage');
  assert(run.violationIds.length > 0 && run.actionIds.length > 0, 'Verified run must carry violations and actions');
  // Pipeline flow canvas: seven stage cards, wires with branch labels clear of every card.
  await nav(page, 'Pipeline');
  await expect(page.locator('.flow-card')).toHaveCount(7);
  const flow = await page.locator('.flow-canvas').evaluate(root => ({
    cards: [...root.querySelectorAll('.flow-slot')].map(e => { const r = e.getBoundingClientRect(); return { text: e.querySelector('.flow-title')!.textContent!, left: r.left, right: r.right, top: r.top, bottom: r.bottom }; }),
    labels: [...root.querySelectorAll('.flow-branch, .flow-lane')].map(e => { const r = e.getBoundingClientRect(); return { text: e.textContent!, left: r.left, right: r.right, top: r.top, bottom: r.bottom }; }),
    wires: root.querySelectorAll('.flow-wires path').length,
    clipped: [...root.querySelectorAll('.flow-title')].filter(t => t.scrollWidth > t.clientWidth + 1).map(t => t.textContent),
  }));
  assert(flow.wires >= 7, `expected at least 7 flow wires, saw ${flow.wires}`);
  assert.deepEqual(flow.clipped, [], 'Flow card titles are truncated');
  const flowClashes = [
    ...flow.cards.flatMap((a, i) => flow.cards.slice(i + 1).filter(b => overlaps(a, b)).map(b => `${a.text} × ${b.text}`)),
    ...flow.labels.flatMap(l => flow.cards.filter(c => overlaps(l, c)).map(c => `${l.text} × ${c.text}`)),
  ];
  assert.deepEqual(flowClashes, [], 'Pipeline flow overlaps');
  // The AI assistant panels are gone from every view.
  await expect(page.getByRole('button', { name: /generate summary/i })).toHaveCount(0);
  await expect(page.locator('.operational-summary')).toHaveCount(0);

  await nav(page, 'Swarm');
  await expect(page.locator('.rehearsal-history article[data-outcome="verified"]').first()).toContainText('hub-outage');
  await page.screenshot({ path: path.join(artifacts, 'stage-verified.png') });
  console.log(`Stage run: hub-outage verified (${run.violationIds.length} violations, ${run.actionIds.length} actions): PASS`);
  console.log(`Artifacts: ${artifacts}`);
} finally {
  await browser.close();
}
