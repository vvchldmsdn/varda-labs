import type { ReactNode } from "react";
import { T } from "@/components/i18n/localized-text";
import styles from "./investment-lab-explanation.module.css";

type Copy = Readonly<{ ko: string; en: string }>;

/** Native disclosure retains server-rendered evidence and needs no extra data request. */
export function InvestmentLabEvidenceGroup({ title, description, children, open = false }: {
  title: Copy;
  description: Copy;
  children: ReactNode;
  open?: boolean;
}) {
  return <details className={styles.evidenceGroup} open={open}>
    <summary><span><strong><T {...title} /></strong><span><T {...description} /></span></span><i aria-hidden="true">+</i></summary>
    <div className={styles.evidenceBody}>{children}</div>
  </details>;
}
