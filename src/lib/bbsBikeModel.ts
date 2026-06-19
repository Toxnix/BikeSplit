export type BbsBikeCalculatedValues = {
  rollingResistance: number;
  mechanicalLoss: number;
  cdaRacingByYaw: Record<string, number>;
  cdaClimbingByYaw: Record<string, number>;
};

export type BbsBikeModelInput = {
  bikeType: string;
  components: string;
  frontWheelType: string;
  frontWheelWidth: string;
  rearWheelType: string;
  rearWheelWidth: string;
  tireType: string;
  tubeType: string;
  racingPosition: string;
  climbingPosition: string;
  helmetType: string;
  riderLevel?: number;
};

const yaws = ["0", "5", "10", "15", "20"] as const;
const yawIndex = [1, 2, 3, 4, 5] as const;

const codeMaps = {
  bikeType: {
    Road: 1,
    "Aero Road": 2,
    "Tri/TT (entry level)": 3,
    "Tri/TT": 4,
    Gravel: 5,
    Mountain: 6
  },
  components: {
    "High End": 1,
    "Mid Range": 2,
    "Entry Level": 3
  },
  wheelType: {
    "Standard Box Rim": 1,
    "Minimal Depth (30s)": 2,
    "Medium Depth (60s)": 3,
    "Deep Depth (90s)": 4,
    "Tri-Spoke": 5,
    Disc: 6
  },
  wheelWidth: {
    Narrow: 1,
    Wide: 2
  },
  tireType: {
    "Clincher (narrow 19-21)": 1,
    "Tubular (narrow 19-21)": 2,
    "Clincher (medium 22-24)": 3,
    "Tubular (medium 22-24)": 4,
    "Clincher (wide 25-28)": 5,
    "Tubular (wide 25-28)": 6,
    "Gravel Tires": 7,
    "Mountain Bike Tires": 8,
    "Clincher (wider 30+)": 9,
    "Tubular (wider 30+)": 10
  },
  tubeType: {
    Butyl: 1,
    Latex: 2,
    Tubeless: 3
  },
  racingPosition: {
    Tops: 1,
    Hoods: 2,
    Drops: 3,
    "Aerobars (Recreational Triathlete)": 6,
    "Aerobars (Midpack Triathlete)": 7,
    "Aerobars (Advanced Triathlete)": 4,
    "Aerobars (Elite/Pro Time Trial)": 5,
    "Mountain Bike Bars": 8
  },
  climbingPosition: {
    Tops: 1,
    "Hoods/Bullhorns": 2,
    Upright: 3,
    "Mountain Bike Bars": 4
  },
  helmetType: {
    Road: 1,
    Aero: 2,
    Mountain: 3
  }
} as const;

const rollingResistance: Record<number, Record<number, number>> = {
  1: { 1: 0.00393, 2: 0.00342, 3: 0.00384 },
  2: { 3: 0.00375 },
  3: { 1: 0.00387, 2: 0.00336, 3: 0.00378 },
  4: { 3: 0.00369 },
  5: { 1: 0.0036, 2: 0.00309, 3: 0.00351 },
  6: { 3: 0.00342 },
  7: { 1: 0.00588, 2: 0.00513, 3: 0.00538 },
  8: { 1: 0.0062, 2: 0.00545, 3: 0.0054 },
  9: { 1: 0.0038, 2: 0.003, 3: 0.0032 },
  10: { 3: 0.0034 }
};

const mechanicalLoss: Record<number, Record<number, number>> = {
  1: { 1: 0.012, 2: 0.015, 3: 0.02 },
  2: { 1: 0.018, 2: 0.022, 3: 0.025 },
  3: { 1: 0.024, 2: 0.028, 3: 0.032 }
};

const cdaRaceBase: Record<number, number> = {
  1: 0.4,
  2: 0.35,
  3: 0.31,
  4: 0.29,
  5: 0.27,
  6: 0.36,
  7: 0.33,
  8: 0.42
};

const cdaClimbBase: Record<number, number> = {
  1: 0.4,
  2: 0.35,
  3: 0.43,
  4: 0.45
};

const frameCda: Record<number, Record<number, number>> = {
  1: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
  2: { 1: 0.015, 2: 0.016, 3: 0.017, 4: 0.018, 5: 0.023 },
  3: { 1: 0.032, 2: 0.027, 3: 0.035, 4: 0.029, 5: 0.04 },
  4: { 1: 0.048, 2: 0.046, 3: 0.053, 4: 0.05, 5: 0.058 },
  5: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
  6: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }
};

