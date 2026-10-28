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

    const v3 = sharedSystemText(loadPrompts('v3'));
    const agentV3 = sharedSystemText(
      loadAgentPrompts('agent-v3'),
      'the submission schema in the task',
    );
    for (const text of [v3, agentV3]) {
      expect(text).toContain('"status": "reviewed"');
      expect(text).not.toMatch(/An unreviewed redraft|reopened|"revision"/);
    }
    // The text each version rendered before the reference was frozen; changing it means a new
    // prompt version.
    expect(sha256(v3)).toBe('fe4530ba4bf1545c00e28317182d441371dee2a1311cfcc5e3a214f79cdc50db');
    expect(sha256(agentV3)).toBe(
      '753e3390e4e33b8986fba93342204229a15bb7f3a4e17b982519edc1d60975a1',
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
