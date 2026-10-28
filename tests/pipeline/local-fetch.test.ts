// Reading pages on this computer: HTML character references, links and where the main text
// starts, PDF text layers (text drawn twice, running headers and footers, footnotes, pdf.js
// warnings), certificate errors and retries after a server error. Fetches go to stubs; no network.
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  dropOverdrawnText,
  dropRunningLines,
  extractLinks,
  fetchPage,
  htmlToText,
  mainTextOffset,
  NetworkCutError,
  pdfToText,
  splitFootnotes,
  type PdfLine,
  type PdfTextItem,
} from '../../pipeline/claims/local-fetch';
import { quoteInText } from '../../pipeline/claims/verdicts';
import { minimalPdf, type PlacedLine } from './helpers';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('HTML text', () => {
  it('leaves no markup in the text, even from an attribute value that holds ">"', () => {
    // pib.gov.in keeps an escaped copy of the release, with its ">" left as they are, in the value
    // of a hidden input. Ending the tag at the first ">" left the rest of the value in the text,
    // and the character references in it became a raw HTML copy of the release's table.
    const copy =
      '&lt;table style=&quot;width:100%&quot;>&lt;tr>&lt;td>Steel&lt;/td>&lt;td>1,234&lt;/td>&lt;/tr>&lt;/table>';
    const html = `<html><body><p>The release says steel output rose.</p>
      <table><tr><th>Year</th><td>2024</td></tr></table>
      <input type="hidden" name="copy" id="copy" value="${copy}" />
      <div title='a > b' data-x="<p>not text</p>">After the input.</div>
      <!-- a comment with <b>tags</b> --><!DOCTYPE html><?xml version="1.0"?></body></html>`;
    const text = htmlToText(html);
    expect(text).not.toMatch(/<[a-z/!?]/i);
    expect(text).not.toContain('not text');
    expect(text).toBe('The release says steel output rose.\n| Year | 2024\nAfter the input.');
    // A "<" that is not a tag stays.
    expect(htmlToText('<p>3 < 5 and 7 > 2</p>')).toBe('3 < 5 and 7 > 2');
  });

  it('keeps a link whose attribute holds ">", with its text', () => {
    const html = '<a title="a > b" href="/x">Linked page</a>';
    expect(extractLinks(html, 'https://site.example/p')).toEqual([
      { url: 'https://site.example/x', text: 'Linked page' },
    ]);
  });

  it('decodes every named character reference once, as a browser does', () => {
    expect(htmlToText('<p>Code Napol&eacute;on, 20&deg;C, &copy; 2024 &ndash; caf&#233;</p>')).toBe(
      'Code Napoléon, 20°C, © 2024 – café',
    );
    // A page that escaped its text twice shows the reference itself, in a browser and here.
    expect(htmlToText('<p>Napol&amp;eacute;on</p>')).toBe('Napol&eacute;on');
  });
});

describe('HTML links', () => {
  it('resolves relative links against the base element, as a browser does', () => {
    // Destatis pages set a base, and resolving against the page URL repeated their path.
    const page =
      'https://www.destatis.de/EN/Themes/Economy/National-Accounts-Domestic-Product/_node.html';
    const html = `<html><head><base href="https://www.destatis.de/"></head><body>
      <a href="EN/Themes/Economy/National-Accounts-Domestic-Product/Tables/gdp.html">GDP</a>
      <a href="/EN/Press/index.html">Press</a>
      <a href="https://example.org/other">Other</a></body></html>`;
    expect(extractLinks(html, page).map((link) => link.url)).toEqual([
      'https://www.destatis.de/EN/Themes/Economy/National-Accounts-Domestic-Product/Tables/gdp.html',
      'https://www.destatis.de/EN/Press/index.html',
      'https://example.org/other',
    ]);
    // A relative base resolves against the page; without one, links resolve against the page.
    const relative = '<base href="/sub/"><a href="a.html">A</a>';
    expect(extractLinks(relative, 'https://site.example/x/y.html')[0].url).toBe(
      'https://site.example/sub/a.html',
    );
    expect(extractLinks('<a href="a.html">A</a>', 'https://site.example/x/y.html')[0].url).toBe(
      'https://site.example/x/a.html',
    );
  });
});

