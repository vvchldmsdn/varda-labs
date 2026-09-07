# Presentation composition redesign

The September 8 request supersedes the scrolling page composition of the previous redesign. Keep the existing paper/ink/orange language and direct chart motion. Change the information architecture itself: one route is one composed scene, with a dominant visual, a small set of related facts, and explicit detail entry points.

## Research and decisions

| Source reviewed | Applicable idea |
| --- | --- |
| [Behance: LLI Design](https://www.behance.net/gallery/35744099/LLI-Design-Website-2016) | Give the main visual most of the viewport and reveal supporting content in a side panel. This is an older structural reference, not a current implementation recommendation. |
| [Behance: Node responsive portfolio](https://www.behance.net/gallery/18464299/Node-Responsive-Portfolio-Template) | Compose to both viewport width and height, with restrained navigation around the scene. |
| [Foleon interactive annual report](https://www.foleon.com/templates/annual-reports) | Treat dense reports as interactive scenes and detail layers. Keep chart exploration in context. |
| [SketchBubble minimalist grey presentation](https://www.sketchbubble.com/en/presentation-minimalist-grey-theme.html) | Put the key figures beside a much larger graph instead of stacking both vertically. |
| [Pinterest finance dashboard reference](https://in.pinterest.com/pin/529947081172725203/) | Compared against the slide direction; conventional repeated summary cards are not the selected composition. |

Pinterest and Behance searches included financial dashboards, full-screen portfolio layouts, annual reports, and minimal financial slides. Some original Behance pages were available through indexed descriptions rather than direct fetch. No third-party template code or artwork is copied into the application.

## What changes on screen

- Home: large balance and a few related facts on the left; the holdings heatmap dominates the right. History and evidence open in detail views.
- Today: total movement and price/FX facts, contribution dots, and selected holding share the same horizontal scene. Long holdings lists scroll inside their own region.
- Contribution: input, funding composition, and leading allocations form one scene. The complete allocation list and calculation steps remain one click away.
- Structure: the allocation ring is the centre of the scene, with summary and selected holding on its sides. Group, risk and source details move into overlays.
- Risk: the correlation matrix takes priority over long explanatory tables.
- History: selected date and value on the left, a large chart on the right. Period facts and recorded evidence use detail layers.
- Lab: scenario and selected-date difference beside the actual/hypothetical comparison. Research controls retain their existing authority.
- Simulation: compact risk facts and period controls beside the large probability fan. Weight experiments and validation remain accessible from the scene footer.
- Management: a four-chapter index replaces the full page of links. Each chapter opens its relevant management links. Existing CRUD forms keep their own routes and scrolling where needed.

Desktop navigation also includes previous/next scene links that retain analysis scope and the development-preview flag. Mobile keeps the existing five primary destinations and full menu.

## Layout and interaction contract

Target desktop sizes are 1440 x 900 and 1366 x 768; mobile is 390 x 844. Each primary route should fit its main scene and detail entry points inside that viewport. Do not hide overflow to conceal content. Dense data may use a clearly bounded internal list; detailed tables and forms may scroll inside dialogs. Small-height windows and enlarged layouts retain scrolling access.

The shared frame uses `varda-stage-page` and `varda-stage-content`. Header, main visual and footer are arranged by each view; no transform-based whole-page scaling is used. Chart hover has a keyboard/touch equivalent. Native dialogs support Escape, focus containment and return to the trigger. Reduced-motion preferences remain supported.

Financial calculations, missing-evidence rules, server data access and tenant boundaries are unchanged. The original unfinished contribution policy remains in the original worktree. The local review URL uses marked example data; it does not create a production authentication bypass.

## Verified outcome

Validation completed September 8, 2026:

- The seven primary views, the detailed risk view and the management index were reviewed in real browsers at 1440 x 900, 1366 x 768 and 390 x 844. Main document scrolling is absent; relevant internal lists and detail views remain scrollable.
- All 2,009 tests pass. Full ESLint and the production build pass. `git diff --check` is clean.
- Ten local routes return HTTP 200, including the user's simulation URL with horizon=126, scope=all and kodexWeight=50.
- Calculation pending/completion, scenario and account selection, ring/matrix keyboard interaction, modal focus return, reduced motion and previous/next scene navigation were verified. Fresh browser reviews report no application errors or warnings.
- No database, finance library, dependency or lockfile change. Original HEAD and unfinished files remain untouched. No commit, push or production deployment.

Logs and reviewed screenshots are in the ignored `output/playwright/` directory. The local dev server remains available at `http://localhost:3107/?preview=design`.
