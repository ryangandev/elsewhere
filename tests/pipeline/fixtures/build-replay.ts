// Builds the replay fixtures in tests/pipeline/fixtures/replay: model responses in the shape the
// Messages API returns, for the pipeline to run end to end without network or an API key.
// The text is placeholder, not content; the place IDs are real gazetteer IDs and every cited URL
// appears in a web search result of the same conversation, as the pipeline requires.
// The claims-CHL fixture checks the drafted Chile overview and its "length" story against their
// sources in one conversation: pages fetched with web_fetch (or fetch_page when web_fetch fails),
// then verdicts through submit_verdicts. The CHL.overview fixture redrafts the Chile country part
// that review sent back alone, citing a new page for one item.
//
//   node --import tsx tests/pipeline/fixtures/build-replay.ts
//
// tests/pipeline/units.test.ts checks the committed files match this script.
import { mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeJson } from '../../../pipeline/content-tree';

export const REPLAY_DIR = join(dirname(fileURLToPath(import.meta.url)), 'replay');
export const FIXTURE_MODEL = 'claude-opus-5-5';
/** The batch the plan fixture answers. */
export const FIXTURE_BATCH = {
  id: 'fixture',
  description: 'Replay fixture batch for the pipeline tests.',
  selection: ['Two neighbours so the plan can link them.'],
  stories: { min: 4, max: 6 },
  countries: [
    { id: 'CHL', why: 'Drafted by the country fixture.' },
    { id: 'ARG', why: 'Planned only, so links to it stay pending.' },
  ],
};

const url = (path: string) => `https://example.org/elsewhere-fixture/${path}`;

let ids = 0;
const nextId = (prefix: string) => `${prefix}_fixture${String((ids += 1)).padStart(3, '0')}`;

function message(
  content: unknown[],
  stopReason: string,
  usage: {
    input: number;
    cacheRead?: number;
    output: number;
    searches?: number;
    fetches?: number;
  },
) {
  return {
    id: nextId('msg'),
    type: 'message',
    role: 'assistant',
    model: FIXTURE_MODEL,
    content,
    stop_reason: stopReason,
    stop_sequence: null,
    usage: {
      input_tokens: usage.input,
      output_tokens: usage.output,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: usage.cacheRead ?? 0,
      server_tool_use: {
        web_search_requests: usage.searches ?? 0,
        web_fetch_requests: usage.fetches ?? 0,
      },
    },
  };
}

const text = (value: string) => ({ type: 'text', text: value, citations: null });

function webSearch(query: string, results: { path: string; title: string }[]) {
  const id = nextId('srvtoolu');
  return [
    { type: 'server_tool_use', id, name: 'web_search', input: { query } },
    {
      type: 'web_search_tool_result',
      tool_use_id: id,
      content: results.map((result) => ({
        type: 'web_search_result',
        url: url(result.path),
        title: result.title,
        encrypted_content: 'fixture',
        page_age: null,
      })),
    },
  ];
}

/** A direct web_fetch call and its result: the page text, or an error when `text` is null. */
function webFetch(path: string, text: string | null) {
  const id = nextId('srvtoolu');
  return [
    { type: 'server_tool_use', id, name: 'web_fetch', input: { url: url(path) } },
    {
      type: 'web_fetch_tool_result',
      tool_use_id: id,
      content:
        text === null
          ? { type: 'web_fetch_tool_error', error_code: 'url_not_accessible' }
          : {
              type: 'web_fetch_result',
              url: url(path),
              retrieved_at: '2026-10-26T00:00:00Z',
              content: {
                type: 'document',
                source: { type: 'text', media_type: 'text/plain', data: text },
                title: `Fixture page ${path}`,
                citations: null,
              },
            },
    },
  ];
}

