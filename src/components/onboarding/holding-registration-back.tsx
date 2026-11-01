"use client";
import { useSearchParams } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { RecoveryJourneyLink } from "@/components/recovery/recovery-return";
import { useI18n } from "@/components/i18n/locale-provider";
import { accountContextHref } from "@/lib/portfolio-navigation-context";

export function HoldingRegistrationBack({ initialAccountId, preview }: { initialAccountId: string; preview: boolean }) {
  const params = useSearchParams(), { t } = useI18n();
  const account = params.get("accountId") ?? (params.get("scope")?.startsWith("account:") ? params.get("scope")!.slice(8) : initialAccountId);
  return <RecoveryJourneyLink className="varda-holding-add-back" href={preview ? "/portfolio/onboarding?preview=design&step=holding" : accountContextHref("/portfolio/holdings", account, params.get("currency") ?? undefined)}><ArrowLeft size={15} />{t("돌아가기", "Back")}</RecoveryJourneyLink>;
}
