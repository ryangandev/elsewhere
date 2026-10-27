// How a claim check run splits countries into sessions, keeps every verdict that passes when
// others do not, and recovers when a conversation outgrows the context window. A scripted client
// answers each session's requests, so no network or key is involved.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import Anthropic from '@anthropic-ai/sdk';
import type { BetaMessage } from '@anthropic-ai/sdk/resources/beta/messages';
import { describe, expect, it } from 'vitest';
import type { CountryFile, Source } from '../../src/content/schema';
import {
  claimsJobs,
  jobScopes,
  jobUnits,
  packBySources,
  type ClaimsJob,
} from '../../pipeline/claims/plan';
import { checkClaims, type ClaimsJobResult } from '../../pipeline/claims/run';
import type { ClaimsContext } from '../../pipeline/claims/session';
import { readClaims } from '../../pipeline/claims/store';
import { citedSources, type ClaimScope, type ClaimUnit } from '../../pipeline/claims/units';
import { CLAIM_LIMITS } from '../../pipeline/config';
import { assembleCountry } from '../../pipeline/generate/assemble';
import { CountryDraft } from '../../pipeline/generate/draft-schema';
import type {
  BatchOutcome,
  ModelClient,
  TaggedRequest,
} from '../../pipeline/generate/model-client';
import { describeError, isFatal } from '../../pipeline/generate/run';
import { loadClaimsPrompts } from '../../pipeline/prompts';
import { chileDraft } from './fixtures/build-replay';
import { RUN_DATE, tempDir } from './helpers';

/**
 * The fixture's Chile draft. Its overview cites four pages (overview, geography, economy,
 * history); the stories cite geography (length, andes), geography and history (desert), and
 * economy (copper).
 */
function chileFile(): CountryFile {
  return assembleCountry(CountryDraft.parse(chileDraft()), {
    countryId: 'CHL',
    slug: 'chile',
    model: 'claude-opus-5-5',
    date: RUN_DATE,
    promptVersion: 'v3',
  });
}

const context = (overrides: Partial<ClaimsContext> = {}): ClaimsContext => ({
  prompts: loadClaimsPrompts(),
  model: 'claude-opus-5-5',
  effort: 'high',
  limits: CLAIM_LIMITS,
  cacheTtl: '5m',
  date: RUN_DATE,
  fetchPage: () => Promise.reject(new Error('not used')),
  ...overrides,
});

let ids = 0;
const nextId = (prefix: string) => `${prefix}_${(ids += 1)}`;

const pageText = (source: Source) => `This is the page of ${source.id}, as fetched.`;

/** A response that fetches pages with the server-side web fetch and submits in the same turn. */
function respond(sources: Source[], submission?: unknown): BetaMessage {
  const content: unknown[] = sources.flatMap((source) => {
    const id = nextId('srvtoolu');
    return [
      { type: 'server_tool_use', id, name: 'web_fetch', input: { url: source.url } },
      {
        type: 'web_fetch_tool_result',
        tool_use_id: id,
        content: {
          type: 'web_fetch_result',
          url: source.url,
          retrieved_at: '2026-10-26T00:00:00Z',
          content: {
            type: 'document',
            source: { type: 'text', media_type: 'text/plain', data: pageText(source) },
            title: source.title,
            citations: null,
          },
        },
      },
    ];
  });
  if (submission) {
    content.push({
      type: 'tool_use',
      id: nextId('toolu'),
      name: 'submit_verdicts',
      input: submission,
    });
  }
  return {
    id: nextId('msg'),
    type: 'message',
    role: 'assistant',
    model: 'claude-opus-5-5',
    content,
    stop_reason: submission ? 'tool_use' : 'end_turn',
    stop_sequence: null,
    usage: {
      input_tokens: 1000,
      output_tokens: 200,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
      server_tool_use: { web_search_requests: 0, web_fetch_requests: sources.length },
    },
  } as unknown as BetaMessage;
}

/** Every unit supported by a quote from its first source, unless a quote is given for it. */
function verdicts(units: ClaimUnit[], quotes: Record<string, string> = {}) {
  return {
    sources: citedSources(units).map((source) => ({ id: source.id, status: 'read', note: null })),
    verdicts: units.map((unit) => ({
      unitId: unit.id,
      verdict: 'supported',
      unsupported: [],
      evidence: [
        { sourceId: unit.sources[0].id, quote: quotes[unit.id] ?? `page of ${unit.sources[0].id}` },
      ],
      note: null,
    })),
  };
}

/** Read every cited page and submit a passing verdict for every unit. */
const checkAll = (job: ClaimsJob) => () =>
  respond(citedSources(jobUnits(job)), verdicts(jobUnits(job)));

