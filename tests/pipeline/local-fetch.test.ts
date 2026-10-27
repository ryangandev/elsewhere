// Reading pages on this computer: HTML character references, PDF text layers (text drawn twice,
// running headers and footers, pdf.js warnings) and retries after a server error. Fetches go to
// stubs; no network.
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  dropOverdrawnText,
  dropRunningLines,
  fetchPage,
  htmlToText,
  pdfToText,
  type PdfTextItem,
} from '../../pipeline/claims/local-fetch';
import { quoteInText } from '../../pipeline/claims/verdicts';
import { minimalPdf } from './helpers';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('HTML text', () => {
  it('decodes every named character reference once, as a browser does', () => {
    expect(htmlToText('<p>Code Napol&eacute;on, 20&deg;C, &copy; 2024 &ndash; caf&#233;</p>')).toBe(
      'Code Napoléon, 20°C, © 2024 – café',
    );
    // A page that escaped its text twice shows the reference itself, in a browser and here.
    expect(htmlToText('<p>Napol&amp;eacute;on</p>')).toBe('Napol&eacute;on');
  });
});

/** A run of text at x on baseline y, 10 units high, as pdf.js reports it. */
const run = (str: string, x: number, y: number, width: number, hasEOL = false): PdfTextItem => ({
  str,
  transform: [10, 0, 0, 10, x, y],
  width,
  hasEOL,
});

const joined = (items: PdfTextItem[]) =>
  items.map((item) => item.str + (item.hasEOL ? '\n' : '')).join('');

describe('PDF text drawn over itself', () => {
  it('reads a line drawn twice in the same place once, keeping its line end', () => {
    // Nunn and Qian's paper draws every line twice; the second copy ends the line.
    const items = [
      run('The Columbian Exchange refers to', 78, 413, 160),
      run('The Columbian Exchange refers to', 78, 413, 160.1, true),
      run('crops, and populations', 78, 400, 110),
      run('crops, and populations', 78, 400, 110, true),
    ];
    expect(joined(dropOverdrawnText(items))).toBe(
      'The Columbian Exchange refers to\ncrops, and populations\n',
    );
  });

  it('reads a line once when its two copies are split into runs differently', () => {
    const items = [
      run('caused', 66, 629, 30),
      run('caused devastation far exceeding', 66, 629, 160),
      run('devastation far exceeding', 97.8, 629, 128.2, true),
    ];
    expect(joined(dropOverdrawnText(items))).toBe('caused devastation far exceeding\n');
  });

  it('keeps text that is repeated elsewhere on the line or on the next line', () => {
    const items = [
      run('the', 66, 600, 15),
      run('the', 84, 600, 15, true),
      run('the', 66, 587, 15, true),
      // Different text at an overlapping place, as a table cell can overflow into the next.
      run('1,204', 200, 560, 30),
      run('1,388', 220, 560, 30, true),
    ];
    expect(joined(dropOverdrawnText(items))).toBe('thethe\nthe\n1,2041,388\n');
  });
});

describe('PDF running headers and footers', () => {
  const page = (number: number, body: string[]) => [
    'February 2024',
    `Regional Analysis Brief: South China Sea ${number}`,
    ...body,
    `${number + 2}`,
  ];

  it('keeps each running line where it first appears and drops its repeats', () => {
    const pages = [
      page(1, ['In 2013, the Philippines decided to submit the dispute to the']),
      page(2, ['Permanent Court of Arbitration (PCA) in the Hague.', 'Total 1,204']),
      page(3, ['China refuses to recognize the decision.', 'Total 1,388']),
      page(4, ['Vietnam hopes to expand offshore production.', 'Total 1,512']),
    ];
    expect(dropRunningLines(pages)).toEqual([
      page(1, ['In 2013, the Philippines decided to submit the dispute to the']),
      ['Permanent Court of Arbitration (PCA) in the Hague.', 'Total 1,204'],
      ['China refuses to recognize the decision.', 'Total 1,388'],
      ['Vietnam hopes to expand offshore production.', 'Total 1,512'],
    ]);
  });

  it('leaves documents too short to tell a running line from text', () => {
    const pages = [page(1, ['One']), page(2, ['Two'])];
    expect(dropRunningLines(pages)).toEqual(pages);
  });

  it('lets a quote run on across a page break', async () => {
    const pdf = minimalPdf([
      ['Brief 1', 'In 2013, the Philippines decided to submit the dispute to the'],
      ['Brief 2', 'Permanent Court of Arbitration in the Hague.'],
      ['Brief 3', 'China refuses to recognize the decision.'],
    ]);
    const text = await pdfToText(pdf);
    expect(text).toBe(
      [
        '[Page 1]\nBrief 1\nIn 2013, the Philippines decided to submit the dispute to the',
        '[Page 2]\nPermanent Court of Arbitration in the Hague.',
        '[Page 3]\nChina refuses to recognize the decision.',
      ].join('\n\n'),
    );
    expect(quoteInText('submit the dispute to the Permanent Court of Arbitration', text)).toBe(
      true,
    );
  });
});

