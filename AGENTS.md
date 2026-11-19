# Lusi — AI Development Instructions

> Canonical instructions for AI coding agents contributing to this repository. Follow these rules unless a maintainer explicitly changes them.

## 1. Product mission

Build an open-source, lightweight, privacy-focused desktop email client for **macOS and Windows**. It must be approachable for nontechnical users: download, install, add an email account, and begin reading mail. Aim for a **1–2 minute onboarding flow** for supported providers; do not promise that all providers can authenticate within that time.

Product principles, in priority order:
1. Correctness, security, and protection against data loss.
2. Simple, accessible user experience.
3. Reliability of mail sync, background operation, and notifications.
4. Low memory/CPU usage and fast perceived performance.
5. Maintainable, testable, contributor-friendly open-source code.

No proprietary backend, required registration, subscription, analytics, advertising, or tracking. The client connects directly to users' mail providers.

## 2. Approved stack

- **Desktop shell:** Tauri 2.
- **Frontend:** React, TypeScript, Vite.
- **UI:** Tailwind CSS, Radix UI primitives, Lucide icons. Do not introduce Ant Design or another heavyweight component system without approval.
- **Mail engine and background tasks:** Rust, Tokio.
- **Persistence:** embedded SQLite, with migrations.
- **Credential storage:** macOS Keychain / Windows Credential Manager through an appropriately maintained integration; never plaintext secrets in SQLite, logs, or settings.
- **Mail transport:** IMAP for retrieval/sync; SMTP for sending; standards-compliant MIME parsing/composition.
- **Desktop integration:** Tauri tray, notifications, autostart, and updater where appropriate.
- **Distribution:** GitHub Actions and GitHub Releases; macOS DMG and Windows installer artifacts.

Use well-maintained, audited dependencies where possible. Check current APIs and licensing before choosing crates/plugins. Do not invent package names or claim unverified compatibility.

## 3. Architecture and boundaries

**React is presentation only.** The Rust core owns network access, credentials, MIME handling, persistence, account state, synchronization, notifications, and background lifecycle. Communicate through narrowly scoped, typed Tauri commands/events. Avoid duplicating business logic in JavaScript.

Suggested modules (adapt to actual implementation):

```text
src/
  app/                 # shell, routing, providers
  features/accounts/
  features/mail-list/
  features/mail-reader/
  features/composer/
  features/settings/
  components/ui/       # shared glass design primitives
  lib/tauri-api.ts     # typed command/event wrappers
  styles/
src-tauri/src/
  commands/
  accounts/
  mail/                # imap, smtp, mime, sync
  storage/             # sqlite, migrations
  security/            # secrets, html policies
  background/          # connection manager, scheduler
  notifications/
  tray/
  lib.rs
.github/workflows/
docs/
```

Keep the mail core independent of the UI and as independent of Tauri as practical. Avoid a separate local HTTP server or cloud backend. Do not implement a privileged background daemon for the first release: keeping the Tauri process alive with its window hidden is sufficient. **A fully quit application cannot deliver notifications** unless a separate service is explicitly added later.

## 4. Visual and interaction design

Style: **Apple-inspired Liquid Glass**, not a literal copy of Apple Mail or proprietary assets. Use restrained frosted translucency on sidebar, toolbar, popovers, and dialogs. Keep the message reading surface substantially opaque for legibility. Support system light/dark mode, keyboard navigation, reduced motion, adequate contrast, and scalable text.

Desktop layout:
- Left: account selector, folders, unread counts; collapsible.
- Center: searchable message list with sender, subject, snippet, date, unread/star state.
- Right: safe message reader, reply/archive/delete actions, attachments.
- Responsive behavior for narrow windows; no fixed-width overflow.
- Composer should be simple, keyboard-friendly, and preserve drafts.

Prefer CSS tokens and reusable primitives over per-page styling. Minimize blur layers, repaints, animations, and frontend bundle size. Avoid gratuitous shadows, gradients, and visual clutter. Target animation durations around 150–250 ms, with reduced-motion support.

## 5. Email protocol correctness

- IMAP: discover folders, paginate headers, fetch messages on demand, handle UID and UIDVALIDITY correctly, preserve flags, and synchronize incrementally.
- IMAP IDLE where supported; fallback to configurable polling. Reconnect with bounded exponential backoff, handle offline/sleep/wake transitions, and avoid duplicate notifications.
- SMTP: authenticated sending with TLS, correct MIME encodings, attachments, reply headers, and delivery error reporting.
- After SMTP acceptance, handle saving a copy to the Sent folder according to provider behavior; do not blindly duplicate sent mail.
- Never assume folder names are English or that all servers support the same IMAP extensions.
- Account setup: known-provider presets and standards-based autoconfiguration where feasible, plus manual IMAP/SMTP setup.
- Gmail and Microsoft accounts require provider-appropriate OAuth2 flows where applicable. Never request the user's primary password for providers that disallow password authentication. OAuth app registration/consent constraints must be documented honestly.
- Preserve message identity, avoid destructive resync, and treat server state as authoritative unless an explicitly supported offline action is queued.

## 6. Security and privacy — non-negotiable

- Require validated TLS for mail connections; never silently bypass certificate validation.
- Store credentials/tokens in the OS credential store. Keep secrets out of telemetry, logs, crash reports, screenshots, and exception messages.
- Render HTML mail as untrusted content: sanitize and isolate it; disable scripts, unsafe navigation, and privileged Tauri access. Block remote images/tracking pixels by default, with explicit per-message or per-sender consent.
- Treat links and attachments as untrusted. Display actual link destinations when useful; never auto-execute attachments.
- Restrict Tauri capabilities and filesystem permissions to the minimum needed. No broad shell execution permissions.
- Validate inputs at the Rust command boundary. Use parameterized SQL queries and schema migrations.
- No analytics, third-party tracking, or upload of mailbox data to our infrastructure.
- Never commit credentials, OAuth secrets, private signing keys, real mailbox exports, or user data.
- Provide a `SECURITY.md` disclosure policy and dependency/security checks in CI.

