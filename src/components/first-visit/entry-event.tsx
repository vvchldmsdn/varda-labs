"use client";
import { useEffect } from "react";
import { trackFirstVisit } from "@/lib/first-visit-events";
export function EntryEvent() { useEffect(() => { trackFirstVisit("entry_view"); }, []); return null; }