/** What the API answers when the conversation is longer than the context window. */
const overflow = () =>
  new Anthropic.BadRequestError(
    400,
    {
      type: 'error',
      error: {
        type: 'invalid_request_error',
        message: 'prompt is too long: 1010252 tokens > 1000000 maximum',
      },
    },
    undefined,
    new Headers(),
  );

type Answer = () => BetaMessage | Error;

/** Answers the n-th request of a tag with the n-th scripted answer, synchronously or in batches. */
class ScriptedClient implements ModelClient {
  readonly description = 'scripted responses';
  readonly requests: TaggedRequest[] = [];
  private readonly turns = new Map<string, number>();

  constructor(private readonly script: Record<string, Answer[]>) {}

  async create(request: TaggedRequest): Promise<BetaMessage> {
    this.requests.push(request);
    const turn = (this.turns.get(request.tag) ?? 0) + 1;
    this.turns.set(request.tag, turn);
    const answer = this.script[request.tag]?.[turn - 1];
    if (!answer) throw new Error(`no scripted answer for ${request.tag} turn ${turn}`);
    const result = answer();
    if (result instanceof Error) throw result;
    return result;
  }

  async runBatch(requests: TaggedRequest[]): Promise<Map<string, BatchOutcome>> {
    const outcomes = new Map<string, BatchOutcome>();
    for (const request of requests) {
      try {
        outcomes.set(request.tag, { type: 'succeeded', message: await this.create(request) });
      } catch (error) {
        // A batch reports an errored entry by its error body, as the Batches API does.
        const body = error instanceof Anthropic.APIError ? error.error : describeError(error);
        outcomes.set(request.tag, { type: 'errored', error: JSON.stringify(body) });
      }
    }
    return outcomes;
  }
}

const names = (scopes: ClaimScope[]) =>
  scopes.map((scope) => (scope.kind === 'overview' ? 'overview' : scope.storyId));

const unitIds = (job: ClaimsJob) => jobUnits(job).map((unit) => unit.id);

const outcomes = (results: ClaimsJobResult[]) =>
  results.map((result) => [result.tag, result.outcome]);

describe('splitting a country into sessions', () => {
  it('packs items by the sources they cite, sharing sources and keeping order', () => {
    const items = {
      a: [1, 2, 3],
      b: [3, 4],
      c: [1],
      d: [5, 6, 7, 8, 9],
      e: [2, 3],
      f: [10, 11, 12, 13],
    };
    const groups = packBySources(
      Object.keys(items),
      (key) => new Set(items[key as keyof typeof items].map(String)),
      4,
    );
    // d cites more than the bound and goes alone; f fills a group; a takes what shares its
    // sources first (e and c add nothing), then b, which still fits.
    expect(groups).toEqual([['a', 'b', 'c', 'e'], ['d'], ['f']]);
  });

  it('keeps a country that fits the bound in one session named after it', () => {
    const file = chileFile();
    const claimsDir = join(tempDir(), 'claims');
    expect(claimsJobs(file, {}, claimsDir)).toMatchObject([{ tag: 'claims-CHL', label: 'CHL' }]);
    expect(claimsJobs(file, { maxSources: 4 }, claimsDir)).toHaveLength(1);
  });

  it('splits by cited sources, grouping overviews and stories that share them', () => {
    const file = chileFile();
    const jobs = claimsJobs(file, { maxSources: 2 }, join(tempDir(), 'claims'));
    expect(jobs.map((job) => [job.tag, job.label])).toEqual([
      ['claims-CHL-part1', 'CHL, part 1 of 3'],
      ['claims-CHL-part2', 'CHL, part 2 of 3'],
      ['claims-CHL-part3', 'CHL, part 3 of 3'],
    ]);
    // The overview cites four pages, more than the bound, so its units are split too: those
    // citing the overview and geography pages go with the stories that cite only geography.
    expect(jobs.map((job) => names(jobScopes(job)))).toEqual([
      ['overview', 'length', 'andes'],
      ['overview', 'copper'],
      ['desert'],
    ]);
    expect(jobs.map(unitIds)).toEqual([
      [
        'overview',
        'quick-fact-1',
        'quick-fact-2',
        'length-section-1',
        'length-section-2',
        'andes-section-1',
        'andes-section-2',
      ],
      ['why-it-matters-1', 'why-it-matters-2', 'copper-section-1', 'copper-section-2'],
      ['desert-section-1', 'desert-section-2'],
    ]);
    for (const job of jobs) expect(citedSources(jobUnits(job)).length).toBeLessThanOrEqual(2);
    // Every unit is checked exactly once.
    expect(jobs.flatMap(unitIds).sort()).toEqual(
      claimsJobs(file, {}, join(tempDir(), 'claims')).flatMap(unitIds).sort(),
    );
  });
});