## 7. Background operation and notifications

- Support minimize/hide-to-tray and explicit **Quit**; make close-button behavior understandable and configurable.
- System tray/menu-bar actions: Open Inbox, Check Mail, Compose, Settings, Quit.
- Support opt-in launch at login; **off by default**.
- Native desktop notifications for newly discovered messages; click opens the correct message/account.
- Offer privacy settings to hide sender/subject/preview in notifications. Respect OS notification permissions and Do Not Disturb.
- Keep background sync independent of React window visibility, but do not claim it continues after the process exits.
- Sync should be event-driven where possible and should not spin, leak connections, or aggressively poll.

## 8. Local data model

Start with `accounts`, `folders`, `messages`, `attachments`, `sync_state`, and `settings` as needed. Store only nonsecret account metadata in SQLite. Use stable account/folder/message keys and indexes for listing. Store attachment payloads in an application data directory if caching them; keep DB references. Plan schema versioning and migrations from day one. Avoid eagerly downloading every full message and attachment.

## 9. Installation and release requirements

The **end user must never need Node.js, Rust, a database server, or a terminal**. Produce installable artifacts through CI. Windows may require the WebView2 runtime; handle its prerequisite through the installer. For a polished trust experience, plan Windows code signing and macOS Developer ID signing/notarization; unsigned builds may trigger OS warnings.

Support both Intel and Apple Silicon macOS where feasible, and current supported Windows architectures. Do not advertise architecture support without a tested build. Provide checksums and clear release notes. Auto-update must use signed updates and an appropriate release channel.

**Performance goals are targets, not guarantees:** cold launch around 1–2 s, small download footprint (aspirational <30 MB), and low idle memory (aspirational <150 MB). Measure on representative Windows and macOS hardware before publishing claims.

## 10. Delivery roadmap

### v0.1 — functional alpha
- Tauri + React shell; polished light/dark glass UI with mock data.
- Account setup for one standard IMAP/SMTP provider, secure credential storage.
- Folder list, paginated inbox, safe message reader, basic compose/reply/send.
- Tray behavior, manual refresh, baseline notifications, SQLite cache.
- macOS and Windows CI builds, basic README and installation instructions.

### v0.2 — practical beta
- Multiple accounts, robust sync and IDLE/poll fallback.
- Attachments, flags, archive/delete, drafts, offline cache.
- OAuth2 integrations for supported major providers.
- Notification privacy controls, startup option, search.

### v1.0 — stable
- Reliability across diverse IMAP servers, accessibility, localization-ready UI.
- Signed distribution/update pipeline, regression tests, documentation, security review.
- Performance measurements and resolved critical data-loss/security issues.

Scope may be reordered when required for correctness; never ship insecure authentication or unsafe HTML just to meet a milestone.

## 11. Coding and quality standards

- Use TypeScript strict mode and explicit types for Tauri command payloads/responses.
- Keep React components small; separate visual state from remote data. Avoid unnecessary state libraries until complexity warrants one.
- Rust: idiomatic modules, structured errors, `Result` propagation, async cancellation, bounded retries and timeouts. Avoid `unwrap()` in production paths.
- Add unit tests for MIME parsing, sync state transitions, UIDVALIDITY handling, duplicate-notification prevention, and account configuration.
- Add UI tests for navigation, theme, message selection, and compose flow; use mocked mail data in CI.
- Integration tests must use isolated test servers/fixtures, not real personal accounts.
- CI should run formatting, linting, type checking, Rust tests, frontend tests, dependency auditing, and packaging smoke checks.
- Prefer small, reviewable changes. Document architectural decisions in `docs/adr/` when consequential.

## 12. AI agent workflow

For user-visible changes, share a working browser-based HTML preview with the maintainer before opening or packaging the Tauri app for review. Use `npm run dev -- --port 1421` from the project directory. If a flow needs native APIs, use clearly labeled sample data in the browser and explain what needs desktop verification. Continue local checks while waiting for the maintainer to review the preview. Proceed to desktop review after they have seen it and confirmed the direction.

For every implementation task:
1. Inspect the repository and identify the relevant existing code before editing.
2. State a concise plan and list files likely to change.
3. Implement the smallest complete vertical slice; preserve working behavior.
4. Add/update tests and documentation for observable changes.
5. Run the relevant format, lint, typecheck, test, and build commands available in the environment.
6. Report changed files, test results, known limitations, and the next actionable step.

Never fabricate test results, screenshots, performance measurements, security guarantees, or successful builds. Ask for clarification only when a decision materially affects security, compatibility, data loss, or product scope. Otherwise choose the simplest maintainable option and document the assumption.

## 13. Repository documentation

Maintain `README.md` (what/why/screenshots/install), `CONTRIBUTING.md` (setup, conventions, PRs), `SECURITY.md` (reporting), `LICENSE` (maintainer-selected license), and `docs/architecture.md`. Do not select a final project license or name on behalf of the maintainer without confirmation. Keep end-user documentation clear and in English initially; design UI strings for future localization.

## 14. Definition of done

A feature is done only when it works on the intended platform(s), handles errors/offline behavior, preserves privacy, has appropriate tests, meets accessibility expectations, and is documented. A release is ready only when installation and first-run account setup have been tested on clean macOS and Windows environments.

**Guiding rule:** A simple, reliable email client beats a feature-rich but fragile one.
