# Contributing to HORIZON

HORIZON is an ambient clock for a tablet on a wall. Readability, restrained visual design and unattended reliability guide changes. Omarchy 4.5 is the first target; other desktop systems are development environments until explicitly qualified.

1. Read [the product scope](docs/PRODUCT.md) and [architecture](docs/ARCHITECTURE.md).
2. Open an issue for changes to the accepted appearance, platform support, network providers or product scope. Small bug fixes can go straight to a pull request.
3. Run `npm ci`, `npm run check`, `npm run test:e2e` and `npm run format:check`. Install Chromium for Playwright with `npx playwright install chromium`; Linux needs its documented OS dependencies.
4. For native changes, also run `npm run desktop:check` and build on the affected platform. See [development](docs/DEVELOPMENT.md).
5. Describe the user-visible behavior, validation, and remaining device checks. Include screenshots for visual changes. Redact private paths, hostnames and personal information from diagnostics.

Use meaningful conventional commit messages. Tests should verify behavior, failure cases and data boundaries, rather than duplicate implementation. Keep weather fixtures visibly confined to tests. Product screens must show missing/stale weather honestly.

Code and comments use English. The initial interface and product documents use Simplified Chinese; the README includes an English introduction. Preserve the visual design when fixing unrelated behavior.

Contributions are licensed under the project's MIT license. Preserve third-party notices. Never commit credentials, signing keys, private logs or local environment files.
