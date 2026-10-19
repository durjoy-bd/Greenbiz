# GreenBiz 2.1 — features restored from GreenBiz 1.x

GreenBiz 1.x was the Flutter app plus Cloudflare Worker published at <https://github.com/ASRumon/greenbiz>. Version 2.0 rebuilt it in React/Capacitor but left several 1.x features out or simplified them. Version 2.1 brings them back. They run on the device and in the optional cloud mode through the same shared domain code.

| 1.x feature | 2.1 implementation | Where |
| --- | --- | --- |
| Cash-out tolerance when attaching a payment to a sale (2% of the bill, at least ৳1) | Linking accepts a receipt inside the band. The sale keeps its own total and the receipt keeps the amount that actually moved. Rows are labelled, e.g. *+৳15 cash-out charge*. | `shared/tolerance.ts`, `shared/domain.ts` |
| Mobile-money payment sheet: last 10 minutes first, closest amount first, Refresh, *Look further back* (30 days), choose a method, *Use bKash without a message* | Payment picker opens from the sale screen or a left swipe. On Android, Refresh re-scans the inbox. Messages still waiting on the phone can be attached directly. | `src/components/PaymentPicker.tsx` |
| *The totals do not match* → *Record separately* | Picking a message outside the band asks first, then records the sale and the payment as two separate records. | `RecordSale` |
| Two-sided swipe: right = cash, left = mobile money | Left now opens the payment messages; buttons remain for accessibility. | `SwipeCheckout` |
| *Payment received* banner while selling | A message that fits the receipt and arrived in the last 10 minutes offers **Attach**. | `RecordSale` |
| Live payment sheet: *Create a sale* / *Not now, keep it in Payments*, *The message* | A global prompt appears when a payment arrives while the app is open or its notification is tapped. Creating a sale saves the payment to the active shop as business income and links it. | `src/components/LivePayment.tsx` |
| Notification with method and amount | *bKash payment received · ৳1,250 · Tap to create a sale*. The amount is hidden on the lock screen. | `SmsPaymentReceiver.java` |
| Sale receipt: *Sale recorded*, *Paid by*, *TrxID*, *Your credit score is now N/100*, *Walk-in customer* | Receipt screen after every sale, with **New sale** / **Done**. | `SaleReceipt` |
| Credit profile 0–100: consistency 30%, volume 25%, stability 25%, activity 20%; band; risk flags; *What to work on* | Ported formula and tests. It uses 90 days of business BDT records, counts linked receipts once and leaves out personal or foreign records. Shown in Growth → Credit score, alongside the 2.0 300–900 indicator that bank users see. | `shared/credit-profile.ts`, `src/screens/Loans.tsx` |
| Loan plans: 39 published Bangladeshi SME products from 8 banks, affordability matching, *High priority* (≥2×) / *Good fit* (1.3–2×) / *Stretch*, capacity at 50% of revenue, requirements and warnings, top 12 | Same catalogue (last checked 18 Oct 2026), matcher and maths, run on the device. Adds a requested-amount option, a bank filter and *Browse all 39 products*. Labelled as estimates from published terms. | `shared/loans.ts`, `shared/catalogue/`, Growth → Loan plans |
| AI advice with *Loan* / *Insurance* intents and borrowing capacity | Advisor topic selector. Only aggregates go to the AI: totals, the profile score and the loan estimate. | `src/data/business.ts`, `Growth.tsx` |
| Report periods: this week, this month, last month, last 90 days, this year, pick a month | Added alongside 7/30 days and Custom. Weeks start on Saturday, in Dhaka time. Bars are grouped day by day, week by week or month by month. | `shared/finance.ts`, `Finance.tsx` |
| Business overview: average sale, best day/week/month, top method, top payer, previous period in and out | Overview card, top payers list, the period's payments (newest 20) and a CSV export with payer and reference. | `Finance.tsx` |
| Upay and *Other* payment methods | Added to every method list, report and SMS parser. | `shared/types.ts` |
| SMS senders 16247, 16167/16248, 16216/16218/16222, 16268 (Upay); Bangla *৳ টাকা পেয়েছেন*; *received payment* wording | Added to both the TypeScript and Java parsers. Numeric short codes must match exactly, so a personal phone number is never trusted. | `shared/sms.ts`, `SmsPaymentParser.java` |
| *Stock at a glance* (value, products tracked, out of stock / running low), **Sell** from Inventory, *Out of stock* labels, price per unit | Stock screen. | `Inventory.tsx` |
| Product detail *Quick restock*: adjust the count without the full form, stock value, unit price, status | Quick restock card on the product page (−1/+1/+5/+10). | `QuickRestock` |
| Payments filters *All / SMS / Manual / Personal*, record detail (*Recorded as*, method, TrxID), flip messages (*Marked as business…*), *View message* | Filters with counts, tap-to-expand detail and classification messages. The raw message is viewable only in the on-device review queue and is never saved or synced. Shows the last inbox import time. | `Transactions.tsx` |

## Deliberately not carried over

- **Username sign-in** (1.x accepted a username or email). Cloud accounts remain email-based; changing that needs a server migration.
- **Storing raw SMS bodies with records.** 1.x uploaded message text to its Worker. 2.x keeps only structured fields. The message is readable before import, then dropped.
- **Server-side AI SMS parsing (tier 2).** 2.x parses on the device only and never sends message text to an AI provider.
- **The 1.x Worker, its backend and credentials.** Nothing contacts `greenbiz.asrumon.workers.dev`.

## Verification (19 October 2026)

- `npm run lint`, `npm run typecheck`, `npm run build`, `npm run build:server` succeed.
- Unit and API tests: 108 pass (79 before 2.1). New tests cover tolerance, the credit profile, loan maths and matching, report presets and the SMS parser.
- Browser journeys: 23 pass (17 existing + 6 new in `tests/legacy-features.spec.ts`).
- Android: see `VALIDATION.md` for the 2.1 debug build and native parser tests.
- Not done: physical-device checks of live SMS, notifications, speech and camera, and any real bank or provider verification.

To run the browser tests beside another GreenBiz dev server, set `GREENBIZ_DEV_PORT` (for example 5174) and `GREENBIZ_API_ORIGIN` (for example `http://127.0.0.1:8788`), and start the API with the matching `PORT` and `PUBLIC_ORIGIN`.