/** A direct web_fetch of a PDF: the server returns it as base64, so its text is not checked. */
function webFetchPdf(path: string) {
  const id = nextId('srvtoolu');
  return [
    { type: 'server_tool_use', id, name: 'web_fetch', input: { url: url(path) } },
    {
      type: 'web_fetch_tool_result',
      tool_use_id: id,
      content: {
        type: 'web_fetch_result',
        url: url(path),
        retrieved_at: '2026-10-26T00:00:00Z',
        content: {
          type: 'document',
          source: { type: 'base64', media_type: 'application/pdf', data: 'JVBERi0xLjQK' },
          title: `Fixture page ${path}`,
          citations: null,
        },
      },
    },
  ];
}

const toolUse = (name: string, input: unknown) => ({
  type: 'tool_use',
  id: nextId('toolu'),
  name,
  input,
});

const placeholder = (topic: string) =>
  `Placeholder text about ${topic} for the pipeline tests. It is not real content.`;

const source = (id: string, path: string, title: string) => ({
  id,
  title,
  publisher: 'Elsewhere test fixtures',
  url: url(path),
});

const SOURCES = [
  source('fixture-overview', 'chile/overview', 'Fixture overview page'),
  source('fixture-geography', 'chile/geography', 'Fixture geography page'),
  source('fixture-economy', 'chile/economy', 'Fixture economy page'),
  source('fixture-history', 'chile/history', 'Fixture history page'),
];

function story(
  id: string,
  sourceIds: string[],
  scene: { highlights?: unknown[]; placeIds?: string[]; routes?: unknown[] },
  next: { countryId: string; storyId: string; reason: string | null }[],
) {
  return {
    id,
    slug: id,
    question: `Fixture question about ${id}?`,
    category: 'Geography',
    summary: placeholder(`the ${id} answer`),
    sections: [
      { title: `First part of ${id}`, text: placeholder(`${id}, part one`), sourceIds },
      { title: `Second part of ${id}`, text: placeholder(`${id}, part two`), sourceIds },
    ],
    takeaway: placeholder(`the ${id} takeaway`),
    scene: {
      highlights: scene.highlights ?? [],
      placeIds: scene.placeIds ?? [],
      routes: scene.routes ?? [],
      mapNote: placeholder(`the ${id} map`),
    },
    next,
  };
}

export function chileDraft() {
  return {
    country: {
      name: 'Chile',
      nativeName: null,
      region: 'South America',
      kicker: 'Placeholder kicker for the fixture.',
      overview: {
        summary: placeholder('the overview'),
        geography: placeholder('the geography'),
        sourceIds: ['fixture-overview', 'fixture-geography'],
        whyItMatters: [
          {
            title: 'Fixture point one',
            text: placeholder('point one'),
            sourceIds: ['fixture-economy'],
          },
          {
            title: 'Fixture point two',
            text: placeholder('point two'),
            sourceIds: ['fixture-history'],
          },
        ],
      },
      quickFacts: [
        { label: 'Capital', value: 'Fixture value', asOf: null, sourceIds: ['fixture-overview'] },
        {
          label: 'Population',
          value: 'Fixture value',
          asOf: '2026',
          sourceIds: ['fixture-overview'],
        },
      ],
      starterStoryIds: ['length', 'desert', 'copper'],
      scene: {
        highlights: [
          { countryId: 'ARG', role: 'related' },
          { countryId: 'PER', role: 'related' },
          { countryId: 'BOL', role: 'related' },
        ],
        placeIds: ['south-pacific-ocean', 'andes', 'atacama-desert'],
        routes: [],
        mapNote: null,
      },
    },
    stories: [
      story(
        'length',
        ['fixture-geography'],
        {
          placeIds: ['santiago', 'strait-of-magellan'],
          routes: [
            {
              id: 'cape-horn-passage',
              kind: 'sea',
              via: ['south-pacific-ocean', 'drake-passage'],
            },
          ],
        },
        [
          { countryId: 'CHL', storyId: 'desert', reason: null },
          {
            countryId: 'BRA',
            storyId: 'amazon',
            reason: 'Another landscape that spans a continent.',
          },
        ],
      ),
      story(
        'desert',
        ['fixture-geography', 'fixture-history'],
        {
          highlights: [
            { countryId: 'PER', role: 'related' },
            { countryId: 'BOL', role: 'related' },
          ],
          placeIds: ['atacama-desert'],
        },
        [
          { countryId: 'CHL', storyId: 'copper', reason: null },
          {
            countryId: 'IND',
            storyId: 'monsoon',
            reason: 'The opposite problem: too much rain at once.',
          },
        ],
      ),
      story('copper', ['fixture-economy'], { placeIds: ['atacama-desert'] }, [
        { countryId: 'CHL', storyId: 'length', reason: null },
        { countryId: 'CHN', storyId: 'manufacturing', reason: 'Where much of the metal ends up.' },
      ]),
      story(
        'andes',
        ['fixture-geography'],
        { highlights: [{ countryId: 'ARG', role: 'related' }], placeIds: ['andes', 'patagonia'] },
        [
          { countryId: 'CHL', storyId: 'length', reason: null },
          {
            countryId: 'BRA',
            storyId: 'agriculture',
            reason: 'Farming on the other side of the continent.',
          },
        ],
      ),
    ],
    sources: SOURCES,
  };
}