describe('partial results', () => {
  const desert: ClaimScope[] = [{ kind: 'story', storyId: 'desert' }];

  it('keep every verdict that passes once repairs run out, and leave the rest for the next run', async () => {
    const file = chileFile();
    const claimsDir = join(tempDir(), 'claims');
    const failedDir = tempDir();
    const [job] = claimsJobs(file, { scopes: desert }, claimsDir);
    const units = jobUnits(job);
    const sources = citedSources(units);
    const [first, second] = units;
    let savedBeforeRepair: string[] = [];
    const log: string[] = [];
    const client = new ScriptedClient({
      'claims-CHL-desert': [
        () => respond(sources, verdicts(units, { [second.id]: 'Chile is long' })),
        () => {
          savedBeforeRepair = Object.keys(readClaims(claimsDir, file.country).checks);
          return respond(
            [],
            verdicts(units, {
              [first.id]: 'This is the page of fixture-geography',
              [second.id]: 'Chile is long',
            }),
          );
        },
        // The last submission garbles the first quote, which does not undo its passing verdict.
        () =>
          respond(
            [],
            verdicts(units, {
              [first.id]: 'This is the page of fixture-gXography',
              [second.id]: 'Chile is long',
            }),
          ),
      ],
    });
    const { results } = await checkClaims({
      client,
      context: context(),
      jobs: [job],
      mode: 'sync',
      claimsDir,
      failedDir,
      log: (line) => log.push(line),
    });

    expect(outcomes(results)).toEqual([['claims-CHL-desert', 'partial']]);
    // The first unit passed in the first submission and was saved before the repair turn.
    expect(savedBeforeRepair).toEqual([first.key]);
    const [result] = results;
    expect(result.detail).toMatch(
      /^1 of 2 units have verdicts and are saved: 1 supported, 0 partly supported, 0 not supported, 0 source unreachable, 1 not checked; still invalid after 2 repairs:/,
    );
    expect(result.statuses.map(({ unit, check }) => [unit.id, check?.verdict])).toEqual([
      [first.id, 'supported'],
      [second.id, undefined],
    ]);
    const reason = `verdicts.${second.id}: the quote "Chile is long" is not in the text fetched from https://example.org/elsewhere-fixture/chile/geography: nothing on the page starts like "chile is long". Copy the words exactly (use "..." for a gap) or leave the quote out.`;
    expect(result.unchecked.map(({ unit, reason }) => [unit.id, reason])).toEqual([
      [second.id, reason],
    ]);
    expect(log.join('\n')).toContain(`Section "Second part of desert": not checked: ${reason}`);

    // The latest passing verdict is the one saved.
    const saved = readClaims(claimsDir, file.country).checks;
    expect(Object.keys(saved)).toEqual([first.key]);
    expect(saved[first.key].evidence).toEqual([
      { sourceId: 'fixture-geography', quote: 'This is the page of fixture-geography' },
    ]);

    // The log says which units are not checked and why.
    const failed = JSON.parse(readFileSync(join(failedDir, 'claims-CHL-desert.json'), 'utf8'));
    expect(failed.unchecked).toEqual([
      { unit: second.id, label: 'Section "Second part of desert"', reason },
    ]);

    // The next run checks only the unit without a verdict.
    expect(claimsJobs(file, { scopes: desert }, claimsDir).map(unitIds)).toEqual([[second.id]]);
  });

  it('keep the verdicts that passed when a later request fails', async () => {
    const file = chileFile();
    const claimsDir = join(tempDir(), 'claims');
    const [job] = claimsJobs(file, { scopes: desert }, claimsDir);
    const units = jobUnits(job);
    const client = new ScriptedClient({
      'claims-CHL-desert': [
        () => respond(citedSources(units), verdicts(units, { [units[1].id]: 'Chile is long' })),
        () => new Error('Connection error.'),
      ],
    });
    const { results } = await checkClaims({
      client,
      context: context(),
      jobs: [job],
      mode: 'sync',
      claimsDir,
      failedDir: tempDir(),
      log: () => {},
    });
    expect(outcomes(results)).toEqual([['claims-CHL-desert', 'partial']]);
    expect(results[0].detail).toContain('Connection error.');
    expect(Object.keys(readClaims(claimsDir, file.country).checks)).toEqual([units[0].key]);
  });

  it('count a submission in the last allowed response', async () => {
    const file = chileFile();
    const claimsDir = join(tempDir(), 'claims');
    const [job] = claimsJobs(file, { scopes: desert }, claimsDir);
    const { results } = await checkClaims({
      client: new ScriptedClient({ 'claims-CHL-desert': [checkAll(job)] }),
      context: context({ limits: { ...CLAIM_LIMITS, requests: 1 } }),
      jobs: [job],
      mode: 'sync',
      claimsDir,
      log: () => {},
    });
    expect(outcomes(results)).toEqual([['claims-CHL-desert', 'checked']]);
  });
});

