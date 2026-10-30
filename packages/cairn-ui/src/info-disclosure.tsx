import type { ComponentProps, ReactNode } from "react";
import styles from "./info-disclosure.module.css";

/** Secondary context stays available without competing with the next action. */
export function InfoDisclosure({ summary, children, className, ...props }: Omit<ComponentProps<"details">, "children"> & {
  summary: ReactNode;
  children: ReactNode;
}) {
  return <details {...props} className={[styles.disclosure, className].filter(Boolean).join(" ")} data-cairn-disclosure>
    <summary><span>{summary}</span><svg viewBox="0 0 20 20" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="m6 8 4 4 4-4" /></svg></summary>
    <div className={styles.content}>{children}</div>
  </details>;
}
