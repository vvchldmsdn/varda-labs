import { config } from "dotenv";

config({ path: ".env.local", quiet: true });

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set");
  const write = process.argv.includes("--write");
  const { runCoreMarketFactorRefreshJob } = await import(
    "../src/lib/market-data/core-market-factor-refresh-job.ts"
  );
  const result = await runCoreMarketFactorRefreshJob({ dryRun: !write });
  console.log(
    JSON.stringify(
      {
        operation: "core_market_factor_refresh",
        mode: write ? "write" : "provider_dry_run",
        ...result,
      },
      null,
      2,
    ),
  );
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "unknown factor refresh error");
  process.exitCode = 1;
});
