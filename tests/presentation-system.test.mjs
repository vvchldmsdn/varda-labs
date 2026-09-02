import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const read = (path) => readFileSync(path, "utf8");
const css = read("src/app/presentation.css");
const color = (name) => css.match(new RegExp(`--${name}: (#[0-9a-f]{6})`))[1];
function luminance(hex) {
  const rgb = hex
    .slice(1)
    .match(/../g)
    .map((x) => parseInt(x, 16) / 255)
    .map((x) => (x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4));
  return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
}

describe("presentation design system", () => {
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
    assert.match(today, /varda-value-bridge/);
    assert.match(today, /whitespace-nowrap text-xl/);
    assert.match(
      css,
      /\.varda-value-bridge\s*\{[^}]*grid-template-columns: 1fr/s,
    );
  });
  it("loads Tailwind and the presentation tokens directly from the root layout", () => {
    const layout = read("src/app/layout.tsx");
    assert.match(layout, /import "\.\/globals\.css"/);
    assert.match(layout, /import "\.\/presentation\.css"/);
    assert.doesNotMatch(read("src/app/globals.css"), /@import.*presentation/);
  });
  it("keeps text, action and signed-value colors readable on the warm canvas", () => {
    for (const name of [
      "ink",
      "muted",
      "faint",
      "brand",
      "negative",
      "warning",
    ]) {
      const ratio =
        (luminance(color("paper")) + 0.05) / (luminance(color(name)) + 0.05);
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
    const source = read("src/components/portfolio-primary-navigation.tsx");
    assert.match(source, /VARDA-LABS/);
    assert.match(source, /varda-mark\.png/);
    assert.match(source, /width=\{24\} height=\{24\}/);
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
  it("keeps primary analysis routes inside a fixed presentation viewport", () => {
    assert.match(
      css,
      /\.varda-presentation-page\s*\{[^}]*height: 100dvh;[^}]*overflow: hidden;/s,
    );
    assert.match(
      css,
      /\.varda-presentation-content\s*\{[^}]*flex: 1 1 auto;[^}]*min-height: 0;/s,
    );
    assert.match(
      css,
      /\.varda-workspace-panel\s*\{[^}]*overflow: hidden;/s,
    );
    assert.match(
      css,
      /\.varda-presentation-dialog-content\s*\{[^}]*overflow: auto;/s,
    );
  });
  it("keeps presentation scenes accessible and addressable by browser history", () => {
    const deck = read("src/components/presentation/presentation-deck.tsx");
    assert.match(deck, /role="tablist"/);
    assert.match(deck, /role="tab"/);
    assert.match(deck, /role="tabpanel"/);
    assert.match(deck, /aria-hidden=\{!active\}/);
    assert.match(deck, /inert=\{!active\}/);
    assert.match(deck, /window\.history\[.*pushState/s);
    assert.match(deck, /addEventListener\("hashchange"/);
    assert.match(deck, /addEventListener\("popstate"/);
    assert.match(deck, /event\.key === "ArrowRight"/);
    assert.match(deck, /isSwipeSurface/);
  });
  it("uses animated scenes for primary stories and dialogs for focused evidence", () => {
    for (const file of [
      "portfolio-dashboard",
      "today-movement",
      "additional-contribution/additional-contribution-page-view",
      "portfolio/portfolio-structure-view",
      "history/history-view",
    ]) {
      assert.match(
        read(`src/components/${file}.tsx`),
        /<PresentationDeck/,
        file,
      );
    }

    const dialog = read("src/components/presentation/presentation-dialog.tsx");
    assert.match(dialog, /<dialog/);
    assert.match(dialog, /showModal/);
    assert.match(dialog, /document\.body\.style\.overflow = "hidden"/);

    for (const file of [
      "today-movement",
      "history/history-time-explorer",
      "portfolio/portfolio-structure-view",
      "investment-lab/investment-lab-disclosure",
    ]) {
      assert.doesNotMatch(read(`src/components/${file}.tsx`), /<details/);
    }
  });
  it("keeps the new history preview strictly development-only", () => {
    const source = read("src/app/history/page.tsx");
    assert.match(source, /process.env.NODE_ENV === "development"/);
    assert.match(source, /previewParams.preview === "design"/);
    assert.match(source, /if \(!resolution.ok\)/);
  });
});