describe('where the main text starts', () => {
  const menu = Array.from(
    { length: 90 },
    (_, index) => `<li><a href="/s${index}">Section ${index} of the menu</a></li>`,
  ).join('');
  const page = (main: string) =>
    `<html><body><header><nav><ul>${menu}</ul></nav></header>${main}<footer>Footer</footer></body></html>`;

  it('starts at the main element, an element with role main, or the only article', () => {
    for (const main of [
      '<main><h1>Title</h1><p>Body.</p></main>',
      '<div role="main"><h1>Title</h1><p>Body.</p></div>',
      '<article><h1>Title</h1><p>Body.</p></article>',
    ]) {
      const html = page(main);
      const text = htmlToText(html);
      const offset = mainTextOffset(html, text)!;
      expect(offset).toBeGreaterThan(1500);
      expect(text.slice(offset)).toMatch(/^Title\nBody\./);
    }
  });

  it('leaves pages that start with their text, or mark no single main part', () => {
    const short = '<nav>Home</nav><main><p>Body.</p></main>';
    expect(mainTextOffset(short, htmlToText(short))).toBeUndefined();
    const two = page('<article><p>One.</p></article><article><p>Two.</p></article>');
    expect(mainTextOffset(two, htmlToText(two))).toBeUndefined();
    const none = page('<div><p>Body.</p></div>');
    expect(mainTextOffset(none, htmlToText(none))).toBeUndefined();
  });
});

