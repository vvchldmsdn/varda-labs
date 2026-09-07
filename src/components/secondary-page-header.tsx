import { Suspense } from "react";
import { AppNavigation } from "@/components/app-navigation";

export function SecondaryPageHeader() {
  return <Suspense fallback={<div className="varda-nav-placeholder" />}><AppNavigation /></Suspense>;
}
