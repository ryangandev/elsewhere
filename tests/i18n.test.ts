import assert from 'node:assert/strict';
import { test } from 'vitest';
import { format, messages } from '@/i18n';

const EM_DASH = String.fromCharCode(0x2014);

function collect(value: unknown, path: string[] = []): { path: string; text: string }[] {
  if (typeof value === 'string') return [{ path: path.join('.'), text: value }];
  return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) =>
    collect(child, [...path, key]),
  );
}

test('format fills placeholders and leaves unknown ones visible', () => {
  assert.equal(
    format('{name} is in {region}', { name: 'Chile', region: 'South America' }),
    'Chile is in South America',
  );
  assert.equal(format('{count} places', { count: 3 }), '3 places');
  assert.equal(format('Hello {missing}', {}), 'Hello {missing}');
});

test('every catalog message is non-empty English text without the em dash', () => {
  const entries = collect(messages);
  assert.ok(entries.length > 100);
  for (const { path, text } of entries) {
    assert.ok(text.trim().length > 0, path);
    assert.ok(!text.includes(EM_DASH), path);
    assert.ok(!/\p{Script=Han}/u.test(text), path);
  }
});