describe('certificate errors', () => {
  it('names a certificate that could not be verified, and never reads the page another way', async () => {
    let requests = 0;
    const stub = (async () => {
      requests += 1;
      throw new TypeError('fetch failed', {
        cause: Object.assign(new Error('unable to verify the first certificate'), {
          code: 'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
        }),
      });
    }) as typeof fetch;
    await expect(fetchPage('https://www.knbs.or.ke/reports/', { fetch: stub })).rejects.toThrow(
      "certificate error: the site's TLS certificate could not be verified (UNABLE_TO_VERIFY_LEAF_SIGNATURE: unable to verify the first certificate), and a page is never read over an unverified connection",
    );
    expect(requests).toBe(1);
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

describe('PDF footnotes', () => {
  const body = (text: string, y: number): PdfLine => ({ text, size: 11, y });
  const note = (text: string, y: number): PdfLine => ({ text, size: 8, y });
  const lines = (count: number, from = 700) =>
    Array.from({ length: count }, (_, index) =>
      body(`Body line ${index + 1} of the page.`, from - index * 14),
    );

  it('splits the small lines at the foot of a page that start with a marker', () => {
    const page = [
      ...lines(6),
      note('1 Census of 2017, table 3.', 90),
      note('continued from the table notes.', 80),
      note('2 Ministry figures.', 70),
      { text: '14', size: 8, y: 40 },
    ];
    expect(splitFootnotes(page)).toEqual({
      body: [...lines(6), { text: '14', size: 8, y: 40 }],
      footnotes: page.slice(6, 9),
    });
  });

  it('leaves pages it cannot tell about as they are', () => {
    // Too few lines of body text.
    const short = [...lines(4), note('1 A note.', 90)];
    expect(splitFootnotes(short).footnotes).toEqual([]);
    // Small text with no marker, such as a caption or a source line.
    const caption = [...lines(6), note('Source: national statistics office.', 90)];
    expect(splitFootnotes(caption).footnotes).toEqual([]);
    // Small text above the lowest body line is not at the foot.
    const aside = [...lines(3), note('1 A side note.', 660), ...lines(3, 640)];
    expect(splitFootnotes(aside).footnotes).toEqual([]);
    // A numbered list in body type is body text.
    const list = [...lines(6), body('1 First item.', 90), body('2 Second item.', 76)];
    expect(splitFootnotes(list).footnotes).toEqual([]);
  });

  it('moves footnotes after the last page, so a sentence reads on across the page break', async () => {
    const placed = (texts: string[], size = 11, from = 700): PlacedLine[] =>
      texts.map((text, index) => ({ text, size, y: from - index * 14 }));
    const filler = [
      'Chile has sixteen regions.',
      'Each region has a governor.',
      'The regions differ in size.',
      'Most people live in the centre.',
    ];
    const pdf = minimalPdf([
      [
        ...placed([...filler, 'The census of 2017 counted 17.6 million people in the']),
        ...placed(['1 Instituto Nacional de Estadisticas, 2018.'], 8, 90),
      ],
      placed(['whole country, a rise of ten percent.', ...filler]),
    ]);
    const text = await pdfToText(pdf);
    expect(text).toBe(
      [
        `[Page 1]\n${filler.join('\n')}\nThe census of 2017 counted 17.6 million people in the`,
        `[Page 2]\nwhole country, a rise of ten percent.\n${filler.join('\n')}`,
        '[Footnotes of page 1]\n1 Instituto Nacional de Estadisticas, 2018.',
      ].join('\n\n'),
    );
    expect(quoteInText('17.6 million people in the whole country', text)).toBe(true);
    expect(quoteInText('Instituto Nacional de Estadisticas, 2018', text)).toBe(true);
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

describe('a body cut off while it downloads', () => {
  /**
   * A response whose body delivers a first chunk and then fails the way undici does when the
   * connection ends in the middle: a TypeError "terminated" caused by a closed socket.
   */
  function cutResponse(error: Error = new TypeError('terminated', { cause: socketClosed() })) {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('<p>Half of the'));
        controller.error(error);
      },
    });
    return new Response(body, { status: 200, headers: { 'content-type': 'text/html' } });
  }
  const socketClosed = () =>
    Object.assign(new Error('other side closed'), { code: 'UND_ERR_SOCKET' });

  /** A fetch stub that answers with each given response in turn (the last one repeats). */
  function sequence(...answers: (() => Response)[]) {
    let calls = 0;
    const stub = (async () => answers[Math.min(calls++, answers.length - 1)]()) as typeof fetch;
    return { stub, calls: () => calls };
  }
  const wholePage = () =>
    new Response('<p>The page text.</p>', { headers: { 'content-type': 'text/html' } });

  it('is tried again after the waits given, and the whole page is read', async () => {
    const { stub, calls } = sequence(cutResponse, cutResponse, wholePage);
    const waits: number[] = [];
    const page = await fetchPage('https://example.org/long.pdf', {
      fetch: stub,
      bodyCutRetriesMs: [10, 20, 30],
      sleep: async (ms) => {
        waits.push(ms);
      },
    });
    expect(page.text).toBe('The page text.');
    expect(calls()).toBe(3);
    expect(waits).toEqual([10, 20]);
  });

  it('is reported as a network cut, not a page problem, when every attempt is cut', async () => {
    const { stub, calls } = sequence(cutResponse);
    const error = await fetchPage('https://example.org/long.pdf', {
      fetch: stub,
      bodyCutRetriesMs: [1, 1],
      sleep: async () => undefined,
    }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(NetworkCutError);
    expect((error as Error).message).toBe(
      'the connection was cut while the page downloaded (terminated: UND_ERR_SOCKET: other side closed) on all 3 attempts; this is a network failure, not a problem with the page, so try again later',
    );
    expect(calls()).toBe(3);
  });

  it('recognises a reset connection and a premature close, but not a timeout', async () => {
    for (const error of [
      Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' }),
      Object.assign(new Error('Premature close'), { code: 'ERR_STREAM_PREMATURE_CLOSE' }),
    ]) {
      const { stub, calls } = sequence(() => cutResponse(error), wholePage);
      const page = await fetchPage('https://example.org/x', {
        fetch: stub,
        bodyCutRetriesMs: [1],
        sleep: async () => undefined,
      });
      expect(page.text).toBe('The page text.');
      expect(calls()).toBe(2);
    }
    const timeout = sequence(() => cutResponse(new DOMException('timed out', 'TimeoutError')));
    await expect(
      fetchPage('https://example.org/x', {
        fetch: timeout.stub,
        bodyCutRetriesMs: [1, 1],
        sleep: async () => undefined,
      }),
    ).rejects.not.toBeInstanceOf(NetworkCutError);
    expect(timeout.calls()).toBe(1);
  });

  it('never retries a refusal or a bot challenge, however many retries are allowed', async () => {
    const sleep = vi.fn(async () => undefined);
    for (const status of [401, 403, 429]) {
      const refused = sequence(() => new Response('no', { status }));
      await expect(
        fetchPage('https://example.org/x', {
          fetch: refused.stub,
          bodyCutRetriesMs: [1, 1, 1],
          sleep,
        }),
      ).rejects.toThrow(`the server answered ${status}`);
      expect(refused.calls()).toBe(1);
    }
    const challenge = sequence(
      () =>
        new Response('<html><body><h1>Just a moment...</h1></body></html>', {
          headers: { 'content-type': 'text/html' },
        }),
    );
    await expect(
      fetchPage('https://example.org/x', {
        fetch: challenge.stub,
        bodyCutRetriesMs: [1, 1, 1],
        sleep,
      }),
    ).rejects.toThrow('bot challenge');
    expect(challenge.calls()).toBe(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('is one attempt when no retries are asked for', async () => {
    const { stub, calls } = sequence(cutResponse, wholePage);
    await expect(fetchPage('https://example.org/x', { fetch: stub })).rejects.toThrow(
      /^the connection was cut while the page downloaded \(terminated: UND_ERR_SOCKET: other side closed\); this is a network failure/,
    );
    expect(calls()).toBe(1);
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
