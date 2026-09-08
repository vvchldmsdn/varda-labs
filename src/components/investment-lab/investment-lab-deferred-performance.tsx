"use client";
import dynamic from "next/dynamic";
const Details = dynamic(() => import("./investment-lab-performance-resource"), { loading: () => <p role="status" className="py-4 text-sm">계산 근거를 불러오고 있습니다.</p> });
/** Mounted by the already-open performance dialog, never by its closed shell. */
export function InvestmentLabDeferredPerformance() { return <Details />; }
