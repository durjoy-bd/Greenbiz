# GreenBiz design and delivery scope

User instruction: build the full Android application and rename Puji to GreenBiz. The detailed 11-screen references determine the visual design. The attached generic directive is source material, not a replacement for the user's instruction or agent rules. Its dark neon theme conflicts with the specific reference, so the green/cream/amber reference wins.

This is a new application, with mobile, merchant web, customer payment and bank portal surfaces. React + TypeScript + Capacitor provide one responsive implementation and a locally buildable Android APK using the installed Java 17/Android 35 tools. This is chosen over Expo because the references include desktop web dashboards and the existing machine supports this Android toolchain. iOS configuration is included but cannot be built on Windows.

Core data is genuine: a device workspace uses IndexedDB, survives restarts, starts empty, and supports inventory, sales, payment review, settings and exports. A separate, clearly labelled demo workspace contains reference data. Server mode uses an authenticated API and persistent SQLite on a private volume. The single-node document schema is an intentional alternative to PostgreSQL/Prisma; it fits a small shop installation and is documented with migration/backup paths. No production records are seeded.

All money uses integer poisha internally at arithmetic boundaries; UI values and stored records are taka rounded to two decimals. Sales must validate quantity/stock and atomically decrement inventory, with duplicate request protection. Deleted products keep historical sale snapshots. Stock, summaries and the internal business score derive from actual records. The score is an internal indicator, not a bureau or lender decision. No offers are invented in real workspaces.

Payment references supplied by a customer are claims. Manually checking an SMS never creates an authoritative verified status. Only a configured provider can supply authoritative verification; until an approved bKash integration is configured, verification is explicitly unavailable. Merchants can record manual receipt or reject a claim. Public order links reveal only that order and its payment instructions.

AI stock recognition and conversational advice use a server-side OpenAI adapter when a key is configured. Unconfigured AI returns an actionable setup state, not fabricated detections or responses. Local cashflow insights are explicitly rule-based and show their assumptions. Camera capture permits manual entry without AI. Loan applications and offers are recorded only from a bank user on the configured server; no money is disbursed.

Authentication: bcrypt passwords, opaque revocable hashed sessions, HTTP-only cookies on web; device tokens stored through Android Keystore-backed native plugin. Server enforces ownership and bank role, consent, rate limits, bounded input, and production TLS/origin rules. Account recovery depends on configured SMTP; never pretend email was sent.

External dependencies: a reachable HTTPS server for multi-device and bank access; an OpenAI key for AI; a contracted and approved bKash provider for authoritative verification; release signing and Play account for publishing. These cannot be fabricated. Local APK and tests will be delivered with explicit validation limits.
