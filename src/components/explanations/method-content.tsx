"use client";

import MethodExplorer from "./method-explorer";
import { investmentLabMethod } from "./investment-lab-method";
import { simulationMethod } from "./simulation-method";
import { contributionMethod } from "./contribution-method";
import { movementMethod, riskMethod } from "./portfolio-methods";
import type { MethodGuide, MethodTopic } from "./method-types";

const guides: Record<MethodTopic, MethodGuide> = {
  "investment-lab": investmentLabMethod,
  simulation: simulationMethod,
  contribution: contributionMethod,
  movement: movementMethod,
  risk: riskMethod,
};

export default function MethodContent({ topic }: { topic: MethodTopic }) {
  return <MethodExplorer guide={guides[topic]} />;
}
