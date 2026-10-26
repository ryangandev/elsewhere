// Shared setup for the pipeline tests: a disposable copy of the English content tree, so drafts
// and review decisions never touch content/en.
import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach } from 'vitest';
import { DEFAULT_LIMITS } from '../../pipeline/config';
import { landIndex } from '../../pipeline/content-tree';
import type { Plan } from '../../pipeline/generate/check';
import { renderLinkTargets, type RunContext } from '../../pipeline/generate/tasks';
import { loadPrompts } from '../../pipeline/prompts';

const created: string[] = [];

afterEach(() => {
  for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A temporary directory removed after the test. */
export function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'elsewhere-pipeline-'));
  created.push(dir);
  return dir;
}

/** A temporary copy of content/en. */
export function tempContentTree(): string {
  const dir = join(tempDir(), 'en');
  cpSync('content/en', dir, { recursive: true });
  return dir;
}

export const RUN_DATE = '2026-10-26';

export function runContext(contentDir: string, plan: Plan = new Map()): RunContext {
  return {
    contentDir,
    prompts: loadPrompts(),
    model: 'claude-opus-5-5',
    effort: 'high',
    limits: DEFAULT_LIMITS,
    cacheTtl: '5m',
    date: RUN_DATE,
    plan,
    linkTargets: renderLinkTargets(contentDir, plan),
    storyCount: { min: 4, max: 6 },
    land: landIndex(),
  };
}