describe('PDF warnings', () => {
  it('never print pdf.js warnings into a command output', async () => {
    // A cross-reference offset pdf.js cannot use makes it warn "Indexing all PDF objects".
    const pdf = new TextDecoder().decode(minimalPdf([['Population 19.6 million']]));
    const broken = new TextEncoder().encode(pdf.replace(/startxref\n\d+/, 'startxref\n9'));
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(await pdfToText(broken)).toBe('[Page 1]\nPopulation 19.6 million');
    expect([...log.mock.calls, ...warn.mock.calls]).toEqual([]);
  });
});

describe('server errors', () => {
  /** A fetch stub answering each request with the next status; the last one repeats. */
  function answers(...statuses: [number, Record<string, string>?][]) {
    const calls: string[] = [];
    const stub = (async (input: string | URL | Request) => {
      calls.push(String(input));
      const [status, headers] = statuses[Math.min(calls.length, statuses.length) - 1];
      return new Response(status === 200 ? '<p>The page text.</p>' : 'Error', {
        status,
        headers: { 'content-type': 'text/html', ...headers },
      });
    }) as typeof fetch;
    return { stub, calls };
  }

  it('are tried again after the waits given, and a page that answers is read', async () => {
    const { stub, calls } = answers([504], [503, { 'retry-after': '2' }], [200]);
    const waits: number[] = [];
    const page = await fetchPage('https://example.org/slow', {
      fetch: stub,
      serverErrorRetriesMs: [5_000, 20_000, 60_000],
      sleep: async (ms) => {
        waits.push(ms);
      },
    });
    expect(page.text).toBe('The page text.');
    expect(calls).toHaveLength(3);
    // The second wait is the server's Retry-After.
    expect(waits).toEqual([5_000, 2_000]);
  });

  it('say how many attempts failed, and nothing else is retried', async () => {
    const sleep = async () => undefined;
    const down = answers([502]);
    await expect(
      fetchPage('https://example.org/down', {
        fetch: down.stub,
        serverErrorRetriesMs: [1, 1],
        sleep,
      }),
    ).rejects.toThrow('the server answered 502 on all 3 attempts');
    const blocked = answers([403]);
    await expect(
      fetchPage('https://example.org/blocked', {
        fetch: blocked.stub,
        serverErrorRetriesMs: [1, 1],
        sleep,
      }),
    ).rejects.toThrow(/^the server answered 403$/);
    expect(blocked.calls).toHaveLength(1);
    // Without retries (the claim check's fetch_page tool), a server error is one attempt.
    const once = answers([500]);
    await expect(fetchPage('https://example.org/once', { fetch: once.stub })).rejects.toThrow(
      /^the server answered 500$/,
    );
    expect(once.calls).toHaveLength(1);
  });
});

describe('bot challenges', () => {
  /** The proof-of-work page Anubis served for hal.ird.fr with a 200, abridged. */
  const anubis = (apostrophe: string) =>
    `<!doctype html><html><head><title>Making sure you${apostrophe}re not a bot!</title></head><body><h1>Making sure you${apostrophe}re not a bot!</h1><p>Loading...</p><p>You are seeing this because the administrator of this website has set up Anubis to protect the server against the scourge of AI companies aggressively scraping websites.</p><p>Anubis uses a proof-of-work scheme, so the load is small for one visitor and large for a scraper.</p></body></html>`;
  const serve = (body: string) =>
    (async () =>
      new Response(body, {
        status: 200,
        headers: { 'content-type': 'text/html' },
      })) as typeof fetch;

  it('refuses an Anubis page with a straight or a curly apostrophe', async () => {
    for (const apostrophe of ["'", '’']) {
      await expect(
        fetchPage('https://hal.ird.fr/ird-00000000', { fetch: serve(anubis(apostrophe)) }),
      ).rejects.toThrow('the server answered with a bot challenge instead of the page');
    }
  });

  it('still reads a long article that mentions the phrases', async () => {
    const article = `<p>Anubis was the Egyptian god of the dead; a site that has set up Anubis to protect the server is making sure you're not a bot. ${'Background on the cult of Anubis. '.repeat(100)}</p>`;
    const page = await fetchPage('https://example.org/anubis', { fetch: serve(article) });
    expect(page.text).toContain('Egyptian god of the dead');
  });
});
