type ScrollLockTarget = { style: { overflow: string } };

const locks = new WeakMap<
  ScrollLockTarget,
  { count: number; previousOverflow: string }
>();

/** Keep the original overflow until every modal owning this body has closed. */
export function acquireBodyScrollLock(target: ScrollLockTarget): () => void {
  const existing = locks.get(target);
  const lock = existing ?? {
    count: 0,
    previousOverflow: target.style.overflow,
  };
  lock.count += 1;
  locks.set(target, lock);
  target.style.overflow = "hidden";

  let released = false;
  return () => {
    if (released) return;
    released = true;
    lock.count -= 1;
    if (lock.count === 0) {
      target.style.overflow = lock.previousOverflow;
      locks.delete(target);
    }
  };
}
