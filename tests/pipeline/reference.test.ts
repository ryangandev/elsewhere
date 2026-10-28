// The reference example is frozen into each drafting prompt version, so reopening or redrafting
// Singapore in content/en never changes the text of v3 or agent-v3 (or their cached prefix). The
// Singapore file is edited here through a mocked readFileSync, so content/en is never touched.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { sharedSystemText } from '../../pipeline/generate/tasks';
import { loadAgentPrompts, loadPrompts } from '../../pipeline/prompts';

const SINGAPORE = 'content/en/countries/singapore.json';

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  const edited = (...args: Parameters<typeof actual.readFileSync>) => {
    const text = actual.readFileSync(...args);
    if (
      typeof text !== 'string' ||
      !String(args[0]).endsWith('content/en/countries/singapore.json')
    )
      return text;
    // Singapore reopened: a draft whose overview carries the editor's notes.
    const file = JSON.parse(text);
    const { reviewedBy, reviewedAt, ...provenance } = file.country.provenance;
    file.country.provenance = {
      ...provenance,
      status: 'draft',
      revision: {
        notes: 'Cite pages that state it.',
        requestedBy: 'Tester',
        requestedAt: '2026-10-28',
        scope: 'overview',
        reopened: { reviewedBy, reviewedAt },
      },
    };
    file.country.kicker = 'An unreviewed redraft.';
    return `${JSON.stringify(file, null, 2)}\n`;
  };
  return { ...actual, readFileSync: edited };
});

const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');

describe('the reference example in drafting prompts', () => {
  it('renders v3 and agent-v3 as they were frozen, whatever content/en says', () => {
    // The mock is in effect: the live Singapore file reads as reopened and redrafted.
    expect(readFileSync(SINGAPORE, 'utf8')).toContain('An unreviewed redraft.');

    // What the frozen reference protects: the system prompt and the reference example. The shared
    // gazetteer after them follows data/geo, which changes on its own.
    const beforeGazetteer = (text: string) => {
      const end = text.indexOf('\n\n# Shared gazetteer\n\n');
      expect(end).toBeGreaterThan(0);
      return text.slice(0, end);
    };
    const v3 = beforeGazetteer(sharedSystemText(loadPrompts('v3')));
    const agentV3 = beforeGazetteer(
      sharedSystemText(loadAgentPrompts('agent-v3'), 'the submission schema in the task'),
    );
    for (const text of [v3, agentV3]) {
      expect(text).toContain('"status": "reviewed"');
      expect(text).not.toMatch(/An unreviewed redraft|reopened|"revision"/);
    }
    // The system prompt and reference each version rendered before the reference was frozen;
    // changing them means a new prompt version.
    expect(sha256(v3)).toBe('845a469ff6f3190ffa55fb9229637faa3c2222fec0f35d0277bcc3210d469d9b');
    expect(sha256(agentV3)).toBe(
      '879ec747a985d3add10f2c6b2b63d4f563574c54a005bd8f7325f164aaa17972',
    );
  });

  it('freezes the same reference into every drafting version', () => {
    const versions = ['v1', 'v2', 'v3'].map((version) => loadPrompts(version).reference);
    const agentVersions = ['agent-v1', 'agent-v2', 'agent-v3'].map(
      (version) => loadAgentPrompts(version).reference,
    );
    for (const reference of [...versions, ...agentVersions]) {
      expect(reference).toBe(versions[2]);
    }
    expect(JSON.parse(versions[2]).paraphrases).toBeUndefined();
  });
});
