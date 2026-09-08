/** Request-local deferred computation. Failed computations may be retried. */
export function lazyValue<T>(calculate: () => T): () => T {
  let evaluated = false;
  let value: T;
  return () => {
    if (!evaluated) {
      value = calculate();
      evaluated = true;
    }
    return value;
  };
}
