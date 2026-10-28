import {buildPrivateOwnerRawHistory} from './simulation-private-owner-raw-history.ts';
import {isRiskDate,shiftRiskDate} from './portfolio-risk-calendar.ts';
/** Suggest a verified window; never changes an explicit or default requested end. */
export function findVerifiedHistoricalWindow(input:Parameters<typeof buildPrivateOwnerRawHistory>[0]):string|null {
 if(!isRiskDate(input.requestedEndServiceDate))return null;
 for(let offset=1;offset<=30;offset++){
  const requestedEndServiceDate=shiftRiskDate(input.requestedEndServiceDate,-offset);
  const result=buildPrivateOwnerRawHistory({...input,requireAdjusted:true,requestedEndServiceDate});
  if(result.status==='ready'&&result.matrix?.status==='ready')return requestedEndServiceDate;
 }
 return null;
}
