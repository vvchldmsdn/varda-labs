# Simple modern redesign

This is the first proposal. Its visual direction is superseded by [the visual and interaction redesign](visual-interaction-redesign.md), based on the user's later five references. Retain this document as the initial implementation record.

The current direction is a light, simple, modern interface. Previous dark presentation and fixed-viewport rules are superseded. Financial calculations, evidence admission, tenant ownership, and order restrictions retain their existing authority.

## Screen composition

- Home: asset summary, a primary history chart, movement evidence, and the holdings heatmap.
- Today: signed contribution amounts, selection and price/FX/trade decomposition, then the valuation bridge.
- Contribution: amount input alongside available funds and the allocation table; calculation and before/after evidence remain available in dialogs.
- Structure: allocation exploration followed by risk summaries. The detailed risk route keeps its evidence and controls.
- History: valuation and return summaries, a large period chart, selected-date evidence and events.
- Investment Lab: actual, hypothetical, and difference together; scenario choices and deeper research tools follow the comparison.
- Simulation: probability paths with central return, loss probability, MDD and assumptions; diagnostics stay available.
- Management: one index for accounts, holdings, allocation targets, records and market data; existing protected forms remain the execution authority.
- Authentication: a calm introduction and a focused form, stacking to a single task on mobile.

## Shared rules

Use the same sidebar and compact mobile navigation, stable control locations, a white surface on a light neutral canvas, and restrained green accents. Keep values readable, disclose missing evidence honestly, and use document scrolling. Navigation preserves the chosen analysis scope. Development design previews retain their query parameter and visibly identify example data. They do not enable production authentication bypasses.

The visual language uses existing Next/React components and shared tokens; no financial data provider or database schema changes are required.

## References reviewed September 7, 2026

- Linear, March 2026 interface refresh: https://linear.app/now/behind-the-latest-design-refresh
- Nielsen Norman Group, progressive disclosure: https://www.nngroup.com/articles/progressive-disclosure/
- W3C, WCAG 2.2 contrast minimum: https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html
- W3C, WCAG 2.2 target size: https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html

## Local review

Start the worktree with `npm run dev -- --port 3107`, then open `http://localhost:3107/?preview=design`. Main navigation keeps the design preview active. Production routes retain their existing tenant and authentication checks.

## Verification

- Full test suite: 2,009 passed; final affected UI checks: 28 passed.
- Final `npm run lint` and `npm run build`: passed, including TypeScript checks.
- Desktop 1440px and mobile 390px: inspected all primary views, authentication and the management index. Checked scope navigation, chart switches, contribution recalculation, dialogs, keyboard dismissal and horizontal overflow.
- Restarted the development server after the navigation boundary change and confirmed no browser errors or warnings in fresh Lab and Simulation sessions.
- All seven primary preview routes, the management index and sign-in preview returned HTTP 200.
- Review uses clearly marked example data. Authenticated production data and management writes were not exercised. No database schema, query, financial-engine, dependency, commit or production deployment change is part of this redesign.

Implementation is isolated on `codex/simple-modern-redesign`, based on `cb43865cf02c3b23c95a6fdc3a25204d1924cb58`. The original `codex/analysis-holding-authority` working directory and its unfinished contribution changes remain intact.
