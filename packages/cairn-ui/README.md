# Cairn UI foundation

`packages/cairn-ui/src` is the presentation authority. `src/components/cairn-ui` is a generated copy used by both frontend compositions. Existing `cairn-v2/ui` entries are compatibility exports.

## Update and verify

- Edit the canonical source, then run `node scripts/verify-cairn-ui.mjs --sync`.
- `node scripts/verify-cairn-ui.mjs` verifies source, generated output, and manifest hashes without writing.
- `node scripts/audit-cairn-ui-consumers.mjs` rejects raw visible form controls in app/component consumers. Native hidden inputs and explicitly documented chart/card/dialog controls retain their specialized contracts.
- `node scripts/test-cairn-ui.mjs` verifies native props, refs, implicit submit behavior, labels, status element semantics, SSR, source parity and drift rejection. It uses only synthetic data.

The build verifier runs both source parity and consumer coverage checks. Sync refuses to overwrite an independently edited generated file. There are no absolute workspace paths or external services in the checks.

## Component boundaries

`@/components/cairn-ui` is server-safe: presentational functions, CSS and formatting only. Inputs forward native names, values, defaults, refs, handlers, required/disabled constraints and submission attributes. Button deliberately preserves the browser default type; callers supply `type="button"` when necessary. Hidden submitted fields stay native.

The optional `Input presentation="amount"` expresses the large monetary entry treatment without overriding every input selector. Field supports an implicit wrapping label or explicit `htmlFor`; caller-provided hint/error IDs remain explicit. FormActions, FormSection, Status and headers own repeated composition and spacing. Status preserves `div`, `p` or `span`; empty live regions retain their node without drawing an empty box.

`@/components/cairn-ui/client` is a separate client boundary. `useActionFormReset` protects drafts from React 19 automatic action resets, with explicit success-only reset for creation flows. It keeps its mutable DOM reference private and returns a callback ref and reset handler. Destructure these at the call site (`const {formRef, onReset} = useActionFormReset(state)`) and pass them directly to Form. This keeps render-time prop reads separate from mutable refs and supports React Compiler checks. It does not alter action authorization or submitted FormData. Do not re-export this client hook through the server-safe barrel.

Shared headings expose `data-cairn-heading`. Legacy ancestor heading styles must exclude this marker instead of competing on cascade order. Consumer modules keep page layout and data-specific charts; they do not restyle generic control typography.
