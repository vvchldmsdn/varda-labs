import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const read = (path) => readFileSync(path, "utf8");
const css = read("src/app/presentation.css");
const modernCss = read("src/app/modern.css");
const color = (name) => css.match(new RegExp(`--${name}: (#[0-9a-f]{6})`))[1];
function luminance(hex) {
  const rgb = hex
    .slice(1)
    .match(/../g)
    .map((x) => parseInt(x, 16) / 255)
    .map((x) => (x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4));
  return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
}

function contrast(first, second) {
  const lighter = Math.max(luminance(first), luminance(second));
  const darker = Math.min(luminance(first), luminance(second));
  return (lighter + 0.05) / (darker + 0.05);
}

describe("simple modern design system", () => {
  it("uses complete available funds for the contribution diagram and its denominator", () => {
    const result = read(
      "src/components/additional-contribution/additional-contribution-result.tsx",
    );
    const flow = read(
      "src/components/additional-contribution/additional-contribution-flow-map.tsx",
    );
    assert.match(result, /cashAmountKrw: preview.totalAvailableFundsKrw/);
    assert.match(
      result,
      /availableFundsKrw=\{preview.totalAvailableFundsKrw\}/,
    );
    assert.match(flow, /buildFlowLayout\(rows, availableFundsKrw, mode\)/);
    assert.match(flow, /formatCompactKrw\(availableFundsKrw\)/);
  });
  it("keeps movement amounts unbroken and stacks the value bridge on mobile", () => {
    const today = read("src/components/today-movement.tsx");
    assert.match(today, /MovementBridge/);
    const overviewCss = read("src/components/home/portfolio-overview.module.css");
    assert.match(overviewCss, /\.bridgeStep dd[^}]*white-space: nowrap/s);
    assert.match(
      overviewCss,
      /\.bridge\s*\{[^}]*grid-template-columns: 1fr/s,
    );
  });
  it("loads Tailwind and the presentation tokens directly from the root layout", () => {
    const layout = read("src/app/layout.tsx");
    assert.match(layout, /import "\.\/globals\.css"/);
    assert.match(layout, /import "\.\/presentation\.css"/);
    assert.doesNotMatch(read("src/app/globals.css"), /@import.*presentation/);
  });
  it("uses a light canvas with readable text and signed values", () => {
    assert.ok(luminance(color("paper")) > 0.8);
    assert.ok(luminance(color("surface")) > luminance(color("paper")));
    for (const name of [
      "ink",
      "muted",
      "faint",
      "brand",
      "negative",
      "warning",
    ]) {
      const ratio = contrast(color("paper"), color(name));
      assert.ok(ratio >= 4.5, `${name}: ${ratio}`);
    }
  });
  it("uses one presentation frame across the seven primary views", () => {
    for (const file of [
      "portfolio-dashboard",
      "today-movement",
      "additional-contribution/additional-contribution-page-view",
      "portfolio/portfolio-structure-view",
      "history/history-view",
      "investment-lab/investment-lab-view",
      "simulation/simulation-input-readiness-view",
    ]) {
      const source = read(`src/components/${file}.tsx`);
      assert.match(source, /varda-page/);
      assert.match(source, /varda-content/);
      assert.match(source, /PortfolioPrimaryNavigation/);
    }
  });
  it("uses the compact shared logo and preserves primary navigation", () => {
    const source = read("src/components/app-navigation.tsx");
    assert.match(source, /VARDA/);
    assert.match(source, /varda-mark\.png/);
    assert.match(source, /buildPortfolioAnalysisScopeHref/);
    assert.match(source, /aria-current/);
    assert.match(css, /prefers-reduced-motion/);
  });
  it("retains accessible selection and the alternate allocation map", () => {
    const ring = read("src/components/portfolio/portfolio-allocation-ring.tsx");
    const view = read(
      "src/components/portfolio/portfolio-allocation-explorer.tsx",
    );
    assert.match(ring, /aria-pressed/);
    assert.match(ring, /event.key === "Enter"/);
    assert.match(ring, /Number.isFinite\(entry.weightPct\)/);
    assert.match(view, /layoutPortfolioTreemap/);
    assert.match(view, /비중 종목 선택/);
  });
  it("keeps native dialog focus behavior and background scroll locks", () => {
    for (const file of [
      "investment-lab/investment-lab-dialog",
      "additional-contribution/additional-contribution-logic-dialog",
    ]) {
      const source = read(`src/components/${file}.tsx`);
      assert.match(source, /<dialog/);
      assert.match(source, /showModal/);
      assert.match(source, /onClose/);
      assert.match(source, /document.body.style.overflow/);
      assert.match(source, /varda-dialog/);
    }
  });
  it("allows document scrolling and preserves mobile navigation", () => {
    assert.match(modernCss, /min-height: 100dvh; height: auto; overflow: visible/);
    assert.match(modernCss, /@media \(max-width: 760px\)/);
    const navigation = read("src/components/app-navigation.tsx");
    assert.match(navigation, /aria-label="메뉴 열기"/);
    assert.match(navigation, /<dialog/);
    assert.match(navigation, /showModal/);
    assert.match(navigation, /메뉴 닫기/);
  });
  it("keeps related primary information together instead of hiding it in scene tabs", () => {
    for (const file of [
      "portfolio-dashboard",
      "today-movement",
      "additional-contribution/additional-contribution-page-view",
      "portfolio/portfolio-structure-view",
      "history/history-view",
    ]) {
      const source = read(`src/components/${file}.tsx`);
      assert.match(source, /PortfolioPrimaryNavigation/);
      assert.doesNotMatch(source, /<PresentationDeck/, file);
    }

    assert.match(read("src/components/portfolio-dashboard.tsx"), /HoldingMovementHeatmap/);
    assert.match(read("src/components/portfolio-dashboard.tsx"), /PortfolioHistoryChart/);
    assert.match(read("src/components/today-movement.tsx"), /TodayContributionExplorer/);
    assert.match(read("src/components/history/history-view.tsx"), /HistoryTimeExplorer/);
  });

  it("uses animated dialogs and drawers for focused evidence", () => {

    const dialog = read("src/components/presentation/presentation-dialog.tsx");
    assert.match(dialog, /<dialog/);
    assert.match(dialog, /showModal/);
    assert.match(dialog, /document\.body\.style\.overflow = "hidden"/);

    assert.match(css, /@keyframes varda-dialog-in/);
    assert.match(css, /@keyframes varda-drawer-in/);
    assert.match(css, /@keyframes varda-cell-detail-in/);
  });
  it("keeps the new history preview strictly development-only", () => {
    const source = read("src/app/history/page.tsx");
    assert.match(source, /process.env.NODE_ENV === "development"/);
    assert.match(source, /previewParams.preview === "design"/);
    assert.match(source, /if \(!resolution.ok\)/);
  });
});
