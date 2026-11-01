"use client";

import { Button, InfoDisclosure } from "@/components/cairn-ui";
import { useI18n } from "@/components/i18n/locale-provider";

/** Used inside both target forms; the existing scoped action validates the revision. */
export function TargetApprovalControls({ revision, pending, disabled = false }: { revision: number; pending: boolean; disabled?: boolean }) {
  const { t } = useI18n();
  if (revision <= 0) return <p>{t("초안 · 저장하면 계산에 적용돼요.", "Draft · Save to use these targets in calculations.")}</p>;
  return <InfoDisclosure summary={t("승인 목표 관리", "Manage approved targets")}>
    <p>{t("승인을 해제하면 목표 없는 상태로 돌아갑니다. 이전 승인 기록과 저장한 계획은 유지돼요.", "Remove the active approval to return to no targets. Previous approvals and saved plans are preserved.")}</p>
    <Button type="submit" name="intent" value="revoke" formNoValidate variant="secondary" disabled={pending || disabled}>
      {t("목표 승인 해제", "Remove target approval")}
    </Button>
  </InfoDisclosure>;
}
