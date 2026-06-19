from __future__ import annotations

import argparse
import math
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from pathlib import Path


EARTH_RADIUS_M = 6_371_000.0
GRAVITY = 9.80665

BBS_REFERENCE = {
    "distance_km": 179.65,
    "time_sec": 15_967.162,
    "avg_power_w": 271.56,
    "avg_cda": 0.2593,
    "crr": 0.00351,
    "mechanical_loss": 0.015,
    "rider_weight_kg": 88.0,
    "bike_weight_kg": 10.0,
}

# Extracted from the public BBS plan page on 2026-06-19.
BBS_WEATHER = [
    {"distance": 0.0, "humidity": 90.91, "wind_speed": 1.19, "wind_bearing": 117.4, "temp": 17.4, "pressure": 1014.00},
    {"distance": 16_393.0, "humidity": 92.07, "wind_speed": 1.11, "wind_bearing": 118.9, "temp": 17.3, "pressure": 1014.00},
    {"distance": 32_681.0, "humidity": 92.66, "wind_speed": 1.00, "wind_bearing": 124.7, "temp": 17.3, "pressure": 1014.00},
    {"distance": 49_018.0, "humidity": 83.64, "wind_speed": 1.00, "wind_bearing": 198.1, "temp": 19.0, "pressure": 1013.70},
    {"distance": 65_387.0, "humidity": 83.82, "wind_speed": 1.33, "wind_bearing": 157.2, "temp": 19.0, "pressure": 1013.70},
    {"distance": 81_725.0, "humidity": 76.54, "wind_speed": 1.53, "wind_bearing": 190.2, "temp": 20.6, "pressure": 1013.30},
    {"distance": 98_037.0, "humidity": 73.36, "wind_speed": 1.47, "wind_bearing": 178.4, "temp": 20.6, "pressure": 1013.30},
    {"distance": 114_339.0, "humidity": 69.70, "wind_speed": 1.81, "wind_bearing": 223.0, "temp": 22.3, "pressure": 1013.00},
    {"distance": 130_662.0, "humidity": 70.15, "wind_speed": 2.11, "wind_bearing": 234.7, "temp": 22.3, "pressure": 1013.00},
    {"distance": 147_019.0, "humidity": 62.69, "wind_speed": 2.69, "wind_bearing": 236.7, "temp": 23.1, "pressure": 1012.30},
    {"distance": 163_334.0, "humidity": 62.95, "wind_speed": 2.83, "wind_bearing": 229.6, "temp": 23.0, "pressure": 1012.30},
    {"distance": 179_652.0, "humidity": 54.26, "wind_speed": 2.97, "wind_bearing": 222.6, "temp": 23.5, "pressure": 1011.70},
]


@dataclass
class Point:
    lat: float
    lon: float
    ele: float
    distance: float = 0.0


@dataclass
class Segment:
    start: float
    end: float
    distance: float
    grade: float
    heading: float


def haversine(a: Point, b: Point) -> float:
    lat1, lon1 = math.radians(a.lat), math.radians(a.lon)
    lat2, lon2 = math.radians(b.lat), math.radians(b.lon)
    dlat = lat2 - lat1
    dlon = lon2 - lon1
    s = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2) ** 2
    return 2 * EARTH_RADIUS_M * math.atan2(math.sqrt(s), math.sqrt(1 - s))


def bearing(a: Point, b: Point) -> float:
    lat1, lon1 = math.radians(a.lat), math.radians(a.lon)
    lat2, lon2 = math.radians(b.lat), math.radians(b.lon)
    y = math.sin(lon2 - lon1) * math.cos(lat2)
    x = math.cos(lat1) * math.sin(lat2) - math.sin(lat1) * math.cos(lat2) * math.cos(lon2 - lon1)
    return (math.degrees(math.atan2(y, x)) + 360) % 360


def parse_gpx(path: Path) -> list[Point]:
    root = ET.parse(path).getroot()
    ns = {"g": "http://www.topografix.com/GPX/1/1"}
    points: list[Point] = []
    for node in root.findall(".//g:trkpt", ns):
        ele_node = node.find("g:ele", ns)
        points.append(
            Point(
                lat=float(node.attrib["lat"]),
                lon=float(node.attrib["lon"]),
                ele=float(ele_node.text) if ele_node is not None and ele_node.text else 0.0,
            )
        )

    distance = 0.0
    for index, point in enumerate(points):
        if index:
            distance += haversine(points[index - 1], point)
        point.distance = distance
    return points


