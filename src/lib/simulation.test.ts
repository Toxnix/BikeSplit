import { describe, expect, it } from "vitest";
import { createDemoRoute } from "./demoRoute";
import { defaultProfile, defaultWeather, simulateCourse } from "./simulation";

describe("route preparation and physics simulation", () => {
  it("creates a 180 km demo course with one-kilometer segments", () => {
    const route = createDemoRoute();

    expect(route.totalDistanceM).toBeGreaterThan(179_000);
    expect(route.totalDistanceM).toBeLessThan(181_000);
    expect(route.segments.length).toBeGreaterThanOrEqual(179);
    expect(route.segments[0].distanceM).toBeCloseTo(1000, 0);
  });

  it("gets faster when target power increases", () => {
    const route = createDemoRoute();
    const baseline = simulateCourse(route.segments, defaultProfile, defaultWeather, "power");
    const stronger = simulateCourse(
      route.segments,
      { ...defaultProfile, targetPowerW: defaultProfile.targetPowerW + 25 },
      defaultWeather,
      "power"
    );

    expect(stronger.summary.totalTimeSec).toBeLessThan(baseline.summary.totalTimeSec);
  });

  it("gets faster with lower aerodynamic drag", () => {
    const route = createDemoRoute();
    const baseline = simulateCourse(route.segments, defaultProfile, defaultWeather, "power");
    const aero = simulateCourse(
      route.segments,
      {
        ...defaultProfile,
        cdaRace: defaultProfile.cdaRace - 0.02,
        cdaClimb: defaultProfile.cdaClimb - 0.02
      },
      defaultWeather,
      "power"
    );

    expect(aero.summary.totalTimeSec).toBeLessThan(baseline.summary.totalTimeSec);
  });

  it("gets slower with higher rolling resistance", () => {
    const route = createDemoRoute();
    const baseline = simulateCourse(route.segments, defaultProfile, defaultWeather, "power");
    const rougher = simulateCourse(
      route.segments,
      { ...defaultProfile, crr: defaultProfile.crr + 0.002 },
      defaultWeather,
      "power"
    );

    expect(rougher.summary.totalTimeSec).toBeGreaterThan(baseline.summary.totalTimeSec);
  });

  it("calculates normalized power for variable terrain pacing", () => {
    const route = createDemoRoute();
    const result = simulateCourse(route.segments, defaultProfile, defaultWeather, "pacing");

    expect(result.summary.normalizedPowerW).toBeGreaterThan(0);
    expect(result.summary.normalizedPowerW).toBeGreaterThanOrEqual(result.summary.averagePowerW);
  });
});
