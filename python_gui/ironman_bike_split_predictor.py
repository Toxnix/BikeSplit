# -*- coding: utf-8 -*-
from __future__ import annotations

import argparse
import json
import math
import sys
import tkinter as tk
from dataclasses import dataclass, replace
from pathlib import Path
from tkinter import filedialog, messagebox, ttk
from xml.etree import ElementTree as ET


GRAVITY = 9.80665
DRY_AIR_R = 287.05
WATER_VAPOR_R = 461.495
EARTH_RADIUS_M = 6_371_000
EQUIPMENT_CDA_M2 = 0.06


@dataclass
class RawRoutePoint:
    lat: float
    lon: float
    ele: float
    time: str | None = None


@dataclass
class RoutePoint(RawRoutePoint):
    distance_m: float = 0.0


@dataclass
class RouteSegment:
    index: int
    start_distance_m: float
    end_distance_m: float
    distance_m: float
    start_ele_m: float
    end_ele_m: float
    grade: float
    heading_deg: float


@dataclass
class PreparedRoute:
    name: str
    points: list[RoutePoint]
    segments: list[RouteSegment]
    total_distance_m: float
    total_ascent_m: float
    total_descent_m: float


@dataclass
class RiderBikeProfile:
    rider_weight_kg: float = 90.0
    bike_weight_kg: float = 9.0
    ftp_w: float = 400.0
    target_power_w: float = 288.0
    cda_race: float = 0.2628
    cda_climb: float = 0.4133
    cda_race_yaw: dict[str, float] | None = None
    cda_climb_yaw: dict[str, float] | None = None
    crr: float = 0.00309
    drivetrain_loss_pct: float = 2.2
    position_switch_kph: float = 24.0
    max_speed_kph: float = 78.0
    min_power_w: float = 90.0
    max_power_w: float = 600.0
    pacing_aggression: float = 0.65
    max_power_surge_pct: float = 18.0
    corner_exit_boost_pct: float = 10.0
    corner_exit_distance_m: float = 300.0
    corner_brake_sensitivity: float = 0.65
    min_corner_speed_kph: float = 22.0

    def __post_init__(self) -> None:
        if self.cda_race_yaw is None:
            self.cda_race_yaw = {"0": 0.2628, "5": 0.2607, "10": 0.2489, "15": 0.2452, "20": 0.236}
        if self.cda_climb_yaw is None:
            self.cda_climb_yaw = {"0": 0.4133, "5": 0.4109, "10": 0.3989, "15": 0.3922, "20": 0.3796}


@dataclass
class WeatherProfile:
    temp_c: float = 20.0
    pressure_hpa: float = 1013.25
    humidity_pct: float = 60.0
    wind_speed_kph: float = 8.0
    wind_direction_deg: float = 240.0


@dataclass
class SimulationSegment(RouteSegment):
    power_w: float = 0.0
    time_sec: float = 0.0
    speed_mps: float = 0.0
    cda: float = 0.0
    yaw_deg: float = 0.0
    air_density_kg_m3: float = 0.0
    headwind_mps: float = 0.0
    position: str = "race"


@dataclass
class SimulationSummary:
    total_time_sec: float
    total_distance_m: float
    average_speed_mps: float
    average_power_w: float
    normalized_power_w: float
    ascent_time_sec: float
    descent_time_sec: float


@dataclass
class SimulationResult:
    segments: list[SimulationSegment]
    summary: SimulationSummary
    solved_power_w: float | None = None


def clamp(value: float, minimum: float, maximum: float) -> float:
    if not math.isfinite(value):
        return minimum
    return min(maximum, max(minimum, value))


def to_radians(value: float) -> float:
    return value * math.pi / 180


def to_degrees(value: float) -> float:
    return value * 180 / math.pi


def haversine_distance_m(a: RawRoutePoint, b: RawRoutePoint) -> float:
    phi1 = to_radians(a.lat)
    phi2 = to_radians(b.lat)
    d_phi = to_radians(b.lat - a.lat)
    d_lambda = to_radians(b.lon - a.lon)
    s = (
        math.sin(d_phi / 2) ** 2
        + math.cos(phi1) * math.cos(phi2) * math.sin(d_lambda / 2) ** 2
    )
    return 2 * EARTH_RADIUS_M * math.atan2(math.sqrt(s), math.sqrt(1 - s))


def bearing_deg(a: RawRoutePoint, b: RawRoutePoint) -> float:
    phi1 = to_radians(a.lat)
    phi2 = to_radians(b.lat)
    lambda1 = to_radians(a.lon)
    lambda2 = to_radians(b.lon)
    y = math.sin(lambda2 - lambda1) * math.cos(phi2)
    x = math.cos(phi1) * math.sin(phi2) - math.sin(phi1) * math.cos(phi2) * math.cos(lambda2 - lambda1)
    return (to_degrees(math.atan2(y, x)) + 360) % 360


def compute_cumulative_distance(raw_points: list[RawRoutePoint]) -> list[RoutePoint]:
    distance = 0.0
    points: list[RoutePoint] = []
    for index, point in enumerate(raw_points):
        if index > 0:
            distance += haversine_distance_m(raw_points[index - 1], point)
        points.append(RoutePoint(point.lat, point.lon, point.ele if math.isfinite(point.ele) else 0.0, point.time, distance))
    return points


def smooth_elevation(points: list[RoutePoint], window_size: int) -> list[RoutePoint]:
    safe_window = max(1, int(window_size))
    if safe_window <= 1:
        return points
    radius = safe_window // 2
    smoothed: list[RoutePoint] = []
    for index, point in enumerate(points):
        total = 0.0
        weight = 0.0
        for offset in range(-radius, radius + 1):
            candidate_index = index + offset
            if 0 <= candidate_index < len(points):
                local_weight = radius + 1 - abs(offset)
                total += points[candidate_index].ele * local_weight
                weight += local_weight
        smoothed.append(replace(point, ele=total / max(1.0, weight)))
    return smoothed


