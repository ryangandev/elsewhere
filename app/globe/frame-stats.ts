export const SLOW_FRAME_MS = 1000 / 30;
export type FrameStats = { frames: number; durationMs: number; fps: number; meanMs: number; p95Ms: number; worstMs: number; slowFrames: number; slowPercent: number };

// Count intervals, not callbacks: the first render only establishes a baseline.
export function summarizeFrames(intervals: number[]): FrameStats | null {
  const values = intervals.filter(value => Number.isFinite(value) && value > 0);
  if (!values.length) return null;
  const durationMs = values.reduce((total, value) => total + value, 0);
  const sorted = [...values].sort((a, b) => a - b);
  const slowFrames = values.filter(value => value > SLOW_FRAME_MS).length;
  return { frames: values.length, durationMs, fps: values.length * 1000 / durationMs,
    meanMs: durationMs / values.length, p95Ms: sorted[Math.ceil(values.length * .95) - 1],
    worstMs: sorted[sorted.length - 1], slowFrames, slowPercent: slowFrames * 100 / values.length };
}
