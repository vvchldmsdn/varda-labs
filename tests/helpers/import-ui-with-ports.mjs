import { readFileSync, existsSync } from "node:fs";
import { registerHooks } from "node:module";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = new URL("../../", import.meta.url);
let sequence = 0;

/** Compile real TSX for React SSR, replacing explicit routing/I/O ports only. */
export async function importUiWithPorts(paths, ports) {
  const registry = `__vardaUiPorts${++sequence}`;
  globalThis[registry] = ports;
  const stubs = new Map(Object.entries(ports).map(([name, values]) => [name,
    "data:text/javascript," + encodeURIComponent(Object.keys(values).map(key => key === "default"
      ? `export default globalThis[${JSON.stringify(registry)}][${JSON.stringify(name)}].default;`
      : `export const ${key}=globalThis[${JSON.stringify(registry)}][${JSON.stringify(name)}][${JSON.stringify(key)}];`).join("\n")),
  ]));
  function sourceUrl(path) {
    const url = new URL(path, root);
    if (!/\.(?:ts|tsx|css)$/.test(url.pathname)) url.pathname += existsSync(fileURLToPath(url) + ".ts") ? ".ts" : ".tsx";
    url.searchParams.set("test-ui-ports", registry);
    return url.href;
  }
  const hook = registerHooks({
    resolve(name, context, next) {
      if (!context.parentURL?.startsWith(new URL("src/", root).href) || new URL(context.parentURL).searchParams.get("test-ui-ports") !== registry) return next(name, context);
      if (stubs.has(name)) return { url: stubs.get(name), shortCircuit: true };
      if (name === "server-only") return { url: "data:text/javascript,export {};", shortCircuit: true };
      if (name.endsWith(".css")) return { url: "data:text/javascript,export default new Proxy({}, {get:(_,key)=>String(key)});", shortCircuit: true };
      if (name.startsWith("@/")) return next(sourceUrl(`src/${name.slice(2)}`), context);
      if (name.startsWith(".") && context.parentURL?.startsWith(new URL("src/", root).href)) return next(sourceUrl(new URL(name, context.parentURL).href), context);
      return next(name, context);
    },
    load(url, context, next) {
      if (url.startsWith(new URL("src/", root).href) && new URL(url).searchParams.get("test-ui-ports") === registry && /\.tsx?$/.test(new URL(url).pathname)) {
        return { format: "module", shortCircuit: true, source: ts.transpileModule(readFileSync(new URL(url), "utf8"), {
          compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
        }).outputText };
      }
      return next(url, context);
    },
  });
  try { return await Promise.all(paths.map(path => import(sourceUrl(path)))); }
  finally { hook.deregister(); delete globalThis[registry]; }
}
