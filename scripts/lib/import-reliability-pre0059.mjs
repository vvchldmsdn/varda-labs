import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import path from 'node:path';
import ts from 'typescript';

const root = new URL('../../', import.meta.url);
const fixtures = new URL('../fixtures/reliability-pre0059/', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('manifest.json', fixtures), 'utf8'));
const digest = value => createHash('sha256').update(value).digest('hex');
const compile = source => ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;

/** Frozen, unmodified deployment sources. Only the actual database transport is
 * replaced; every reused calculation dependency must match the old runtime hash. */
export async function importPre0059(ports) {
  const registry = `__cairnCompatibility${randomUUID().replaceAll('-', '')}`;
  globalThis[registry] = ports;
  const stubs = new Map(Object.entries(ports).map(([specifier, exports]) => [specifier,
    'data:text/javascript,' + encodeURIComponent(Object.keys(exports).map(name =>
      `export const ${name}=globalThis[${JSON.stringify(registry)}][${JSON.stringify(specifier)}][${JSON.stringify(name)}];`).join('\n'))]));
  const prefix = `cairn-pre0059:${registry}/`;
  const hook = registerHooks({
    resolve(specifier, context, next) {
      if (specifier === 'server-only') return { url: 'data:text/javascript,export {};', shortCircuit: true };
      if (stubs.has(specifier)) return { url: stubs.get(specifier), shortCircuit: true };
      if (specifier.startsWith(prefix)) return { url: specifier, shortCircuit: true };
      if (context.parentURL?.startsWith(prefix)) {
        if (specifier.startsWith('@/') || specifier.startsWith('.')) {
          let file = specifier.startsWith('@/') ? `src/${specifier.slice(2)}`
            : path.posix.normalize(path.posix.join(path.posix.dirname(context.parentURL.slice(prefix.length)), specifier));
          if (!file.endsWith('.ts')) file += '.ts';
          assert.ok(manifest.frozen[file] || manifest.sharedRuntime[file], `Unverified old dependency: ${file}`);
          return { url: prefix + file, shortCircuit: true };
        }
        return next(specifier, { ...context, parentURL: root.href });
      }
      return next(specifier, context);
    },
    load(url, context, next) {
      if (!url.startsWith(prefix)) return next(url, context);
      const file = url.slice(prefix.length), frozen = manifest.frozen[file];
      const source = readFileSync(frozen ? new URL(frozen.file, fixtures) : new URL(file, root), 'utf8');
      if (frozen) assert.equal(digest(source), frozen.sha256, `Old fixture changed: ${file}`);
      const runtime = compile(source);
      if (!frozen) assert.equal(digest(runtime), manifest.sharedRuntime[file], `Shared runtime differs from ${manifest.base}: ${file}`);
      return { format: 'module', shortCircuit: true, source: runtime };
    },
  });
  try {
    const [ledger, snapshots, projection] = await Promise.all([
      'src/db/queries/native-portfolio-ledger.ts',
      'src/db/queries/native-portfolio-snapshots.ts',
      'src/lib/native-portfolio-projection.ts',
    ].map(file => import(prefix + file)));
    return { ledger, snapshots, projection, base: manifest.base };
  } finally { hook.deregister(); delete globalThis[registry]; }
}