/** The first submission: cites a page it never retrieved and uses a place the gazetteer lacks. */
function invalidChileDraft() {
  const draft = chileDraft();
  const copper = draft.stories.find((entry) => entry.id === 'copper')!;
  copper.sections[1].sourceIds = ['fixture-unretrieved'];
  copper.scene.placeIds = ['valparaiso'];
  draft.sources = [
    ...SOURCES,
    source('fixture-unretrieved', 'chile/not-retrieved', 'Never retrieved'),
  ];
  return draft;
}

const plan = {
  countries: [
    {
      countryId: 'CHL',
      stories: [
        { id: 'length', question: 'Fixture question about length?', angle: 'common' },
        { id: 'desert', question: 'Fixture question about desert?', angle: 'common' },
        { id: 'copper', question: 'Fixture question about copper?', angle: 'common' },
        { id: 'andes', question: 'Fixture question about andes?', angle: 'unexpected' },
      ],
    },
    {
      countryId: 'ARG',
      stories: [
        { id: 'pampas', question: 'Fixture question about pampas?', angle: 'common' },
        { id: 'patagonia', question: 'Fixture question about patagonia?', angle: 'common' },
        { id: 'capital', question: 'Fixture question about the capital?', angle: 'common' },
        { id: 'glaciers', question: 'Fixture question about glaciers?', angle: 'unexpected' },
      ],
    },
  ],
};

function revisedAndes() {
  const revised = story(
    'andes',
    ['fixture-andes'],
    { highlights: [{ countryId: 'ARG', role: 'related' }], placeIds: ['andes', 'patagonia'] },
    [
      { countryId: 'CHL', storyId: 'length', reason: null },
      { countryId: 'ARG', storyId: 'patagonia', reason: 'The other side of the same mountains.' },
    ],
  );
  revised.summary = placeholder('the revised andes answer');
  return {
    story: revised,
    sources: [source('fixture-andes', 'chile/andes-revised', 'Fixture page for the revision')],
  };
}

/** The Chile country part redrafted: a new summary, and a new page for "Fixture point two". */
export function revisedOverview() {
  const { country } = chileDraft();
  country.overview.summary = placeholder('the revised overview');
  country.overview.whyItMatters[1].sourceIds = ['fixture-history-report'];
  return {
    country,
    sources: [
      ...SOURCES.filter((entry) => entry.id !== 'fixture-history'),
      source('fixture-history-report', 'chile/history-report', 'Fixture report for the revision'),
    ],
  };
}

const read = (id: string) => ({ id, status: 'read', note: null });

type FixtureVerdict = {
  unitId: string;
  verdict: string;
  unsupported: string[];
  evidence: { sourceId: string; quote: string }[];
  note: string | null;
};

const supported = (unitId: string, sourceId: string): FixtureVerdict => ({
  unitId,
  verdict: 'supported',
  unsupported: [],
  evidence: [{ sourceId, quote: 'Placeholder text' }],
  note: null,
});

