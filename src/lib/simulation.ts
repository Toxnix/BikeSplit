import { clamp, RouteSegment, toRadians } from "./geo";

export type SimulationMode = "power" | "goal" | "pacing";

export interface RiderBikeProfile {
  riderWeightKg: number;
  bikeWeightKg: number;
  ftpW: number;
  targetPowerW: number;
  cdaRace: number;
  cdaClimb: number;
  cdaRaceYaw: Record<string, number>;
  cdaClimbYaw: Record<string, number>;
  crr: number;
  drivetrainLossPct: number;
  positionSwitchKph: number;
  maxSpeedKph: number;
  minPowerW: number;
  maxPowerW: number;
  pacingAggression: number;
  maxPowerSurgePct: number;
  cornerExitBoostPct: number;
  cornerExitDistanceM: number;
  cornerBrakeSensitivity: number;
  minCornerSpeedKph: number;
}

export interface WeatherProfile {
  tempC: number;
  pressureHpa: number;
  humidityPct: number;
  windSpeedKph: number;
  windDirectionDeg: number;
}

export interface SimulationSegment extends RouteSegment {
  powerW: number;
  timeSec: number;
  speedMps: number;
  cda: number;
  yawDeg: number;
  airDensityKgM3: number;
  headwindMps: number;
  position: "race" | "climb";
}

export interface SimulationSummary {
  totalTimeSec: number;
  totalDistanceM: number;
  averageSpeedMps: number;
  averagePowerW: number;
  normalizedPowerW: number;
  ascentTimeSec: number;
  descentTimeSec: number;
}

export interface SimulationResult {
  segments: SimulationSegment[];
  summary: SimulationSummary;
  solvedPowerW?: number;
}

export interface ScenarioComparison {
  id: string;
  label: string;
  value: string;
  deltaSec: number;
}

const GRAVITY = 9.80665;
const DRY_AIR_R = 287.05;
const WATER_VAPOR_R = 461.495;

export const defaultProfile: RiderBikeProfile = {
  riderWeightKg: 90,
  bikeWeightKg: 9,
  ftpW: 400,
  targetPowerW: 288,
  cdaRace: 0.2628,
  cdaClimb: 0.4133,
  cdaRaceYaw: {
    "0": 0.2628,
    "5": 0.2607,
    "10": 0.2489,
    "15": 0.2452,
    "20": 0.236
  },
  cdaClimbYaw: {
    "0": 0.4133,
    "5": 0.4109,
    "10": 0.3989,
    "15": 0.3922,
    "20": 0.3796
  },
  crr: 0.00309,
  drivetrainLossPct: 2.2,
  positionSwitchKph: 24,
  maxSpeedKph: 78,
  minPowerW: 90,
  maxPowerW: 600,
  pacingAggression: 0.65,
  maxPowerSurgePct: 18,
  cornerExitBoostPct: 10,
  cornerExitDistanceM: 300,
  cornerBrakeSensitivity: 0.65,
  minCornerSpeedKph: 22
};

export const defaultWeather: WeatherProfile = {
  tempC: 20,
  pressureHpa: 1013.25,
  humidityPct: 60,
  windSpeedKph: 8,
  windDirectionDeg: 240
};

export function airDensityKgM3(weather: WeatherProfile): number {
  const tempK = weather.tempC + 273.15;
  const saturationHpa = 6.1078 * Math.exp((17.27 * weather.tempC) / (weather.tempC + 237.3));
  const vaporPressureHpa = saturationHpa * clamp(weather.humidityPct, 0, 100) / 100;
  const dryPressurePa = Math.max(0, weather.pressureHpa - vaporPressureHpa) * 100;
  const vaporPressurePa = vaporPressureHpa * 100;

  return dryPressurePa / (DRY_AIR_R * tempK) + vaporPressurePa / (WATER_VAPOR_R * tempK);
}

export function simulateCourse(
  routeSegments: RouteSegment[],
  profile: RiderBikeProfile,
  weather: WeatherProfile,
  mode: SimulationMode,
  goalTimeSec?: number
): SimulationResult {
  if (mode === "goal" && goalTimeSec && goalTimeSec > 0) {
    return solveForGoalTime(routeSegments, profile, weather, goalTimeSec);
  }

  const powerPlan =
    mode === "pacing"
      ? createPacingPlan(routeSegments, profile)
      : routeSegments.map(() => profile.targetPowerW);

  return runSimulation(routeSegments, profile, weather, powerPlan);
}

export function runSimulation(
  routeSegments: RouteSegment[],
  profile: RiderBikeProfile,
  weather: WeatherProfile,
  powerPlan: number[]
): SimulationResult {
  const rho = airDensityKgM3(weather);
  const segments = routeSegments.map((segment, index) =>
    solveSegment(
      segment,
      clamp(powerPlan[index] ?? profile.targetPowerW, 0, profile.maxPowerW),
      profile,
      weather,
      rho,
      routeSegments,
      index
    )
  );

  return summarize(segments);
}

