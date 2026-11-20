import test from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { importWithPorts } from "./helpers/import-with-ports.mjs";

test("public market history cache checks content, corrections, nulls and deletes without retransferring rows", async () => {
  const pg = new PGlite();
  await pg.exec("create table prices(ticker text, price numeric, source text); insert into prices values ('VOO',100,'kis'),('VOO',null,'unavailable')");
  const cache = new Map(); let reads = 0, signatures = 0, outage = false;
  const [{ readSharedMarketHistory }] = await importWithPorts(["src/db/queries/shared-market-history-cache.ts"], {
    "@/db/client": { sqlClient: { query: async (sql, params) => {
      signatures++; if (outage) throw new Error("synthetic database unavailable");
      return (await pg.query(sql, params)).rows;
    } } },
    "next/cache": { unstable_cache: (fn, keys) => async () => {
      const key = JSON.stringify(keys);
      if (!cache.has(key)) cache.set(key, JSON.parse(JSON.stringify(await fn())));
      return cache.get(key);
    } },
  });
  const query = {
    toSQL: () => ({ sql: "select ticker,price::text,source from prices where ticker=$1 order by price nulls last", params: ["VOO"] }),
    then: (resolve, reject) => { reads++; return pg.query(query.toSQL().sql, ["VOO"]).then(r => r.rows).then(resolve, reject); },
  };
  try {
    const first = await readSharedMarketHistory("instrument-price-history", query);
    assert.equal(first[1].price, null);
    assert.deepEqual(await readSharedMarketHistory("instrument-price-history", query), first);
    assert.equal(reads, 1); assert.equal(signatures, 3); // cold before/after, warm before only
    await pg.exec("update prices set price=105 where price=100");
    assert.equal((await readSharedMarketHistory("instrument-price-history", query))[0].price, "105");
    assert.equal(reads, 2);
    await pg.exec("delete from prices where price is null");
    assert.equal((await readSharedMarketHistory("instrument-price-history", query)).length, 1);
    assert.equal(reads, 3);
    outage = true;
    await assert.rejects(readSharedMarketHistory("instrument-price-history", query), /unavailable/);
    assert.equal(reads, 3, "DB failure must not serve the old cached evidence");
  } finally { await pg.close(); }
});

test("concurrent correction is never stored under the previous content signature", async () => {
  let calls = 0, reads = 0, saved = 0;
  const [{ readSharedMarketHistory }] = await importWithPorts(["src/db/queries/shared-market-history-cache.ts"], {
    "@/db/client": { sqlClient: { query: async () => [{ signature: (++calls === 1 ? "a" : "b").repeat(32) }] } },
    "next/cache": { unstable_cache: fn => async () => { const r = await fn(); saved++; return r; } },
  });
  const query = { toSQL: () => ({ sql: "select price from public_prices", params: [] }),
    then: resolve => Promise.resolve(resolve([{ price: ++reads }])) };
  assert.deepEqual(await readSharedMarketHistory("instrument-price-history", query), [{ price: 2 }]);
  assert.equal(saved, 0);
});

test("cache infrastructure failure falls back to fresh evidence; source failure stays a failure", async () => {
  let reads = 0;
  const ports = {
    "@/db/client": { sqlClient: { query: async () => [{ signature: "a".repeat(32) }] } },
    "next/cache": { unstable_cache: () => async () => { throw new Error("cache offline"); } },
  };
  const [{ readSharedMarketHistory }] = await importWithPorts(["src/db/queries/shared-market-history-cache.ts"], ports);
  const query = { toSQL: () => ({ sql: "select price from public_prices", params: [] }),
    then: resolve => { reads++; return Promise.resolve(resolve([{ price: 10 }])); } };
  assert.deepEqual(await readSharedMarketHistory("fx-history", query), [{ price: 10 }]);
  assert.equal(reads, 1);
  const [{ readSharedMarketHistory: failing }] = await importWithPorts(["src/db/queries/shared-market-history-cache.ts"], {
    ...ports, "next/cache": { unstable_cache: fn => fn },
  });
  const error = new Error("source unavailable");
  await assert.rejects(failing("fx-history", { ...query, then: (_resolve, reject) => { reads++; return Promise.reject(error).catch(reject); } }), e => e === error);
  assert.equal(reads, 2, "no repeated source query on source failure");
});

test("read metrics expose only numeric estimates and preserve success/errors", async () => {
  const [{ measureDatabaseRead }] = await importWithPorts(["src/lib/database-read-metrics.ts"], {});
  const enabled = process.env.CAIRN_DB_READ_METRICS_ENABLED, info = console.info, output = [];
  process.env.CAIRN_DB_READ_METRICS_ENABLED = "true"; console.info = value => output.push(JSON.parse(value));
  try {
    const rows = [{ account: "private-owner", token: "secret", amount: 123 }];
    assert.equal(await measureDatabaseRead("tenant.transaction", async () => rows), rows);
    const error = new Error("private-error-contents");
    await assert.rejects(measureDatabaseRead("tenant.transaction", async () => { throw error; }), e => e === error);
    assert.equal(output[0].rows, 1); assert.ok(output[0].estimatedResultBytes > 0);
    assert.equal(output[1].ok, false);
    assert.doesNotMatch(JSON.stringify(output), /private-owner|secret|private-error-contents|amount/);
    console.info = () => { throw new Error("logger down"); };
    assert.equal(await measureDatabaseRead("tenant.transaction", async () => rows), rows);
  } finally {
    console.info = info;
    if (enabled === undefined) delete process.env.CAIRN_DB_READ_METRICS_ENABLED;
    else process.env.CAIRN_DB_READ_METRICS_ENABLED = enabled;
  }
});