def interpolate_at_distance(points: list[RoutePoint], distance_m: float) -> RoutePoint:
    if distance_m <= 0:
        return points[0]
    last = points[-1]
    if distance_m >= last.distance_m:
        return last

    low = 0
    high = len(points) - 1
    while low < high:
        mid = (low + high) // 2
        if points[mid].distance_m < distance_m:
            low = mid + 1
        else:
            high = mid

    right = points[low]
    left = points[max(0, low - 1)]
    span = max(1.0, right.distance_m - left.distance_m)
    ratio = clamp((distance_m - left.distance_m) / span, 0, 1)
    return RoutePoint(
        lat=left.lat + (right.lat - left.lat) * ratio,
        lon=left.lon + (right.lon - left.lon) * ratio,
        ele=left.ele + (right.ele - left.ele) * ratio,
        time=left.time,
        distance_m=distance_m,
    )


def build_segments(points: list[RoutePoint], segment_meters: float) -> list[RouteSegment]:
    total_distance = points[-1].distance_m if points else 0.0
    segments: list[RouteSegment] = []
    start_distance = 0.0
    index = 1
    while start_distance < total_distance - 50:
        end_distance = min(start_distance + segment_meters, total_distance)
        start = interpolate_at_distance(points, start_distance)
        end = interpolate_at_distance(points, end_distance)
        distance = max(1.0, end_distance - start_distance)
        grade = clamp((end.ele - start.ele) / distance, -0.15, 0.15)
        segments.append(
            RouteSegment(
                index=index,
                start_distance_m=start_distance,
                end_distance_m=end_distance,
                distance_m=distance,
                start_ele_m=start.ele,
                end_ele_m=end.ele,
                grade=grade,
                heading_deg=bearing_deg(start, end),
            )
        )
        start_distance = end_distance
        index += 1
    return segments


def prepare_route(name: str, raw_points: list[RawRoutePoint], segment_meters: float = 50, smoothing_window: int = 9) -> PreparedRoute:
    if len(raw_points) < 2:
        raise ValueError("Eine Route braucht mindestens zwei Punkte.")
    points = smooth_elevation(compute_cumulative_distance(raw_points), smoothing_window)
    total_ascent = 0.0
    total_descent = 0.0
    for previous, current in zip(points, points[1:]):
        delta = current.ele - previous.ele
        if delta > 0:
            total_ascent += delta
        else:
            total_descent += abs(delta)
    return PreparedRoute(
        name=name,
        points=points,
        segments=build_segments(points, max(100, segment_meters)),
        total_distance_m=points[-1].distance_m,
        total_ascent_m=total_ascent,
        total_descent_m=total_descent,
    )


def local_name(tag: str) -> str:
    return tag.split("}", 1)[-1] if "}" in tag else tag


def child_text(node: ET.Element, wanted_name: str) -> str | None:
    for child in node:
        if local_name(child.tag) == wanted_name and child.text:
            return child.text.strip()
    return None


def parse_gpx(path: Path, display_name: str | None = None) -> PreparedRoute:
    root = ET.parse(path).getroot()
    track_points = [node for node in root.iter() if local_name(node.tag) == "trkpt"]
    route_points = track_points or [node for node in root.iter() if local_name(node.tag) == "rtept"]

    name = display_name or path.stem
    if display_name is None:
        for node in root.iter():
            if local_name(node.tag) == "trk":
                track_name = child_text(node, "name")
                if track_name:
                    name = track_name
                    break

    points: list[RawRoutePoint] = []
    for node in route_points:
        try:
            lat = float(node.attrib.get("lat", "nan"))
            lon = float(node.attrib.get("lon", "nan"))
            ele = float(child_text(node, "ele") or 0)
        except ValueError:
            continue
        if math.isfinite(lat) and math.isfinite(lon):
            points.append(RawRoutePoint(lat=lat, lon=lon, ele=ele, time=child_text(node, "time")))

    return prepare_route(name, points, 50, 9)


def air_density_kg_m3(weather: WeatherProfile) -> float:
    temp_k = weather.temp_c + 273.15
    saturation_hpa = 6.1078 * math.exp((17.27 * weather.temp_c) / (weather.temp_c + 237.3))
    vapor_pressure_hpa = saturation_hpa * clamp(weather.humidity_pct, 0, 100) / 100
    dry_pressure_pa = max(0.0, weather.pressure_hpa - vapor_pressure_hpa) * 100
    vapor_pressure_pa = vapor_pressure_hpa * 100
    return dry_pressure_pa / (DRY_AIR_R * temp_k) + vapor_pressure_pa / (WATER_VAPOR_R * temp_k)


def simulate_course(
    route_segments: list[RouteSegment],
    profile: RiderBikeProfile,
    weather: WeatherProfile,
    mode: str,
    goal_time_sec: float | None = None,
) -> SimulationResult:
    if mode == "goal" and goal_time_sec and goal_time_sec > 0:
        return solve_for_goal_time(route_segments, profile, weather, goal_time_sec)
    power_plan = create_pacing_plan(route_segments, profile) if mode == "pacing" else [profile.target_power_w] * len(route_segments)
    return run_simulation(route_segments, profile, weather, power_plan)


def run_simulation(
    route_segments: list[RouteSegment],
    profile: RiderBikeProfile,
    weather: WeatherProfile,
    power_plan: list[float],
) -> SimulationResult:
    rho = air_density_kg_m3(weather)
    segments = [
        solve_segment(segment, clamp(power_plan[index] if index < len(power_plan) else profile.target_power_w, 0, profile.max_power_w), profile, weather, rho, route_segments, index)
        for index, segment in enumerate(route_segments)
    ]
    return summarize(segments)


