import { destinationPoint, prepareRoute, RawRoutePoint } from "./geo";

export function createDemoRoute(): ReturnType<typeof prepareRoute> {
  const points: RawRoutePoint[] = [];
  let current: RawRoutePoint = { lat: 50.028, lon: 8.287, ele: 98 };
  const stepM = 500;
  const totalDistanceM = 180_000;
  const steps = Math.floor(totalDistanceM / stepM);

  points.push(current);

  for (let index = 1; index <= steps; index += 1) {
    const distance = index * stepM;
    const bearing =
      62 +
      26 * Math.sin(distance / 17_500) +
      11 * Math.sin(distance / 6_400) -
      18 * Math.cos(distance / 31_000);
    const broadClimb = 58 * Math.sin((2 * Math.PI * distance) / 46_000);
    const rollers = 18 * Math.sin((2 * Math.PI * distance) / 11_500);
    const lateClimb =
      distance > 108_000 && distance < 136_000 ? 42 * Math.sin(((distance - 108_000) / 28_000) * Math.PI) : 0;
    const ele = 115 + broadClimb + rollers + lateClimb;
    current = destinationPoint(current, stepM, bearing, ele);
    points.push(current);
  }

  return prepareRoute("Demo Iron Course 180", points, 1000, 9);
}
