# GreenBiz managed AI delivery

Public service: https://greenbiz-ai-service.dearjelly6.chatgpt.site

Published on 19 October 2026, saved version 4. Service source commit: 5b57b15374e8ebbc2cb77db3e7d921c884c548e1. The companion source directory is GreenBiz-Managed-AI in the combined delivery archive.

The Android APK contains only the public origin. OPENROUTER_API_KEY, OPENROUTER_MODEL and OPENROUTER_PROVIDER are hosted secrets in this owner-managed Sites project. No ordinary user supplies a key or operates a business server. Automatic installation credentials are encrypted on Android; service records store their hashes.

Configured model google/gemini-3.8-flash, only provider google-ai-studio/flex, fallbacks disabled. Bounded nonstreaming output with low reasoning effort supports strict stock/sale JSON. Upstream requests use manual redirect handling and reject all non-success status codes; credentials are never forwarded to a redirect target.

Defaults: 20 requests/device/day, 100/IP/day, 200 globally/day, using UTC. Supported positive-integer hosted settings DEVICE_DAILY_LIMIT, IP_DAILY_LIMIT and GLOBAL_DAILY_LIMIT can be adjusted by the owner; deployment applies new environment revisions. New enrollment is limited to 10/IP/day. These are conservative request limits, not a currency budget. Maintain OpenRouter spending limits/credits and review usage. Failures may consume quota. Anonymous enrollment is not device attestation.

The managed service stores installation hashes, IP digests, daily counters and request ID/digest/task/status metadata. It does not store prompts, selected photos, sale text, aggregates or answers. OpenRouter and its provider receive the selected payload. Raw SMS and personal transactions are excluded from constructed advice context; users should omit personal details from free text. Business records remain local unless the user separately chooses the optional cloud portal.

Live health, enrollment, advice, sale matching and blank-image analysis passed after publication. 24 service tests include actual SQLite and Workers runtime checks. Real product-recognition accuracy and physical Android camera/speech/SMS behavior still need device evaluation. AI suggestions always require user review.

For future maintenance, reuse project_id from GreenBiz-Managed-AI/.openai/hosting.json, store secrets through Sites environment controls, push/package the exact source revision, save a new version and deploy. Do not create another project or place credentials in .env/source/APK. The native app needs no rebuild for a provider credential change at the same service origin. The service README documents API contracts and operations.
