"use client";


import { type DomainRead } from "@/lib/cairn-v2/read-contract";
import { useBetaView } from "./use-beta-view";
import type { BetaContext } from "@/lib/cairn-v2/navigation";
import { BetaShell } from "./beta-shell";
import { BetaDetail } from "./beta-details";
import { useBetaContext } from "./use-beta-context";
import {HistoryReturnBoundary} from "./history-return-boundary";
import styles from "./beta.module.css";
import { DetailHeader } from "./ui/molecules";

export function BetaWorkspace({ kind, initialContext, read }: { kind: "history" | "structure"; initialContext: BetaContext; read?: DomainRead }) {
  const [context, setContext] = useBetaContext(initialContext);
  const view = useBetaView(context, read);
  return <BetaShell context={context} setContext={setContext} readView={view} workspace={kind} originalPath={kind === "history" ? "/history" : "/portfolio/structure"}>
    <DetailHeader className={styles.workspaceIntro} title={kind === "history" ? "히스토리" : "포트 구조"} description={`${view.scopeLabel} · ${context.currency}`} />
    <div className={styles.workspacePaper}>{kind === "history" ? <HistoryReturnBoundary context={context} view={view}><BetaDetail kind={kind} view={view} context={context} workspace /></HistoryReturnBoundary> : <BetaDetail kind={kind} view={view} context={context} workspace />}</div>
  </BetaShell>;
}