export function solveForGoalTime(
  routeSegments: RouteSegment[],
  profile: RiderBikeProfile,
  weather: WeatherProfile,
  goalTimeSec: number
): SimulationResult {
  let low = 80;
  let high = Math.max(profile.maxPowerW, profile.ftpW * 1.35, profile.targetPowerW + 120);
  let solvedPowerW = profile.targetPowerW;

  for (let i = 0; i < 42; i += 1) {
    const mid = (low + high) / 2;
    const candidate = runSimulation(
      routeSegments,
      { ...profile, targetPowerW: mid, maxPowerW: Math.max(profile.maxPowerW, mid) },
      weather,
      routeSegments.map(() => mid)
    );
    solvedPowerW = mid;

    if (candidate.summary.totalTimeSec > goalTimeSec) {
      low = mid;
    } else {
      high = mid;
    }
  }

  const result = runSimulation(
    routeSegments,
    { ...profile, targetPowerW: solvedPowerW, maxPowerW: Math.max(profile.maxPowerW, solvedPowerW) },
    weather,
    routeSegments.map(() => solvedPowerW)
  );

  return {
    ...result,
    solvedPowerW
  };
}

export function createPacingPlan(routeSegments: RouteSegment[], profile: RiderBikeProfile): number[] {
  const maxSurge = clamp(profile.maxPowerSurgePct, 0, 50) / 100;
  const maxAllowedPower = Math.min(profile.maxPowerW, profile.targetPowerW * (1 + maxSurge));
  const raw = routeSegments.map((segment, index) => {
    const climbBoost = clamp(segment.grade / 0.06, 0, 1);
    const cornerBoost = cornerExitLoad(routeSegments, index, profile);
    const descentRelief = clamp(-segment.grade / 0.06, 0, 1) * 0.18;
    const surge =
      clamp(
        profile.pacingAggression * (climbBoost * maxSurge + cornerBoost * (profile.cornerExitBoostPct / 100)),
        0,
        maxSurge
      );
    const distanceLoad = segment.distanceM / 1000;
    const adjusted = profile.targetPowerW * (1 + surge - profile.pacingAggression * descentRelief);
    return {
      watts: adjusted,
      weight: distanceLoad
    };
  });

  const weightedAverage =
    raw.reduce((sum, item) => sum + item.watts * item.weight, 0) /
    Math.max(1, raw.reduce((sum, item) => sum + item.weight, 0));

  const offset = weightedAverage - profile.targetPowerW;
  return raw.map((item) => clamp(item.watts - offset, profile.minPowerW, maxAllowedPower));
}

export function buildScenarioComparisons(
  routeSegments: RouteSegment[],
  profile: RiderBikeProfile,
  weather: WeatherProfile,
  baseline: SimulationResult,
  mode: SimulationMode
): ScenarioComparison[] {
  const run = (nextProfile: RiderBikeProfile, nextWeather = weather) =>
    simulateCourse(routeSegments, nextProfile, nextWeather, mode).summary.totalTimeSec;
  const baselineSec = baseline.summary.totalTimeSec;

  const scenarios: ScenarioComparison[] = [
    {
      id: "power",
      label: "+10 W",
      value: "Pacing",
      deltaSec: run({ ...profile, targetPowerW: profile.targetPowerW + 10 }) - baselineSec
    },
    {
      id: "cda",
      label: "-0,01 CdA",
      value: "Aero",
      deltaSec:
        run({
          ...profile,
          cdaRace: Math.max(0.18, profile.cdaRace - 0.01),
          cdaClimb: Math.max(0.2, profile.cdaClimb - 0.01),
          cdaRaceYaw: adjustCdaMap(profile.cdaRaceYaw, -0.01, 0.18),
          cdaClimbYaw: adjustCdaMap(profile.cdaClimbYaw, -0.01, 0.2)
        }) - baselineSec
    },
    {
      id: "crr",
      label: "-0,0004 Crr",
      value: "Rollwiderstand",
      deltaSec: run({ ...profile, crr: Math.max(0.002, profile.crr - 0.0004) }) - baselineSec
    },
    {
      id: "mass",
      label: "-2 kg",
      value: "Systemmasse",
      deltaSec: run({ ...profile, riderWeightKg: Math.max(45, profile.riderWeightKg - 2) }) - baselineSec
    },
    {
      id: "wind",
      label: "+5 km/h Wind",
      value: "Wetter",
      deltaSec: run(profile, { ...weather, windSpeedKph: weather.windSpeedKph + 5 }) - baselineSec
    }
  ];

  return scenarios;
}

