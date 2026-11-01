'use client';

import { useMemo, useState, useSyncExternalStore } from 'react';
import { safeRecoveryUrl } from '@/lib/recovery-navigation';

const changed = 'cairn:ui-draft';
const subscribe = (notify: () => void) => {
  window.addEventListener('popstate', notify);
  window.addEventListener(changed, notify);
  return () => { window.removeEventListener('popstate', notify); window.removeEventListener(changed, notify); };
};
const snapshot = () => location.pathname + location.search;
const serverSnapshot = () => '';
const canonical = (value: unknown): string => JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item)
  ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);

/** Editable hints live in this history entry, never in financial records or a shared user store. */
export function useNavigationDraft<T>({ initial, path, scope, read, write }: {
  initial: T; path: string | null; scope?: string;
  read: (query: URLSearchParams) => T | null;
  write: (value: T) => Record<string, string>;
}) {
  const [local, setLocal] = useState<{ value: T; rejectedAt: string | null }>({ value: initial, rejectedAt: null });
  const address = useSyncExternalStore(subscribe, snapshot, serverSnapshot);
  const url = address ? new URL(address, 'https://cairn.invalid') : null;
  const admitted = url?.pathname === path && url.searchParams.getAll('scope').length <= 1 && (url.searchParams.get('scope') ?? 'all') === (scope ?? 'all');
  const notPreserved = local.rejectedAt !== null && local.rejectedAt === address;
  const value = notPreserved ? local.value : admitted ? read(url.searchParams) ?? initial : local.value;
  // Stable array identities prevent a URL read from restarting calculations on every render.
  const serialized = JSON.stringify(value);
  const stableValue = useMemo(() => JSON.parse(serialized) as T, [serialized]);
  function update(next: T) {
    // Standalone saved-input research has its own identity lifecycle, not an
    // account continuation URL. Preserve its existing local editing behavior.
    if (path === null || typeof window === 'undefined') { setLocal({ value: next, rejectedAt: null }); return; }
    const current = new URL(location.href);
    // A late event from an old account/surface must not overwrite the new URL.
    if (current.pathname !== path || current.searchParams.getAll('scope').length > 1 || (current.searchParams.get('scope') ?? 'all') !== (scope ?? 'all')) {
      setLocal({ value: next, rejectedAt: current.pathname + current.search }); return;
    }
    const previous = current.pathname + current.search;
    for (const [key, item] of Object.entries(write(next))) current.searchParams.set(key, item);
    const href = current.pathname + current.search;
    // Limits/normalization must not silently revert edits. Keep an unsaved local
    // draft, and let the caller disclose that navigation cannot retain it.
    if (!safeRecoveryUrl(href) || canonical(read(current.searchParams)) !== canonical(next)) {
      setLocal({ value: next, rejectedAt: previous }); return;
    }
    try {
      // Native history integrates with Next without a server read on each keystroke.
      window.history.replaceState(null, '', href + current.hash);
      setLocal({ value: next, rejectedAt: null });
      window.dispatchEvent(new Event(changed));
    } catch { setLocal({ value: next, rejectedAt: previous }); }
  }
  return [stableValue, update, notPreserved] as const;
}