const wheelCda: Record<number, Record<number, Record<number, number>>> = {
  1: {
    1: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
    2: { 1: 0.002759, 2: 0.003394, 3: 0.005095, 4: 0.003387, 5: 0.002935 }
  },
  2: {
    1: { 1: 0.001109, 2: 0.001151, 3: 0.001031, 4: 0.002508, 5: 0.002454 },
    2: { 1: 0.003868, 2: 0.004544, 3: 0.006127, 4: 0.005895, 5: 0.005389 }
  },
  3: {
    1: { 1: 0.002479, 2: 0.003221, 3: 0.00563, 4: 0.006554, 5: 0.004823 },
    2: { 1: 0.005238, 2: 0.006615, 3: 0.010725, 4: 0.00994, 5: 0.007758 }
  },
  4: {
    1: { 1: 0.003048, 2: 0.004735, 3: 0.009364, 4: 0.009483, 5: 0.00731 },
    2: { 1: 0.005807, 2: 0.008128, 3: 0.014459, 4: 0.01287, 5: 0.010246 }
  },
  5: {
    1: { 1: 0.002606, 2: 0.002631, 3: 0.003983, 4: 0.006096, 5: 0.006815 },
    2: { 1: 0.002606, 2: 0.002631, 3: 0.003983, 4: 0.006096, 5: 0.006815 }
  },
  6: {
    1: { 1: 0.00323, 2: 0.005535, 3: 0.009131, 4: 0.01341, 5: 0.015535 },
    2: { 1: 0.00599, 2: 0.008929, 3: 0.014227, 4: 0.016797, 5: 0.01847 }
  }
};

export function calculateBbsBikeValues(input: BbsBikeModelInput): BbsBikeCalculatedValues {
  const tire = valueFor(codeMaps.tireType, input.tireType);
  const tube = isTubularTire(tire) ? 3 : valueFor(codeMaps.tubeType, input.tubeType);
  const component = valueFor(codeMaps.components, input.components);
  const riderLevel = input.riderLevel ?? 2;
  const frame = valueFor(codeMaps.bikeType, input.bikeType);
  const frontDepth = valueFor(codeMaps.wheelType, input.frontWheelType);
  const frontWidth = valueFor(codeMaps.wheelWidth, input.frontWheelWidth);
  const rearDepth = valueFor(codeMaps.wheelType, input.rearWheelType);
  const rearWidth = valueFor(codeMaps.wheelWidth, input.rearWheelWidth);
  const racingPosition = valueFor(codeMaps.racingPosition, input.racingPosition);
  const climbingPosition = valueFor(codeMaps.climbingPosition, input.climbingPosition);
  const helmet = valueFor(codeMaps.helmetType, input.helmetType);
  const aeroHelmet = helmet === 2 ? 0.01 : 0;

  return {
    rollingResistance: rollingResistance[tire]?.[tube] ?? rollingResistance[5][2],
    mechanicalLoss: mechanicalLoss[component]?.[riderLevel] ?? mechanicalLoss[2][2],
    cdaRacingByYaw: calculateRaceYaw({
      frame,
      frontDepth,
      frontWidth,
      rearDepth,
      rearWidth,
      racingPosition,
      aeroHelmet
    }),
    cdaClimbingByYaw: calculateClimbYaw({
      frame,
      frontDepth,
      frontWidth,
      rearDepth,
      rearWidth,
      climbingPosition,
      aeroHelmet
    })
  };
}

function calculateRaceYaw({
  frame,
  frontDepth,
  frontWidth,
  rearDepth,
  rearWidth,
  racingPosition,
  aeroHelmet
}: {
  frame: number;
  frontDepth: number;
  frontWidth: number;
  rearDepth: number;
  rearWidth: number;
  racingPosition: number;
  aeroHelmet: number;
}) {
  const base = cdaRaceBase[racingPosition] - aeroHelmet;
  return yawMap((yawDeg, index) =>
    ceil4(
      (yawDeg === 0 ? base : Math.cos(yawDeg * 0.0174532925) * base) -
        0.3 * frameValue(frame, index) -
        wheelValue(frontDepth, frontWidth, index) -
        0.4 * wheelValue(rearDepth, rearWidth, index)
    )
  );
}

function calculateClimbYaw({
  frame,
  frontDepth,
  frontWidth,
  rearDepth,
  rearWidth,
  climbingPosition,
  aeroHelmet
}: {
  frame: number;
  frontDepth: number;
  frontWidth: number;
  rearDepth: number;
  rearWidth: number;
  climbingPosition: number;
  aeroHelmet: number;
}) {
  const base = cdaClimbBase[climbingPosition] - 0.25 * aeroHelmet;
  return yawMap((yawDeg, index) =>
    ceil4(
      (yawDeg === 0 ? base : Math.cos(yawDeg * 0.0174532925) * base) -
        0.25 * frameValue(frame, index) -
        0.85 * wheelValue(frontDepth, frontWidth, index) -
        0.3 * wheelValue(rearDepth, rearWidth, index)
    )
  );
}

function yawMap(getValue: (yawDeg: number, index: number) => number) {
  return Object.fromEntries(yaws.map((yaw, index) => [yaw, getValue(Number(yaw), yawIndex[index])]));
}

function frameValue(frame: number, index: number) {
  return frameCda[frame]?.[index] ?? 0;
}

function wheelValue(depth: number, width: number, index: number) {
  return wheelCda[depth]?.[width]?.[index] ?? 0;
}

function valueFor<T extends Record<string, number>>(map: T, key: string): number {
  return map[key] ?? Object.values(map)[0];
}

function isTubularTire(tire: number) {
  return tire === 2 || tire === 4 || tire === 6 || tire === 10;
}

function ceil4(value: number) {
  return Math.ceil(10000 * value) / 10000;
}
