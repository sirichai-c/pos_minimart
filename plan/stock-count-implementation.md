# Stock count mockup implementation plan

**Goal:** Implement Module 3 in the existing browser mockup, using `pos-stock-count-spec.md` approved in chat.
**Architecture:** Keep one store and stock ledger. Isolate count operations in `mockup/stock-count.js` and count screens/events in `mockup/stock-count-ui.js`; reuse existing transactions, request keys, dialogs and Thai styles.
**Tech stack:** Plain JavaScript, HTML/CSS, localStorage, Node test runner.
**Execution:** Implement inline in this session as authorized; leave changes available for review before a separate add/commit request.

## Constraints and review focus

- Quantities are safe nonnegative integers; null means uncounted and zero means counted zero.
- Only owner creates, approves or cancels; cashier can count and submit.
- One active count; snapshot stock and per-product version; changed version requires explicit recount even when balance returns to its old value.
- Approve all lines together, with variance reasons and linked movements only for nonzero deltas; preserve original sales, cash and purchasing documents.
- Same request key/payload returns original result; different payload conflicts. Failed storage writes must leave no partial data or consumed key.
- Preserve existing demo data through version 4 migration. This is not production SQLite or cross-tab transaction isolation.
- Reservations are not implemented yet; defensively reject counts below `activeReservedQty` when supplied by a future integration.

## Tasks

- [x] 1. Write count-model tests, run RED; implement migration/version tracking and count lifecycle; run GREEN with existing suite.
  Interfaces: `createStockCount({key,userId,name,productIds?})`, `recordStockCount({key,userId,countId,productId,countedQty,varianceReason?})`, `reopenStockCountLine({key,userId,countId,productId,reason})`, `submitStockCount({key,userId,countId})`, `approveStockCount({key,userId,countId})`, `cancelStockCount({key,userId,countId,reason})`, `getStockCount(id)`.
- [x] 2. Write view tests, run RED; add navigation, create/select scope, search SKU/barcode, line count/recount, submit/approve/cancel, audit detail and printable report; run GREEN.
- [x] 3. Update guides/readiness with mockup capabilities and remaining SQLite work. Run all tests, syntax/diff checks and browser smoke test.

## Execution ledger

- Design/spec approved by user; implementation starts from `34291ac` on main. Existing staged IDE files and unrelated untracked specs are outside this task.
- Existing page/model architecture retained; no dependencies or external service changes.
- Model tests observed RED for missing lifecycle/versioning, then GREEN. Existing migration assertions updated to v4. View tests observed RED before UI implementation, then GREEN.
- Independent read-only review found per-line submission locking and historical movement-window defects. Regression tests reproduced both, then fixes passed the full 64-test suite; print summary coverage added as well. Reopening now unlocks only the requested SKU; movement evidence survives recount and closes on approval/cancellation.
- Edge browser: owner created a one-SKU count; cashier recorded 78 of 80 and submitted; receiving one unit disabled approval; owner reopened/recounted 79 of 81, submitted and approved a -2 movement. No console warnings/errors. Browser screenshot capture timed out in the connected browser; DOM/UI state verified.
- Reservation ledger and SQLite/cross-tab atomicity remain production work. Current integration only checks `activeReservedQty` when present.
