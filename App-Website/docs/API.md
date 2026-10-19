# GreenBiz API

All routes use JSON. Errors are `{ "error": "Readable message" }` with an appropriate HTTP status. Amounts are taka, rounded to two decimal places before arithmetic. Quantities are nonnegative numbers with up to three decimal places. Product/sale quantities cannot exceed 1,000,000; an individual money input cannot exceed 1,000,000,000 taka. Unsafe integer arithmetic is rejected. All API responses use `Cache-Control: no-store`.

## Sessions and origins

Web sessions use a `greenbiz_session` cookie (`HttpOnly`, `SameSite=Strict`, `Secure` in production). Web session JSON contains only `{user:{id,email,role}}`. Every web mutation must send the browser's `Origin` matching `PUBLIC_ORIGIN`; a missing or foreign origin is rejected. Configure the exact public frontend origin, including the development port. GET requests do not require an Origin header.

Native requests send `x-greenbiz-client: native`. Register/login return `{user,token}` for these requests. Subsequent private calls send `Authorization: Bearer <token>` with that native header. A native request without an Origin may mutate; cookie-bearing requests cannot use this exemption. The bounded Capacitor origins `capacitor://localhost`, `http://localhost`, and `https://localhost` are allowed with native bearer authentication. They cannot authenticate through a web cookie. Use the native Keystore storage supplied by the Android client for tokens.

Opaque tokens have 256 bits of randomness; only their SHA-256 hashes are stored. Sessions expire after seven days and can be revoked. Session JSON never contains password hashes. Bank accounts are created by the administrator command documented in `SERVER.md`, never by public registration.

## Authentication

| Method and route | Body | Result |
| --- | --- | --- |
| `GET /api/health` | — | `{status:"ok",ai:boolean,bkashVerification:false,passwordRecovery:false,persistence:"sqlite"}` |
| `POST /api/auth/register` | `{email,password,shopName,owner,location,phone,bkash}` | Session; creates a merchant with an empty workspace |
| `POST /api/auth/login` | `{email,password}` | Session; generic invalid-credential error |
| `GET /api/auth/me` | — | `{user}` |
| `POST /api/auth/logout` | — | `{ok:true}`; revokes current session |
| `POST /api/auth/logout-all` | — | `{ok:true}`; revokes all own sessions |
| `DELETE /api/auth/account` | `{password}` | `{ok:true}`; verifies password and cascades own server records |
| `POST /api/auth/forgot-password` | `{email}` | `503`: recovery delivery is unavailable; no email is claimed to have been sent |

Passwords must be at least 10 characters, at most 72 UTF-8 bytes, and contain at least three of lowercase, uppercase, numbers, and symbols. Email addresses are normalized to lowercase. Unknown body fields, including a registration `role`, are rejected. Authentication routes are limited to 10 calls per IP per route per 15 minutes; the general API limit is 300 per IP per 15 minutes. Limits are in-memory for this single server process.

## Merchant workspace

`GET /api/workspace` returns the authenticated merchant's `Workspace` directly. Bank-authored offers are joined from authoritative offer rows. `GET /api/export` returns that same workspace JSON with an attachment filename. This export contains business records, not passwords or sessions; order invoices are maintained separately through the order routes. `POST /api/actions` accepts one of the exact actions below and returns the updated workspace directly. No client user ID or workspace ID is accepted. Unknown fields are rejected at every object boundary.

```ts
{type:'product.save', product:{id?:string,name,category,unit,description,quantity,cost,price,lowAt,source:'manual'|'photo'}}
{type:'product.delete', id:string}
{type:'sale.create', items:[{productId,quantity}], method:'cash'|'bkash'|'nagad'|'rocket'|'upi'|'bank', channel:'shop'|'facebook'|'website', customer:string, requestId:string}
{type:'payment.create', customer,order,channel,amount,trxId,requestId}
{type:'payment.review', id,decision:'manual'|'rejected',received?:number,note:string}
{type:'shop.update', shop:{name?,owner?,location?,phone?,bkash?,language?:'en'|'bn',shareScore?:boolean}}
```

