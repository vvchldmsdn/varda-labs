import type { ComponentProps, ReactNode } from "react";
import styles from "./atoms.module.css";

export type MetricTone = "neutral" | "positive" | "negative" | "muted";

export function IconButton({
  label, children, className, type = "button", ...props
}: Omit<ComponentProps<"button">, "aria-label"> & { label: string; children: ReactNode }) {
  return <button {...props} type={type} aria-label={label} className={[styles.iconButton, className].filter(Boolean).join(" ")}>{children}</button>;
}

export function StatusPill({ children, tone = "neutral", className }: {
  children: ReactNode; tone?: MetricTone; className?: string;
}) {
  return <span className={[styles.statusPill, className].filter(Boolean).join(" ")} data-tone={tone}>{children}</span>;
}

export function ValueText({ children, unit, tone = "neutral", className }: {
  children: ReactNode; unit?: ReactNode; tone?: MetricTone; className?: string;
}) {
  return <span className={[styles.value, className].filter(Boolean).join(" ")} data-tone={tone}>{children}{unit && <small>{unit}</small>}</span>;
}
