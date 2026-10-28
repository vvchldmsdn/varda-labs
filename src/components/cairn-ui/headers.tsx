import type { ComponentProps, ReactNode } from "react";
import styles from "./headers.module.css";
type HeaderProps = { title: ReactNode; eyebrow?: ReactNode; description?: ReactNode; actions?: ReactNode; className?: string; id?: string };
export function PageTitle({ className, ...props }: ComponentProps<"h1">) { return <h1 {...props} data-cairn-heading data-cairn-page-title className={[styles.pageTitle,className].filter(Boolean).join(" ")} />; }
export function SectionTitle({ className, level = "h2", ...props }: ComponentProps<"h2"> & { level?: "h2" | "h3" }) { const Heading=level; return <Heading {...props} data-cairn-heading data-cairn-section-title className={[styles.sectionTitle,className].filter(Boolean).join(" ")} />; }
export function PageHeader({ title, eyebrow, description, actions, className, id, level = "h1" }: HeaderProps & { level?: "h1" | "h2" }) {
  const Heading = level;
  return <header className={[styles.pageHeader, className].filter(Boolean).join(" ")} data-cairn-page-header>
    <div className={styles.copy}>{eyebrow && <p className={styles.eyebrow}>{eyebrow}</p>}<Heading id={id} data-cairn-heading>{title}</Heading>{description && <p className={styles.description}>{description}</p>}</div>
    {actions && <div className={styles.actions}>{actions}</div>}
  </header>;
}
export function SectionHeader({ title, description, actions, className, id, level = "h2" }: HeaderProps & { level?: "h2" | "h3" }) {
  const Heading = level;
  return <header className={[styles.sectionHeader, className].filter(Boolean).join(" ")} data-cairn-section-header><div className={styles.copy}><Heading id={id} data-cairn-heading>{title}</Heading>{description && <p className={styles.description}>{description}</p>}</div>{actions && <div className={styles.actions}>{actions}</div>}</header>;
}
