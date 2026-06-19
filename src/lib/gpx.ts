import { prepareRoute, PreparedRoute, RawRoutePoint } from "./geo";

export function parseGpx(text: string, fileName = "GPX Route"): PreparedRoute {
  const parser = new DOMParser();
  const document = parser.parseFromString(text, "application/xml");
  const parserError = document.querySelector("parsererror");
  if (parserError) {
    throw new Error("Die GPX-Datei konnte nicht gelesen werden.");
  }

  const name =
    document.querySelector("metadata > name")?.textContent?.trim() ||
    document.querySelector("trk > name")?.textContent?.trim() ||
    fileName.replace(/\.gpx$/i, "");

  const trackPoints = [...document.querySelectorAll("trkpt")];
  const routePoints = trackPoints.length > 0 ? trackPoints : [...document.querySelectorAll("rtept")];

  const points: RawRoutePoint[] = routePoints
    .map((node) => {
      const lat = Number(node.getAttribute("lat"));
      const lon = Number(node.getAttribute("lon"));
      const ele = Number(node.querySelector("ele")?.textContent ?? 0);
      const time = node.querySelector("time")?.textContent ?? undefined;

      return { lat, lon, ele, time };
    })
    .filter((point) => Number.isFinite(point.lat) && Number.isFinite(point.lon));

  return prepareRoute(name, points, 50, 9);
}
