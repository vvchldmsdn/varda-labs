import type {BetaContext} from '@/lib/cairn-v2/navigation';
import {managementHref} from '@/lib/cairn-v2/account-management-contract';
import {remainingWorkspaceHref} from '@/lib/cairn-v2/remaining-workspace-contract';
import type {TradeRecordHint} from '../../../lib/trade-record-intent';

/** Presentation-only destinations. No caller-supplied return URL is accepted. */
export function betaLedgerNavigation(context:BetaContext,epoch?:string|null,selection:TradeRecordHint={}){
 const returnTo=remainingWorkspaceHref('ledger',context,epoch,selection);
 return {signInHref:'/auth/sign-in?'+new URLSearchParams({returnTo}),accountsHref:managementHref(context,epoch)};
}
