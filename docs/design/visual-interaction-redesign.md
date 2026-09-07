# VARDA visual and interaction redesign

The visual language remains in use. The September 8 [presentation composition redesign](presentation-composition-redesign.md) supersedes this document's scrolling screen composition.

## Direction

The user's five supplied references supersede the first light-dashboard proposal. The base is warm white and ink, with orange used deliberately for selection and important positive values. A darker orange supports readable small text; a cooler blue distinguishes negative values. Colour is always accompanied by signs, labels or selection state.

Separate information through alignment, typography, space and hairlines. Keep a card only when its contents form a complete visual object. Avoid giving every summary and explanation its own container. Preserve the existing service, owner boundaries, calculation authority and evidence handling.

## Research synthesis

| Reference | Applied idea |
| --- | --- |
| User reference 1 | A visual widget should feel complete, with an identifiable main graphic. |
| User reference 2 | Restrained dots, generous chart space, strong numbers and minimal framing. |
| User reference 3 | Rounded segmented geometry and direct pointer response; the supplied still image does not establish its actual animation timing. |
| User references 4–5 | Paper and ink, orange emphasis, flat summaries and accessible bottom navigation on mobile. |
| [Pinterest: Minimal Lime Dashboard](https://www.pinterest.com/pin/minimal-lime-dashboard-design--370984088048280935/) | Studied the grouping of visual widgets; retained the grouping principle with VARDA's own colour and content. |
| [Pinterest: Dot Stacks Chart](https://in.pinterest.com/pin/dot-stacks-chart-editable-vector-dashboard-component--684828687111533562/) | Dot textures as a restrained alternative to solid bars. Exact financial lengths and labels remain authoritative. |
| [Dipa: Finance Component](https://dribbble.com/shots/24828319-Finance-Component) | Studied self-contained finance components and readable spacing. |
| [Vercel Geist](https://vercel.com/geist/introduction) | Consistent typography, neutral surfaces and a compact shared control language. |
| [Motion animation documentation](https://motion.dev/docs/animate) | Reviewed entry, SVG and gesture techniques. Implementation uses native CSS and browser APIs without adding this dependency. |
| [MDN: Web Animations API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Animations_API/Using_the_Web_Animations_API) | Browser-native, interruptible animation and explicit cleanup. |
| [MDN: reduced motion](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/@media/prefers-reduced-motion) | A complete static experience when the user requests reduced motion. |

References were researched September 7, 2026. They inform visual decisions; no third-party page text or artwork is embedded in the application.

## Screen language

- Home: flat, large asset total; full-width ink history line; orange focus point; holdings heatmap as a complete visual widget.
- Today: signed dot-matrix contribution bars; one selected-holding detail; a flat valuation bridge.
- History: selected-date value above a large chart, with compact period facts below. Pointer selection uses recorded observations.
- Contribution: large amount input, integrated funding composition, then unboxed allocation rows. Pending and completion effects track the actual calculation request.
- Structure: rounded allocation segments, a legible centre and direct hover/selection feedback. Actual weights retain their geometry and exact labels.
- Risk: correlation and contribution graphics carry the page; evidence remains available without repeated nested cards.
- Lab: actual and hypothetical paths share one plotting area; the selected-date difference becomes the focal summary.
- Simulation: distribution layers and selectable paths stay together; the mobile summary is compact enough to introduce the chart early.
- Management: clearly grouped links and forms separated by rules, with small directional hover feedback.
- Authentication: a flat editorial layout and an interactive abstract dot orbit. The orbit is decorative and represents no financial data.

## Motion contract

Page content enters briefly without blocking navigation. Pending navigation uses a small indicator tied to Next's actual link status. Charts draw or reveal when introduced; hover and focus expose the same values. Click/pin states remain available after the pointer moves. Loading skeletons contain no fabricated financial numbers. Native dialogs retain Escape, focus and scroll-lock behavior.

Respect reduced motion, coarse pointers and touch. Never move a chart axis or change a value solely for visual effect. Do not alter price, FX, flow, MA120, allocation, risk or simulation calculations to fit a graphic.

## Review

Worktree: `.worktrees/simple-modern-20260907`, branch `codex/simple-modern-redesign`. Start with `npm run dev -- --port 3107` and open `http://localhost:3107/?preview=design`. The original unfinished contribution work remains in the original worktree. Development previews are marked example data and do not create a production authentication bypass.

Validation completed September 7, 2026:

- All 2,009 existing tests pass. ESLint and the production build pass.
- Desktop (1440px) and mobile (390px) reviews cover the main screens, navigation, dialogs and chart interactions. No horizontal page overflow was observed.
- Fresh browser loads have no application console errors or warnings. Development-only CSP report messages remain unchanged.
- Contribution pending/completion, scope preservation, chart hover/pinning, keyboard controls and reduced-motion behavior were checked. The allocation geometry is identical before and after the lint correction, including very small weights.
- Ten local review routes return HTTP 200. No DB, finance library, package or lockfile changes were made. No commit, push or production deployment was performed.

Verification logs and screenshots are in the ignored `output/playwright/` directory of the worktree.
