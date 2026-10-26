'use client';

import { useEffect, useRef, useState, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import type { GlobeInstance } from 'globe.gl';
import { RotateCcw, X } from 'lucide-react';
import { summarizeFrames, type FrameStats } from './globe/frame-stats';
import type { BasemapMode } from './globe/materials';

type Phase = 'live' | 'running' | 'complete' | 'stopped' | 'hidden';
type Reading = {
  live: FrameStats | null; result: FrameStats | null; phase: Phase; remaining: number;
  calls: number; triangles: number; width: number; height: number; dpr: number; paused: boolean; motion: 'rotate' | 'manual'; view: string;
};
const empty: Reading = { live: null, result: null, phase: 'live', remaining: 10, calls: 0, triangles: 0, width: 0, height: 0, dpr: 1, paused: false, motion: 'rotate', view: '' };

export default function PerformanceMonitor({ globeRef, readyKey, basemap, onBasemapChange, showLabels, onLabelsChange, onClose }: {
  globeRef: RefObject<GlobeInstance | null>; readyKey: number; basemap: BasemapMode; onBasemapChange: (mode: BasemapMode) => void;
  showLabels: boolean; onLabelsChange: (enabled: boolean) => void; onClose: () => void;
}) {
  const [reading, setReading] = useState(empty);
  const commands = useRef<{ start: (motion: 'rotate' | 'manual') => void; stop: () => void; reset: () => void }>({ start: () => {}, stop: () => {}, reset: () => {} });
  useEffect(() => {
    const globe = globeRef.current;
    if (!globe) return;
    const scene = globe.scene();
    const renderer = globe.renderer();
    const controls = globe.controls();
    const initialView = { ...globe.pointOfView() };
    const original = scene.onAfterRender;
    let last: number | null = null;
    let live: { time: number; ms: number }[] = [];
    let result: FrameStats | null = null;
    let phase: Phase = 'live';
    let motion: 'rotate' | 'manual' = 'rotate';
    let run: { start: number; frames: number[]; autoRotate: boolean; speed: number } | null = null;
    let calls = 0;
    let triangles = 0;
    const publish = () => {
      const now = performance.now();
      live = live.filter(frame => now - frame.time <= 2000);
      setReading({ live: summarizeFrames(live.map(frame => frame.ms)), result: run ? summarizeFrames(run.frames) : result,
        phase, remaining: run ? Math.max(0, Math.ceil((10000 - (now - run.start)) / 1000)) : 10,
        calls, triangles, width: renderer.domElement.width, height: renderer.domElement.height, dpr: renderer.getPixelRatio(), paused: document.hidden, motion, view: `${initialView.lat.toFixed(2)}°, ${initialView.lng.toFixed(2)}° · altitude ${initialView.altitude.toFixed(3)}` });
    };
    const finish = (next: Phase) => {
      if (!run) return;
      result = summarizeFrames(run.frames);
      controls.autoRotate = run.autoRotate;
      controls.autoRotateSpeed = run.speed;
      run = null;
      phase = next;
    };
    const onRender: typeof original = (...args) => {
      original.apply(scene, args);
      if (document.hidden) { last = null; return; }
      const now = performance.now();
      if (last !== null && now > last) {
        const ms = now - last;
        live.push({ time: now, ms });
        while (live.length && now - live[0].time > 2000) live.shift();
        if (run) { run.frames.push(ms); if (now - run.start >= 10000) finish('complete'); }
      }
      last = now;
      calls = renderer.info.render.calls;
      triangles = renderer.info.render.triangles;
    };
    scene.onAfterRender = onRender;
    commands.current = {
      start: nextMotion => {
        motion = nextMotion;
        if (document.hidden) return;
        finish('stopped');
        globe.pointOfView(initialView, 0);
        result = null;
        last = null;
        live = [];
        phase = 'running';
        run = { start: performance.now(), frames: [], autoRotate: controls.autoRotate, speed: controls.autoRotateSpeed };
        controls.autoRotateSpeed = 2;
        controls.autoRotate = motion === 'rotate';
        publish();
      },
      stop: () => { finish('stopped'); publish(); },
      reset: () => { finish('stopped'); phase = 'live'; result = null; live = []; last = null; publish(); },
    };
    const visibility = () => {
      if (document.hidden) finish('hidden');
      last = null;
      live = [];
      publish();
    };
    document.addEventListener('visibilitychange', visibility);
    // Only this small panel updates, twice a second. No extra animation loop.
    const timer = window.setInterval(publish, 500);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', visibility);
      finish('stopped');
      if (scene.onAfterRender === onRender) scene.onAfterRender = original;
      commands.current = { start: () => {}, stop: () => {}, reset: () => {} };
    };
  }, [globeRef, readyKey]);
  useEffect(() => () => { onBasemapChange('texture'); onLabelsChange(true); }, [onBasemapChange, onLabelsChange]);
  const stats = reading.phase === 'live' ? reading.live : reading.result;
  const headline = reading.paused ? 'Paused while tab is hidden' : reading.phase === 'running' ? `${reading.motion === 'rotate' ? 'Rotating' : 'Drag / zoom now'} · ${reading.remaining}s left`
    : reading.phase === 'complete' ? `${reading.motion === 'rotate' ? 'Rotation' : 'Interaction'} test complete` : reading.phase === 'stopped' ? 'Test stopped' : reading.phase === 'hidden' ? 'Test interrupted · tab hidden' : 'Live · recent 2 seconds';
  const ms = (value?: number) => value === undefined ? '…' : `${value.toFixed(1)} ms`;
  return createPortal(<aside className="performance-monitor" aria-label="Globe frame rate checker">
    <div className="performance-heading"><strong>{"Frame check"}</strong><button onClick={onClose} aria-label="Close frame rate checker"><X size={14} /></button></div>
    <p className="performance-phase">{headline}</p>
    <div className={`performance-fps ${stats && stats.fps < 30 ? 'is-slow' : ''}`}><strong data-testid="measured-fps">{stats ? stats.fps.toFixed(1) : '…'}</strong><span>FPS</span><small>{stats ? `${stats.frames} frames / ${(stats.durationMs / 1000).toFixed(1)}s` : 'Waiting for rendered frames'}</small></div>
    <dl className="performance-metrics">
      <div><dt>{"Average frame"}</dt><dd>{ms(stats?.meanMs)}</dd></div>
      <div><dt>{"P95 frame"}</dt><dd>{ms(stats?.p95Ms)}</dd></div>
      <div><dt>{"Worst frame"}</dt><dd>{ms(stats?.worstMs)}</dd></div>
      <div><dt>{"Slow >33.3 ms"}</dt><dd>{stats ? `${stats.slowFrames} (${stats.slowPercent.toFixed(1)}%)` : '…'}</dd></div>
    </dl>
    <p className="performance-budget">{"60 FPS ≈ 16.7 ms per frame."}<br />{"P95: 95% of frames are at or below this time."}</p>
    <div className="performance-actions"><button disabled={reading.paused} onClick={() => reading.phase === 'running' ? commands.current.stop() : commands.current.start('rotate')}>{reading.phase === 'running' ? 'Stop test' : 'Rotate for 10s'}</button><button onClick={() => commands.current.reset()} aria-label="Reset frame measurements" title="Return to live measurements"><RotateCcw size={13} /></button></div>
    <button className="performance-manual" disabled={reading.paused || reading.phase === 'running'} onClick={() => commands.current.start('manual')}>{"Record drag / zoom for 10s"}</button>
    <details className="performance-comparison"><summary>{"Compare globe rendering"}</summary><label>{"Globe rendering"}<select aria-label="Globe rendering" value={basemap} disabled={reading.phase === 'running'} onChange={event => { commands.current.reset(); onBasemapChange(event.target.value as BasemapMode); }}><option value="texture">{"4K blue globe"}</option><option value="vector">{"Vector terrain"}</option></select></label><label className="performance-label-toggle"><input type="checkbox" checked={showLabels} disabled={reading.phase === 'running'} onChange={event => { commands.current.reset(); onLabelsChange(event.target.checked); }} />{"Country labels"}</label><p>{"Same starting view and render resolution. Let the map settle before testing. Closing restores the 4K globe and labels."}</p></details>
    <p className="performance-detail">{basemap === 'texture' ? '4K blue globe' : 'Vector terrain'} {"· labels"} {showLabels ? 'on' : 'off'}<br />{reading.calls.toLocaleString()} {"draw calls ·"}{(reading.triangles / 1000).toFixed(0)}{"k triangles"}<br />{reading.width} × {reading.height} {"buffer · DPR"}{reading.dpr.toFixed(1)}{reading.phase !== 'live' && reading.live && <><br />{"Live now:"}{reading.live.fps.toFixed(1)} FPS</>}</p>
    <p className="performance-method">{"Test start:"}{reading.view}<br />{"WebGL render intervals, not GPU execution time. Test results stay here until reset or closed."}</p>
  </aside>, document.body);
}
