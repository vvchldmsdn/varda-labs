import { createHash } from "node:crypto";

import { SIMULATION_CURATED_ADMISSION_PLANNER_POLICY } from "./simulation-curated-admission-planner-policy.ts";
import type { SimulationCuratedAdmissionEnvelopeInput } from "./simulation-curated-admission-planner-types.ts";

const CANONICAL_UTC_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})\.(\d{3})Z$/;
const DAYS_BEFORE_MONTH = Object.freeze([
  0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334,
]);

export type SimulationCuratedAdmissionEnvelopeSerializationResult =
  | Readonly<{
      status: "serialized";
      canonicalSerialization: string;
      approvalEnvelopeDigest: string;
      byteLength: number;
    }>
  | Readonly<{
      status: "too_large";
      canonicalSerialization: null;
      approvalEnvelopeDigest: null;
      byteLength: number;
    }>;

export function serializeSimulationCuratedAdmissionEnvelope(
  input: SimulationCuratedAdmissionEnvelopeInput,
): SimulationCuratedAdmissionEnvelopeSerializationResult {
  const canonicalVector = new Array<Readonly<Record<string, unknown>>>(
    input.vector.length,
  );
  for (let index = 0; index < input.vector.length; index += 1) {
    const source = input.vector[index];
    const row: Record<string, unknown> = Object.create(null);
    row.market = source.market;
    row.currency = source.currency;
    row.ticker = source.ticker;
    row.weightBps = source.weightBps;
    canonicalVector[index] = Object.freeze(row);
  }
  Object.defineProperty(canonicalVector, "toJSON", {
    value: undefined,
    enumerable: false,
    writable: false,
    configurable: false,
  });
  Object.freeze(canonicalVector);

  const root: Record<string, unknown> = Object.create(null);
  root.approvalEnvelopeDigestVersion = input.approvalEnvelopeDigestVersion;
  root.actorMode = input.actorMode;
  root.confirmationPolicyId = input.confirmationPolicyId;
  root.intent = input.intent;
  root.ownerUserId = input.ownerUserId;
  root.portfolioPathPolicyId = input.portfolioPathPolicyId;
  root.gate0ApprovalCommit = input.gate0ApprovalCommit;
  root.scenarioId = input.scenarioId;
  root.scenarioVersion = input.scenarioVersion;
  root.vectorHashVersion = input.vectorHashVersion;
  root.scenarioVectorHash = input.scenarioVectorHash;
  root.vector = canonicalVector;
  Object.freeze(root);

  const canonicalSerialization = JSON.stringify(root);
  if (typeof canonicalSerialization !== "string") {
    throw new TypeError("Canonical approval envelope did not serialize");
  }
  const byteLength = Buffer.byteLength(canonicalSerialization, "utf8");
  if (
    byteLength >
    SIMULATION_CURATED_ADMISSION_PLANNER_POLICY.maxCanonicalInputBytes
  ) {
    return Object.freeze({
      status: "too_large",
      canonicalSerialization: null,
      approvalEnvelopeDigest: null,
      byteLength,
    });
  }

  const approvalEnvelopeDigest = `sha256:${createHash("sha256")
    .update(canonicalSerialization, "utf8")
    .digest("hex")}`;
  return Object.freeze({
    status: "serialized",
    canonicalSerialization,
    approvalEnvelopeDigest,
    byteLength,
  });
}

export function parseSimulationCuratedAdmissionSyntheticInstant(
  value: unknown,
): number | null {
  if (typeof value !== "string") return null;
  const match = CANONICAL_UTC_PATTERN.exec(value);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const millisecond = Number(match[7]);
  if (
    year < 2000 ||
    year > 2099 ||
    month < 1 ||
    month > 12 ||
    hour > 23 ||
    minute > 59 ||
    second > 59 ||
    millisecond > 999
  ) {
    return null;
  }

  const daysInMonth = getDaysInMonth(year, month);
  if (day < 1 || day > daysInMonth) return null;

  let daysSinceEpoch = 0;
  for (let currentYear = 1970; currentYear < year; currentYear += 1) {
    daysSinceEpoch += isLeapYear(currentYear) ? 366 : 365;
  }
  daysSinceEpoch += DAYS_BEFORE_MONTH[month - 1];
  if (month > 2 && isLeapYear(year)) daysSinceEpoch += 1;
  daysSinceEpoch += day - 1;

  return (
    (((daysSinceEpoch * 24 + hour) * 60 + minute) * 60 + second) * 1_000 +
    millisecond
  );
}

function getDaysInMonth(year: number, month: number) {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

function isLeapYear(year: number) {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}
