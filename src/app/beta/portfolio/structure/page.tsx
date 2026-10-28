import { getBetaDomainRead } from "@/lib/cairn-v2/server-read";
import { requireBetaFixtureAccess, prepareBetaPageParams } from "@/lib/cairn-v2/server-access";
import { normalizeBetaContext } from "@/lib/cairn-v2/navigation";
import { BetaWorkspace } from "@/components/cairn-v2/beta-workspace";
export default async function BetaStructure({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireBetaFixtureAccess();
  const params = await prepareBetaPageParams(await searchParams, '/beta/portfolio/structure');
  const read = params.mode !== undefined ? await getBetaDomainRead(params) : undefined;
  return <BetaWorkspace kind="structure" initialContext={read?.context ?? normalizeBetaContext(params)} read={read} />;
}
