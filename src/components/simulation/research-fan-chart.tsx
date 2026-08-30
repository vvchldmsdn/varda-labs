import { SimulationFanExplorer } from "./simulation-fan-explorer";
import type {
  ResearchFanChartData,
  ResearchFanChartValueDomain,
} from "./simulation-presentation";

export { resolveResearchFanChartValueDomain } from "./simulation-presentation";
export type { ResearchFanChartValueDomain } from "./simulation-presentation";

export function ResearchFanChart(props: {
  execution: ResearchFanChartData;
  valueDomain?: ResearchFanChartValueDomain;
  large?: boolean;
}) {
  return <SimulationFanExplorer key={props.execution.id} {...props} />;
}
