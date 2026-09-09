export type GuideCopy = { ko: string; en: string };

export type CalculationGuideDefinition = {
  id: string;
  intro: GuideCopy;
  steps: readonly {
    id: string;
    label: GuideCopy;
    title: GuideCopy;
    body: GuideCopy;
    nodes: readonly { label: GuideCopy; detail?: GuideCopy }[];
    takeAway: GuideCopy;
    example?: { label: GuideCopy; body: GuideCopy };
    detail?: GuideCopy;
  }[];
  notes?: readonly { title: GuideCopy; body: GuideCopy }[];
  footnote?: GuideCopy;
};
