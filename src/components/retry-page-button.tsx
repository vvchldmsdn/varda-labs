"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { useI18n } from "@/components/i18n/locale-provider";

export function RetryPageButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const { t } = useI18n();
  return (
    <button
      type="button"
      className="varda-action mt-5 min-h-11"
      disabled={pending}
      aria-busy={pending}
      onClick={() => startTransition(() => router.refresh())}
    >
      {pending ? t("다시 확인 중…", "Checking again…") : t("다시 시도", "Try again")}
    </button>
  );
}
