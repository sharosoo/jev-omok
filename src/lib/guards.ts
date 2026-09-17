/**
 * The project's only type-guard module. These narrow an unknown payload far
 * enough to read individual fields with `typeof`; they never claim to prove a
 * shape. Parse at the boundary, then pass named types inward.
 */

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const isNumberRecord = (value: unknown): value is Record<string, number> =>
  isRecord(value) && Object.values(value).every((n) => typeof n === "number");
