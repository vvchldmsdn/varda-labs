import { SimulationFanExplorer } from "./simulation-fan-explorer";
import type { SimulationPathHandle } from "@/lib/simulation-path-detail";
import type {
  ResearchFanChartData,
  ResearchFanChartValueDomain,
} from "./simulation-presentation";

export { resolveResearchFanChartValueDomain } from "./simulation-presentation";
export type { ResearchFanChartValueDomain } from "./simulation-presentation";

export function ResearchFanChart(props: {
  pathDetail?: SimulationPathHandle;
  pathDetailNotice?: "limit" | "storage" | "disabled";
  execution: ResearchFanChartData;
  valueDomain?: ResearchFanChartValueDomain;
  large?: boolean;
  compact?: boolean;
}) {
  return <SimulationFanExplorer key={props.pathDetail?.executionId ?? props.execution.id} {...props} />;
}
