"use client";
import { createContext, useContext, useState, type ReactNode } from "react";
import { Status as CairnStatus } from "@/components/cairn-ui";

type Selection = { keys: string[]; dirty: boolean; choose:(keys:string[])=>void };
const Context=createContext<Selection|null>(null);
export function SaleSelectionProvider({scopeKey,committed=[],children}:{scopeKey:string;committed?:readonly string[];children:ReactNode}) {
  const key=JSON.stringify([scopeKey,committed]);
  const [draft,setDraft]=useState({key,keys:[...committed]});
  const keys=draft.key===key?draft.keys:[...committed];
  return <Context.Provider value={{keys,dirty:JSON.stringify(keys)!==JSON.stringify(committed),choose:next=>setDraft({key,keys:next})}}>{children}</Context.Provider>;
}
export function useSaleSelection(){return useContext(Context);}
export function SaleSelectionResultGate({children}:{children:ReactNode}){const selection=useSaleSelection();return selection?.dirty?<CairnStatus as="p" tone="neutral" role="status">매도 제외 선택 변경 · 다시 계산해 주세요. 이전 결과는 표시하지 않습니다.</CairnStatus>:children;}
