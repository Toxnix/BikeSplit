import { simulateCourse, type RiderBikeProfile, type SimulationMode, type WeatherProfile } from "../../src/lib/simulation";
import type { RouteSegment } from "../../src/lib/geo";

interface SimulationRequest {
  segments: RouteSegment[];
  profile: RiderBikeProfile;
  weather: WeatherProfile;
  mode: SimulationMode;
  goalTimeSec?: number;
}

export async function onRequestPost({ request }: { request: Request }): Promise<Response> {
  try {
    const body = (await request.json()) as SimulationRequest;
    if (!Array.isArray(body.segments) || !body.profile || !body.weather || !body.mode) {
      return Response.json({ error: "Ungueltige Simulationsanfrage." }, { status: 400 });
    }

    const result = simulateCourse(body.segments, body.profile, body.weather, body.mode, body.goalTimeSec);
    return Response.json(result);
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Serverberechnung fehlgeschlagen." },
      { status: 500 }
    );
  }
}
