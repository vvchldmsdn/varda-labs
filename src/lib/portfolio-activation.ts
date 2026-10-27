import { parseQuickDraft, QUICK_STORAGE_KEY, type QuickDraft } from "./quick-portfolio.ts";

export const ACTIVATION_STORAGE_KEY = "varda.portfolio-activation.v1";
export type ActivationIntent = { version: 1; draftId: string; expiresAt: number; sessionKey: string | null };

// A navigation cookie alone never authorizes saving. A matching, unexpired,
// explicitly requested personal draft is required, then bound to one session identity.
export function activationIntent(draft: QuickDraft): ActivationIntent {
  return { version: 1, draftId: draft.id, expiresAt: draft.expiresAt, sessionKey: null };
}

export function parseActivationIntent(raw: string | null, draftRaw: string | null, now = Date.now()) {
  try {
    const intent = JSON.parse(raw ?? "null");
    const draft = parseQuickDraft(draftRaw, now);
    if (!draft || intent?.version !== 1 || intent.draftId !== draft.id || intent.expiresAt !== draft.expiresAt ||
      !(intent.sessionKey === null || /^[a-f0-9]{64}$/.test(intent.sessionKey))) return null;
    return { intent: intent as ActivationIntent, draft };
  } catch { return null; }
}

/** Recheck after async authentication before touching the shared browser draft. */
export function bindCurrentActivationIntent(
  storage: Pick<Storage, "getItem" | "setItem">,
  expected: { intent: ActivationIntent; draft: QuickDraft },
  sessionKey: string,
  now = Date.now(),
): boolean {
  const current = parseActivationIntent(storage.getItem(ACTIVATION_STORAGE_KEY), storage.getItem(QUICK_STORAGE_KEY), now);
  if (!current || current.draft.id !== expected.draft.id || current.draft.expiresAt !== expected.draft.expiresAt ||
    !/^[a-f0-9]{64}$/.test(sessionKey) ||
    (current.intent.sessionKey !== null && current.intent.sessionKey !== sessionKey)) return false;
  storage.setItem(ACTIVATION_STORAGE_KEY, JSON.stringify({ ...current.intent, sessionKey }));
  return true;
}
