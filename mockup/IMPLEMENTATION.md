# POS browser mockup implementation plan

> For agentic workers: implement the independent data/assets tasks in parallel, then integrate and review the browser flows.

**Goal:** Build an interactive Thai retail POS mockup inside `mockup/`, based on `../plan/pos-mvp-spec.md`.

**Architecture:** A dependency-free browser app with local SVG assets and browser-local demo data. Classic scripts allow opening `index.html` directly. This prototype demonstrates the UI and business rules; production React/API/SQLite transactions, secure authentication, cloud backups and restoration remain outside this mockup.

**Tech stack:** HTML, CSS, JavaScript, localStorage, native dialogs and browser print. Node's built-in test runner checks the data model.

**Spec:** `../plan/pos-mvp-spec.md`

## Global constraints

- Thai interface, THB displayed to two decimals, business dates in Asia/Bangkok.
- Money calculations use integer satang; quantities are whole units; stock cannot be negative.
- Cash only. No discounts, separate taxes, membership, QR/card or profit calculation. Partial returns and purchase-cost history are covered by the later modules below.
- All assets are local; the browser app does not require a CDN or installation.
- Keep original bills, stock movements, cash movements and audits; closed-shift results are snapshots.
- Do not stage, commit, publish or change existing branches as part of this task.

## Design

- A calm shop-counter workspace: white surfaces, mist `#F4F7F6`, ink `#24352F`, emerald `#147D64`, amber `#E9A34A`, muted `#78857E`.
- Local Thai font stack: Leelawadee UI, Tahoma, sans-serif. Clear numerals, generous controls, restrained borders and no decorative dashboard hero.
- Desktop layout: compact navigation, product search/category/grid in the center, a persistent cart on the right. Narrow screens stack the cart under products.
- Original grocery package illustrations distinguish products without external images.

## Task 1: Data model and rules

Files: `assets/js/store.js`, `store.test.cjs`.

Expose `POSData.createStore({storage,key})` in the browser and a CommonJS export for tests. Public API: `getState`, `setUser`, `saveProduct`, `adjustStock`, `checkout`, `recoverCheckout`, `getPendingCheckout`, `voidSale`, `openShift`, `closeShift`, `addCashMovement`, `shiftSummary`, `dailySummary`, `saveUser`, `recordBackup`, `setOnline`, `reset`. Export `parseMoney` and `money` helpers.

State: products, users, currentUserId, shifts, activeShiftId, sales, stockMovements, cashMovements, audit, backup, online, pendingCheckout. Products have `id,name,sku,barcode,price,stock,category,image,active`. Sale lines retain historical product names, SKU and unit prices.

- [x] Seed a realistic shop, products, owner/cashier, open shift and linked sample bills.
- [x] Verify A01 cash/stock, idempotent replay/conflict, price changes, stock limits, owner-only same-open-shift void, A09 cash reconciliation, closed-shift gating, storage failure and zero/invalid quantities.
- [x] Run `node --test --test-isolation=none mockup/store.test.cjs`.

## Task 2: Product illustrations

Files: `assets/products/*.svg`.

Image keys: milk, water, coffee, tea, soda, noodles, rice, oil, fish, bread, snack, soap, shampoo, tissue, eggs, sugar. Local standalone SVGs, 160×160 viewBox, original product packaging with coherent soft shadows and varied silhouettes.

- [x] Create and inspect all illustrations; no external references or embedded scripts.

## Task 3: App and UI integration

Files: `index.html`, `assets/css/styles.css`, `assets/js/views.js`, `assets/js/app.js`, `README.md`.

- [x] Build sale, inventory, history, shifts, reports, users and system screens with keyboard-accessible navigation.
- [x] Implement cart/search/categories, checkout and receipt/print, recovery state, product edits, stock receipt/count, bill void, cash movements, opening/closing shifts, report filters, role switching and backup/audit demo.
- [x] Clearly label demo status and simulated backup; avoid production durability or authentication claims.
- [x] Verify desktop/mobile layout, keyboard usage, checkout/void/stock behavior, persistence and absence of browser errors; shift rules are covered by model tests.

## Review focus

1. Duplicate checkout/void cannot change money or stock twice.
2. Cashier cannot invoke owner-only model operations.
3. Closing a shift blocks new sales; re-opening requires a new shift.
4. Price/stock changes are revalidated at checkout without silent price replacement.
5. localStorage failures leave the in-memory model unchanged and show an actionable error.

## Execution notes

Ruling: implement in the explicitly requested `mockup/` folder on the current checkout and leave existing staged IDE files alone. The user's requested artifact is a local UI mockup, so backend guarantees are documented rather than simulated as production claims.

## Returns/refunds extension (21 October 2026)

The later [returns/refunds spec](../plan/pos-returns-refunds-spec.md) supersedes the original exclusion of partial returns. The mockup now has sale-line IDs, append-only return documents, a separate cash refund ledger, owner-only partial/full returns, restock/damaged quantities, return recovery, and Bangkok day/current shift reporting. State version 1 migrates in place to version 2 while retaining existing sales and request history. `returns.test.cjs` checks migration, price snapshots, multiple returns, permissions, idempotency, void exclusion, cross-shift totals, and failure rollback. Production API/SQLite work remains in [production-readiness.md](../plan/production-readiness.md), milestone M4R.

## Purchasing/receiving extension (21 October 2026)

The [purchasing/receiving spec](../plan/pos-purchasing-receiving-spec.md) adds supplier records, draft/issued/closed PO states, partial goods receipts, rejected quantities, cost snapshots and a purchasing report. Issuing a PO changes neither stock nor cash; accepted receipt lines create `purchase_receipt` movements. Existing data migrates to state version 3 without resetting sales or returns. `purchasing.test.cjs` and `purchasing.views.test.cjs` cover quantities, idempotency, price variance, permissions, rollback, migration and report/document output. The UI exposes the full mockup flow and simulated response recovery. Production schema/API/SQLite work remains in [production-readiness.md](../plan/production-readiness.md), milestone M4P.

## Stock count extension (21 October 2026)

Module 3 follows [the stock-count spec](../plan/pos-stock-count-spec.md) and [implementation plan](../plan/stock-count-implementation.md). `stock-count.js` adds owner-created sessions, cashier entry/submission, owner recount/approval/cancellation, immutable approved results, revisions and idempotent requests. Every shared stock movement increments the product's `stockVersion`; approval rejects stale snapshots even if the balance returned to its old quantity. Only nonzero approved deltas create `count_adjustment` movements referencing count line IDs. State versions 1–3 migrate to v4 without deleting documents; persistence failures roll back the cloned state. `stock-count-ui.js` adds the tenth screen, barcode/SKU search, scope selection, role controls and print reports. Reservations are deferred to Module 5; `activeReservedQty` is a defensive integration hook, not an implemented reservation ledger. Cross-tab concurrency and durable transactions require production SQLite (milestone M4S).
