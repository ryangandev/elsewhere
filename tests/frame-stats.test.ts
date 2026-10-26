import assert from 'node:assert/strict';
import { test } from 'vitest';
import { summarizeFrames } from '../app/globe/frame-stats';

test('FPS uses elapsed frame time and does not assume a 60 Hz screen', () => {
  assert.equal(summarizeFrames(Array(120).fill(1000 / 120))!.fps.toFixed(0), '120');
  const result = summarizeFrames([10, 10, 80])!;
  assert.equal(result.fps, 30);
  assert.equal(result.slowFrames, 1);
  assert.equal(result.worstMs, 80);
});

test('slow frames and long stalls survive the summary instead of being discarded', () => {
  const result = summarizeFrames([...Array(18).fill(16), 80, 1000])!;
  assert.equal(result.p95Ms, 80);
  assert.equal(result.worstMs, 1000);
  assert.equal(result.slowPercent, 10);
  assert.ok(result.fps < 15);
});

test('empty or invalid samples produce a waiting state, not fabricated FPS', () => {
  assert.equal(summarizeFrames([]), null);
  assert.equal(summarizeFrames([0, -1, NaN, Infinity]), null);
});
