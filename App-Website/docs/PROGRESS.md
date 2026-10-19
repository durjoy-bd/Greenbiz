# GreenBiz 2.0 project progress

GreenBiz 2.0 integrates the supplied APK’s multiple shops, fractional inventory, restock, voice/text checkout, payment SMS review, business/personal transactions, expenses, period reports and borrowing tools. Existing stock/sales, public invoices, payment review and consent-based bank features remain available. The Android app creates local shops without a user business server; optional account sync preserves durable operations and stops on conflicts.

Premium motion, reduced-motion preferences and optional Android haptics are implemented. The managed AI service uses hosted OpenRouter credentials and automatic installation enrollment; no provider key is bundled in the app. Separate service source and deployment details accompany the delivery.

Independent review reproduced and verified fixes for failed uncached branch switching, payment-claim IDs during replay, fractional decrement rounding and exhausted AI installation abuse. The corrected managed service passed 24 offline tests; the app passed79 unit/API tests and17 browser journeys. Android assembly, bundle, parser tests and lint succeeded. See VALIDATION.md for exact evidence and limits.

Physical-device testing, owner release signing and Play submission remain unexecuted. Official payment verification, mail recovery, bank partnerships, full Bengali UI translation and automatic backup import/device-to-server migration are not claimed. The optional cloud bank portal was not publicly deployed.
