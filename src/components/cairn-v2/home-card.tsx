"use client";

import type { MouseEvent, ReactNode } from "react";
import { CardHeader } from "./ui/molecules";
import { IconButton } from "./ui/atoms";
import { cardTitles, type CardKind } from "./card-definition";
import styles from "./beta.module.css";

/** The common home card owns heading, expansion, and keyboard target geometry. */
export function HomeCard({
  kind,
  className,
  children,
  controls,
  onOpen,
  minimal = false,
}: {
  kind: CardKind;
  className?: string;
  children: ReactNode;
  controls?: ReactNode;
  onOpen: (kind: CardKind, trigger: HTMLElement) => void;
  minimal?: boolean;
}) {
  const activate = (event: MouseEvent<HTMLElement>) => {
    if ((event.target as Element).closest("button,a,input,select,summary,[role=button]")) return;
    const trigger = event.currentTarget.querySelector<HTMLButtonElement>("[data-expand]");
    if (trigger) onOpen(kind, trigger);
  };
  return (
    <section
      className={`${styles.card} ${styles[kind]} ${className ?? ""}`}
      data-beta-card={kind}
      data-minimal={minimal || undefined}
      onClick={activate}
    >
      <CardHeader
        className={styles.cardHeader}
        title={
          minimal ? (
            <span className={styles.visuallyHidden}>{cardTitles[kind]}</span>
          ) : (
            <button
              id={kind === "contribution" ? "beta-contribution" : undefined}
              type="button"
              onClick={(event) => onOpen(kind, event.currentTarget)}
            >
              {cardTitles[kind]}
            </button>
          )
        }
        actions={
          <IconButton
            label={`${cardTitles[kind]} 확대`}
            data-expand
            onClick={(event) => onOpen(kind, event.currentTarget)}
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.4"
              aria-hidden="true"
            >
              <path d="M14 4h6v6M20 4l-7 7M10 20H4v-6M4 20l7-7" />
            </svg>
          </IconButton>
        }
      >
        {controls}
      </CardHeader>
      {children}
    </section>
  );
}
