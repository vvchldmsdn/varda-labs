import { AsyncLocalStorage } from "node:async_hooks";
/** Server process context only, never accepted from a request body. */
export const snapshotFence = new AsyncLocalStorage<{ id:string; generation:number }>();
export const snapshotDeadline = new AsyncLocalStorage<number>();
