import {
  KODEX_VOO_FIXED_MIX_SELECTION_POLICY,
  resolveKodexVooFixedMixSelection,
  type KodexVooFixedMixSelection,
} from "./kodex-voo-fixed-mix-selection.ts";

export const INVESTMENT_LAB_FIXED_MIX_SELECTION_POLICY =
  KODEX_VOO_FIXED_MIX_SELECTION_POLICY;

export type InvestmentLabFixedMixSelection = KodexVooFixedMixSelection;

export const resolveInvestmentLabFixedMixSelection =
  resolveKodexVooFixedMixSelection;
