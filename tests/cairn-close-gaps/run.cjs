const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const cp = require('node:child_process');
const esbuild = require('esbuild');
const root = path.resolve(__dirname, '../..');
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'cairn-close-gap-tests-'));

const workerIsolation = {
  name: 'isolated-provider-and-db',
  setup(build) {
    build.onLoad({ filter: /[/\\]db[/\\]client.ts$/ }, () => ({ loader: 'ts', contents: `
      export const sqlClient = { query: async (sql, params) => {
        const state = globalThis.gapTest;
        if (sql.includes('on conflict(market,currency,ticker,date) do nothing')) {
          if (!state.claimed || state.expireAtWrite) return [{ claimed: 0, written: 0 }];
          const rows = JSON.parse(params[2]);
          let written = 0;
          for (const row of rows) {
            if (state.dates.has(row.priceDate)) continue;
            state.dates.add(row.priceDate); state.writes.push(row.priceDate); written++;
          }
          return [{ claimed: 1, written }];
        }
        return [...state.dates].map(date => ({ date }));
      }};` }));
    build.onLoad({ filter: /[/\\]collection-queue.ts$/ }, () => ({
      contents: 'export const isMarketCollectionClaimCurrent=async()=>globalThis.gapTest.claimed;', loader: 'ts',
    }));
  },
};

(async () => {
  try {
    for (const name of ['coverage', 'worker']) {
      const outfile = path.join(out, name + '.cjs');
      await esbuild.build({
        entryPoints: [path.join(__dirname, name + '.test.ts')], outfile, bundle: true,
        platform: 'node', format: 'cjs', conditions: ['react-server'],
        tsconfig: path.join(root, 'tsconfig.json'), plugins: name === 'worker' ? [workerIsolation] : [],
      });
      const result = cp.spawnSync(process.execPath, [outfile], { stdio: 'inherit', windowsHide: true });
      if (result.status !== 0) { process.exitCode = result.status ?? 1; break; }
    }
  } finally {
    fs.rmSync(out, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
