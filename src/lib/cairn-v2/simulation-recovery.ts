import type { OwnerSimulationModel } from './simulation-contract';

/** Display only: preserve the admitted read's causes without altering execution admission. */
export function simulationRecoveryReasons(model: OwnerSimulationModel | null): string[] {
  if (!model || model.execution.status === 'ready') return [];
  return [...new Set([
    ...(model.execution.reason ? [model.execution.reason] : []),
    ...model.candidate.blockers,
    ...model.candidate.instruments.flatMap(row => [
      ...(row.admissionStatus && row.admissionStatus !== 'ready' ? [row.admissionStatus] : []),
      ...strings(row.storedCoverage.reasons),
      ...strings(row.provenance.issues),
    ]),
  ])];
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}
