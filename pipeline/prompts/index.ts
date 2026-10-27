// Versioned prompt templates. Each version is a directory of Markdown files; a draft records the
// version that produced it in provenance.promptVersion. To change a prompt, copy the current
// directory to the next version, edit it there, and point CURRENT_PROMPT_VERSION at it, so drafts
// stay traceable to the exact text that produced them.
//
// The claim check (pipeline/claims) has its own version line, claims-v<n>, so its prompts can
// change without moving drafting to a new version (and the other way round). Each claim check
// result records the claims prompt version that produced it.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export const CURRENT_PROMPT_VERSION = 'v3';

const PROMPTS_DIR = 'pipeline/prompts';

const NAMES = [
  'system',
  'link-targets',
  'draft-country',
  'revise-story',
  'repair',
  'nudge',
  'plan',
  'plan-repair',
] as const;
export type PromptName = (typeof NAMES)[number];

export type PromptSet = { version: string } & Record<PromptName, string>;

function loadPromptFiles<Name extends string>(
  version: string,
  names: readonly Name[],
): { version: string } & Record<Name, string> {
  const texts = Object.fromEntries(
    names.map((name) => [name, readFileSync(join(PROMPTS_DIR, version, `${name}.md`), 'utf8')]),
  ) as Record<Name, string>;
  return { version, ...texts };
}

export function loadPrompts(version: string = CURRENT_PROMPT_VERSION): PromptSet {
  return loadPromptFiles(version, NAMES);
}

/**
 * Agent drafting (pipeline/agent) has its own version line, agent-v<n>, recorded in a draft's
 * provenance like any drafting version. A Claude Code subagent researches with its web search and
 * the pipeline's fetch command instead of the API's server tools, so the research and submission
 * instructions differ; every content, tone and sourcing rule is copied unchanged from the drafting
 * version it started from (agent-v1 from v3). It holds only the prompts agent drafting uses.
 */
export const CURRENT_AGENT_PROMPT_VERSION = 'agent-v1';

const AGENT_NAMES = ['system', 'link-targets', 'draft-country', 'repair'] as const;
export type AgentPromptSet = { version: string } & Record<(typeof AGENT_NAMES)[number], string>;

export function loadAgentPrompts(version: string = CURRENT_AGENT_PROMPT_VERSION): AgentPromptSet {
  return loadPromptFiles(version, AGENT_NAMES);
}

export const CURRENT_CLAIMS_PROMPT_VERSION = 'claims-v1';

const CLAIMS_NAMES = ['system', 'task', 'repair', 'nudge'] as const;
export type ClaimsPromptName = (typeof CLAIMS_NAMES)[number];

export type ClaimsPromptSet = { version: string } & Record<ClaimsPromptName, string>;

export function loadClaimsPrompts(
  version: string = CURRENT_CLAIMS_PROMPT_VERSION,
): ClaimsPromptSet {
  return loadPromptFiles(version, CLAIMS_NAMES);
}

/**
 * The paraphrase step (npm run content:paraphrase) has its own prompts and versions in
 * pipeline/prompts/paraphrase/, so they change without touching the drafting prompts or a
 * drafting run in progress. The version is recorded in each story's paraphrases.promptVersion.
 */
export const CURRENT_PARAPHRASE_PROMPT_VERSION = 'paraphrase/v1';

const PARAPHRASE_NAMES = ['system', 'task', 'repair'] as const;
export type ParaphrasePromptSet = { version: string } & Record<
  (typeof PARAPHRASE_NAMES)[number],
  string
>;

export function loadParaphrasePrompts(
  version: string = CURRENT_PARAPHRASE_PROMPT_VERSION,
): ParaphrasePromptSet {
  const prompts = { version } as ParaphrasePromptSet;
  for (const name of PARAPHRASE_NAMES) {
    prompts[name] = readFileSync(join(PROMPTS_DIR, version, `${name}.md`), 'utf8');
  }
  return prompts;
}

/** Fill `{{name}}` placeholders. A missing or unused value is an error, so templates and code agree. */
export function render(template: string, values: Record<string, string | number>): string {
  const used = new Set<string>();
  const text = template.replace(/\{\{(\w+)\}\}/g, (_, name: string) => {
    if (!(name in values)) throw new Error(`Prompt placeholder {{${name}}} has no value`);
    used.add(name);
    return String(values[name]);
  });
  const unused = Object.keys(values).filter((name) => !used.has(name));
  if (unused.length)
    throw new Error(`Prompt values not used by the template: ${unused.join(', ')}`);
  return text.trimEnd();
}
