export interface RawRoutePoint {
  lat: number;
  lon: number;
  ele: number;
  time?: string;
}

export interface RoutePoint extends RawRoutePoint {
  distanceM: number;
}

export interface RouteSegment {
  index: number;
  startDistanceM: number;
  endDistanceM: number;
  distanceM: number;
  startEleM: number;
  endEleM: number;
  grade: number;
  headingDeg: number;
}

export interface PreparedRoute {
  name: string;
  points: RoutePoint[];
  segments: RouteSegment[];
  totalDistanceM: number;
  totalAscentM: number;
  totalDescentM: number;
}

const EARTH_RADIUS_M = 6_371_000;

export function toRadians(value: number): number {
  return (value * Math.PI) / 180;
}

export function toDegrees(value: number): number {
  return (value * 180) / Math.PI;
}

export function haversineDistanceM(a: RawRoutePoint, b: RawRoutePoint): number {
  const phi1 = toRadians(a.lat);
  const phi2 = toRadians(b.lat);
  const dPhi = toRadians(b.lat - a.lat);
  const dLambda = toRadians(b.lon - a.lon);

  const s =
    Math.sin(dPhi / 2) * Math.sin(dPhi / 2) +
    Math.cos(phi1) * Math.cos(phi2) * Math.sin(dLambda / 2) * Math.sin(dLambda / 2);

  return 2 * EARTH_RADIUS_M * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
}

export function bearingDeg(a: RawRoutePoint, b: RawRoutePoint): number {
  const phi1 = toRadians(a.lat);
  const phi2 = toRadians(b.lat);
  const lambda1 = toRadians(a.lon);
  const lambda2 = toRadians(b.lon);
  const y = Math.sin(lambda2 - lambda1) * Math.cos(phi2);
  const x =
    Math.cos(phi1) * Math.sin(phi2) -
    Math.sin(phi1) * Math.cos(phi2) * Math.cos(lambda2 - lambda1);

  return (toDegrees(Math.atan2(y, x)) + 360) % 360;
}

export function destinationPoint(
  start: RawRoutePoint,
  distanceM: number,
  bearingDegrees: number,
  ele: number
): RawRoutePoint {
  const delta = distanceM / EARTH_RADIUS_M;
  const theta = toRadians(bearingDegrees);
  const phi1 = toRadians(start.lat);
  const lambda1 = toRadians(start.lon);

  const sinPhi2 =
    Math.sin(phi1) * Math.cos(delta) +
    Math.cos(phi1) * Math.sin(delta) * Math.cos(theta);
  const phi2 = Math.asin(sinPhi2);
  const y = Math.sin(theta) * Math.sin(delta) * Math.cos(phi1);
  const x = Math.cos(delta) - Math.sin(phi1) * Math.sin(phi2);
  const lambda2 = lambda1 + Math.atan2(y, x);

  return {
    lat: toDegrees(phi2),
    lon: ((toDegrees(lambda2) + 540) % 360) - 180,
    ele
  };
}

export function prepareRoute(
  name: string,
  rawPoints: RawRoutePoint[],
  segmentMeters = 1000,
  smoothingWindow = 7
): PreparedRoute {
  if (rawPoints.length < 2) {
    throw new Error("Eine Route braucht mindestens zwei Punkte.");
  }

  const pointsWithDistance = computeCumulativeDistance(rawPoints);
  const smoothed = smoothElevation(pointsWithDistance, smoothingWindow);
  const totalDistanceM = smoothed.at(-1)?.distanceM ?? 0;
  const segments = buildSegments(smoothed, Math.max(100, segmentMeters));
  let totalAscentM = 0;
  let totalDescentM = 0;

  for (let i = 1; i < smoothed.length; i += 1) {
    const delta = smoothed[i].ele - smoothed[i - 1].ele;
    if (delta > 0) {
      totalAscentM += delta;
    } else {
      totalDescentM += Math.abs(delta);
    }
  }

  return {
    name,
    points: smoothed,
    segments,
    totalDistanceM,
    totalAscentM,
    totalDescentM
  };
}

export function computeCumulativeDistance(rawPoints: RawRoutePoint[]): RoutePoint[] {
  let distanceM = 0;

  return rawPoints.map((point, index) => {
    if (index > 0) {
      distanceM += haversineDistanceM(rawPoints[index - 1], point);
    }

    return {
      ...point,
      ele: Number.isFinite(point.ele) ? point.ele : 0,
      distanceM
    };
  });
}

export function smoothElevation(points: RoutePoint[], windowSize: number): RoutePoint[] {
  const safeWindow = Math.max(1, Math.floor(windowSize));
  if (safeWindow <= 1) {
    return points;
  }

  const radius = Math.floor(safeWindow / 2);

  return points.map((point, index) => {
    let total = 0;
    let weight = 0;
    for (let offset = -radius; offset <= radius; offset += 1) {
      const candidate = points[index + offset];
      if (!candidate) {
        continue;
      }
      const localWeight = radius + 1 - Math.abs(offset);
      total += candidate.ele * localWeight;
      weight += localWeight;
    }

    return {
      ...point,
      ele: total / weight
    };
  });
}

function buildSegments(points: RoutePoint[], segmentMeters: number): RouteSegment[] {
  const totalDistanceM = points.at(-1)?.distanceM ?? 0;
  const segments: RouteSegment[] = [];
  let startDistanceM = 0;
  let index = 1;

  while (startDistanceM < totalDistanceM - 50) {
    const endDistanceM = Math.min(startDistanceM + segmentMeters, totalDistanceM);
    const start = interpolateAtDistance(points, startDistanceM);
    const end = interpolateAtDistance(points, endDistanceM);
    const distanceM = Math.max(1, endDistanceM - startDistanceM);
    const rawGrade = (end.ele - start.ele) / distanceM;
    const grade = clamp(rawGrade, -0.15, 0.15);

    segments.push({
      index,
      startDistanceM,
      endDistanceM,
      distanceM,
      startEleM: start.ele,
      endEleM: end.ele,
      grade,
      headingDeg: bearingDeg(start, end)
    });

    startDistanceM = endDistanceM;
    index += 1;
  }

  return segments;
}

export function interpolateAtDistance(points: RoutePoint[], distanceM: number): RoutePoint {
  if (distanceM <= 0) {
    return points[0];
  }

  const last = points.at(-1)!;
  if (distanceM >= last.distanceM) {
    return last;
  }

  let low = 0;
  let high = points.length - 1;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (points[mid].distanceM < distanceM) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }

  const right = points[low];
  const left = points[Math.max(0, low - 1)];
  const span = Math.max(1, right.distanceM - left.distanceM);
  const ratio = clamp((distanceM - left.distanceM) / span, 0, 1);

  return {
    lat: left.lat + (right.lat - left.lat) * ratio,
    lon: left.lon + (right.lon - left.lon) * ratio,
    ele: left.ele + (right.ele - left.ele) * ratio,
    time: left.time,
    distanceM
  };
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