def solve_for_goal_time(route_segments: list[RouteSegment], profile: RiderBikeProfile, weather: WeatherProfile, goal_time_sec: float) -> SimulationResult:
    low = 80.0
    high = max(profile.max_power_w, profile.ftp_w * 1.35, profile.target_power_w + 120)
    solved_power = profile.target_power_w
    for _ in range(42):
        mid = (low + high) / 2
        candidate_profile = replace(profile, target_power_w=mid, max_power_w=max(profile.max_power_w, mid))
        candidate = run_simulation(route_segments, candidate_profile, weather, [mid] * len(route_segments))
        solved_power = mid
        if candidate.summary.total_time_sec > goal_time_sec:
            low = mid
        else:
            high = mid
    final_profile = replace(profile, target_power_w=solved_power, max_power_w=max(profile.max_power_w, solved_power))
    result = run_simulation(route_segments, final_profile, weather, [solved_power] * len(route_segments))
    result.solved_power_w = solved_power
    return result


def create_pacing_plan(route_segments: list[RouteSegment], profile: RiderBikeProfile) -> list[float]:
    max_surge = clamp(profile.max_power_surge_pct, 0, 50) / 100
    max_allowed_power = min(profile.max_power_w, profile.target_power_w * (1 + max_surge))
    raw: list[tuple[float, float]] = []
    for index, segment in enumerate(route_segments):
        climb_boost = clamp(segment.grade / 0.06, 0, 1)
        corner_boost = corner_exit_load(route_segments, index, profile)
        descent_relief = clamp(-segment.grade / 0.06, 0, 1) * 0.18
        surge = clamp(
            profile.pacing_aggression * (climb_boost * max_surge + corner_boost * (profile.corner_exit_boost_pct / 100)),
            0,
            max_surge,
        )
        weight = segment.distance_m / 1000
        raw.append((profile.target_power_w * (1 + surge - profile.pacing_aggression * descent_relief), weight))
    total_weight = max(1.0, sum(weight for _, weight in raw))
    weighted_average = sum(watts * weight for watts, weight in raw) / total_weight
    offset = weighted_average - profile.target_power_w
    return [clamp(watts - offset, profile.min_power_w, max_allowed_power) for watts, _ in raw]


def solve_segment(
    segment: RouteSegment,
    power_w: float,
    profile: RiderBikeProfile,
    weather: WeatherProfile,
    air_density: float,
    route_segments: list[RouteSegment],
    segment_index: int,
) -> SimulationSegment:
    mass_kg = profile.rider_weight_kg + profile.bike_weight_kg
    wheel_power_w = power_w * (1 - clamp(profile.drivetrain_loss_pct, 0, 15) / 100)
    max_speed_mps = max(2.0, min(profile.max_speed_kph / 3.6, corner_speed_limit_mps(route_segments, segment_index, profile)))
    min_speed_mps = 0.25
    low_need = required_wheel_power(min_speed_mps, segment, profile, weather, air_density, mass_kg)["required_power_w"]
    high_need = required_wheel_power(max_speed_mps, segment, profile, weather, air_density, mass_kg)["required_power_w"]
    speed_mps = max_speed_mps
    if low_need >= wheel_power_w:
        speed_mps = min_speed_mps
    elif high_need >= wheel_power_w:
        low = min_speed_mps
        high = max_speed_mps
        for _ in range(54):
            mid = (low + high) / 2
            need = required_wheel_power(mid, segment, profile, weather, air_density, mass_kg)["required_power_w"]
            if need > wheel_power_w:
                high = mid
            else:
                low = mid
        speed_mps = (low + high) / 2

    details = required_wheel_power(speed_mps, segment, profile, weather, air_density, mass_kg)
    return SimulationSegment(
        **segment.__dict__,
        power_w=power_w,
        time_sec=segment.distance_m / max(0.1, speed_mps),
        speed_mps=speed_mps,
        cda=details["cda"],
        yaw_deg=details["yaw_deg"],
        air_density_kg_m3=air_density,
        headwind_mps=details["headwind_mps"],
        position=details["position"],
    )


def required_wheel_power(
    speed_mps: float,
    segment: RouteSegment,
    profile: RiderBikeProfile,
    weather: WeatherProfile,
    air_density: float,
    mass_kg: float,
) -> dict[str, float | str]:
    theta = math.atan(segment.grade)
    wind = wind_vector_mps(weather)
    heading = to_radians(segment.heading_deg)
    forward = {"east": math.sin(heading), "north": math.cos(heading)}
    right = {"east": math.sin(heading + math.pi / 2), "north": math.cos(heading + math.pi / 2)}
    ground = {"east": forward["east"] * speed_mps, "north": forward["north"] * speed_mps}
    relative = {"east": ground["east"] - wind["east"], "north": ground["north"] - wind["north"]}
    rel_speed = math.hypot(relative["east"], relative["north"])
    along = relative["east"] * forward["east"] + relative["north"] * forward["north"]
    cross = relative["east"] * right["east"] + relative["north"] * right["north"]
    yaw_deg = abs(math.atan2(cross, max(0.1, along)) * 180 / math.pi)
    position = "climb" if segment.grade > 0.012 and speed_mps * 3.6 < profile.position_switch_kph else "race"
    cda = (
        interpolate_cda(yaw_deg, profile.cda_climb_yaw or {}, profile.cda_climb)
        if position == "climb"
        else interpolate_cda(yaw_deg, profile.cda_race_yaw or {}, profile.cda_race)
    )
    aero_force = 0.5 * air_density * cda * rel_speed * rel_speed
    rolling_force = profile.crr * mass_kg * GRAVITY * math.cos(theta)
    gravity_force = mass_kg * GRAVITY * math.sin(theta)
    wind_along = wind["east"] * forward["east"] + wind["north"] * forward["north"]
    return {
        "required_power_w": speed_mps * (aero_force + rolling_force + gravity_force),
        "cda": cda,
        "yaw_deg": yaw_deg,
        "headwind_mps": -wind_along,
        "position": position,
    }


