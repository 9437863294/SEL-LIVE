/**
 * The map-based progress report, without a mapping library.
 *
 * There is no map dependency in this project and no tile-server key, so rather than add either, this
 * projects the towers' own coordinates into an SVG route diagram: towers plotted in line order,
 * joined by the conductor route, coloured by progress. That is what the map report is actually for —
 * "where along the line is the work, and where is it stuck" — and doing it this way means the report
 * renders offline, prints to a clean A4 sheet, and needs no API quota. What it does not give you is a
 * basemap: no roads, no villages, no satellite imagery behind the route.
 *
 * Pure — no Firebase, no React, no DOM — so the projection is unit-testable with `node --test`.
 */

import {
  TOWER_ACTIVITIES,
  computeTowerProgressPct,
  daysInCurrentStatus,
  isActivityComplete,
  toDateKey,
  startOfDay,
  type ProjectTower,
  type TowerProgressSettings,
} from "./project-management-tower-progress.ts";

/** The four states the legend shows (§15). */
export const ROUTE_STATUSES = ["completed", "in-progress", "delayed", "not-started"] as const;
export type RouteStatus = (typeof ROUTE_STATUSES)[number];

export const ROUTE_STATUS_LABELS: Record<RouteStatus, string> = {
  completed: "Completed",
  "in-progress": "In Progress",
  delayed: "Delayed",
  "not-started": "Not Started",
};

/** Fill colours as literal hex rather than Tailwind classes: these are painted onto SVG shapes and
 *  have to survive `print-color-adjust: exact` on a sheet of paper. */
export const ROUTE_STATUS_COLORS: Record<RouteStatus, string> = {
  completed: "#059669",
  "in-progress": "#d97706",
  delayed: "#dc2626",
  "not-started": "#94a3b8",
};

export interface RoutePoint {
  towerId: string;
  towerNo: string;
  latitude: number;
  longitude: number;
  /** SVG coordinates inside the returned viewBox. */
  x: number;
  y: number;
  progressPct: number;
  status: RouteStatus;
  location: string;
}

export interface TowerRouteMap {
  points: RoutePoint[];
  /** viewBox dimensions. Callers render at whatever CSS size they like. */
  width: number;
  height: number;
  /** `M x y L x y …` for the route line through the plotted towers, in tower order. */
  path: string;
  bounds: { minLat: number; maxLat: number; minLon: number; maxLon: number };
  /** Straight-line length of the plotted route, in kilometres. */
  routeKm: number;
  counts: Record<RouteStatus, number>;
  /** Towers with no coordinates recorded — excluded from the plot and named so the omission is
   *  visible rather than silent. */
  towersWithoutCoordinates: string[];
}

/**
 * A tower's map colour.
 *
 * Delayed outranks in-progress: a tower that is both under way and stalled is a tower somebody needs
 * to look at, and showing it as ordinary progress would hide exactly the thing the map is for.
 */
export function routeStatusOf(
  tower: ProjectTower,
  settings: TowerProgressSettings,
  today: Date = new Date(),
): RouteStatus {
  const allComplete = TOWER_ACTIVITIES.every((activity) =>
    isActivityComplete(tower.activities[activity].status),
  );
  if (allComplete) return "completed";

  const todayKey = toDateKey(startOfDay(today));
  const delayed = TOWER_ACTIVITIES.some((activity) => {
    const state = tower.activities[activity];
    if (isActivityComplete(state.status)) return false;
    if (state.status === "Blocked") return true;
    if (state.plannedEndDate && state.plannedEndDate < todayKey) return true;
    const days = daysInCurrentStatus(state, today);
    return days !== undefined && days >= settings.delayThresholdDays && state.status !== "Not Started";
  });
  if (delayed) return "delayed";

  const started = TOWER_ACTIVITIES.some(
    (activity) => tower.activities[activity].status !== "Not Started",
  );
  return started ? "in-progress" : "not-started";
}

const EARTH_RADIUS_KM = 6371;

