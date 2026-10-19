## What and why

## How it was checked

- [ ] `npm run lint && npm run typecheck && npm test && npm run build`
- [ ] Browser journeys (`npx playwright test`) for UI changes
- [ ] Android parser tests for SMS changes

## Checklist

- [ ] Money stays in integer poisha; no raw SMS leaves the device
- [ ] New admin actions write an audit entry
- [ ] Schema changes use a new migration file
- [ ] CHANGELOG.md updated for user-visible changes