def summarize(segments: list[SimulationSegment]) -> SimulationResult:
    total_time = sum(segment.time_sec for segment in segments)
    total_distance = sum(segment.distance_m for segment in segments)
    average_power = sum(segment.power_w * segment.time_sec for segment in segments) / max(1.0, total_time)
    fourth_average = sum((segment.power_w ** 4) * segment.time_sec for segment in segments) / max(1.0, total_time)
    normalized_power = fourth_average ** 0.25
    ascent_time = sum(segment.time_sec for segment in segments if segment.grade > 0.005)
    descent_time = sum(segment.time_sec for segment in segments if segment.grade < -0.005)
    return SimulationResult(
        segments=segments,
        summary=SimulationSummary(
            total_time_sec=total_time,
            total_distance_m=total_distance,
            average_speed_mps=total_distance / max(1.0, total_time),
            average_power_w=average_power,
            normalized_power_w=normalized_power,
            ascent_time_sec=ascent_time,
            descent_time_sec=descent_time,
        ),
    )


def wind_vector_mps(weather: WeatherProfile) -> dict[str, float]:
    speed_mps = weather.wind_speed_kph / 3.6
    to_direction = to_radians((weather.wind_direction_deg + 180) % 360)
    return {"east": math.sin(to_direction) * speed_mps, "north": math.cos(to_direction) * speed_mps}


def corner_speed_limit_mps(route_segments: list[RouteSegment], index: int, profile: RiderBikeProfile) -> float:
    if profile.corner_brake_sensitivity <= 0:
        return max(2.0, profile.max_speed_kph / 3.6)
    severity = corner_severity_at(route_segments, index)
    if severity <= 0:
        return max(2.0, profile.max_speed_kph / 3.6)
    max_speed = max(10.0, profile.max_speed_kph)
    min_corner = clamp(profile.min_corner_speed_kph, 8, max_speed)
    speed_kph = max_speed - (max_speed - min_corner) * clamp(profile.corner_brake_sensitivity, 0, 1) * severity
    return max(2.0, speed_kph / 3.6)


def corner_exit_load(route_segments: list[RouteSegment], index: int, profile: RiderBikeProfile) -> float:
    exit_distance = clamp(profile.corner_exit_distance_m, 0, 1200)
    if exit_distance <= 0 or profile.corner_exit_boost_pct <= 0:
        return 0.0
    distance_after_corner = 0.0
    load = 0.0
    cursor = index
    while cursor >= 0 and distance_after_corner <= exit_distance:
        severity = corner_severity_at(route_segments, cursor)
        if severity > 0:
            decay = 1 - distance_after_corner / max(1.0, exit_distance)
            load = max(load, severity * decay)
        distance_after_corner += route_segments[cursor].distance_m
        cursor -= 1
    return clamp(load, 0, 1)


def corner_severity_at(route_segments: list[RouteSegment], index: int) -> float:
    current = route_segments[index] if 0 <= index < len(route_segments) else None
    if current is None:
        return 0.0
    previous = route_segments[index - 1] if index - 1 >= 0 else None
    following = route_segments[index + 1] if index + 1 < len(route_segments) else None
    entry_delta = heading_delta_deg(previous.heading_deg, current.heading_deg) if previous else 0.0
    exit_delta = heading_delta_deg(current.heading_deg, following.heading_deg) if following else 0.0
    return clamp((max(entry_delta, exit_delta) - 12) / 78, 0, 1)


def heading_delta_deg(a: float, b: float) -> float:
    delta = abs(((b - a + 540) % 360) - 180)
    return delta if math.isfinite(delta) else 0.0


def interpolate_cda(yaw_deg: float, cda_by_yaw: dict[str, float], zero_yaw_cda: float) -> float:
    values = {**cda_by_yaw, "0": zero_yaw_cda}
    entries = sorted((float(yaw), cda) for yaw, cda in values.items() if math.isfinite(float(yaw)) and math.isfinite(cda))
    if not entries:
        return zero_yaw_cda
    yaw = abs(yaw_deg)
    if yaw <= entries[0][0]:
        return entries[0][1]
    for left, right in zip(entries, entries[1:]):
        if yaw <= right[0]:
            ratio = (yaw - left[0]) / max(0.001, right[0] - left[0])
            return left[1] + (right[1] - left[1]) * ratio
    return entries[-1][1]


def rider_cda_formula_scale(height_cm: float, mass_kg: float) -> float:
    height_m = clamp(height_cm / 100, 1.2, 2.3)
    mass = clamp(mass_kg, 45, 130)
    return (height_m / 1.8) ** 1.1 * (mass / 74) ** 0.45


def scale_system_cda_by_rider(cda: float, rider_scale: float) -> float:
    equipment_cda = min(EQUIPMENT_CDA_M2, cda)
    return round(equipment_cda + (cda - equipment_cda) * rider_scale, 4)


def apply_rider_cda_scale(profile: RiderBikeProfile, rider_scale: float) -> RiderBikeProfile:
    if abs(rider_scale - 1) < 1e-9:
        return profile
    return replace(
        profile,
        cda_race=scale_system_cda_by_rider(profile.cda_race, rider_scale),
        cda_climb=scale_system_cda_by_rider(profile.cda_climb, rider_scale),
        cda_race_yaw={yaw: scale_system_cda_by_rider(cda, rider_scale) for yaw, cda in (profile.cda_race_yaw or {}).items()},
        cda_climb_yaw={yaw: scale_system_cda_by_rider(cda, rider_scale) for yaw, cda in (profile.cda_climb_yaw or {}).items()},
    )


def format_time(seconds: float) -> str:
    total = int(round(seconds))
    hours = total // 3600
    minutes = (total % 3600) // 60
    secs = total % 60
    return f"{hours}:{minutes:02d}:{secs:02d}"


def format_distance(distance_m: float) -> str:
    return f"{distance_m / 1000:.1f} km"


