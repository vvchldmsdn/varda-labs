import {redirect} from "next/navigation";
import {defaultHomeContributionHref,readBetaHome} from "@/lib/cairn-v2/home-read";
import {getBetaSimulationRead} from "@/lib/cairn-v2/server-simulation";
import { getBetaDomainRead } from "@/lib/cairn-v2/server-read";
import { requireBetaFixtureAccess, prepareBetaPageParams } from "@/lib/cairn-v2/server-access";
import { normalizeBetaContext } from "@/lib/cairn-v2/navigation";
import { BetaHome } from "@/components/cairn-v2/beta-home";

export default async function BetaPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireBetaFixtureAccess();
  const params = await prepareBetaPageParams(await searchParams, '/beta');
  const defaultHref=defaultHomeContributionHref(params);
  if(defaultHref)redirect(defaultHref);
  const result=params.mode!==undefined?await readBetaHome(params,{domain:getBetaDomainRead,simulation:getBetaSimulationRead}):undefined;
  const read=result?.read;
  return <BetaHome initialContext={read?.context ?? normalizeBetaContext(params)} read={read} simulationPromise={result?.simulationPromise} />;
}
