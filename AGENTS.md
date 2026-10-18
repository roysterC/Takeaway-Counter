# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.

# Where things are

- `src/lib/receptionist/` — the phone receptionist. `engine.ts` (conversation
  loop) and `voice/` (turn-taking, Deepgram, ElevenLabs, signed passes) came
  from call-assistant and are deliberately kept close to it, so fixes can be
  carried across; the takeaway parts are `order-tools.ts` (the tools and what
  they do), `prompt.ts` and `session.ts`.
- `src/lib/order-draft.ts` — the order taken on one call, and the read-back
  rule: an order is only placed once it has been read back unchanged and the
  caller has spoken since. Keep that rule in code, not in the prompt.
- `src/lib/orders.ts` — placing an order (phone and counter share it). Prices,
  availability and delivery fees are re-checked against the database there.
- `src/lib/delivery.ts`, `src/lib/hours.ts`, `src/lib/menu.ts`, `src/lib/money.ts` —
  pure logic, unit-tested in `src/lib/takeaway.test.ts`.
- `src/lib/menu-data/hixon.ts` — Hixon's leaflet as seed data. The live menu
  is in the database and edited in the CRM.

# Conventions

- Money is integer pence everywhere. Prices are spoken in words
  (`spokenPrice`), never as "£7.60", because the reply goes straight to speech.
- Every table belongs to an organisation; every route scopes by
  `requireTenant()`'s `organizationId`. Routes are owner-only unless they pass
  `{ members: true }`.
- `npm test`, `npm run typecheck` and `npm run lint` before pushing.
