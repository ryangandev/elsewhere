// Shared setup for the pipeline tests: a disposable copy of the English content tree, so drafts
// and review decisions never touch content/en.
import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach } from 'vitest';
import { DEFAULT_LIMITS } from '../../pipeline/config';
import { landIndex } from '../../pipeline/content-tree';
import type { Plan } from '../../pipeline/generate/check';
import { renderLinkTargets, type RunContext } from '../../pipeline/generate/tasks';
import { loadPrompts } from '../../pipeline/prompts';

const created: string[] = [];

afterEach(() => {
  for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A temporary directory removed after the test. */
export function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'elsewhere-pipeline-'));
  created.push(dir);
  return dir;
}

/** A temporary copy of content/en. */
export function tempContentTree(): string {
  const dir = join(tempDir(), 'en');
  cpSync('content/en', dir, { recursive: true });
  return dir;
}

/** A line of a PDF page set at its own size, on its own baseline (PDF units up from the bottom). */
export type PlacedLine = { text: string; size: number; y: number };

/**
 * A small valid PDF with one page per entry, each line of text in Helvetica, so PDF extraction
 * is tested without a binary fixture. Lines are set in 12-point type 14 units apart, unless a
 * page gives placed lines, each with its own size and baseline (as footnotes are set). Text must
 * not contain parentheses or backslashes.
 */
export function minimalPdf(pages: (string[] | PlacedLine[])[]): Uint8Array<ArrayBuffer> {
  const objects: string[] = [];
  const pageIds = pages.map((_, index) => 4 + index * 2);
  objects[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objects[2] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pages.length} >>`;
  objects[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>';
  pages.forEach((lines, index) => {
    const id = pageIds[index];
    const stream = lines.every((line) => typeof line === 'string')
      ? `BT /F1 12 Tf 72 720 Td 14 TL ${lines.map((line) => `(${line}) Tj T*`).join(' ')} ET`
      : (lines as PlacedLine[])
          .map(({ text, size, y }) => `BT /F1 ${size} Tf 72 ${y} Td (${text}) Tj ET`)
          .join(' ');
    objects[id] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${id + 1} 0 R >>`;
    objects[id + 1] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
  });
  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  for (let id = 1; id < objects.length; id += 1) {
    offsets.push(pdf.length);
    pdf += `${id} 0 obj\n${objects[id]}\nendobj\n`;
  }
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  pdf += offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  pdf += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(pdf);
}

export const RUN_DATE = '2026-10-26';

export function runContext(contentDir: string, plan: Plan = new Map()): RunContext {
  return {
    contentDir,
    prompts: loadPrompts(),
    model: 'claude-opus-5-5',
    effort: 'high',
    limits: DEFAULT_LIMITS,
    cacheTtl: '5m',
    date: RUN_DATE,
    plan,
    linkTargets: renderLinkTargets(contentDir, plan),
    storyCount: { min: 4, max: 6 },
    land: landIndex(),
  };
}