function solveSegment(
  segment: RouteSegment,
  powerW: number,
  profile: RiderBikeProfile,
  weather: WeatherProfile,
  airDensity: number,
  routeSegments: RouteSegment[],
  segmentIndex: number
): SimulationSegment {
  const massKg = profile.riderWeightKg + profile.bikeWeightKg;
  const wheelPowerW = powerW * (1 - clamp(profile.drivetrainLossPct, 0, 15) / 100);
  const maxSpeedMps = Math.max(
    2,
    Math.min(profile.maxSpeedKph / 3.6, cornerSpeedLimitMps(routeSegments, segmentIndex, profile))
  );
  const minSpeedMps = 0.25;
  const lowNeed = requiredWheelPower(minSpeedMps, segment, profile, weather, airDensity, massKg).requiredPowerW;
  const highNeed = requiredWheelPower(maxSpeedMps, segment, profile, weather, airDensity, massKg).requiredPowerW;

  let speedMps = maxSpeedMps;
  if (lowNeed >= wheelPowerW) {
    speedMps = minSpeedMps;
  } else if (highNeed >= wheelPowerW) {
    let low = minSpeedMps;
    let high = maxSpeedMps;
    for (let i = 0; i < 54; i += 1) {
      const mid = (low + high) / 2;
      const need = requiredWheelPower(mid, segment, profile, weather, airDensity, massKg).requiredPowerW;
      if (need > wheelPowerW) {
        high = mid;
      } else {
        low = mid;
      }
    }
    speedMps = (low + high) / 2;
  }

  const details = requiredWheelPower(speedMps, segment, profile, weather, airDensity, massKg);
  const timeSec = segment.distanceM / Math.max(0.1, speedMps);

  return {
    ...segment,
    powerW,
    timeSec,
    speedMps,
    cda: details.cda,
    yawDeg: details.yawDeg,
    airDensityKgM3: airDensity,
    headwindMps: details.headwindMps,
    position: details.position
  };
}

function requiredWheelPower(
  speedMps: number,
  segment: RouteSegment,
  profile: RiderBikeProfile,
  weather: WeatherProfile,
  airDensity: number,
  massKg: number
) {
  const theta = Math.atan(segment.grade);
  const wind = windVectorMps(weather);
  const heading = toRadians(segment.headingDeg);
  const forward = { east: Math.sin(heading), north: Math.cos(heading) };
  const right = { east: Math.sin(heading + Math.PI / 2), north: Math.cos(heading + Math.PI / 2) };
  const ground = {
    east: forward.east * speedMps,
    north: forward.north * speedMps
  };
  const relative = {
    east: ground.east - wind.east,
    north: ground.north - wind.north
  };
  const relSpeedMps = Math.hypot(relative.east, relative.north);
  const along = relative.east * forward.east + relative.north * forward.north;
  const cross = relative.east * right.east + relative.north * right.north;
  const yawDeg = Math.abs(Math.atan2(cross, Math.max(0.1, along)) * 180) / Math.PI;
  const position: "race" | "climb" =
    segment.grade > 0.012 && speedMps * 3.6 < profile.positionSwitchKph ? "climb" : "race";
  const cda =
    position === "climb"
      ? interpolateCda(yawDeg, profile.cdaClimbYaw, profile.cdaClimb)
      : interpolateCda(yawDeg, profile.cdaRaceYaw, profile.cdaRace);
  const aeroForce = 0.5 * airDensity * cda * relSpeedMps * relSpeedMps;
  const rollingForce = profile.crr * massKg * GRAVITY * Math.cos(theta);
  const gravityForce = massKg * GRAVITY * Math.sin(theta);
  const requiredPowerW = speedMps * (aeroForce + rollingForce + gravityForce);
  const windAlong = wind.east * forward.east + wind.north * forward.north;
  const headwindMps = -windAlong;

  return {
    requiredPowerW,
    cda,
    yawDeg,
    headwindMps,
    position
  };
}

function summarize(segments: SimulationSegment[]): SimulationResult {
  const totalTimeSec = segments.reduce((sum, segment) => sum + segment.timeSec, 0);
  const totalDistanceM = segments.reduce((sum, segment) => sum + segment.distanceM, 0);
  const weightedPower =
    segments.reduce((sum, segment) => sum + segment.powerW * segment.timeSec, 0) /
    Math.max(1, totalTimeSec);
  const fourthPowerAverage =
    segments.reduce((sum, segment) => sum + Math.pow(segment.powerW, 4) * segment.timeSec, 0) /
    Math.max(1, totalTimeSec);
  const normalizedPowerW = Math.pow(fourthPowerAverage, 0.25);
  const averageSpeedMps = totalDistanceM / Math.max(1, totalTimeSec);
  const ascentTimeSec = segments
    .filter((segment) => segment.grade > 0.005)
    .reduce((sum, segment) => sum + segment.timeSec, 0);
  const descentTimeSec = segments
    .filter((segment) => segment.grade < -0.005)
    .reduce((sum, segment) => sum + segment.timeSec, 0);

  return {
    segments,
    summary: {
      totalTimeSec,
      totalDistanceM,
      averageSpeedMps,
      averagePowerW: weightedPower,
      normalizedPowerW,
      ascentTimeSec,
      descentTimeSec
    }
  };
}

