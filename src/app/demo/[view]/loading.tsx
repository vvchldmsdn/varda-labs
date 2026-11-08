
import { Status as CairnStatus } from "@/components/cairn-ui";
import { T } from "@/components/i18n/localized-text";
export default function Loading() { return <CairnStatus as="p" tone="neutral" className="p-8 text-[var(--muted)]" role="status"><T ko="샘플 화면을 준비하고 있어요…" en="Preparing the sample…" /></CairnStatus>; }
