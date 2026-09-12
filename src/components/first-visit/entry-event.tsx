"use client";
import { useEffect } from "react";
import { trackFirstVisit, type FirstVisitEvent } from "@/lib/first-visit-events";
export function EntryEvent({ event = "entry_view" }: { event?: FirstVisitEvent }) { useEffect(() => { trackFirstVisit(event); }, [event]); return null; }
