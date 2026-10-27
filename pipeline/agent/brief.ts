// The brief a drafting subagent follows: the same system prompt, reference example, gazetteer,
// link targets and country task the API path sends, from the agent-v<n> prompt line, followed by
// the JSON Schema of the submission. Only the research and submission instructions differ. A
// revision session's brief has the story revision task instead, with what the API path's
// revise-story task gives: each story's notes and the story as drafted, and its context.
import { z } from 'zod';
import { StoryId, type CountryFile } from '../../src/content/schema';
import { render, type AgentPromptSet, type AgentRevisionPromptSet } from '../prompts';
import {
  CountryDraft,
  DraftSource,
  DraftStory,
  StoryRevisionsDraft,
  toToolJsonSchema,
} from '../generate/draft-schema';
import { candidateListing } from '../generate/gazetteer-context';
import {
  countryTaskValues,
  inboundReferences,
  linkTargetsText,
  otherStoriesText,
  sharedSystemText,
  storyUnderRevision,
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
const AgentDraftSource = DraftSource.extend({
  url: z
    .string()
    .describe('The exact URL of a page you read with the fetch command in this session.'),
});

const AgentCountryDraft = CountryDraft.extend({
  sources: z.array(AgentDraftSource).min(1).describe('Every source cited above, declared once.'),
});

export function submissionSchema(): Record<string, unknown> {
  return toToolJsonSchema(AgentCountryDraft);
}

/**
 * The revised stories as a revision brief shows them. It validates exactly like
 * StoryRevisionsDraft; only the descriptions of a story ID and a source URL differ.
 */
const AgentStoryRevisionsDraft = StoryRevisionsDraft.extend({
  stories: z
    .array(
      DraftStory.extend({
        id: StoryId.describe('The ID of the story this revises, unchanged.'),
      }),
    )
    .min(1)
    .describe('Every story listed under "Stories to revise", revised, each keeping its ID.'),
  sources: z
    .array(AgentDraftSource)
    .min(1)
    .describe('Every source the stories cite, declared once.'),
});

export function revisionSubmissionSchema(): Record<string, unknown> {
  return toToolJsonSchema(AgentStoryRevisionsDraft);
}

/**
 * JSON with two-space indentation, except that arrays of plain values stay on one line, so the
 * enum of 258 country codes takes one line instead of 258.
 */
export function readableJson(value: unknown, indent = ''): string {
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

const quoted = (ids: string[]) => ids.map((id) => `"${id}"`);

/** "the story "a"", or "the stories "a", "b" and "c"". */
function storiesSentBack(storyIds: string[]): string {
  const ids = quoted(storyIds);
  return ids.length === 1
    ? `the story ${ids[0]}`
    : `the stories ${ids.slice(0, -1).join(', ')} and ${ids.at(-1)}`;
}

/** The brief of a revision session: the stories sent back, each with its notes and old text. */
export function renderRevisionBrief(
  context: DraftingContext & { prompts: AgentRevisionPromptSet },
  existing: CountryFile,
  storyIds: string[],
  draftFile: string,
): string {
  const countryId = existing.country.id;
  const revisions = storyIds.map((storyId) => {
    const { story, notes, asDrafted } = storyUnderRevision(existing, storyId);
    return [
      `### "${storyId}": ${story.question}`,
      "#### Editor's notes",
      notes,
      '#### The story as drafted',
      `\`\`\`json\n${asDrafted}\n\`\`\``,
    ].join('\n\n');
  });
  const task = render(context.prompts['revise-story'], {
    countryName: existing.country.name,
    countryId,
    storiesSentBack: storiesSentBack(storyIds),
    today: context.date,
    draftFile,
    revisions: revisions.join('\n\n'),
    otherStories: otherStoriesText(existing, storyIds),
    inboundReferences: inboundReferences(context.contentDir, countryId),
    candidatePlaces: candidateListing(countryId),
    submissionSchema: readableJson(revisionSubmissionSchema()),
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
