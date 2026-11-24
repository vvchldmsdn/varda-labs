import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { importWithPorts } from "./helpers/import-with-ports.mjs";
import { ecbCrossFromData, ecbReferenceDate, ECB_VALUATION_POLICY, ECB_VALUATION_SOURCE } from "../src/lib/market-data/ecb-valuation-fx.ts";

const header = "KEY,FREQ,CURRENCY,CURRENCY_DENOM,EXR_TYPE,EXR_SUFFIX,TIME_PERIOD,OBS_VALUE";
const krw = "EXR.D.KRW.EUR.SP00.A,D,KRW,EUR,SP00,A,2026-11-23,1475.51";
const usd = "EXR.D.USD.EUR.SP00.A,D,USD,EUR,SP00,A,2026-11-23,1.0939";
test("the shared close uses the last ECB publication date before the KST service date", () => {
  for (const [day, reference] of [
    ["2026-11-24", "2026-11-23"], ["2026-11-23", "2026-11-20"],
    ["2026-04-07", "2026-04-02"], ["2026-05-04", "2026-04-30"],
    ["2026-12-28", "2026-12-24"], ["2026-01-02", "2025-12-31"],
    ["2026-11-27", "2026-11-26"],
  ]) assert.equal(ecbReferenceDate(day), reference);
  assert.throws(() => ecbReferenceDate("2026-02-30"), /invalid_fx_service_date/);
});
test("parses both exact ECB quote legs, rounds the cross once, and rejects unpublished or mixed fixings", () => {
  const parse = (...rows) => ecbCrossFromData([header, ...rows].join("\n"), "2026-11-23");
  assert.deepEqual(parse(usd, krw), { referenceDate: "2026-11-23", krwPerEur: "1475.51", usdPerEur: "1.0939", rate: "1348.85" });
  assert.equal(parse(krw.replace("1475.51", "1400.005"), usd.replace("1.0939", "1")).rate, "1400.01");
  for (const rows of [[], [usd], [usd, usd], [krw, usd.replace("11-23", "11-20")], [krw, usd.replace(",EUR", ",GBP")], [krw, usd.replace("1.0939","0")]]) {
    assert.throws(() => parse(...rows));
  }
});
test("one immutable reference is shared by duplicate close jobs, and a later close repairs old missing fixings", async () => {
  const pg = new PGlite();
  try {
    await pg.exec("create role varda_tenant_app");
    await pg.exec(readFileSync(new URL("../drizzle/0067_daily_valuation_fx.sql", import.meta.url), "utf8"));
    const calls = [];
    let unavailable = null;
    const [fx] = await importWithPorts(["src/db/queries/daily-valuation-fx.ts"], {
      "@/db/client": { db: drizzle(pg) },
      "@/lib/market-data/ecb-valuation-fx": {
        ECB_VALUATION_POLICY, ECB_VALUATION_SOURCE,
        async fetchEcbValuationFx(day) {
          calls.push(day);
          if (unavailable === day) throw new Error("ecb_reference_unavailable");
          return { referenceDate: ecbReferenceDate(day), krwPerEur: "1475.51", usdPerEur: "1.0939", rate: "1348.85", fetchedAt: new Date("2024-05-01T22:00:00Z") };
        },
      },
    });
    assert.equal(await fx.loadDailyValuationFx("2024-04-22"), null);
    const [a, b] = await Promise.all([fx.ensureDailyValuationFx("2024-04-22"), fx.ensureDailyValuationFx("2024-04-22")]);
    assert.equal(a.id, b.id);
    assert.equal(a.evidenceKind, "historical_reconstruction");
    assert.equal(a.cutoffAt.toISOString(), "2024-04-21T22:00:00.000Z");
    const fetchCount = calls.length;
    assert.equal((await fx.ensureDailyValuationFx("2024-04-22")).id, a.id);
    assert.equal(calls.length, fetchCount);
    unavailable = "2024-04-30";
    let cycle = await fx.collectClosingValuationFx("2024-04-30");
    assert.deepEqual(cycle.missingDates, [unavailable]);
    assert.equal(cycle.gapScanFailed, false);
    assert.equal(await fx.loadDailyValuationFx(unavailable), null);
    assert.ok(await fx.loadDailyValuationFx("2024-04-23"));
    unavailable = null;
    cycle = await fx.collectClosingValuationFx("2024-05-01");
    assert.equal(cycle.gapScanFailed, false);
    assert.deepEqual(cycle.missingDates, []);
    assert.ok(await fx.loadDailyValuationFx("2024-04-30"));
    assert.ok(await fx.loadDailyValuationFx("2024-04-25"));
    const current = await fx.ensureDailyValuationFx("2024-05-02");
    assert.equal(current.evidenceKind, "closing_reference");
    assert.equal(current.rate, "1348.850000");
    await assert.rejects(fx.ensureDailyValuationFx("2999-07-01"), /not_closed/);
    for (const sql of ["update daily_valuation_fx set rate=1", "delete from daily_valuation_fx"]) {
      await assert.rejects(pg.exec(sql), /immutable/);
    }
    const invalidCross = "insert into daily_valuation_fx(service_date,base_currency,quote_currency,reference_date,rate,krw_per_eur,usd_per_eur,source,policy,evidence_kind,fetched_at) select '2024-05-03',base_currency,quote_currency,'2024-05-02',1,krw_per_eur,usd_per_eur,source,policy,evidence_kind,'2024-05-03T00:00Z' from daily_valuation_fx limit 1";
    await assert.rejects(pg.exec(invalidCross), /daily_valuation_fx_cross/);
    await pg.exec("set role varda_tenant_app");
    await assert.rejects(pg.exec("select * from daily_valuation_fx"), /permission denied/);
  } finally {
    await pg.close();
  }
});
