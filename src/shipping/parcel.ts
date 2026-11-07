import { type Parcel, ShippingError } from "./types.js";

export interface SizeClass {
  code: string;
  /** Interior dimensions of the compartment, in millimetres. */
  lengthMm: number;
  widthMm: number;
  heightMm: number;
}

export interface SizeConfig {
  classes: readonly SizeClass[];
  maxWeightG: number;
}

/**
 * EXAMPLE VALUES ONLY. These imitate the three size classes (A, B, C) commonly used by
 * parcel locker networks in Poland, but they were NOT verified against any carrier's
 * current specification. Always load the real limits from your carrier's documentation
 * or contract and pass them in as configuration.
 */
export const EXAMPLE_SIZE_CONFIG: SizeConfig = {
  classes: [
    { code: "A", lengthMm: 640, widthMm: 380, heightMm: 80 },
    { code: "B", lengthMm: 640, widthMm: 380, heightMm: 190 },
    { code: "C", lengthMm: 640, widthMm: 380, heightMm: 410 },
  ],
  maxWeightG: 25_000,
};

export type FitResult = { fits: true; sizeClass: string } | { fits: false; reason: string };

function volume(c: SizeClass): number {
  return c.lengthMm * c.widthMm * c.heightMm;
}

function assertParcel(parcel: Parcel): void {
  for (const [key, value] of Object.entries(parcel)) {
    if (!Number.isInteger(value) || value <= 0) {
      throw new ShippingError("invalid_parcel", `${key} must be a positive integer, got ${value}`);
    }
  }
}

/**
 * Finds the smallest size class the parcel fits into. Dimensions are compared after
 * sorting both the parcel and the compartment (longest side to longest side), so the
 * parcel may be rotated freely. The parcel is treated as one rigid box: packing several
 * items into a box is out of scope.
 */
export function fitParcel(parcel: Parcel, config: SizeConfig = EXAMPLE_SIZE_CONFIG): FitResult {
  assertParcel(parcel);
  if (parcel.weightG > config.maxWeightG) {
    return { fits: false, reason: `Parcel weighs ${parcel.weightG} g, the limit is ${config.maxWeightG} g` };
  }
  const dims = [parcel.lengthMm, parcel.widthMm, parcel.heightMm].sort((a, b) => b - a) as [number, number, number];
  const classes = [...config.classes].sort((a, b) => volume(a) - volume(b));
  for (const c of classes) {
    const box = [c.lengthMm, c.widthMm, c.heightMm].sort((a, b) => b - a) as [number, number, number];
    if (dims[0] <= box[0] && dims[1] <= box[1] && dims[2] <= box[2]) {
      return { fits: true, sizeClass: c.code };
    }
  }
  return { fits: false, reason: "Parcel does not fit any configured size class" };
}
