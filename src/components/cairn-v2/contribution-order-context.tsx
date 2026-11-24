"use client";

import { createContext, useContext, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import {
  defaultContributionOrderSettings,
  projectContributionOrderPlan,
  type ContributionOrderBasis,
  type ContributionOrderOption,
  type ContributionOrderSettings,
} from "@/lib/cairn-v2/contribution-order-plan";
import { encodeFractionalPreferences, decodeFractionalPreferences } from "@/lib/cairn-v2/contribution-order-preferences";
import type { Currency } from "@/lib/money";

const OrderContext = createContext<ReturnType<typeof useOrderProjection> | null>(null);

const noOptions: readonly ContributionOrderOption[] = [];
const emptySnapshot = () => "";
const unsubscribeNothing = () => {};
const subscribeNothing = () => unsubscribeNothing;
const subscribeStorage = (notify: () => void) => {
  window.addEventListener("storage", notify);
  return () => window.removeEventListener("storage", notify);
};

function useOrderProjection(basis?: ContributionOrderBasis, storageKey?: string, options = noOptions) {
  const stored = useSyncExternalStore(storageKey ? subscribeStorage : subscribeNothing, () => {
    try { return storageKey ? window.localStorage.getItem(storageKey) ?? "" : ""; } catch { return ""; }
  }, emptySnapshot);
  const restored = useMemo(() => ({...defaultContributionOrderSettings,
    rules: decodeFractionalPreferences(stored, options)}), [stored, options]);
  const [current, setCurrent] = useState<ContributionOrderSettings | null>(null);
  const settings = current ?? restored;
  function setSettings(next: ContributionOrderSettings) {
    setCurrent(next);
    if (storageKey && options.length) {
      try { window.localStorage.setItem(storageKey, encodeFractionalPreferences(next.rules, options)); }
      catch { /* Browser storage can be disabled. The current calculation still uses these terms. */ }
    }
  }
  const projection = useMemo(() => basis ? projectContributionOrderPlan(basis, settings) : null, [basis, settings]);
  return {settings, setSettings, projection};
}

export function ContributionOrderProvider({basis, options, binding, scope, currency, children}: {
  basis?: ContributionOrderBasis; options?: readonly ContributionOrderOption[]; binding?: string;
  scope?: string; currency?: Currency; children: ReactNode;
}) {
  const storageKey = binding && scope && currency
    ? "cairn:order-capabilities:v1:" + JSON.stringify([binding, scope, currency]) : undefined;
  return <OrderContext.Provider value={useOrderProjection(basis, storageKey, options)}>{children}</OrderContext.Provider>;
}

export function useContributionOrderPlan(basis?: ContributionOrderBasis) {
  const shared = useContext(OrderContext);
  const local = useOrderProjection(shared ? undefined : basis);
  return shared ?? local;
}
