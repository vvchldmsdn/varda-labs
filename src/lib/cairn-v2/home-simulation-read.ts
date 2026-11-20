import { betaHref, type BetaContext } from './navigation';
import { simulationKey, type SimulationRead } from './simulation-contract';

export const SIMULATION_BINDING_HEADER = 'X-Cairn-Display-Binding';

export function homeSimulationRequest(context: BetaContext, epoch?: string) {
  const query = new URL(betaHref('/beta/simulation', { ...context, run: context.run ?? '1' }), 'https://cairn.invalid').searchParams;
  // Planning inputs have no authority over this read and are not needed here.
  for (const key of [...query.keys()]) if (!['mode', 'scope', 'currency', 'horizon', 'end', 'run'].includes(key)) query.delete(key);
  if (epoch) query.set('_betaRead', epoch);
  return '/beta/api/simulation?' + query;
}

export function matchesHomeSimulation(read: SimulationRead, context: BetaContext, binding: string, epoch?: string) {
  return read.displayBinding === binding && !!read.readReceipt && read.readEpoch === epoch &&
    simulationKey(read.context) === simulationKey({ ...context, run: context.run ?? '1' });
}