Product updates require an existing ID. Sales require 1–200 nonzero cart lines. Duplicate product lines are merged, every stock check succeeds before commit, and historical names/prices/costs are copied into sale records. Deleting inventory does not delete sale history. Sale/payment request IDs are required (1–128 characters); reuse with identical action JSON returns current workspace without a second mutation, while a conflicting reuse returns `409`. Server request fingerprints are durable SQLite rows. No request records are pruned automatically.

Transaction IDs must be exactly 10 uppercase letters/digits. Reuse across recorded server claims flags the new claim `duplicate` without identifying another merchant. A submitted reference is a claim, never authoritative proof. Manual review accepts only `waiting`, `wrong_amount`, or `duplicate` records. Matching manual amounts produce `manual`; a differing amount produces `wrong_amount`; rejection produces `rejected`. Repeated settled reviews fail. Clients cannot produce `verified` payments.

Names, descriptions and notes are length-bounded. The domain keeps at most 10,000 products, 100,000 sales, 100,000 payments, 200 activity entries and 2,000 local retry signatures. Sales retain a permanent request ID in their history. The server additionally retains durable request fingerprints for both sale and payment actions, including after the local cache fills. Device-only payment retry deduplication is bounded to the 2,000-signature cache; transaction-reference duplicates are still detected against all retained payment records.

Business dates use `Asia/Dhaka` for daily, monthly and score summaries. Profit may be negative when a sale realizes a loss; money inputs remain nonnegative. A score is `null` until positive sales exist on at least seven distinct business dates. The transparent 300–900 internal indicator uses 300 base points, sale-day consistency over the last 30 dates (180), recorded digital-sales share (180), 30-day sales/current stock-cost turnover capped at 2 (120), and sale-day history capped at 90 days (120). Digital sales are merchant-entered records. This is not a bureau score or a lending decision.

## Orders and public claims

| Method and route | Body/result |
| --- | --- |
| `POST /api/orders` | Private merchant. Body `{customer,items:[{name,quantity,price}],delivery}`; result `{token,url}`. The URL is `${PUBLIC_ORIGIN}/#/pay/${token}`. |
| `GET /api/orders` | Private merchant. `{orders:[{token,total,customer,createdAt}]}` for own orders only. |
| `GET /api/public/orders/:token` | Public object `{id,customer,shop:{name,location,bkash},items:[{name,quantity,price}],delivery,total,payment:Payment|null}`. |
| `POST /api/public/orders/:token/claim` | Public body `{trxId}` only; returns the public order object. Limited to 20 per IP per 15 minutes. |

An invoice snapshots prices and shop payment instructions when created. A token is 32 random bytes encoded as hex and acts as a private capability: anyone with the link can view that invoice. Orders never expose other invoices, inventory, sales, owner email, or session data. Keep links private. Claims derive the customer, invoice ID and exact amount from the stored invoice. Retrying a reference returns its exact recorded claim, including a prior rejected claim, without adding another payment; the durable request row stores its payment ID. A different claim is allowed only after a merchant has rejected the previous one. Every exposed payment must match the invoice ID, customer, amount and website channel. Old request rows from before migration 3 have no result ID: a historical replay requiring reassociation returns `409` for merchant review, without guessing or changing the current claim. An existing mismatched invoice/payment link also returns `409` without exposing payment details. There are at most 10,000 orders per merchant. These invoice links do not decrement stock or record a sale automatically; the merchant records actual stock fulfillment separately.

## Bank portal

`GET /api/bank/businesses` is bank-only and returns `{businesses:BusinessProfile[]}`. Profiles contain only currently consenting merchants' shop identity/location and aggregate score, turnover, stock value and sales history; no product or customer records. Consent withdrawal removes future portal visibility.

`POST /api/bank/offers` is bank-only. Body: `{businessId,bank,name,kind:'loan'|'grant',amount,annualRate,months,requirements}`. The bank ID is always taken from the authenticated bank account. `bank` is a display label entered by that administrator-provisioned account. The business must currently consent. Returns `{ok:true}`. Offer amount must be positive, annual rate 0–100, duration 1–600 whole months. Nothing is disbursed.