function windVectorMps(weather: WeatherProfile) {
  const speedMps = weather.windSpeedKph / 3.6;
  const toDirection = toRadians((weather.windDirectionDeg + 180) % 360);

  return {
    east: Math.sin(toDirection) * speedMps,
    north: Math.cos(toDirection) * speedMps
  };
}

function cornerSpeedLimitMps(routeSegments: RouteSegment[], index: number, profile: RiderBikeProfile): number {
  if (profile.cornerBrakeSensitivity <= 0) {
    return Math.max(2, profile.maxSpeedKph / 3.6);
  }

  const severity = cornerSeverityAt(routeSegments, index);
  if (severity <= 0) {
    return Math.max(2, profile.maxSpeedKph / 3.6);
  }

  const sensitivity = clamp(profile.cornerBrakeSensitivity, 0, 1);
  const maxSpeedKph = Math.max(10, profile.maxSpeedKph);
  const minCornerKph = clamp(profile.minCornerSpeedKph, 8, maxSpeedKph);
  const speedKph = maxSpeedKph - (maxSpeedKph - minCornerKph) * sensitivity * severity;
  return Math.max(2, speedKph / 3.6);
}

function cornerExitLoad(routeSegments: RouteSegment[], index: number, profile: RiderBikeProfile): number {
  const exitDistanceM = clamp(profile.cornerExitDistanceM, 0, 1200);
  if (exitDistanceM <= 0 || profile.cornerExitBoostPct <= 0) {
    return 0;
  }

  let distanceAfterCorner = 0;
  let load = 0;
  for (let cursor = index; cursor >= 0 && distanceAfterCorner <= exitDistanceM; cursor -= 1) {
    const severity = cornerSeverityAt(routeSegments, cursor);
    if (severity > 0) {
      const decay = 1 - distanceAfterCorner / Math.max(1, exitDistanceM);
      load = Math.max(load, severity * decay);
    }
    distanceAfterCorner += routeSegments[cursor]?.distanceM ?? 0;
  }

  return clamp(load, 0, 1);
}

function cornerSeverityAt(routeSegments: RouteSegment[], index: number): number {
  const current = routeSegments[index];
  if (!current) {
    return 0;
  }

  const previous = routeSegments[index - 1];
  const next = routeSegments[index + 1];
  const entryDelta = previous ? headingDeltaDeg(previous.headingDeg, current.headingDeg) : 0;
  const exitDelta = next ? headingDeltaDeg(current.headingDeg, next.headingDeg) : 0;
  const delta = Math.max(entryDelta, exitDelta);
  return clamp((delta - 12) / 78, 0, 1);
}

function headingDeltaDeg(a: number, b: number): number {
  const delta = Math.abs(((b - a + 540) % 360) - 180);
  return Number.isFinite(delta) ? delta : 0;
}

function interpolateCda(yawDeg: number, cdaByYaw: Record<string, number> | undefined, zeroYawCda: number) {
  const entries = Object.entries({ ...(cdaByYaw ?? {}), "0": zeroYawCda })
    .map(([yaw, cda]) => ({ yaw: Number(yaw), cda }))
    .filter((entry) => Number.isFinite(entry.yaw) && Number.isFinite(entry.cda))
    .sort((a, b) => a.yaw - b.yaw);

  if (entries.length === 0) {
    return zeroYawCda;
  }

  const yaw = Math.abs(yawDeg);
  if (yaw <= entries[0].yaw) {
    return entries[0].cda;
  }

  for (let index = 1; index < entries.length; index += 1) {
    const left = entries[index - 1];
    const right = entries[index];
    if (yaw <= right.yaw) {
      const ratio = (yaw - left.yaw) / Math.max(0.001, right.yaw - left.yaw);
      return left.cda + (right.cda - left.cda) * ratio;
    }
  }

  return entries.at(-1)?.cda ?? zeroYawCda;
}

function adjustCdaMap(cdaByYaw: Record<string, number>, delta: number, floor: number) {
  return Object.fromEntries(
    Object.entries(cdaByYaw).map(([yaw, cda]) => [yaw, Math.max(floor, cda + delta)])
  );
}
