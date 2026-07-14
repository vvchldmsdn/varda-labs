import Link from "next/link";
import type { ReactNode } from "react";

import { DirectHoldingsBaseline } from "@/components/portfolio/direct-holdings-baseline";
import { SpecialHoldingsCoverage } from "@/components/portfolio/special-holdings-coverage";
import { getReadOnlyPortfolioStructure } from "@/db/queries/portfolio-structure";
import { buildPortfolioDirectHoldingsBaseline } from "@/lib/portfolio-direct-holdings";
import { buildPortfolioSpecialHoldingsModel } from "@/lib/portfolio-special-holdings";
import type {
  PortfolioStructureAccount,
  PortfolioStructureExclusion,
  PortfolioStructureGroupRow,
  PortfolioStructureHoldingRow,
  PortfolioStructureResult,
} from "@/lib/portfolio-structure";

export const dynamic = "force-dynamic";

type PortfolioStructurePageProps = {
  searchParams: Promise<{
    account?: string | string[];
  }>;
};

const accountTabs: { code: PortfolioStructureAccount; label: string }[] = [
  { code: "brokerage", label: "Brokerage" },
  { code: "isa", label: "ISA" },
  { code: "irp", label: "IRP" },
  { code: "all", label: "All" },
];

export default async function PortfolioStructurePage({
  searchParams,
}: PortfolioStructurePageProps) {
  const params = await searchParams;
  const structure = await getReadOnlyPortfolioStructure({
    account: params.account,
  });
  const directHoldingsBaseline =
    buildPortfolioDirectHoldingsBaseline(structure);
  const specialHoldingsCoverage =
    buildPortfolioSpecialHoldingsModel(structure);

  return (
    <main className="min-h-screen bg-[#f3f4ef] text-[#171916]">
      <div className="mx-auto w-full max-w-[1500px] space-y-4 px-4 py-4">
        <section className="rounded-lg border border-[#dfe3d5] bg-[#fbfcf7] p-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <p className="text-xs font-semibold text-[#687064]">
                Varda Labs
              </p>
              <h1 className="mt-1 text-2xl font-semibold tracking-normal">
                자산 배분
              </h1>
            </div>
            <nav className="flex flex-wrap gap-2 text-sm font-semibold">
              <NavLink href="/">Dashboard</NavLink>
              <NavLink href="/today">Today Movement</NavLink>
              <NavLink href="/history">History</NavLink>
              <NavLink href="/etfs">ETF Reference</NavLink>
              <NavLink href="/market">Market Context</NavLink>
            </nav>
          </div>

          <div className="mt-4 flex flex-wrap gap-2 rounded-md border border-[#dce2d2] bg-white p-1">
            {accountTabs.map((tab) => (
              <Link
                key={tab.code}
                href={
                  tab.code === "brokerage"
                    ? "/portfolio/structure"
                    : `/portfolio/structure?account=${tab.code}`
                }
                className={[
                  "rounded-md px-3 py-2 text-sm font-semibold transition",
                  structure.selectedAccount === tab.code
                    ? "bg-[#1e3a34] text-white"
                    : "text-[#5d665b] hover:bg-[#edf1e8]",
                ].join(" ")}
              >
                {tab.label}
              </Link>
            ))}
          </div>

          <div className="mt-4 grid gap-3 md:grid-cols-4">
            <SummaryCell
              label="Current value"
              value={formatMoney(structure.totalValueKrw)}
              detail={`USD/KRW ${formatNumber(structure.usdKrwRate)}`}
            />
            <SummaryCell
              label="Included holdings"
              value={String(structure.includedHoldingCount)}
              detail={`${structure.excludedHoldingCount} excluded`}
            />
            <SummaryCell
              label="Groups"
              value={String(structure.groupRows.length)}
              detail={`account ${structure.selectedAccount}`}
            />
            <SummaryCell
              label="Policy status"
              value={policyStatusSummary(structure)}
              detail="effective target n/a"
            />
          </div>
        </section>

        <DirectHoldingsBaseline model={directHoldingsBaseline} />

        <SpecialHoldingsCoverage model={specialHoldingsCoverage} />

        <section className="rounded-lg border border-[#dfe3d5] bg-[#fbfcf7] p-4">
          <SectionHeader title="그룹 비중" detail="current read model" />
          <GroupTable rows={structure.groupRows} />
        </section>

        <section className="rounded-lg border border-[#dfe3d5] bg-[#fbfcf7] p-4">
          <SectionHeader title="보유 종목 비중" detail="current holdings" />
          <HoldingTable rows={structure.holdingRows} />
        </section>

        <section className="rounded-lg border border-[#dfe3d5] bg-[#fbfcf7] p-4">
          <SectionHeader
            title="Exclusions"
            detail={`${structure.exclusions.length} rows`}
          />
          <ExclusionTable rows={structure.exclusions} />
        </section>

        <section className="rounded-lg border border-[#dfe3d5] bg-[#fbfcf7] p-4">
          <SectionHeader title="Data Health" detail="read-only counts" />
          <div className="mt-3 grid gap-3 md:grid-cols-4">
            <SummaryCell
              label="Selected assets"
              value={String(structure.dataHealth.selectedAssetCount)}
              detail={`input ${structure.dataHealth.inputAssetCount}`}
            />
            <SummaryCell
              label="Missing price"
              value={String(structure.dataHealth.missingPriceCount)}
              detail="current valuation"
            />
            <SummaryCell
              label="Missing FX"
              value={String(structure.dataHealth.missingFxCount)}
              detail="USD conversion"
            />
            <SummaryCell
              label="Policy unresolved"
              value={String(structure.dataHealth.unresolvedTargetPolicyCount)}
              detail="target_policy_unresolved"
            />
          </div>
        </section>
      </div>
    </main>
  );
}

function GroupTable({ rows }: { rows: PortfolioStructureGroupRow[] }) {
  if (rows.length === 0) {
    return <EmptyTableMessage>No group rows found.</EmptyTableMessage>;
  }

  return (
    <div className="mt-3 overflow-x-auto">
      <table className="w-full min-w-[820px] border-separate border-spacing-0 text-left text-sm">
        <thead className="text-xs uppercase text-[#687064]">
          <tr>
            <TableHeader>Group</TableHeader>
            <TableHeader align="right">Value</TableHeader>
            <TableHeader align="right">Weight</TableHeader>
            <TableHeader align="right">Group target</TableHeader>
            <TableHeader align="right">Effective target</TableHeader>
            <TableHeader align="right">Holdings</TableHeader>
            <TableHeader align="right">Excluded</TableHeader>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.name} className="border-t border-[#e1e6dc]">
              <TableCell strong>{row.name}</TableCell>
              <TableCell align="right">{formatMoney(row.currentValueKrw)}</TableCell>
              <TableCell align="right">
                {formatPercent(row.currentWeightPct)}
              </TableCell>
              <TableCell align="right">{formatPercent(row.groupTargetPct)}</TableCell>
              <TableCell align="right">n/a</TableCell>
              <TableCell align="right">{row.holdingCount}</TableCell>
              <TableCell align="right">{row.excludedCount}</TableCell>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function HoldingTable({ rows }: { rows: PortfolioStructureHoldingRow[] }) {
  if (rows.length === 0) {
    return <EmptyTableMessage>No holding rows found.</EmptyTableMessage>;
  }

  return (
    <div className="mt-3 overflow-x-auto">
      <table className="w-full min-w-[1280px] border-separate border-spacing-0 text-left text-sm">
        <thead className="text-xs uppercase text-[#687064]">
          <tr>
            <TableHeader>Holding</TableHeader>
            <TableHeader>Account</TableHeader>
            <TableHeader>Market</TableHeader>
            <TableHeader>Currency</TableHeader>
            <TableHeader>Group</TableHeader>
            <TableHeader align="right">Quantity</TableHeader>
            <TableHeader align="right">Price</TableHeader>
            <TableHeader align="right">Value</TableHeader>
            <TableHeader align="right">Weight</TableHeader>
            <TableHeader align="right">Asset target</TableHeader>
            <TableHeader align="right">Group target</TableHeader>
            <TableHeader>Policy</TableHeader>
            <TableHeader>Price evidence</TableHeader>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={`${row.account}-${row.market}-${row.ticker ?? row.name}`}
              className="border-t border-[#e1e6dc]"
            >
              <TableCell strong>
                <div>{row.ticker ?? "-"}</div>
                <div className="text-xs font-normal text-[#687064]">
                  {row.name}
                </div>
              </TableCell>
              <TableCell>{row.account}</TableCell>
              <TableCell>{row.market}</TableCell>
              <TableCell>{row.currency}</TableCell>
              <TableCell>{row.groupName}</TableCell>
              <TableCell align="right">{formatNumber(row.quantity)}</TableCell>
              <TableCell align="right">{formatNumber(row.currentPrice)}</TableCell>
              <TableCell align="right">{formatMoney(row.currentValueKrw)}</TableCell>
              <TableCell align="right">{formatPercent(row.currentWeightPct)}</TableCell>
              <TableCell align="right">
                {formatPercent(row.rawAssetTargetPct)}
              </TableCell>
              <TableCell align="right">{formatPercent(row.groupTargetPct)}</TableCell>
              <TableCell>{row.targetPolicyStatus}</TableCell>
              <TableCell>
                <div>{row.priceEvidenceSource}</div>
                <div className="text-xs text-[#687064]">
                  {row.priceSource ?? "-"}
                </div>
              </TableCell>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ExclusionTable({ rows }: { rows: PortfolioStructureExclusion[] }) {
  if (rows.length === 0) {
    return <EmptyTableMessage>No excluded rows.</EmptyTableMessage>;
  }

  return (
    <div className="mt-3 overflow-x-auto">
      <table className="w-full min-w-[900px] border-separate border-spacing-0 text-left text-sm">
        <thead className="text-xs uppercase text-[#687064]">
          <tr>
            <TableHeader>Reason</TableHeader>
            <TableHeader>Holding</TableHeader>
            <TableHeader>Account</TableHeader>
            <TableHeader>Market</TableHeader>
            <TableHeader>Currency</TableHeader>
            <TableHeader>Group</TableHeader>
            <TableHeader align="right">Quantity</TableHeader>
            <TableHeader align="right">Price</TableHeader>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={`${row.reason}-${row.account}-${row.market}-${row.ticker ?? row.name}`}
              className="border-t border-[#e1e6dc]"
            >
              <TableCell strong>{row.reason}</TableCell>
              <TableCell>
                <div>{row.ticker ?? "-"}</div>
                <div className="text-xs text-[#687064]">{row.name}</div>
              </TableCell>
              <TableCell>{row.account}</TableCell>
              <TableCell>{row.market}</TableCell>
              <TableCell>{row.currency}</TableCell>
              <TableCell>{row.groupName}</TableCell>
              <TableCell align="right">{formatNumber(row.quantity)}</TableCell>
              <TableCell align="right">{formatNumber(row.currentPrice)}</TableCell>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SummaryCell({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div className="rounded-md border border-[#e2e6da] bg-white p-3">
      <p className="text-xs font-semibold text-[#687064]">{label}</p>
      <p className="mt-2 text-xl font-semibold tracking-normal text-[#111411]">
        {value}
      </p>
      <p className="mt-1 text-xs text-[#73786c]">{detail}</p>
    </div>
  );
}

function SectionHeader({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <h2 className="text-lg font-semibold tracking-normal">{title}</h2>
      <p className="text-xs text-[#687064]">{detail}</p>
    </div>
  );
}

function NavLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      className="rounded-md border border-[#d7ddcf] bg-white px-3 py-2 text-[#253029] hover:bg-[#eef1e8]"
    >
      {children}
    </Link>
  );
}

function TableHeader({
  children,
  align = "left",
}: {
  children: ReactNode;
  align?: "left" | "right";
}) {
  return (
    <th
      className={[
        "border-b border-[#dfe3d5] px-3 py-2 font-semibold",
        align === "right" ? "text-right" : "text-left",
      ].join(" ")}
    >
      {children}
    </th>
  );
}

function TableCell({
  children,
  align = "left",
  strong = false,
}: {
  children: ReactNode;
  align?: "left" | "right";
  strong?: boolean;
}) {
  return (
    <td
      className={[
        "border-b border-[#edf0e7] px-3 py-2 align-top",
        align === "right" ? "text-right" : "text-left",
        strong ? "font-semibold" : "",
      ].join(" ")}
    >
      {children}
    </td>
  );
}

function EmptyTableMessage({ children }: { children: ReactNode }) {
  return (
    <div className="mt-3 rounded-md border border-[#e2e6da] bg-white p-3 text-sm text-[#687064]">
      {children}
    </div>
  );
}

function policyStatusSummary(structure: PortfolioStructureResult) {
  const statuses = new Set(
    structure.holdingRows.map((row) => row.targetPolicyStatus),
  );
  return statuses.size > 0 ? String(statuses.size) : "0";
}

function formatMoney(value: number | null) {
  if (value === null || !Number.isFinite(value)) return "-";
  return `₩${Math.round(value).toLocaleString("en-US")}`;
}

function formatNumber(value: number | null) {
  if (value === null || !Number.isFinite(value)) return "-";
  return value.toLocaleString("en-US", {
    maximumFractionDigits: 2,
  });
}

function formatPercent(value: number | null) {
  if (value === null || !Number.isFinite(value)) return "n/a";
  return `${value.toLocaleString("en-US", {
    maximumFractionDigits: 2,
  })}%`;
}
