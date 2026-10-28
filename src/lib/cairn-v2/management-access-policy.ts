import { betaFixtureAccessAllowed } from './access-policy.ts';

// The preserved writer predates the candidate's native-ledger safeguards.
// Until backend source parity is resolved, its new frontend is synthetic-only.
// This URL cannot connect to a real database; it does not authorize a user.
export function betaManagementAccessAllowed(input: Parameters<typeof betaFixtureAccessAllowed>[0] & {
  databaseUrl?: string; liveReadOnly?: string;
}) {
  return input.databaseUrl === 'postgresql://synthetic:synthetic@127.0.0.1:1/synthetic'
    && input.liveReadOnly !== '1'
    && betaFixtureAccessAllowed(input);
}
