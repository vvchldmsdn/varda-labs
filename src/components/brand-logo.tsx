import styles from "./brand-logo.module.css";

/** Three balanced stones: a small, legible wayfinding mark. */
export function BrandLogo({ stacked = false }: { stacked?: boolean }) {
  return <span className={`${styles.lockup} ${stacked ? styles.stacked : ""}`} role="img" aria-label="Cairn Labs">
    <svg className={styles.mark} viewBox="0 0 40 40" fill="none" aria-hidden="true" focusable="false">
      <path d="M9 28C12 26 28 26 32 28C35 30 35 34 31 35H9C5 34 5 30 9 28Z" fill="currentColor" />
      <path d="M12 17C15 15 25 15 29 18C32 20 30 24 27 24H12C8 24 8 20 12 17Z" fill="currentColor" />
      <path d="M19 4C22 3 27 6 27 9C27 12 23 13 18 13C14 13 13 10 15 7L19 4Z" fill="var(--brand, #c44821)" />
    </svg>
    <span className={styles.word}>cairn<span className={styles.labs}>labs</span></span>
  </span>;
}
