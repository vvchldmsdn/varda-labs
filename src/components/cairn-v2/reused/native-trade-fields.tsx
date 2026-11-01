"use client";
import { TradeExecutionFields } from "@/components/native-trade-fields";
import { useI18n } from "./native-locale";
import styles from "./native-ledger-view.module.css";
import type { Currency } from "@/lib/money";
export function NativeTradeFields(props: {kind:"buy"|"sell";fields:Record<string,string>;unit:Currency;quantity:string;edit:(key:string,value:string)=>void}) {
  const i18n = useI18n();
  return <TradeExecutionFields {...props} {...i18n} styles={styles} />;
}