def smooth_elevation(points: list[Point], window: int = 9) -> list[Point]:
    radius = max(0, window // 2)
    output = [Point(p.lat, p.lon, p.ele, p.distance) for p in points]
    for index in range(len(points)):
        weighted = 0.0
        total_weight = 0.0
        for offset in range(-radius, radius + 1):
            candidate = index + offset
            if 0 <= candidate < len(points):
                weight = radius + 1 - abs(offset)
                weighted += points[candidate].ele * weight
                total_weight += weight
        output[index].ele = weighted / total_weight
    return output


def interpolate(points: list[Point], distance: float) -> Point:
    if distance <= 0:
        return points[0]
    if distance >= points[-1].distance:
        return points[-1]

    low = 0
    high = len(points) - 1
    while low < high:
        mid = (low + high) // 2
        if points[mid].distance < distance:
            low = mid + 1
        else:
            high = mid

    right = points[low]
    left = points[max(0, low - 1)]
    ratio = (distance - left.distance) / max(1e-9, right.distance - left.distance)
    return Point(
        lat=left.lat + (right.lat - left.lat) * ratio,
        lon=left.lon + (right.lon - left.lon) * ratio,
        ele=left.ele + (right.ele - left.ele) * ratio,
        distance=distance,
    )


def build_segments(points: list[Point], segment_m: float = 1000.0) -> list[Segment]:
    segments: list[Segment] = []
    start = 0.0
    total = points[-1].distance
    while start < total - 50:
        end = min(start + segment_m, total)
        a = interpolate(points, start)
        b = interpolate(points, end)
        distance = max(1.0, end - start)
        grade = max(-0.15, min(0.15, (b.ele - a.ele) / distance))
        segments.append(Segment(start=start, end=end, distance=distance, grade=grade, heading=bearing(a, b)))
        start = end
    return segments


def weather_at(distance: float, average_weather: bool) -> dict[str, float]:
    if average_weather:
        return {
            "distance": distance,
            "humidity": sum(p["humidity"] for p in BBS_WEATHER) / len(BBS_WEATHER),
            "wind_speed": sum(p["wind_speed"] for p in BBS_WEATHER) / len(BBS_WEATHER),
            "wind_bearing": sum(p["wind_bearing"] for p in BBS_WEATHER) / len(BBS_WEATHER),
            "temp": sum(p["temp"] for p in BBS_WEATHER) / len(BBS_WEATHER),
            "pressure": sum(p["pressure"] for p in BBS_WEATHER) / len(BBS_WEATHER),
        }

    if distance <= BBS_WEATHER[0]["distance"]:
        return BBS_WEATHER[0]
    if distance >= BBS_WEATHER[-1]["distance"]:
        return BBS_WEATHER[-1]

    for index in range(1, len(BBS_WEATHER)):
        right = BBS_WEATHER[index]
        if right["distance"] >= distance:
            left = BBS_WEATHER[index - 1]
            ratio = (distance - left["distance"]) / (right["distance"] - left["distance"])
            return {
                key: left[key] + (right[key] - left[key]) * ratio
                for key in ["distance", "humidity", "wind_speed", "wind_bearing", "temp", "pressure"]
            }
    return BBS_WEATHER[-1]


def air_density(temp_c: float, pressure_hpa: float, humidity_pct: float) -> float:
    temp_k = temp_c + 273.15
    saturation_hpa = 6.1078 * math.exp((17.27 * temp_c) / (temp_c + 237.3))
    vapor_hpa = saturation_hpa * max(0.0, min(100.0, humidity_pct)) / 100
    dry_pa = (pressure_hpa - vapor_hpa) * 100
    vapor_pa = vapor_hpa * 100
    return dry_pa / (287.05 * temp_k) + vapor_pa / (461.495 * temp_k)


def solve_speed(
    segment: Segment,
    rider_weight_kg: float,
    bike_weight_kg: float,
    power_w: float,
    cda: float,
    crr: float,
    loss: float,
    wind_bearing_as_from: bool,
    average_weather: bool,
) -> tuple[float, float, float, float]:
    weather = weather_at((segment.start + segment.end) / 2, average_weather)
    density = air_density(weather["temp"], weather["pressure"], weather["humidity"])
    wind_direction = weather["wind_bearing"] + (180 if wind_bearing_as_from else 0)
    wind_rad = math.radians(wind_direction % 360)
    wind_speed = weather["wind_speed"]
    wind = (math.sin(wind_rad) * wind_speed, math.cos(wind_rad) * wind_speed)

    heading_rad = math.radians(segment.heading)
    forward = (math.sin(heading_rad), math.cos(heading_rad))
    right = (math.sin(heading_rad + math.pi / 2), math.cos(heading_rad + math.pi / 2))
    theta = math.atan(segment.grade)
    mass = rider_weight_kg + bike_weight_kg
    wheel_power = power_w * (1 - loss)

    def required_power(speed: float) -> tuple[float, float, float]:
        ground = (forward[0] * speed, forward[1] * speed)
        relative = (ground[0] - wind[0], ground[1] - wind[1])
        relative_speed = math.hypot(relative[0], relative[1])
        aero = 0.5 * density * cda * relative_speed * relative_speed
        rolling = crr * mass * GRAVITY * math.cos(theta)
        gravity = mass * GRAVITY * math.sin(theta)
        along = relative[0] * forward[0] + relative[1] * forward[1]
        cross = relative[0] * right[0] + relative[1] * right[1]
        yaw = abs(math.degrees(math.atan2(cross, max(0.1, along))))
        headwind = -(wind[0] * forward[0] + wind[1] * forward[1])
        return speed * (aero + rolling + gravity), yaw, headwind

    low = 0.25
    high = 78 / 3.6
    if required_power(low)[0] >= wheel_power:
        speed = low
    elif required_power(high)[0] < wheel_power:
        speed = high
    else:
        for _ in range(60):
            mid = (low + high) / 2
            if required_power(mid)[0] > wheel_power:
                high = mid
            else:
                low = mid
        speed = (low + high) / 2

    _, yaw, headwind = required_power(speed)
    return speed, yaw, headwind, density


def run_model(
    segments: list[Segment],
    rider_weight_kg: float,
    bike_weight_kg: float,
    wind_bearing_as_from: bool,
    average_weather: bool,
) -> dict[str, float]:
    total_time = 0.0
    total_distance = 0.0
    yaw_time = 0.0
    density_time = 0.0
    headwind_time = 0.0
    for segment in segments:
        speed, yaw, headwind, density = solve_speed(
            segment=segment,
            rider_weight_kg=rider_weight_kg,
            bike_weight_kg=bike_weight_kg,
            power_w=BBS_REFERENCE["avg_power_w"],
            cda=BBS_REFERENCE["avg_cda"],
            crr=BBS_REFERENCE["crr"],
            loss=BBS_REFERENCE["mechanical_loss"],
            wind_bearing_as_from=wind_bearing_as_from,
            average_weather=average_weather,
        )
        time = segment.distance / speed
        total_time += time
        total_distance += segment.distance
        yaw_time += yaw * time
        density_time += density * time
        headwind_time += headwind * time

    return {
        "time_sec": total_time,
        "delta_sec": total_time - BBS_REFERENCE["time_sec"],
        "delta_pct": (total_time / BBS_REFERENCE["time_sec"] - 1) * 100,
        "speed_kph": total_distance / total_time * 3.6,
        "avg_yaw_deg": yaw_time / total_time,
        "avg_air_density": density_time / total_time,
        "avg_headwind_kph": headwind_time / total_time * 3.6,
    }


def format_hms(seconds: float) -> str:
    rounded = round(seconds)
    hours = rounded // 3600
    minutes = (rounded % 3600) // 60
    secs = rounded % 60
    return f"{hours:02d}:{minutes:02d}:{secs:02d}"


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--gpx", type=Path, default=Path("validate/GPX-Route_135568_251066.gpx"))
    parser.add_argument("--rider-weight", type=float, default=90.0)
    parser.add_argument("--bike-weight", type=float, default=9.0)
    args = parser.parse_args()

    points = smooth_elevation(parse_gpx(args.gpx))
    segments = build_segments(points)
    ascent = sum(max(0.0, points[i].ele - points[i - 1].ele) for i in range(1, len(points)))
    descent = sum(max(0.0, points[i - 1].ele - points[i].ele) for i in range(1, len(points)))

    print(f"Route: {args.gpx}")
    print(
        f"Points={len(points)} Distance={points[-1].distance / 1000:.3f} km "
        f"Segments={len(segments)} Ascent={ascent:.0f} m Descent={descent:.0f} m"
    )
    print(
        "BBS: "
        f"{format_hms(BBS_REFERENCE['time_sec'])}, "
        f"{BBS_REFERENCE['distance_km']:.2f} km, "
        f"{BBS_REFERENCE['avg_power_w']:.2f} W, "
        f"CdA {BBS_REFERENCE['avg_cda']:.4f}, "
        f"Crr {BBS_REFERENCE['crr']:.5f}"
    )
    print()

    scenarios = [
        ("BBS mass, bearing as from", BBS_REFERENCE["rider_weight_kg"], BBS_REFERENCE["bike_weight_kg"], True, False),
        ("BBS mass, bearing as to", BBS_REFERENCE["rider_weight_kg"], BBS_REFERENCE["bike_weight_kg"], False, False),
        ("User mass, bearing as from", args.rider_weight, args.bike_weight, True, False),
        ("User mass, bearing as to", args.rider_weight, args.bike_weight, False, False),
        ("User mass, avg weather", args.rider_weight, args.bike_weight, True, True),
    ]

    for label, rider_weight, bike_weight, wind_as_from, average_weather in scenarios:
        result = run_model(segments, rider_weight, bike_weight, wind_as_from, average_weather)
        print(
            f"{label:27s} "
            f"{format_hms(result['time_sec'])} "
            f"delta={result['delta_sec']:+6.1f}s "
            f"({result['delta_pct']:+.2f}%) "
            f"speed={result['speed_kph']:.2f} km/h "
            f"yaw={result['avg_yaw_deg']:.2f} deg"
        )


if __name__ == "__main__":
    main()
