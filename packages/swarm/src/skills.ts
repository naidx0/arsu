// Skill loader — /skills/*.md files with frontmatter are mirrored into
// the `skills` collection at launch (SPEC §3). Response agents load the
// skill doc for their block at claim time.

import fs from 'node:fs';
import path from 'node:path';
import { NodeKind, SkillDoc, Step } from '@arsu/core';

/**
 * Mini frontmatter parser — flat `key: value` pairs plus a `steps:` list
 * of flow maps (`- { action: x, target: y, param: z }`). No YAML dep.
 */
export function parseSkillFile(file: string): SkillDoc {
  const raw = fs.readFileSync(file, 'utf8');
  const id = path.basename(file, '.md');
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) throw new Error(`${file}: missing frontmatter`);
  const [, fm, body] = m;

  const meta: Record<string, string> = {};
  const steps: Step[] = [];
  let inSteps = false;
  for (const line of fm.split(/\r?\n/)) {
    const stepMatch = line.match(/^\s+-\s*\{(.*)\}\s*$/);
    if (stepMatch) {
      steps.push(parseFlowMap(stepMatch[1]) as unknown as Step);
      continue;
    }
    const kv = line.match(/^(\w[\w-]*):\s*(.*)$/);
    if (kv) {
      inSteps = kv[1] === 'steps';
      if (!inSteps) meta[kv[1]] = kv[2].trim();
      else if (kv[2].trim()) {
        // `steps: [ {...}, {...} ]` on one line
        for (const inner of kv[2].matchAll(/\{([^}]*)\}/g)) {
          steps.push(parseFlowMap(inner[1]) as unknown as Step);
        }
      }
    }
  }
  if (!meta.block) throw new Error(`${file}: frontmatter missing 'block'`);

  const title =
    meta.title ??
    body
      .split(/\r?\n/)
      .find((l) => l.startsWith('# '))
      ?.replace(/^#\s*/, '') ??
    id;

  return {
    id,
    block: meta.block as NodeKind,
    failure: meta.failure || undefined,
    title,
    steps,
    authoredBy: 'arsu/skills',
  };
}

function parseFlowMap(inner: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const pair of inner.split(',')) {
    const kv = pair.match(/(\w+)\s*:\s*(.*)/);
    if (!kv) continue;
    const v = kv[2].trim();
    if (v === 'true') out[kv[1]] = true;
    else if (v === 'false') out[kv[1]] = false;
    else if (/^-?\d+(\.\d+)?$/.test(v)) out[kv[1]] = Number(v);
    else out[kv[1]] = v.replace(/^["']|["']$/g, '');
  }
  return out;
}

export function loadSkills(dir = 'skills'): SkillDoc[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.md'))
    .sort()
    .map((f) => parseSkillFile(path.join(dir, f)));
}
