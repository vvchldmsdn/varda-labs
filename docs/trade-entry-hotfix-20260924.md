# Trade-entry hotfix — 2026-09-24

Base: `3bd12a07a454552f2d8c51042b7a363c6d370258`.

The existing `/portfolio/ledger` records buys/sells and cash events; it does not place brokerage orders. This hotfix will expose its existing protected flow from the primary navigation and management screen, preserve the requested trade action through account initialization, and make buy/sell selection explicit.

No ledger arithmetic, DB migration, authorization policy, provider activation or production data mutation is authorized by this UI patch. Existing B/C rollout gates remain unchanged. The hotfix branch disables automatic Vercel Preview deployment because inherited Preview configuration was previously documented as unsafe. Production remains unchanged until the reviewed patch passes verification and is merged.

Verification must distinguish isolated UI/API doubles from real authenticated Production. Read the installed Next.js guidance before application edits. Run relevant behavior tests, lint and build, then browser checks at desktop and mobile sizes. Do not treat workflow preparation or a deployment status alone as end-user verification.

Status: read-only preparation; application patch and verification pending.