`POST /api/bank/document-requests` is bank-only. Body: `{businessId:UUID,message:string}` with a trimmed message of 1–1,000 characters; unknown fields are rejected. The target business must exist and currently consent to bank sharing. Returns `{ok:true}` after one SQLite transaction appends a merchant activity with title `Document request`, detail containing the authenticated bank account email and message, and a server timestamp, then increments `workspace.version`. The notification appears in the merchant's persisted workspace activity (subject to the 200-activity retention limit). This records an in-app request only: it does not send email, upload documents or claim delivery through an external service. Missing business is `404`, lack of consent or a merchant caller is `403`.

`POST /api/offers/:id/interest` is merchant-only, with body `{message?:string}` (at most 2,000 characters). It requires ownership of the offered business and active sharing consent. Returns `{ok:true}`. Repeated submissions retain the original expression; there is one per business and offer.

`GET /api/bank/interests` returns `{interests:[{id,offerId,businessId,businessName,offerName,message,createdAt}]}` only for the authenticated bank's offers and currently consenting merchants. This is an expression of interest, not a submitted or approved loan application.

## Optional AI

Both AI routes require an authenticated merchant and are limited to 10 per IP per route per 15 minutes. A server `OPENAI_API_KEY` and explicit vision-capable `OPENAI_VISION_MODEL` must be configured. Otherwise they return actionable `503` errors. Provider failures/timeouts/invalid output return `502`; no fallback AI text or image detections are fabricated.

`POST /api/ai/stock` body `{image:"data:image/png;base64,..."}` accepts JPEG, PNG or WebP data URLs up to 5 MB decoded, with validated format signatures. External URLs are rejected. The server calls the official OpenAI chat completions endpoint with a 30-second timeout. Returns `{products:[{name,category,unit,description,quantity,cost,price,lowAt,source:'photo'}]}`, strictly validated and limited to 50 suggestions. Unknown quantities/prices are requested as zero. All suggestions need merchant review; they are never automatically saved to inventory.

`POST /api/ai/advisor` body `{message:string}` (1–2,000 characters) returns `{message:string}` from the configured provider. Automatically supplied context contains only the signed-in merchant's aggregates, with no product/customer names, phone numbers, transaction IDs or owner email. The user's own message is sent as entered. Neither route can approve a loan, verify a bKash claim or move money.

There is no bKash verification route. An approved provider adapter, credentials and independent testing are prerequisites for authoritative verification.


## GreenBiz 2.0 shops, transactions and offline replay

`GET /api/shops` returns `{shops:[{id,name}],activeDefault}`. `POST /api/shops {name,owner?,location?}` creates an owned branch and returns `{id,workspace}`. `DELETE /api/shops/:id {name}` requires the exact confirmation name and refuses the last shop. Account deletion removes all owned branches. Optional `x-greenbiz-shop` selects an owned workspace for private merchant operations; omitted headers preserve the legacy default shop. Orders and bank consent/offers remain bound to their actual shop IDs.

`POST /api/sync {id,baseVersion,action,createdAt}` applies one queued action atomically at the expected revision. The event timestamp must parse to a finite time within90days and no more than5minutes future; exact committed retries remain valid afterward. Durable envelope fingerprints prevent repeated commits. Conflicting revisions/envelopes return409. New queued product actions set action-level `create:true` and a stable product.id; new queued payment.create actions include a stable optional id. Legacy actions without IDs still work.

Payment methods include cash,bkash,nagad,rocket,upi,bank. `transaction.import {transactions,requestId}` accepts bounded structured FinancialTransaction records, never raw SMS; `transaction.classify {id,business}` and `transaction.delete {id}` manage unlinked receipts. `sale.create` accepts optional transactionId and atomically links an incoming business BDT receipt with matching amount/method. Linked receipts cannot be reclassified or deleted. Optional currency BDT|INR defaultsBDT; foreign receipts are excluded from BDT indicators. See shared/types.ts for the exact strict contract.

Domain retry signatures and import identity/reference metadata are SHA256 digests; older plaintext metadata is converted lazily on mutation. Tombstone IDs/digests prevent deleted records from being rescanned and silently restored. Device caches and pending operations remain scoped by origin,owner andshop.

The standalone managed AI service is a separate deployment with installation credentials; it never requires a GreenBiz business account. Its routes, quota defaults and privacy boundaries are documented in the service source README and FEATURES-2.0.md.
