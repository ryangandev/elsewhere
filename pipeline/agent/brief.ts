// The brief a drafting subagent follows: the same system prompt, reference example, gazetteer,
// link targets and country task the API path sends, from the agent-v<n> prompt line, followed by
// the JSON Schema of the submission. Only the research and submission instructions differ. A
// revision session's brief has a revision task instead, with what the API path's revision tasks
// give: the notes on each part sent back (the country part, stories) and the part as drafted, in
// the submission's shape, and its context, with the sources the last claim check could not read.
import { z } from 'zod';
import { StoryId, type CountryFile, type SceneSpec } from '../../src/content/schema';
import { readClaims } from '../claims/store';
import { scopeUnits, type ClaimScope } from '../claims/units';
import { render, type AgentPromptSet, type AgentRevisionPromptSet } from '../prompts';
import { toDraftCountry, toDraftSources, toDraftStory } from '../generate/assemble';
import {
  CountryDraft,
  CountryRevisionsDraft,
  DraftCountry,
  DraftSource,
  DraftStory,
  StoryRevisionsDraft,
  toToolJsonSchema,
} from '../generate/draft-schema';
import { candidateListing } from '../generate/gazetteer-context';
import {
  countryPartUnderRevision,
  countryTaskValues,
  inboundReferences,
  linkTargetsText,
  otherStoriesText,
  sharedSystemText,
  storiesText,
  storyDraftUnderRevision,
  storyUnderRevision,
  type DraftingContext,
  type SentBack,
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
 * The country part and the stories as the brief of a revision session that includes the overview
 * shows them. It validates exactly like CountryRevisionsDraft; only descriptions differ.
 */
const AgentCountryRevisionsDraft = CountryRevisionsDraft.extend({
  country: DraftCountry.describe('The country part, revised.'),
  stories: z
    .array(
      DraftStory.extend({
        id: StoryId.describe('The ID of the story this revises, unchanged.'),
      }),
    )
    .describe(
      'Every story listed under "Stories to revise", revised, each keeping its ID; an empty list when only the overview is sent back.',
    ),
  sources: z
    .array(AgentDraftSource)
    .min(1)
    .describe('Every source the country part and the stories cite, declared once.'),
});

export function countryRevisionSubmissionSchema(): Record<string, unknown> {
  return toToolJsonSchema(AgentCountryRevisionsDraft);
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

/** "the overview", "the overview and the story "a"". */
function partsSentBack(sentBack: SentBack): string {
  const stories = sentBack.storyIds.length ? storiesSentBack(sentBack.storyIds) : '';
  if (!sentBack.overview) return stories;
  return stories ? `the overview and ${stories}` : 'the overview';
}

/**
 * The sources of an overview or story that its last claim check could not read, from the current
 * results in the claims directory, as lines for a revision brief; empty when there are none.
 */
export function unreadSources(file: CountryFile, scope: ClaimScope, claimsDir: string): string[] {
  const { checks } = readClaims(claimsDir, file.country);
  const unread = new Map<string, string>();
  for (const unit of scopeUnits(file, scope)) {
    for (const source of checks[unit.key]?.sources ?? []) {
      if (source.status === 'unreachable' && !unread.has(source.id)) {
        unread.set(
          source.id,
          `- "${source.id}" (${source.url})${source.note ? `: ${source.note}` : ''}`,
        );
      }
    }
  }
  return [...unread.values()];
}

/** The note under a part as drafted that lists the sources its claim check could not read. */
function unreadSection(lines: string[]): string[] {
  return lines.length
    ? [
        '#### Sources the last claim check could not read',
        `${lines.join('\n')}\n\nReplace each of these with a source you can read with the fetch command, unless you read it now and it states the claim.`,
      ]
    : [];
}

/**
 * The note under a part as drafted whose scene has a camera set by hand, which the submission
 * shape leaves out: what the pipeline does with it (`keepsCamera` in pipeline/generate/assemble.ts).
 */
function cameraSection(kind: 'country' | 'story', scene: SceneSpec): string[] {
  if (!scene.camera) return [];
  const { lat, lng, altitude } = scene.camera;
  const camera = `latitude ${lat}, longitude ${lng}, altitude ${altitude}`;
  return [
    '#### Camera',
    kind === 'country'
      ? `This scene has a camera set by hand (${camera}). The submission has no camera; the pipeline keeps this one with your revision, since it frames the country and stories without a camera borrow it.`
      : `This scene has a camera set by hand (${camera}). The submission has no camera; the pipeline keeps this one only if your revision keeps the scene's highlights, places and routes exactly as they are, and otherwise drops it, so the globe frames the new scene itself.`,
  ];
}

/**
 * The starting draft of a revision session: every part sent back as drafted, in the submission's
 * shape, with the sources they cite declared once. A small fix is then an edit of this file.
 */
export function initialRevisionDraft(existing: CountryFile, sentBack: SentBack): unknown {
  const stories = existing.stories.filter((story) => sentBack.storyIds.includes(story.id));
  const sources = new Map<string, DraftSource>();
  for (const entry of [...(sentBack.overview ? [existing.country] : []), ...stories]) {
    for (const source of toDraftSources(entry.sources)) {
      if (!sources.has(source.id)) sources.set(source.id, source);
    }
  }
  return {
    ...(sentBack.overview ? { country: toDraftCountry(existing.country) } : {}),
    stories: stories.map(toDraftStory),
    sources: [...sources.values()],
  };
}

/**
 * The brief of a revision session: the parts sent back, each with its notes, its text as drafted
 * in the submission's shape, and the sources its last claim check could not read. A session of
 * stories alone uses revise-story; one that includes the overview uses revise-overview.
 */
export function renderRevisionBrief(
  context: DraftingContext & { prompts: AgentRevisionPromptSet },
  existing: CountryFile,
  sentBack: SentBack,
  draftFile: string,
  claimsDir: string,
): string {
  const countryId = existing.country.id;
  const { storyIds } = sentBack;
  const revisions = storyIds.map((storyId) => {
    const { story, notes } = storyUnderRevision(existing, storyId);
    return [
      `### "${storyId}": ${story.question}`,
      "#### Editor's notes",
      notes,
      '#### The story as drafted',
      `\`\`\`json\n${storyDraftUnderRevision(existing, storyId)}\n\`\`\``,
      ...cameraSection('story', story.scene),
      ...unreadSection(unreadSources(existing, { kind: 'story', storyId }, claimsDir)),
    ].join('\n\n');
  });
  const shared = {
    countryName: existing.country.name,
    countryId,
    today: context.date,
    draftFile,
    inboundReferences: inboundReferences(context.contentDir, countryId),
    candidatePlaces: candidateListing(countryId),
  };
  let task: string;
  if (!sentBack.overview) {
    task = render(context.prompts['revise-story'], {
      ...shared,
      storiesSentBack: storiesSentBack(storyIds),
      otherStories: otherStoriesText(existing, storyIds),
      revisions: revisions.join('\n\n'),
      submissionSchema: readableJson(revisionSubmissionSchema()),
    });
  } else {
    const template = context.prompts['revise-overview'];
    if (!template) {
      throw new Error(
        `The ${context.prompts.version} agent prompts have no revise-overview template.`,
      );
    }
    const { notes, asDrafted } = countryPartUnderRevision(existing);
    task = render(template, {
      ...shared,
      sentBack: partsSentBack(sentBack),
      overviewNotes: notes,
      country: asDrafted,
      countryUnread: [
        ...cameraSection('country', existing.country.scene),
        ...unreadSection(unreadSources(existing, { kind: 'overview' }, claimsDir)),
      ].join('\n\n'),
      stories: storiesText(existing),
      revisions: revisions.length
        ? revisions.join('\n\n')
        : 'None: only the overview is sent back. Submit an empty list of stories.',
      submissionSchema: readableJson(countryRevisionSubmissionSchema()),
    });
  }
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
