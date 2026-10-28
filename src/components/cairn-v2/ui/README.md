# Cairn UI foundation

This layer owns presentation contracts shared by the beta screens. It does not own portfolio calculations, account access, persistence, data freshness, or currency conversion.

## Layers

- `tokens.module.css`: scoped color, typography, spacing, radius, and focus variables. Apply `scope` to the shell and portal/dialog surface. Existing Cairn color variables remain authoritative.
- `atoms.tsx`: `IconButton`, `StatusPill`, and `ValueText`. These units own visual states and accessible labels; they contain no fetching or effects.
- `molecules.tsx`: `CardHeader`, `DetailHeader`, `SectionHeading`, `Metric`, `MetricGroup`, and `EmptyState`. These units compose atoms and establish consistent heading and numeric hierarchy.
- `format.ts`: finite, bounded display formatting. Missing values remain an em dash. Formatting is never used to calculate or reconstruct financial values.
- Feature components outside this folder own chart selection, forms, filters, and domain-specific explanations. Server read adapters remain under `lib/cairn-v2`.

## Usage rules

Use `CardHeader` for home card titles and expansion actions. Use `DetailHeader` for page and expanded-panel titles. Its optional `headingProps` preserves a heading ID, ref, and focus destination. Use `SectionHeading` for meaningful sections, not for every text label.

`Metric` renders `dt` and `dd` inside a wrapping `div`; place it inside `MetricGroup` or an existing `dl`. Pass an already formatted display value and a separate unit. A missing numeric value must not be formatted as zero or assigned a positive/negative tone.

Keep stateful controls at the feature boundary. These components intentionally have no client directive; they can be rendered from Server Components or imported into a client interaction subtree. Do not introduce a barrel that imports every feature or chart into the home client graph.

Prefer composition to growing configuration objects. Introduce another atom only when multiple surfaces need the same behavior and semantics. Domain values, provenance and authorization stay in their existing read contracts.

## Sale exclusions

`../../sale-exclusion-picker.tsx` is a controlled feature control. Search only filters the visible options. Selected values remain in controlled state and hidden form inputs while searching. Chips, checkboxes and clear-all all call the same `onChange`; selecting a row does not calculate, save or place a trade. The caller applies the draft with its existing Calculate action.
