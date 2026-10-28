import type { ComponentProps, ReactNode } from "react";
import { ValueText, type MetricTone } from "./atoms";
import styles from "./molecules.module.css";

const classes = (...values: (string | undefined)[]) => values.filter(Boolean).join(" ");

export function CardHeader({ title, actions, children, className }: {
  title: ReactNode; actions?: ReactNode; children?: ReactNode; className?: string;
}) {
  return <header className={classes(styles.cardHeader, className)} data-cairn-card-header>
    <h2 data-cairn-heading>{title}</h2>{children && <div className={styles.cardControls}>{children}</div>}
    {actions && <div className={styles.headerActions}>{actions}</div>}
  </header>;
}

export function DetailHeader({ title, eyebrow, description, actions, className, headingProps }: {
  title: ReactNode; eyebrow?: ReactNode; description?: ReactNode; actions?: ReactNode; className?: string; headingProps?: ComponentProps<"h2">;
}) {
  return <header className={classes(styles.detailHeader, className)} data-cairn-detail-header>
    <div className={styles.headingCopy}>{eyebrow && <p className={styles.eyebrow}>{eyebrow}</p>}
      <h2 {...headingProps} data-cairn-heading>{title}</h2>{description && <p className={styles.description}>{description}</p>}
    </div>{actions && <div className={styles.headerActions}>{actions}</div>}
  </header>;
}

export function SectionHeading({ title, description, actions, className }: {
  title: ReactNode; description?: ReactNode; actions?: ReactNode; className?: string;
}) {
  return <header className={classes(styles.sectionHeading, className)} data-cairn-section-heading>
    <div className={styles.headingCopy}><h3 data-cairn-heading>{title}</h3>{description && <p className={styles.description}>{description}</p>}</div>
    {actions && <div className={styles.headerActions}>{actions}</div>}
  </header>;
}

/** Use inside a MetricGroup or another dl. Values must already be formatted. */
export function Metric({ label, value, unit, note, tone = "neutral", size = "default", className }: {
  label: ReactNode; value: ReactNode; unit?: ReactNode; note?: ReactNode;
  tone?: MetricTone; size?: "default" | "hero"; className?: string;
}) {
  return <div className={classes(styles.metric, className)} data-cairn-metric data-size={size}>
    <dt>{label}</dt><dd className={styles.metricValue}><ValueText unit={unit} tone={tone}>{value}</ValueText></dd>
    {note && <dd className={styles.metricNote}>{note}</dd>}
  </div>;
}

export function MetricGroup({ children, className }: { children: ReactNode; className?: string }) {
  return <dl className={classes(styles.metricGroup, className)}>{children}</dl>;
}

export function EmptyState({ title, description, action, className }: {
  title: ReactNode; description?: ReactNode; action?: ReactNode; className?: string;
}) {
  return <div className={classes(styles.emptyState, className)} role="status">
    <p className={styles.emptyTitle}>{title}</p>
    {description && <p className={styles.description}>{description}</p>}
    {action && <div className={styles.emptyAction}>{action}</div>}
  </div>;
}