describe('a conversation that outgrows the context window', () => {
  /** The overview and the "length" story: seven units citing four pages, one session. */
  const scopes: ClaimScope[] = [{ kind: 'overview' }, { kind: 'story', storyId: 'length' }];

  async function run(mode: 'sync' | 'batch') {
    const file = chileFile();
    const claimsDir = join(tempDir(), 'claims');
    const failedDir = tempDir();
    const [job] = claimsJobs(file, { scopes }, claimsDir);
    expect(job.tag).toBe('claims-CHL');
    // Half the sources each: the overview and geography pages, and the economy and history pages.
    const [overviewAndLength, whyItMatters] = claimsJobs(
      file,
      { scopes, maxSources: 2 },
      claimsDir,
    );
    const [economy, history] = claimsJobs(
      file,
      { scopes: [{ kind: 'overview' }], maxSources: 1 },
      claimsDir,
    ).filter((part) => unitIds(part).some((id) => id.startsWith('why-it-matters')));
    const log: string[] = [];
    const client = new ScriptedClient({
      'claims-CHL': [overflow],
      'claims-CHL-split1': [checkAll(overviewAndLength)],
      'claims-CHL-split2': [overflow],
      'claims-CHL-split2-split1': [checkAll(economy)],
      // A single unit that still does not fit cannot be split again.
      'claims-CHL-split2-split2': [overflow],
    });
    expect(unitIds(whyItMatters)).toEqual(['why-it-matters-1', 'why-it-matters-2']);
    const summary = await checkClaims({
      client,
      context: context(),
      jobs: [job],
      mode,
      claimsDir,
      failedDir,
      log: (line) => log.push(line),
    });
    return { file, claimsDir, failedDir, log, history, ...summary };
  }

  for (const mode of ['sync', 'batch'] as const) {
    it(`splits the session and checks the rest in smaller ones (${mode})`, async () => {
      const { file, claimsDir, failedDir, log, history, results } = await run(mode);
      expect(outcomes(results)).toEqual([
        ['claims-CHL', 'split'],
        ['claims-CHL-split1', 'checked'],
        ['claims-CHL-split2', 'split'],
        ['claims-CHL-split2-split1', 'checked'],
        ['claims-CHL-split2-split2', 'failed'],
      ]);
      expect(results.map((result) => result.label)).toEqual([
        'CHL',
        'CHL, split 1 of 2',
        'CHL, split 2 of 2',
        'CHL, split 2 of 2, split 1 of 2',
        'CHL, split 2 of 2, split 2 of 2',
      ]);
      expect(results[0].detail).toMatch(
        /^the conversation outgrew the model's context window \(.*prompt is too long: 1010252 tokens > 1000000 maximum.*\); 0 of 7 units saved, the other 7 go to 2 smaller sessions/,
      );
      expect(results[0].splitInto).toEqual(['claims-CHL-split1', 'claims-CHL-split2']);

      // Each unit is reported once: six with verdicts, one not checked with the reason.
      const statuses = results.flatMap((result) => result.statuses);
      expect(statuses).toHaveLength(7);
      expect(statuses.filter(({ check }) => check)).toHaveLength(6);
      const unchecked = results.flatMap((result) => result.unchecked);
      expect(unchecked.map(({ unit }) => unit.id)).toEqual(unitIds(history));
      expect(unchecked[0].reason).toContain('prompt is too long');
      expect(log.join('\n')).toContain('continues in claims-CHL-split1, claims-CHL-split2');

      expect(Object.keys(readClaims(claimsDir, file.country).checks)).toHaveLength(6);
      expect(existsSync(join(failedDir, 'claims-CHL.json'))).toBe(true);
      expect(claimsJobs(file, { scopes }, claimsDir).map(unitIds)).toEqual([unitIds(history)]);
    });
  }

  it('is not an error that stops the whole run', () => {
    expect(isFatal(overflow())).toBe(false);
    expect(isFatal(new Anthropic.BadRequestError(400, undefined, 'bad', new Headers()))).toBe(true);
  });
});