/** Great-circle distance in kilometres, for the route length and the scale bar. */
export function haversineKm(
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number },
): number {
  const toRad = (value: number) => (value * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

const hasCoordinates = (
  tower: ProjectTower,
): tower is ProjectTower & { latitude: number; longitude: number } =>
  typeof tower.latitude === "number" && typeof tower.longitude === "number";

/**
 * Projects the towers onto an SVG canvas.
 *
 * Equirectangular, with longitude compressed by the cosine of the mean latitude so the corridor is
 * not stretched east–west — at 20°N that is a 6% error uncorrected, which is enough to make a
 * straight line look like a dogleg. Both axes share one scale factor so the route keeps its true
 * shape inside the box instead of being stretched to fill it, and a line that runs almost due north
 * therefore renders as a narrow column rather than a fanned-out zigzag.
 */
export function buildTowerRouteMap(
  towers: readonly ProjectTower[],
  settings: TowerProgressSettings,
  options: { width?: number; height?: number; padding?: number; today?: Date } = {},
): TowerRouteMap {
  const width = options.width ?? 1000;
  const height = options.height ?? 620;
  const padding = options.padding ?? 40;
  const today = options.today ?? new Date();

  const plottable = towers.filter(hasCoordinates);
  const towersWithoutCoordinates = towers
    .filter((tower) => !hasCoordinates(tower))
    .map((tower) => tower.towerNo);

  const counts = ROUTE_STATUSES.reduce(
    (map, status) => {
      map[status] = 0;
      return map;
    },
    {} as Record<RouteStatus, number>,
  );
  towers.forEach((tower) => {
    counts[routeStatusOf(tower, settings, today)] += 1;
  });

  if (!plottable.length) {
    return {
      points: [],
      width,
      height,
      path: "",
      bounds: { minLat: 0, maxLat: 0, minLon: 0, maxLon: 0 },
      routeKm: 0,
      counts,
      towersWithoutCoordinates,
    };
  }

  const lats = plottable.map((tower) => tower.latitude);
  const lons = plottable.map((tower) => tower.longitude);
  const bounds = {
    minLat: Math.min(...lats),
    maxLat: Math.max(...lats),
    minLon: Math.min(...lons),
    maxLon: Math.max(...lons),
  };
  const meanLat = ((bounds.minLat + bounds.maxLat) / 2) * (Math.PI / 180);
  const lonScale = Math.max(0.1, Math.cos(meanLat));

  const spanX = (bounds.maxLon - bounds.minLon) * lonScale;
  const spanY = bounds.maxLat - bounds.minLat;
  const usableWidth = width - padding * 2;
  const usableHeight = height - padding * 2;
  // A single-tower project, or a perfectly straight north–south line, has a zero span on one axis;
  // falling back to the other axis' scale keeps the divisor finite and the plot centred.
  const scale =
    spanX <= 0 && spanY <= 0
      ? 1
      : Math.min(
          spanX > 0 ? usableWidth / spanX : Number.POSITIVE_INFINITY,
          spanY > 0 ? usableHeight / spanY : Number.POSITIVE_INFINITY,
        );

  const plotWidth = spanX * scale;
  const plotHeight = spanY * scale;
  const offsetX = padding + (usableWidth - plotWidth) / 2;
  const offsetY = padding + (usableHeight - plotHeight) / 2;

  const points: RoutePoint[] = plottable
    .map((tower) => ({
      towerId: tower.id,
      towerNo: tower.towerNo,
      latitude: tower.latitude,
      longitude: tower.longitude,
      // Latitude increases northward, SVG y increases downward, so the y axis is inverted.
      x: offsetX + (tower.longitude - bounds.minLon) * lonScale * scale,
      y: offsetY + (bounds.maxLat - tower.latitude) * scale,
      progressPct: computeTowerProgressPct(tower, settings.activityWeights),
      status: routeStatusOf(tower, settings, today),
      location: tower.location ?? "",
    }))
    .sort((a, b) => a.towerNo.localeCompare(b.towerNo, undefined, { numeric: true }));

  const path = points
    .map((point, index) => `${index === 0 ? "M" : "L"} ${point.x.toFixed(1)} ${point.y.toFixed(1)}`)
    .join(" ");

  const routeKm = points.reduce(
    (sum, point, index) => (index === 0 ? 0 : sum + haversineKm(points[index - 1], point)),
    0,
  );

  return { points, width, height, path, bounds, routeKm, counts, towersWithoutCoordinates };
}
