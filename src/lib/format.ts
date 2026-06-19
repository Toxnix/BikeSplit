const number = new Intl.NumberFormat("de-DE", {
  maximumFractionDigits: 1
});

const compactNumber = new Intl.NumberFormat("de-DE", {
  maximumFractionDigits: 0
});

export function formatDistance(meters: number): string {
  if (meters >= 1000) {
    return `${number.format(meters / 1000)} km`;
  }
  return `${compactNumber.format(meters)} m`;
}

export function formatSpeed(mps: number): string {
  return `${number.format(mps * 3.6)} km/h`;
}

export function formatWatts(watts: number): string {
  return `${compactNumber.format(watts)} W`;
}

export function formatPercent(value: number): string {
  return `${number.format(value * 100)} %`;
}

export function formatMeters(value: number): string {
  return `${compactNumber.format(value)} m`;
}

export function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds)) {
    return "--:--";
  }

  const total = Math.max(0, Math.round(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  }

  return `${minutes}:${String(secs).padStart(2, "0")}`;
}

export function formatDeltaTime(seconds: number): string {
  const sign = seconds > 0 ? "+" : seconds < 0 ? "-" : "";
  return `${sign}${formatTime(Math.abs(seconds))}`;
}
