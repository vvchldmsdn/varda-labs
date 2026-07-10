import { HistoryView } from "@/components/history/history-view";
import { getReadOnlyHistoryBalance } from "@/db/queries/history-balance";
import {
  normalizeHistoryAccount,
  normalizeHistoryLane,
} from "@/lib/history-balance";

export const dynamic = "force-dynamic";

type HistoryPageProps = {
  searchParams: Promise<{
    account?: string | string[];
    lane?: string | string[];
  }>;
};

export default async function HistoryPage({ searchParams }: HistoryPageProps) {
  const params = await searchParams;
  const account = normalizeHistoryAccount(params.account);
  const lane = normalizeHistoryLane(params.lane);
  const history = await getReadOnlyHistoryBalance({ account, lane });

  return <HistoryView history={history} />;
}
