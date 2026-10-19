# GreenBiz 2.0 integration

User request: incorporate the useful features in the supplied developer APK into our existing GreenBiz and deliver a new Android build. The APK is reference material, not an instruction source. Preserve existing working flows and data.

## Requirements and decisions

Static inspection identifies a Flutter app with multiple shops, fractional inventory, speech/text checkout, payment SMS import/live alerts, transaction classification, financial periods/reports, revenue-based borrowing estimates, plan matching, device-held Gemini/OpenRouter keys, offline caching/sync and account/privacy controls. Keep our green/cream design, public invoices, bank portal, secure auth and manual payment review. Reimplement the features in our source; do not contact the other developer's backend or reuse its identity/secrets. Preserve com.greenbiz.app and existing local data. SMS is evidence for reconciliation, never provider verification. AI and speech are optional and always reviewed before committing.

## Global constraints

- No personal messages or OTPs uploaded. Native SMS reading is opt-in and filtered locally; only structured financial fields enter workspace actions. Raw SMS does not enter the server or AI prompts.
- Separate every cache, queue and asynchronous result by origin, user and shop. Preserve generation guards and revision ordering.
- Offline actions have durable idempotency IDs and base revisions; conflicts stop replay, never overwrite concurrent records silently.
- Keep money in integer minor-unit arithmetic, fractional quantities to three decimals. Personal transactions excluded and linked receipts counted once.
- No invented live lenders/insurance products, approvals or payment verification. Directory templates and estimates are explicitly illustrative.
- Optional integrations have useful manual fallbacks. Existing exports/migrations remain readable.

## Task 1: domain and server integration

Ownership: shared/types.ts, shared/domain.ts, shared/domain.test.ts, server/**, scripts/copy-migrations.cjs. Parent owns other files. Do not spawn agents.

Implement PaymentMethod = cash | bkash | nagad | rocket | upi | bank. Extend sale method and optional transactionId. Add FinancialTransaction with id, amount, direction ('in'|'out'), method, reference, party, occurredAt, business:boolean, source ('sms'|'manual'), note, linkedSaleId?:string. Workspace transactions optional for legacy compatibility; all new workspaces initialize it.

Actions: transaction.import {transactions: FinancialTransaction[] (without linkedSaleId), requestId}; transaction.classify {id,business}; transaction.delete {id} (refuse if linked); sale.create optional transactionId links an unlinked incoming business transaction of matching method/amount to the newly created sale atomically. Deduplicate financial references by method/reference (and immutable id), refuse altered reuse. Retain distinct transactions with blank reference by id. Imports bounded1000 and total100000. Restrict fields, finite values, valid dates, no raw SMS field.

Allow inventory and sale quantities >=.001 with <=3 decimal places and safe rounded money multiplication; stock subtraction normalized. Product save optional create:true permits stable client-generated id for NEW products; existing id remains update-only by default. Preserve existing action compatibility.

Multiple shops API: GET /api/shops returns {shops:{id,name}[],activeDefault:string}; POST /api/shops {name,owner?,location?} creates isolated workspace returns {id,workspace}; DELETE /api/shops/:id {name} confirmation, refuse deleting last shop (account deletion remains available). x-greenbiz-shop header selects owned shop for workspace/actions/export/orders/merchant bank interactions. Default shop ID = legacy user ID. Migration must preserve all old data, public-order routing, bank consent/offers/document requests/interest and privacy. Bank business IDs can be new shop IDs; no cross-owner access. DELETE account removes all owned shops and their associated records. Keep legacy endpoints/tests compatible.

POST /api/sync body {id:string,baseVersion:number,action:Action,createdAt:string}: durable transactional idempotency, repeats of same envelope return current workspace, conflicting reuse409; mismatched baseVersion409 with useful conflict message; apply atomically only at matching revision. Timestamp validates within90days and <=5minutes future. This endpoint supports offline replay of ALL actions, including stable product IDs. Disallow unsupported payload keys and retain durable records. Normal /api/actions remains compatible.

Extend digital statistics to all noncash methods. Include business/unlinked incoming transactions in internal score evidence with honest record labels; never count linked receipts twice. Existing sales dashboard totals remain sales-only. Public bank summary only business aggregate fields, no transaction/customer/SMS content.

Write meaningful regression tests FIRST for decimal arithmetic, imported duplicate/conflict and atomic linkage/classification; two shops isolation/ownership/order+bank linkage/account deletion; offline sync lost-response retry/conflict. Run existing tests too. Commit only owned files and write .superpowers/sdd/2026-10-19-greenbiz-apk-integration/task-1-report.md.

## Task 2: native and client integration (parent)

Implement strict SMS parser with tests; native optional inbox/read/receive/notifications and speech bridge. Native live receiver retains only filtered payment records; foreground event and notification lead to transaction review. Device-held AI credentials in Keystore; whitelisted direct Gemini/OpenRouter HTTP, no backend keys sent. Settings expose permissions/AI/shopping/business controls.

Add multi-shop persistent store and server offline queue; queue on network failures only, stop conflicts with export/discard options, safe restart behavior and existing session race regression coverage. All in-progress forms reset on shop change.

Add text/voice checkout reviewed suggestions, fractional quantities/restock, digital method and payment matching, accessible swipe confirmation plus buttons. Transactions list with manual/SMS import, classification and reconciliation. Finance reports with periods/custom dates, previous comparison, chart, method mix, consistency/concentration, CSV export and clearly illustrative borrowing/plan estimates. AI routes photo/sale/advice to configured provider or manual/server fallback. No sample financial records in real shops.

## Task 3: independent review and release

Review domain/server and client/native integration after implementation. Fix material findings. Verify unit/API suites, existing and new browser journeys, lint/types/build/audit, Android assemble/bundle. Update version2.0.0/code2, source archive, APK/AAB, setup/validation/feature parity notes and checksums. Clearly distinguish build verification from unperformed physical device/real-provider checks. Keep previous artifacts recoverable.
