"use client";

import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import {
  defaultContributionOrderSettings,
  projectContributionOrderPlan,
  type ContributionOrderBasis,
} from "@/lib/cairn-v2/contribution-order-plan";

const OrderContext = createContext<ReturnType<typeof useOrderProjection> | null>(null);

function useOrderProjection(basis?: ContributionOrderBasis) {
  const [settings, setSettings] = useState(defaultContributionOrderSettings);
  const projection = useMemo(() => basis ? projectContributionOrderPlan(basis, settings) : null, [basis, settings]);
  return {settings, setSettings, projection};
}

export function ContributionOrderProvider({basis, children}: {basis?: ContributionOrderBasis; children: ReactNode}) {
  return <OrderContext.Provider value={useOrderProjection(basis)}>{children}</OrderContext.Provider>;
}

export function useContributionOrderPlan(basis?: ContributionOrderBasis) {
  const shared = useContext(OrderContext);
  const local = useOrderProjection(shared ? undefined : basis);
  return shared ?? local;
}
