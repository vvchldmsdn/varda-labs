import { Suspense } from "react";
import { AppNavigation } from "@/components/app-navigation";

export function SecondaryPageHeader({ researchHref }: { researchHref?: string } = {}) {
  return <Suspense fallback={<div className="varda-nav-placeholder" />}><AppNavigation researchHref={researchHref} /></Suspense>;
}
