import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import ts from "typescript";

const root = new URL("../../", import.meta.url);
let sequence = 0;

/** Import unchanged server code while replacing explicit I/O boundaries only. */
export async function importWithPorts(paths, ports) {
  const registry = `__vardaTestPorts${++sequence}`;
  globalThis[registry] = ports;
  const stubs = new Map(Object.entries(ports).map(([specifier, exports]) => [
    specifier,
    "data:text/javascript," + encodeURIComponent(Object.keys(exports).map(
      (name) => `export const ${name}=globalThis[${JSON.stringify(registry)}][${JSON.stringify(specifier)}][${JSON.stringify(name)}];`,
    ).join("\n")),
  ]));
  const sourceUrl = (path) => {
    const url = new URL(path, root);
    url.searchParams.set("test-ports", registry);
    return url.href;
  };
  const hook = registerHooks({
    resolve(specifier, context, nextResolve) {
      if (specifier === "server-only") return { url: "data:text/javascript,export {};", shortCircuit: true };
      if (stubs.has(specifier)) return { url: stubs.get(specifier), shortCircuit: true };
      if (specifier.startsWith("@/")) return nextResolve(sourceUrl(`src/${specifier.slice(2)}.ts`), context);
      if ((specifier.startsWith("./") || specifier.startsWith("../")) && context.parentURL?.startsWith(new URL("src/", root).href)) {
        const url = new URL(specifier, context.parentURL);
        if (!/\.[a-z]+$/.test(url.pathname)) url.pathname += ".ts";
        url.searchParams.set("test-ports", registry);
        return nextResolve(url.href, context);
      }
      return nextResolve(specifier, context);
    },
    load(url, context, nextLoad) {
      if (url.startsWith(new URL("src/", root).href) && new URL(url).pathname.endsWith(".ts")) {
        return {
          format: "module", shortCircuit: true,
          source: ts.transpileModule(readFileSync(new URL(url), "utf8"), {
            compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
          }).outputText,
        };
      }
      return nextLoad(url, context);
    },
  });
  try {
    return await Promise.all(paths.map((path) => import(sourceUrl(path))));
  } finally {
    hook.deregister();
    delete globalThis[registry];
  }
}
