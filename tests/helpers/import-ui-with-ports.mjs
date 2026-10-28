import { readFileSync, existsSync } from "node:fs";
import { registerHooks } from "node:module";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import * as React from "react";
import * as jsxRuntime from "react/jsx-runtime";

const primitive = Symbol.for("cairn.test.pure-ui-primitive");
const renderPrimitive = factory => (type, props, key) => {
  if (typeof type !== "function" || !type[primitive]) return factory(type, props, key);
  const rendered = type(props ?? {});
  return key !== undefined && React.isValidElement(rendered) ? React.cloneElement(rendered, { key }) : rendered;
};

const root = new URL("../../", import.meta.url);
let sequence = 0;

/** Compile real TSX for React SSR, replacing explicit routing/I/O ports only. */
export async function importUiWithPorts(paths, ports) {
  // Hook fixtures replace state/lifecycle methods, not React's element primitives.
  // Expand only the actual stateless UI primitives so shallow interaction
  // fixtures keep inspecting DOM controls after their extraction into atoms.
  ports = { ...ports, ...(ports.react ? {
    "react/jsx-runtime": { ...jsxRuntime, jsx: renderPrimitive(jsxRuntime.jsx), jsxs: renderPrimitive(jsxRuntime.jsxs) },
    react: { ...React, ...ports.react },
  } : {}) };
  const registry = `__vardaUiPorts${++sequence}`;
  globalThis[registry] = ports;
  const stubs = new Map(Object.entries(ports).map(([name, values]) => [name,
    "data:text/javascript," + encodeURIComponent(Object.keys(values).filter(key => /^[A-Za-z_$][\w$]*$/.test(key)).map(key => key === "default"
      ? `export default globalThis[${JSON.stringify(registry)}][${JSON.stringify(name)}].default;`
      : `export const ${key}=globalThis[${JSON.stringify(registry)}][${JSON.stringify(name)}][${JSON.stringify(key)}];`).join("\n")),
  ]));
  function sourceUrl(path) {
    const url = new URL(path, root);
    if (!/\.(?:ts|tsx|css)$/.test(url.pathname)) {
      const suffix = [".ts", ".tsx", "/index.ts", "/index.tsx"].find(candidate => existsSync(fileURLToPath(url) + candidate));
      if (!suffix) throw new Error(`UI module missing: ${url.pathname}`);
      url.pathname += suffix;
    }
    url.searchParams.set("test-ui-ports", registry);
    return url.href;
  }
  const hook = registerHooks({
    resolve(name, context, next) {
      if (!context.parentURL?.startsWith(new URL("src/", root).href) || new URL(context.parentURL).searchParams.get("test-ui-ports") !== registry) return next(name, context);
      const canonical = name.startsWith(".") ? "@/" + new URL(name, context.parentURL).pathname.slice(new URL("src/", root).pathname.length).replace(/\.(ts|tsx)$/, "") : name.replace(/\.(ts|tsx)$/, "");
      if (stubs.has(canonical)) return { url: stubs.get(canonical), shortCircuit: true };
      if (stubs.has(name)) return { url: stubs.get(name), shortCircuit: true };
      if (name === "server-only") return { url: "data:text/javascript,export {};", shortCircuit: true };
      if (name.endsWith(".css")) return { url: "data:text/javascript,export default new Proxy({}, {get:(_,key)=>String(key)});", shortCircuit: true };
      if (name.startsWith("@/")) return next(sourceUrl(`src/${name.slice(2)}`), context);
      if (name.startsWith(".") && context.parentURL?.startsWith(new URL("src/", root).href)) return next(sourceUrl(new URL(name, context.parentURL).href), context);
      if (name === "next/image") return next("next/image.js", context);
      return next(name, context);
    },
    load(url, context, next) {
      if (url.startsWith(new URL("src/", root).href) && new URL(url).searchParams.get("test-ui-ports") === registry && /\.tsx?$/.test(new URL(url).pathname)) {
        const source = readFileSync(new URL(url), "utf8");
        const primitiveMarks = /\/components\/cairn-ui\/(forms|headers|atoms|molecules)\.tsx$/.test(new URL(url).pathname)
          ? [...source.matchAll(/export function (\w+)/g)].map(([, name]) => `${name}[Symbol.for("cairn.test.pure-ui-primitive")]=true;`).join("\n") : "";
        return { format: "module", shortCircuit: true, source: ts.transpileModule(source, {
          compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
        }).outputText + "\n" + primitiveMarks };
      }
      return next(url, context);
    },
  });
  try { return await Promise.all(paths.map(path => import(sourceUrl(path)))); }
  finally { hook.deregister(); delete globalThis[registry]; }
}
