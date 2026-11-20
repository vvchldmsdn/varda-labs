export const LAZY_READ_TIMEOUT_MS = 30_000;

/** Bound the whole read, including JSON decoding. A provider/fetch adapter that
 * ignores abort cannot keep the UI pending or publish a late result. Cleanup
 * cancels the request; callers suppress cancellation errors after unmount. */
export function startBoundedRead<T>(read: (signal: AbortSignal) => Promise<T>) {
  const controller = new AbortController();
  let rejectBoundary: (error: Error) => void = () => {};
  const boundary = new Promise<T>((_resolve, reject) => { rejectBoundary = reject; });
  const timer = setTimeout(() => {
    controller.abort();
    rejectBoundary(new Error('read_timeout'));
  }, LAZY_READ_TIMEOUT_MS);
  const pending = (async () => read(controller.signal))();
  const promise = Promise.race([pending, boundary]).finally(() => clearTimeout(timer));
  return {
    promise,
    cancel() {
      clearTimeout(timer);
      controller.abort();
      rejectBoundary(new Error('read_cancelled'));
    },
  };
}