def builtin_frankfurt_path() -> Path:
    return Path(__file__).resolve().parents[1] / "public" / "courses" / "IMFFM26_Bike.gpx"


class BikeSplitGui(tk.Tk):
    def __init__(self) -> None:
        super().__init__()
        self.title("Ironman Bike Split Predictor - Python")
        self.geometry("1220x780")
        self.minsize(980, 650)
        self.route: PreparedRoute | None = None
        self.result: SimulationResult | None = None
        self.last_cda_scale = 1.0
        self.vars = self.create_vars()
        self.summary_vars = {key: tk.StringVar(value="-") for key in ["route", "distance", "ascent", "time", "speed", "power", "np", "cda"]}
        self.configure_style()
        self.build_layout()
        self.update_formula_scale()

    def create_vars(self) -> dict[str, tk.Variable]:
        defaults = RiderBikeProfile()
        return {
            "height_cm": tk.DoubleVar(value=190),
            "rider_weight_kg": tk.DoubleVar(value=defaults.rider_weight_kg),
            "bike_weight_kg": tk.DoubleVar(value=defaults.bike_weight_kg),
            "ftp_w": tk.DoubleVar(value=defaults.ftp_w),
            "target_pct": tk.DoubleVar(value=72),
            "mode": tk.StringVar(value="power"),
            "goal_hours": tk.DoubleVar(value=5),
            "goal_minutes": tk.DoubleVar(value=5),
            "scale_cda": tk.BooleanVar(value=True),
            "cda_scale_pct": tk.DoubleVar(value=100),
            "cda_race": tk.DoubleVar(value=defaults.cda_race),
            "cda_climb": tk.DoubleVar(value=defaults.cda_climb),
            "crr": tk.DoubleVar(value=defaults.crr),
            "drivetrain": tk.DoubleVar(value=defaults.drivetrain_loss_pct),
            "max_speed": tk.DoubleVar(value=defaults.max_speed_kph),
            "min_power": tk.DoubleVar(value=defaults.min_power_w),
            "max_power": tk.DoubleVar(value=defaults.max_power_w),
            "terrain": tk.DoubleVar(value=defaults.pacing_aggression),
            "max_boost": tk.DoubleVar(value=defaults.max_power_surge_pct),
            "corner_exit": tk.DoubleVar(value=defaults.corner_exit_boost_pct),
            "exit_distance": tk.DoubleVar(value=defaults.corner_exit_distance_m),
            "corner_brake": tk.DoubleVar(value=defaults.corner_brake_sensitivity),
            "min_corner": tk.DoubleVar(value=defaults.min_corner_speed_kph),
            "climb_switch": tk.DoubleVar(value=defaults.position_switch_kph),
            "wind": tk.DoubleVar(value=8),
            "wind_dir": tk.DoubleVar(value=240),
            "temp": tk.DoubleVar(value=20),
            "pressure": tk.DoubleVar(value=1013.25),
            "humidity": tk.DoubleVar(value=60),
            "status": tk.StringVar(value="Keine Strecke geladen."),
            "formula": tk.StringVar(value=""),
        }

    def configure_style(self) -> None:
        style = ttk.Style(self)
        style.theme_use("clam")
        self.configure(bg="#0c1012")
        style.configure(".", background="#151b1e", foreground="#eef6f3", fieldbackground="#101719")
        style.configure("TFrame", background="#0c1012")
        style.configure("Panel.TLabelframe", background="#101719", foreground="#eef6f3", bordercolor="#314044")
        style.configure("Panel.TLabelframe.Label", background="#0c1012", foreground="#28d49b", font=("Segoe UI", 10, "bold"))
        style.configure("TLabel", background="#101719", foreground="#eef6f3")
        style.configure("TButton", background="#1e272a", foreground="#eef6f3", bordercolor="#314044")
        style.map("TButton", background=[("active", "#28d49b")], foreground=[("active", "#06120f")])
        style.configure("TRadiobutton", background="#101719", foreground="#eef6f3")
        style.configure("TCheckbutton", background="#101719", foreground="#eef6f3")
        style.configure("TEntry", fieldbackground="#eef6f3", foreground="#06120f")

    def build_layout(self) -> None:
        root = ttk.Frame(self, padding=12)
        root.pack(fill="both", expand=True)

        top = ttk.Frame(root)
        top.pack(fill="x", pady=(0, 10))
        ttk.Button(top, text="GPX laden", command=self.load_gpx).pack(side="left", padx=(0, 8))
        ttk.Button(top, text="Frankfurt 2026 laden", command=self.load_frankfurt).pack(side="left", padx=(0, 8))
        ttk.Button(top, text="Simulation starten", command=self.run_simulation_action).pack(side="left", padx=(0, 8))
        ttk.Label(top, textvariable=self.vars["status"]).pack(side="left", padx=12)

        panes = ttk.PanedWindow(root, orient="horizontal")
        panes.pack(fill="both", expand=True)

        controls_outer = ttk.Frame(panes)
        controls_canvas = tk.Canvas(controls_outer, width=360, bg="#0c1012", highlightthickness=0)
        controls_scroll = ttk.Scrollbar(controls_outer, orient="vertical", command=controls_canvas.yview)
        controls_container = ttk.Frame(controls_canvas)
        controls_container.bind("<Configure>", lambda _event: controls_canvas.configure(scrollregion=controls_canvas.bbox("all")))
        controls_canvas.create_window((0, 0), window=controls_container, anchor="nw")
        controls_canvas.configure(yscrollcommand=controls_scroll.set)
        controls_canvas.pack(side="left", fill="both", expand=True)
        controls_scroll.pack(side="right", fill="y")
        controls_canvas.bind_all("<MouseWheel>", lambda event: controls_canvas.yview_scroll(int(-1 * (event.delta / 120)), "units"))
        panes.add(controls_outer, weight=0)

        output = ttk.Frame(panes, padding=(12, 0, 0, 0))
        panes.add(output, weight=1)

        self.build_controls(controls_container)
        self.build_output(output)

    def build_controls(self, parent: ttk.Frame) -> None:
        self.add_profile_section(parent)
        self.add_goal_section(parent)
        self.add_cda_section(parent)
        self.add_aero_section(parent)
        self.add_terrain_section(parent)
        self.add_weather_section(parent)

    def panel(self, parent: ttk.Frame, title: str) -> ttk.LabelFrame:
        frame = ttk.LabelFrame(parent, text=title, style="Panel.TLabelframe", padding=10)
        frame.pack(fill="x", padx=2, pady=(0, 10))
        return frame

    def add_number(self, parent: ttk.Frame, row: int, label: str, variable: tk.Variable, unit: str = "", width: int = 9) -> None:
        ttk.Label(parent, text=label).grid(row=row, column=0, sticky="w", pady=3)
        ttk.Entry(parent, textvariable=variable, width=width).grid(row=row, column=1, sticky="ew", pady=3, padx=(8, 4))
        ttk.Label(parent, text=unit).grid(row=row, column=2, sticky="w", pady=3)
        parent.columnconfigure(1, weight=1)

    def add_profile_section(self, parent: ttk.Frame) -> None:
        frame = self.panel(parent, "Profil")
        self.add_number(frame, 0, "Groesse", self.vars["height_cm"], "cm")
        self.add_number(frame, 1, "Fahrergewicht", self.vars["rider_weight_kg"], "kg")
        self.add_number(frame, 2, "Radgewicht", self.vars["bike_weight_kg"], "kg")
        self.add_number(frame, 3, "FTP", self.vars["ftp_w"], "W")
        for key in ("height_cm", "rider_weight_kg"):
            self.vars[key].trace_add("write", lambda *_args: self.update_formula_scale())

    def add_goal_section(self, parent: ttk.Frame) -> None:
        frame = self.panel(parent, "Ziele")
        for index, (label, value) in enumerate([("Leistung", "power"), ("Zielzeit", "goal"), ("Terrain", "pacing")]):
            ttk.Radiobutton(frame, text=label, value=value, variable=self.vars["mode"]).grid(row=0, column=index, sticky="w", padx=(0, 8))
        self.add_number(frame, 1, "Zielpower", self.vars["target_pct"], "% FTP")
        self.add_number(frame, 2, "Zielzeit h", self.vars["goal_hours"], "h")
        self.add_number(frame, 3, "Zielzeit min", self.vars["goal_minutes"], "min")

    def add_cda_section(self, parent: ttk.Frame) -> None:
        frame = self.panel(parent, "Prediction-CdA")
        ttk.Checkbutton(frame, text="Groesse/Gewicht auf CdA anwenden", variable=self.vars["scale_cda"]).grid(row=0, column=0, columnspan=3, sticky="w")
        ttk.Label(frame, textvariable=self.vars["formula"], wraplength=310).grid(row=1, column=0, columnspan=3, sticky="w", pady=(6, 3))
        self.add_number(frame, 2, "CdA Scale", self.vars["cda_scale_pct"], "%")
        ttk.Button(frame, text="Formel uebernehmen", command=self.use_formula_scale).grid(row=3, column=0, columnspan=3, sticky="ew", pady=(6, 0))

    def add_aero_section(self, parent: ttk.Frame) -> None:
        frame = self.panel(parent, "Aero & Widerstand")
        self.add_number(frame, 0, "CdA Race", self.vars["cda_race"], "m2")
        self.add_number(frame, 1, "CdA Climb", self.vars["cda_climb"], "m2")
        self.add_number(frame, 2, "Crr", self.vars["crr"])
        self.add_number(frame, 3, "Antrieb", self.vars["drivetrain"], "%")
        self.add_number(frame, 4, "Max Tempo", self.vars["max_speed"], "km/h")

    def add_terrain_section(self, parent: ttk.Frame) -> None:
        frame = self.panel(parent, "Terrain-Pacing")
        self.add_number(frame, 0, "Terrain-Faktor", self.vars["terrain"])
        self.add_number(frame, 1, "Min W", self.vars["min_power"], "W")
        self.add_number(frame, 2, "Max W", self.vars["max_power"], "W")
        self.add_number(frame, 3, "Max Boost", self.vars["max_boost"], "%")
        self.add_number(frame, 4, "Kurven-Exit", self.vars["corner_exit"], "%")
        self.add_number(frame, 5, "Exit-Distanz", self.vars["exit_distance"], "m")
        self.add_number(frame, 6, "Kurvenbremse", self.vars["corner_brake"])
        self.add_number(frame, 7, "Min Kurve", self.vars["min_corner"], "km/h")
        self.add_number(frame, 8, "Climb-Wechsel", self.vars["climb_switch"], "km/h")

    def add_weather_section(self, parent: ttk.Frame) -> None:
        frame = self.panel(parent, "Wetter")
        self.add_number(frame, 0, "Wind", self.vars["wind"], "km/h")
        self.add_number(frame, 1, "Richtung", self.vars["wind_dir"], "Grad")
        self.add_number(frame, 2, "Temperatur", self.vars["temp"], "C")
        self.add_number(frame, 3, "Druck", self.vars["pressure"], "hPa")
        self.add_number(frame, 4, "Feuchte", self.vars["humidity"], "%")

    def build_output(self, parent: ttk.Frame) -> None:
        summary = ttk.LabelFrame(parent, text="Ergebnis", style="Panel.TLabelframe", padding=10)
        summary.pack(fill="x", pady=(0, 10))
        labels = [
            ("Strecke", "route"),
            ("Distanz", "distance"),
            ("Anstieg", "ascent"),
            ("Radzeit", "time"),
            ("Tempo", "speed"),
            ("Leistung", "power"),
            ("Normalized Power", "np"),
            ("CdA Scale", "cda"),
        ]
        for index, (label, key) in enumerate(labels):
            ttk.Label(summary, text=label).grid(row=index // 4 * 2, column=index % 4, sticky="w", padx=8)
            ttk.Label(summary, textvariable=self.summary_vars[key], font=("Segoe UI", 12, "bold")).grid(row=index // 4 * 2 + 1, column=index % 4, sticky="w", padx=8, pady=(0, 6))

        chart_panel = ttk.LabelFrame(parent, text="Power / Speed / Hoehe", style="Panel.TLabelframe", padding=8)
        chart_panel.pack(fill="both", expand=True, pady=(0, 10))
        self.chart = tk.Canvas(chart_panel, bg="#111719", highlightthickness=0, height=330)
        self.chart.pack(fill="both", expand=True)
        self.chart.bind("<Configure>", lambda _event: self.draw_chart())

        route_panel = ttk.LabelFrame(parent, text="Route", style="Panel.TLabelframe", padding=8)
        route_panel.pack(fill="both", expand=True)
        self.route_canvas = tk.Canvas(route_panel, bg="#111719", highlightthickness=0, height=210)
        self.route_canvas.pack(fill="both", expand=True)
        self.route_canvas.bind("<Configure>", lambda _event: self.draw_route())

    def load_frankfurt(self) -> None:
        path = builtin_frankfurt_path()
        if not path.exists():
            messagebox.showerror("GPX fehlt", f"Nicht gefunden:\n{path}")
            return
        self.load_route(path, "IRONMAN Frankfurt 2026")

    def load_gpx(self) -> None:
        selected = filedialog.askopenfilename(title="GPX laden", filetypes=[("GPX-Dateien", "*.gpx"), ("Alle Dateien", "*.*")])
        if selected:
            self.load_route(Path(selected))

    def load_route(self, path: Path, display_name: str | None = None) -> None:
        try:
            self.route = parse_gpx(path, display_name)
            if display_name:
                self.route.name = display_name
            self.result = None
            self.vars["status"].set(f"Geladen: {self.route.name}")
            self.update_summary()
            self.draw_route()
            self.draw_chart()
        except Exception as exc:
            messagebox.showerror("GPX-Import fehlgeschlagen", str(exc))

    def update_formula_scale(self) -> None:
        try:
            scale = rider_cda_formula_scale(float(self.vars["height_cm"].get()), float(self.vars["rider_weight_kg"].get()))
            self.vars["formula"].set(f"Formelvorschlag: {scale * 100:.1f}% der Referenz")
        except Exception:
            self.vars["formula"].set("Formelvorschlag: -")

    def use_formula_scale(self) -> None:
        scale = rider_cda_formula_scale(float(self.vars["height_cm"].get()), float(self.vars["rider_weight_kg"].get()))
        self.vars["cda_scale_pct"].set(round(scale * 100, 1))

    def profile_from_ui(self) -> RiderBikeProfile:
        ftp = float(self.vars["ftp_w"].get())
        target_power = round(ftp * float(self.vars["target_pct"].get()) / 100)
        base = RiderBikeProfile(
            rider_weight_kg=float(self.vars["rider_weight_kg"].get()),
            bike_weight_kg=float(self.vars["bike_weight_kg"].get()),
            ftp_w=ftp,
            target_power_w=target_power,
            cda_race=float(self.vars["cda_race"].get()),
            cda_climb=float(self.vars["cda_climb"].get()),
            crr=float(self.vars["crr"].get()),
            drivetrain_loss_pct=float(self.vars["drivetrain"].get()),
            position_switch_kph=float(self.vars["climb_switch"].get()),
            max_speed_kph=float(self.vars["max_speed"].get()),
            min_power_w=float(self.vars["min_power"].get()),
            max_power_w=max(float(self.vars["max_power"].get()), target_power),
            pacing_aggression=float(self.vars["terrain"].get()),
            max_power_surge_pct=float(self.vars["max_boost"].get()),
            corner_exit_boost_pct=float(self.vars["corner_exit"].get()),
            corner_exit_distance_m=float(self.vars["exit_distance"].get()),
            corner_brake_sensitivity=float(self.vars["corner_brake"].get()),
            min_corner_speed_kph=float(self.vars["min_corner"].get()),
        )
        if bool(self.vars["scale_cda"].get()):
            self.last_cda_scale = clamp(float(self.vars["cda_scale_pct"].get()), 70, 140) / 100
            return apply_rider_cda_scale(base, self.last_cda_scale)
        self.last_cda_scale = 1.0
        return base

    def weather_from_ui(self) -> WeatherProfile:
        return WeatherProfile(
            temp_c=float(self.vars["temp"].get()),
            pressure_hpa=float(self.vars["pressure"].get()),
            humidity_pct=float(self.vars["humidity"].get()),
            wind_speed_kph=float(self.vars["wind"].get()),
            wind_direction_deg=float(self.vars["wind_dir"].get()),
        )

    def run_simulation_action(self) -> None:
        if self.route is None:
            messagebox.showinfo("Keine Strecke", "Bitte zuerst eine GPX laden.")
            return
        try:
            self.vars["status"].set("Berechne...")
            self.update_idletasks()
            mode = str(self.vars["mode"].get())
            goal_time = float(self.vars["goal_hours"].get()) * 3600 + float(self.vars["goal_minutes"].get()) * 60
            self.result = simulate_course(self.route.segments, self.profile_from_ui(), self.weather_from_ui(), mode, goal_time)
            self.vars["status"].set("Berechnung fertig.")
            self.update_summary()
            self.draw_chart()
        except Exception as exc:
            self.vars["status"].set("Berechnung fehlgeschlagen.")
            messagebox.showerror("Berechnung fehlgeschlagen", str(exc))

    def update_summary(self) -> None:
        route = self.route
        result = self.result
        if route is None:
            for var in self.summary_vars.values():
                var.set("-")
            return
        self.summary_vars["route"].set(route.name)
        self.summary_vars["distance"].set(format_distance(route.total_distance_m))
        self.summary_vars["ascent"].set(f"{route.total_ascent_m:.0f} m")
        if result is None:
            for key in ["time", "speed", "power", "np"]:
                self.summary_vars[key].set("offen")
        else:
            summary = result.summary
            self.summary_vars["time"].set(format_time(summary.total_time_sec))
            self.summary_vars["speed"].set(f"{summary.average_speed_mps * 3.6:.1f} km/h")
            self.summary_vars["power"].set(f"{(result.solved_power_w or summary.average_power_w):.0f} W")
            self.summary_vars["np"].set(f"{summary.normalized_power_w:.0f} W")
        self.summary_vars["cda"].set(f"{self.last_cda_scale * 100:.1f}%")

    def draw_chart(self) -> None:
        canvas = self.chart
        canvas.delete("all")
        width = max(400, canvas.winfo_width())
        height = max(240, canvas.winfo_height())
        canvas.create_rectangle(0, 0, width, height, fill="#111719", outline="")
        if self.route is None:
            canvas.create_text(width / 2, height / 2, text="GPX laden und Simulation starten", fill="#9aa8a3", font=("Segoe UI", 14, "bold"))
            return
        segments = self.result.segments if self.result else []
        points = self.route.points
        padding = 34
        elevation_values = [point.ele for point in points]
        if elevation_values:
            self.draw_line(canvas, elevation_values, "#58a6ff", width, height, padding)
        if segments:
            power_values = [segment.power_w for segment in segments]
            speed_values = [segment.speed_mps * 3.6 for segment in segments]
            self.draw_bars(canvas, power_values, "#8bb8bd", width, height, padding)
            self.draw_line(canvas, speed_values, "#ff9b45", width, height, padding)
        canvas.create_text(75, height - 12, text="Power", fill="#8bb8bd", anchor="w")
        canvas.create_text(155, height - 12, text="Speed", fill="#ff9b45", anchor="w")
        canvas.create_text(235, height - 12, text="Hoehe", fill="#58a6ff", anchor="w")

    def draw_line(self, canvas: tk.Canvas, values: list[float], color: str, width: int, height: int, padding: int) -> None:
        if len(values) < 2:
            return
        sampled = downsample(values, 600)
        low = min(sampled)
        high = max(sampled)
        span = max(1.0, high - low)
        coords: list[float] = []
        for index, value in enumerate(sampled):
            x = padding + index / max(1, len(sampled) - 1) * (width - 2 * padding)
            y = padding + (1 - (value - low) / span) * (height - 2.4 * padding)
            coords.extend([x, y])
        canvas.create_line(*coords, fill=color, width=2, smooth=True)

    def draw_bars(self, canvas: tk.Canvas, values: list[float], color: str, width: int, height: int, padding: int) -> None:
        if not values:
            return
        sampled = downsample(values, 280)
        high = max(1.0, max(sampled))
        bar_width = max(1.0, (width - 2 * padding) / len(sampled))
        baseline = height - padding * 1.5
        for index, value in enumerate(sampled):
            x = padding + index * bar_width
            y = baseline - (value / high) * (height - 2.5 * padding)
            canvas.create_rectangle(x, y, x + bar_width * 0.85, baseline, fill=color, outline="")

    def draw_route(self) -> None:
        canvas = self.route_canvas
        canvas.delete("all")
        width = max(400, canvas.winfo_width())
        height = max(180, canvas.winfo_height())
        canvas.create_rectangle(0, 0, width, height, fill="#111719", outline="")
        if self.route is None or len(self.route.points) < 2:
            canvas.create_text(width / 2, height / 2, text="Keine Route", fill="#9aa8a3", font=("Segoe UI", 13, "bold"))
            return
        points = downsample(self.route.points, 800)
        min_lat = min(point.lat for point in points)
        max_lat = max(point.lat for point in points)
        min_lon = min(point.lon for point in points)
        max_lon = max(point.lon for point in points)
        pad = 20
        lon_span = max(0.0001, max_lon - min_lon)
        lat_span = max(0.0001, max_lat - min_lat)
        coords: list[float] = []
        for point in points:
            x = pad + (point.lon - min_lon) / lon_span * (width - 2 * pad)
            y = height - pad - (point.lat - min_lat) / lat_span * (height - 2 * pad)
            coords.extend([x, y])
        canvas.create_line(*coords, fill="#ff3f1f", width=3, smooth=False)


def downsample(items: list, limit: int) -> list:
    if len(items) <= limit:
        return items
    step = len(items) / limit
    return [items[int(index * step)] for index in range(limit)]


def run_smoke_test(path: Path) -> None:
    route = parse_gpx(path, "Smoke Test")
    profile = RiderBikeProfile()
    weather = WeatherProfile()
    result = simulate_course(route.segments, profile, weather, "power")
    print(
        json.dumps(
            {
                "route": route.name,
                "distance_km": round(route.total_distance_m / 1000, 2),
                "ascent_m": round(route.total_ascent_m),
                "segments": len(route.segments),
                "time": format_time(result.summary.total_time_sec),
                "average_power_w": round(result.summary.average_power_w),
                "normalized_power_w": round(result.summary.normalized_power_w),
            },
            indent=2,
        )
    )


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Lokale Python-GUI fuer den Ironman Bike Split Predictor.")
    parser.add_argument("--smoke-test", action="store_true", help="Rechnet die Frankfurt-GPX ohne GUI.")
    parser.add_argument("--gpx", type=Path, default=builtin_frankfurt_path(), help="GPX-Datei fuer den Smoke-Test.")
    args = parser.parse_args(argv)

    if args.smoke_test:
        run_smoke_test(args.gpx)
        return 0

    app = BikeSplitGui()
    app.mainloop()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
