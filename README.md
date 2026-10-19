# GreenBiz

GreenBiz is an Android small-business app for shop owners in Bangladesh: inventory, sales, mobile-money payment matching, reports, credit profile and bank loan offers. It also ships a responsive web dashboard and an optional AI service.

## Repository layout

| Folder | What it is |
| --- | --- |
| [`App-Website/`](App-Website/) | The Android app (Capacitor), the responsive website, the optional business API, database migrations, tests and deployment files. See its [README](App-Website/README.md). |
| [`Managed-AI-Service/`](Managed-AI-Service/) | The hosted AI service behind the app's photo, sale and advice helpers, with its status website, database schema and tests. See its [README](Managed-AI-Service/README.md). |

Each project has its own `package.json` and lockfile. Run `npm ci` inside the project folder you're working on.

## Download

Installable Android builds are published on the [Releases](../../releases) page.

## Security

No API keys, signing keys or private databases are stored in this repository. Configuration is supplied through environment variables (see [`App-Website/.env.example`](App-Website/.env.example)) and hosted secrets.
