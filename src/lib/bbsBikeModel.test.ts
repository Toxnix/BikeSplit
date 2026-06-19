import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { calculateBbsBikeValues } from "./bbsBikeModel";

type ValidationCase = {
  index: number;
  labels: {
    btype: string;
    bcomponents: string;
    fwheel_depth: string;
    fwheel_width: string;
    rwheel_depth: string;
    rwheel_width: string;
    tire_type: string;
    tube_type: string;
    riding_style: string;
    climbing_style: string;
    bhelmet: string;
  };
  calculated: Record<string, string>;
};

const fixture = JSON.parse(
  readFileSync(resolve(process.cwd(), "tools/bbs-bike-live-validation-97709.json"), "utf8")
) as { cases: ValidationCase[] };

describe("BestBikeSplit bike calculated values model", () => {
  it("matches live BBS Basic Riding Style calculations", () => {
    for (const sample of fixture.cases) {
      const actual = calculateBbsBikeValues({
        bikeType: sample.labels.btype,
        components: sample.labels.bcomponents,
        frontWheelType: sample.labels.fwheel_depth,
        frontWheelWidth: sample.labels.fwheel_width,
        rearWheelType: sample.labels.rwheel_depth,
        rearWheelWidth: sample.labels.rwheel_width,
        tireType: sample.labels.tire_type,
        tubeType: sample.labels.tube_type,
        racingPosition: sample.labels.riding_style,
        climbingPosition: sample.labels.climbing_style,
        helmetType: sample.labels.bhelmet
      });

      expect(actual.rollingResistance, `rolling resistance sample ${sample.index}`).toBeCloseTo(
        Number(sample.calculated.rollingres),
        6
      );
      expect(actual.mechanicalLoss, `mechanical loss sample ${sample.index}`).toBeCloseTo(
        Number(sample.calculated.mechloss),
        6
      );

      for (const yaw of ["0", "5", "10", "15", "20"]) {
        expect(actual.cdaRacingByYaw[yaw], `race CdA ${yaw} sample ${sample.index}`).toBeCloseTo(
          Number(sample.calculated[`cdayaw_${yaw}`]),
          6
        );
        expect(actual.cdaClimbingByYaw[yaw], `climb CdA ${yaw} sample ${sample.index}`).toBeCloseTo(
          Number(sample.calculated[`cdayawcl_${yaw}`]),
          6
        );
      }
    }
  });
});
