"use client";

import dynamic from "next/dynamic";
import { PresentationDialog } from "@/components/presentation/presentation-dialog";
import { T } from "@/components/i18n/localized-text";
import type { CalculationGuideDefinition, GuideCopy } from "./calculation-guide-types";

const CalculationGuide = dynamic(() => import("./calculation-guide"), {
  loading: () => <p role="status"><T ko="계산 과정을 불러오고 있습니다." en="Loading the calculation guide." /></p>,
});

export function CalculationGuideDialog({ guide, title, label }: {
  guide: CalculationGuideDefinition;
  title: GuideCopy;
  label: GuideCopy;
}) {
  return <PresentationDialog label={label.ko} labelEn={label.en} title={title.ko} titleEn={title.en} mountOnOpen wide>
    <CalculationGuide guide={guide} />
  </PresentationDialog>;
}
