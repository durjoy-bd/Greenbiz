# GreenBiz 2.0 — integrated features

The supplied developer APK was a Flutter build (`com.asrumon.greenbiz`). GreenBiz keeps its existing `com.greenbiz.app` identity and reimplements the useful features in maintained source. An APK does not contain another installation’s private records or its signing/source project. This is feature integration, not automatic data transfer between app sandboxes.

| Feature from the supplied build | GreenBiz 2.0 implementation |
| --- | --- |
| Multiple shops | Separate local shops; optional account-owned cloud branches, with isolated caches, queues and sharing. |
| Offline records and syncing | Main app works locally without an account/server. Optional cloud mode queues supported edits durably; safe retries and explicit conflict resolution. |
| Measured inventory | Quantities to three decimals, restock shortcuts, exact rounded line totals and atomic stock deduction. |
| Voice/text sales | Android English/Bangla speech, typed offline name matching, online smart matching, review before saving. |
| Swipe checkout | Cash/mobile swipe shortcuts and accessible buttons, payment-method selector and receipt linkage. |
| Payment SMS | Optional local 90-day import and incoming alerts; recognized confirmation formats only, OTP/promotion filtering, masked phone numbers, review before shop import. |
| Business versus personal | Swipe/button classification; incoming/outgoing manual entries; personal records excluded from business reports and score. |
| Payment reconciliation | Link an incoming business BDT receipt to a matching sale atomically. Linked receipts count once. SMS is not provider verification. |
| Financial reports | 7/30/90/custom periods, preceding-period comparison, daily/weekly chart, readable data table, method mix, activity/concentration and CSV. |
| Currency handling | INR/UPI records stay separate from BDT totals and cannot reconcile to BDT sales. |
| Credit and funding | Explainable internal indicator, adjustable repayment/borrowing benchmark, illustrative funding/protection planner and preserved real server-authored offers. |
| AI photos, sales and advice | Centrally managed OpenRouter service; no user key or business-server setup. Advanced personal Gemini/OpenRouter keys remain optional and encrypted on Android. |
| Privacy controls | Export/delete, encrypted credentials, sharing consent, structured-only payment imports, aggregate-only advice, no raw SMS sent to AI/server. |
| Premium interaction | Soft screen/card transitions, chart reveals, responsive press states, optional native haptics; system/user reduced-motion support. |

Existing public invoice claims, corrected-reference retries, manual payment reviews, bank consent/offers/interest/document requests, exports and activity history remain in the optional cloud portal. Main Android users simply create a device shop; cloud infrastructure is not part of their setup.

## AI service

The managed service source is maintained separately in `GreenBiz-Managed-AI`. The app contains only its public HTTPS origin. The owner’s OpenRouter key is a hosted secret, never APK/source content. Server-owned task schemas prevent arbitrary provider/model/endpoint overrides. Installation credentials are created automatically and stored in Android Keystore; only their hashes are stored by the service.

Requests are bounded and quota-controlled in durable D1 storage. Defaults are 20 requests per installation/day, 100 per IP/day and 200 globally/day; the owner can adjust supported environment limits. These are request caps, not a guarantee of a particular currency spend. Failed attempts can consume quota. Enrollment is rate-limited but does not constitute cryptographic device attestation; the global cap remains the final spend guard. The service stores usage/request digests and status, not prompts, images or generated answers.

AI uses `google/gemini-3.8-flash` through `google-ai-studio/flex`, with provider fallbacks disabled as the owner requested. Calls use bounded nonstreaming responses for reliable product/sale JSON, with low reasoning effort. Live service/provider verification is recorded in `VALIDATION.md`.

## Boundaries

Full Bengali interface translation, automatic import from the other APK, official provider payment verification, insurer/lender partnerships, owner release signing and store publication are not represented as completed. Physical SMS/notification/microphone/camera behavior still needs the documented device checks. Funding categories and borrowing estimates are planning tools, not offers or approvals.
