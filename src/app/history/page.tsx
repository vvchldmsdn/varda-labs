import { HistoryView } from "@/components/history/history-view";
import { getReadOnlyHistoryBalance } from "@/db/queries/history-balance";
import {
  normalizeHistoryAccount,
  normalizeHistoryLane,
} from "@/lib/history-balance";
import { normalizeHistoryPositionSelection } from "@/lib/history-position-detail";

export const dynamic = "force-dynamic";

type HistoryPageProps = {
  searchParams: Promise<{
    account?: string | string[];
    lane?: string | string[];
    positionDate?: string | string[];
    positionSource?: string | string[];
  }>;
};

export default async function HistoryPage({ searchParams }: HistoryPageProps) {
  const params = await searchParams;
  const account = normalizeHistoryAccount(params.account);
  const lane = normalizeHistoryLane(params.lane);
  const positionSelection = normalizeHistoryPositionSelection({
    account,
    lane,
    positionDate: params.positionDate,
    positionSource: params.positionSource,
  });
  const history = await getReadOnlyHistoryBalance({
    account,
    lane,
    positionSelection,
  });

  return <HistoryView history={history} />;
}