/**
 * Verdicts on the Chile overview and the "length" story: one page could not be read, and one
 * quick fact is unsupported.
 */
function chileVerdicts(): {
  sources: { id: string; status: string; note: string | null }[];
  verdicts: FixtureVerdict[];
} {
  return {
    sources: [
      read('fixture-overview'),
      read('fixture-geography'),
      read('fixture-economy'),
      { id: 'fixture-history', status: 'unreachable', note: 'The fetch failed.' },
    ],
    verdicts: [
      // Quotes are matched loosely: case, quotation marks, dashes and a gap marked "...".
      {
        ...supported('overview', 'fixture-overview'),
        evidence: [
          {
            sourceId: 'fixture-overview',
            quote: '“placeholder TEXT about the overview page … It is not real content.”',
          },
        ],
      },
      // The economy page is a PDF, whose text is not available to check the quote against.
      {
        ...supported('why-it-matters-1', 'fixture-economy'),
        evidence: [{ sourceId: 'fixture-economy', quote: 'Table 3, 2024 column' }],
      },
      {
        unitId: 'why-it-matters-2',
        verdict: 'source_unreachable',
        unsupported: ['Fixture point two'],
        evidence: [],
        note: 'Its only source could not be read.',
      },
      {
        unitId: 'quick-fact-1',
        verdict: 'not_supported',
        unsupported: ['Capital: Fixture value'],
        evidence: [],
        note: 'The page does not name the capital.',
      },
      supported('quick-fact-2', 'fixture-overview'),
      supported('length-section-1', 'fixture-geography'),
      supported('length-section-2', 'fixture-geography'),
    ],
  };
}

/**
 * The first submission: claims a page it never fetched was read, skips a unit, and quotes words
 * the overview page does not contain.
 */
function invalidChileVerdicts() {
  const verdicts = chileVerdicts();
  verdicts.verdicts[0] = {
    ...verdicts.verdicts[0],
    evidence: [{ sourceId: 'fixture-overview', quote: 'Chile is the longest country' }],
  };
  verdicts.sources[3] = read('fixture-history');
  verdicts.verdicts = verdicts.verdicts.filter((entry) => entry.unitId !== 'quick-fact-2');
  return verdicts;
}

/** Phrasings for the Singapore stories, for the paraphrase step. Placeholder wording. */
const singaporePhrasings = {
  wealth: [
    'Why is Singapore so rich?',
    'Why is Singapore loaded?',
    'How did Singapore get so wealthy?',
    'What made Singapore prosperous?',
    'singapore wealth',
  ],
  shipping: [
    'Why do so many ships stop in Singapore?',
    "Why is Singapore's port so busy?",
    'Why is Singapore a big shipping hub?',
    'How did Singapore become a port city?',
    'singapore port',
  ],
  identity: [
    'Why are most Singaporeans ethnically Chinese?',
    'Why does Singapore have so many Chinese people?',
    'Where do Chinese Singaporeans come from?',
    'Why is Singapore mostly Chinese?',
    'singapore chinese population',
  ],
};

const thinking = () => ({ type: 'thinking', thinking: '', signature: 'fixture' });

