import type {SimulationPriceFrontier} from '@/lib/shared-domain/market-data/kis-history-finalization';
import {Status} from '@/components/cairn-ui';
import {SimulationText} from './simulation-text';
import styles from './simulation-price-evidence.module.css';

export function SimulationPriceEvidence({frontier,latest}:{frontier:SimulationPriceFrontier|null|undefined;latest:boolean}) {
 if(!frontier)return null;
 return <Status role="note" className={styles.evidence} data-price-frontier={frontier.status}>
  <p><strong><SimulationText ko={latest?'최신 확인 종가':'사용한 확인 종가'} en={latest?'Latest verified close':'Verified close used'}/></strong><span>{frontier.usTradeDate&&<><SimulationText ko="미국 거래일" en="US trade date"/> {frontier.usTradeDate} · </>}<SimulationText ko="관측 기준" en="Observation date"/> {frontier.serviceDate}</span></p>
  {frontier.status==='provider_pending'&&frontier.pendingUsTradeDate&&<details><summary><SimulationText ko="최근 종가 갱신 안내" en="Latest close update"/></summary><p><SimulationText ko={`${frontier.pendingUsTradeDate} 미국 일봉은 공급자에서 갱신 중이어서 제외했습니다. 확정된 종가가 수집되면 최신 기준에 반영합니다.`} en={`The provider is still updating the ${frontier.pendingUsTradeDate} US daily bar, so it is excluded. The latest basis will include it after the finalized close is collected.`}/></p></details>}
 </Status>;
}
