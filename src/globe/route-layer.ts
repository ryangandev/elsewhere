import type { GlobeInstance } from 'globe.gl';
import { diffKeyed, sameRoute } from './scene-diff';
import type { SceneRoute } from './scene';

type RouteStyle = { color: string; stroke: number; dash: number; gap: number; animateMs: number };

// Illustrative routes: dashed, gently animated, styled by the mechanism they show.
const ROUTE_STYLES: Record<SceneRoute['kind'], RouteStyle> = {
  sea: { color: '#ebd49f', stroke: 1.6, dash: 0.06, gap: 0.018, animateMs: 24000 },
  land: { color: '#e9c79d', stroke: 1.6, dash: 0.035, gap: 0.02, animateMs: 30000 },
  river: { color: '#a9d5e6', stroke: 1.3, dash: 0.08, gap: 0.012, animateMs: 30000 },
  flow: { color: '#f3e4b8', stroke: 1.4, dash: 0.02, gap: 0.03, animateMs: 12000 },
};

const ROUTE_ALTITUDE = 0.006;

const styleOf = (item: object) => ROUTE_STYLES[(item as SceneRoute).kind];

// Routes are keyed by id; an unchanged route keeps its path object and animation.
export function createRouteLayer(globe: GlobeInstance, duration: (ms: number) => number) {
  let routes = new Map<string, SceneRoute>();
  globe
    .pathPoints((item) => (item as SceneRoute).points)
    .pathPointLat((point) => (point as [number, number])[0])
    .pathPointLng((point) => (point as [number, number])[1])
    .pathPointAlt(ROUTE_ALTITUDE)
    .pathColor((item: object) => styleOf(item).color)
    .pathStroke((item) => styleOf(item).stroke)
    .pathDashLength((item) => styleOf(item).dash)
    .pathDashGap((item) => styleOf(item).gap)
    // Reduced motion keeps routes static.
    .pathDashAnimateTime((item) => duration(styleOf(item).animateMs));

  return {
    setRoutes(next: readonly SceneRoute[]) {
      const diff = diffKeyed(routes, next, sameRoute);
      if (!diff.added.length && !diff.updated.length && !diff.removed.length) return;
      // Keep the previous object for unchanged routes so globe.gl does not rebuild them.
      const data = [...diff.next.values()].map((route) => {
        const before = routes.get(route.id);
        return before && sameRoute(before, route) ? before : route;
      });
      routes = new Map(data.map((route) => [route.id, route]));
      globe.pathTransitionDuration(duration(600)).pathsData(data);
    },
  };
}