/** Recorded turns by tag, in order. */
export function replayFixtures(): Record<string, unknown[]> {
  ids = 0;
  return {
    'plan-fixture': [
      message([text(JSON.stringify(plan))], 'end_turn', { input: 9000, output: 1200 }),
    ],
    CHL: [
      // Research; the server tool loop pauses and the pipeline resends the conversation.
      message(
        [
          ...webSearch('fixture chile overview', [
            { path: 'chile/overview', title: 'Fixture overview page' },
            { path: 'chile/geography', title: 'Fixture geography page' },
          ]),
          ...webSearch('fixture chile economy history', [
            { path: 'chile/economy', title: 'Fixture economy page' },
            { path: 'chile/history', title: 'Fixture history page' },
          ]),
        ],
        'pause_turn',
        { input: 60000, output: 3000, searches: 2 },
      ),
      // A gazetteer lookup through the client tool.
      message(
        [toolUse('find_places', { query: 'drake', countryId: null, near: null })],
        'tool_use',
        { input: 2000, cacheRead: 60000, output: 400 },
      ),
      message([toolUse('submit_draft', invalidChileDraft())], 'tool_use', {
        input: 1500,
        cacheRead: 62000,
        output: 9000,
      }),
      message(
        [text('Fixed the source and the place.'), toolUse('submit_draft', chileDraft())],
        'tool_use',
        { input: 1800, cacheRead: 71000, output: 9000 },
      ),
    ],
    'CHL-andes': [
      message(
        [
          ...webSearch('fixture andes revision', [
            { path: 'chile/andes-revised', title: 'Fixture page for the revision' },
          ]),
          toolUse('submit_story', revisedAndes()),
        ],
        'tool_use',
        { input: 50000, output: 2500, searches: 1 },
      ),
    ],
    // The first answer repeats a question and leaves a story out; the repair fixes both.
    'paraphrase-SGP': [
      message(
        [
          thinking(),
          text(
            JSON.stringify({
              stories: [
                {
                  id: 'wealth',
                  phrasings: [
                    ...singaporePhrasings.wealth.slice(0, 4),
                    'How did a tiny island become so wealthy?',
                  ],
                },
                { id: 'identity', phrasings: singaporePhrasings.identity },
              ],
            }),
          ),
        ],
        'end_turn',
        { input: 900, output: 700 },
      ),
      message(
        [
          thinking(),
          text(
            JSON.stringify({
              stories: Object.entries(singaporePhrasings).map(([id, phrasings]) => ({
                id,
                phrasings,
              })),
            }),
          ),
        ],
        'end_turn',
        { input: 1900, output: 800 },
      ),
    ],
    'claims-CHL': [
      // The geography page refuses web_fetch, so it is fetched locally.
      message(
        [
          ...webFetch('chile/overview', placeholder('the overview page')),
          ...webFetch('chile/geography', null),
          ...webFetchPdf('chile/economy'),
          ...webFetch('chile/history', null),
          toolUse('fetch_page', { url: url('chile/geography') }),
        ],
        'tool_use',
        { input: 12000, output: 1500, fetches: 4 },
      ),
      // The turn ends without submitting and is reminded.
      message([text('Read them.')], 'end_turn', { input: 400, cacheRead: 12000, output: 100 }),
      // The first submission is sent back.
      message([toolUse('submit_verdicts', invalidChileVerdicts())], 'tool_use', {
        input: 300,
        cacheRead: 12500,
        output: 1500,
      }),
      message([toolUse('submit_verdicts', chileVerdicts())], 'tool_use', {
        input: 600,
        cacheRead: 14000,
        output: 1500,
      }),
    ],
    // Last, so the IDs of the fixtures above stay as they were.
    'CHL.overview': [
      message(
        [
          ...webSearch('fixture chile overview revision', [
            { path: 'chile/overview', title: 'Fixture overview page' },
            { path: 'chile/geography', title: 'Fixture geography page' },
            { path: 'chile/economy', title: 'Fixture economy page' },
            { path: 'chile/history-report', title: 'Fixture report for the revision' },
          ]),
          toolUse('submit_overview', revisedOverview()),
        ],
        'tool_use',
        { input: 40000, output: 2000, searches: 1 },
      ),
    ],
  };
}

export function writeReplayFixtures(dir: string): void {
  rmSync(dir, { recursive: true, force: true });
  for (const [tag, turns] of Object.entries(replayFixtures())) {
    mkdirSync(join(dir, tag), { recursive: true });
    turns.forEach((turn, index) => {
      writeJson(join(dir, tag, `${String(index + 1).padStart(3, '0')}.json`), turn);
    });
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  writeReplayFixtures(REPLAY_DIR);
  console.log(`Wrote ${REPLAY_DIR}`);
}
