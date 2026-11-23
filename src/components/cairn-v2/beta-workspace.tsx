"use client";


import { type DomainRead } from "@/lib/cairn-v2/read-contract";
import { useBetaView } from "./use-beta-view";
import type { BetaContext } from "@/lib/cairn-v2/navigation";
import { BetaShell } from "./beta-shell";
import { BetaDetail } from "./beta-details";
import { useBetaContext } from "./use-beta-context";
import {HistoryReturnBoundary} from "./history-return-boundary";
import { HomePerformanceProvider } from "./home-performance";
import styles from "./beta.module.css";

export function BetaWorkspace({ kind, initialContext, read }: { kind: "history" | "structure"; initialContext: BetaContext; read?: DomainRead }) {
  const [context, setContext] = useBetaContext(initialContext);
  const view = useBetaView(context, read);
  return <BetaShell context={context} setContext={setContext} readView={view} workspace={kind} originalPath={kind === "history" ? "/history" : "/portfolio/structure"}>
    <div className={styles.workspacePaper}>{kind === "history" ? (
      <HomePerformanceProvider context={context} view={view} read={read}>
        <HistoryReturnBoundary context={context} view={view}>
          <BetaDetail kind={kind} view={view} context={context} historyRead={read} onAllHistoryAccounts={() => setContext({ ...context, scope: "all" })} workspace />
        </HistoryReturnBoundary>
      </HomePerformanceProvider>
    ) : <BetaDetail kind={kind} view={view} context={context} workspace />}</div>
  </BetaShell>;
}
