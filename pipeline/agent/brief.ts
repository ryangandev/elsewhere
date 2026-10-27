// The brief a drafting subagent follows: the same system prompt, reference example, gazetteer,
// link targets and country task the API path sends, from the agent-v<n> prompt line, followed by
// the JSON Schema of the submission. Only the research and submission instructions differ.
import { z } from 'zod';
import type { CountryFile } from '../../src/content/schema';
import { render, type AgentPromptSet } from '../prompts';
import { CountryDraft, DraftSource, toToolJsonSchema } from '../generate/draft-schema';
import {
  countryTaskValues,
  linkTargetsText,
  sharedSystemText,
  type DraftingContext,
} from '../generate/tasks';

export type AgentContext = DraftingContext & { prompts: AgentPromptSet };

/** Told to the subagent when it cites a page it did not fetch. */
export const AGENT_EVIDENCE_RULE =
  'Cite only pages you read with the fetch command in this session, by the URL you fetched; search results are not evidence.';

/**
 * The country draft as the brief shows it. It validates exactly like CountryDraft; only the
 * description of a source URL names the fetch command instead of the API's web tools.
 */
const AgentCountryDraft = CountryDraft.extend({
  sources: z
    .array(
      DraftSource.extend({
        url: z
          .string()
          .describe('The exact URL of a page you read with the fetch command in this session.'),
      }),
    )
    .min(1)
    .describe('Every source cited above, declared once.'),
});

export function submissionSchema(): Record<string, unknown> {
  return toToolJsonSchema(AgentCountryDraft);
}

/**
 * JSON with two-space indentation, except that arrays of plain values stay on one line, so the
 * enum of 258 country codes takes one line instead of 258.
 */
function readableJson(value: unknown, indent = ''): string {
  const inner = `${indent}  `;
  if (Array.isArray(value)) {
    if (value.every((item) => item === null || typeof item !== 'object')) {
      return `[${value.map((item) => JSON.stringify(item)).join(', ')}]`;
    }
    return `[\n${value.map((item) => inner + readableJson(item, inner)).join(',\n')}\n${indent}]`;
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value);
    if (!entries.length) return '{}';
    const lines = entries.map(
      ([key, item]) => `${inner}${JSON.stringify(key)}: ${readableJson(item, inner)}`,
    );
    return `{\n${lines.join(',\n')}\n${indent}}`;
  }
  return JSON.stringify(value);
}

export function renderBrief(
  context: AgentContext,
  countryId: string,
  existing: CountryFile | undefined,
  draftFile: string,
): string {
  const task = render(context.prompts['draft-country'], {
    ...countryTaskValues(context, countryId, existing),
    draftFile,
    submissionSchema: readableJson(submissionSchema()),
  });
  return `${[
    sharedSystemText(context.prompts, 'the submission schema in the task'),
    linkTargetsText(context),
    task,
  ].join('\n\n')}\n`;
}

/** The repair prompt for a failed submission, with its problems as a numbered list. */
export function renderRepair(prompts: AgentPromptSet, issues: string[], draftFile: string): string {
  return render(prompts.repair, {
    draftFile,
    issues: issues.map((issue, index) => `${index + 1}. ${issue}`).join('\n'),
  });
}
