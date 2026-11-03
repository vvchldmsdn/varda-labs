import { BrandLogo } from "@/components/brand-logo";
import { ManagementText } from "@/components/i18n/management-text";
import beta from "@/components/cairn-v2/beta.module.css";
import styles from "./loading.module.css";

/** Safe before session admission: no account names, financial values or links. */
export default function BetaLoading() {
  return <main className={`${beta.scope} ${beta.shell} ${styles.loading}`} aria-busy="true" data-beta-loading>
    <BrandLogo />
    <div className={styles.status} role="status">
      <p><ManagementText>화면을 준비하고 있어요</ManagementText></p>
      <div className={styles.placeholder} aria-hidden="true" />
    </div>
  </main>;
}
