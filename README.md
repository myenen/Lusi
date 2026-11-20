# Lusi

Lusi is a lightweight, privacy-focused desktop mail client in development for macOS and Windows. The current preview uses a sample mailbox you can explore without adding an account.

![Lusi in light mode with the folder sidebar, message list, and an open sample email](docs/screenshots/lusi-light.jpg)

[View dark mode](docs/screenshots/lusi-dark.jpg)

## What works today

- Three resizable panes, with a collapsible icon rail on desktop and a folder drawer and list-to-reader view in narrow windows.
- Search the current folder or all mail, sort by date, and filter by unread, starred, or attached files.
- Archive or move messages to Trash, undo the last move, and restore messages from Trash. Snooze a message for one hour or until 09:00 the next day, then use the Snoozed folder to end a snooze early.
- The reader displays plain text, previews supported image and text attachments, and shows a collapsible Smart Summary card with sample content and loading, unavailable, and error states.
- Compose, reply, reply all, and forward in the sample mailbox. Drafts appear in Drafts when edited and retain local attachments. Demo send validates recipients and moves the message to Sent. Use `fail@example.test` to try the failure state. Drafts and mailbox changes last until the window is reloaded.
- The desktop build remembers the theme and pane widths locally.
- Liquid Glass and Flat themes with different shapes, surfaces, density, and motion. Both support light and dark appearance.
- Turkish and English. The interface follows the system language by default, with English as the fallback. Hover over the appearance controls or focus them with the keyboard to reveal the language and theme settings.

Real account setup, sending, sync, and notifications are planned.

## Preview in a browser first

Install Node.js 24 LTS, then run these commands from your terminal.

```sh
git clone https://github.com/myenen/Lusi.git
cd Lusi
npm ci
npm run dev -- --port 1421
```

Open [the local HTML preview](http://127.0.0.1:1421/). It runs the interactive Lusi interface with the sample mailbox. Desktop-specific behavior can be verified in Tauri after the interface review.

## Run the desktop development build

Install stable Rust in addition to Node.js 24 LTS. Follow the [Tauri platform prerequisites](https://v2.tauri.app/start/prerequisites/) for Xcode or the Windows build tools and WebView2.

```sh
npm ci
npm run tauri -- dev
```

## Build an installer

On macOS, run `npm run tauri -- build --bundles dmg -- --locked`. On Windows, run `npm run tauri -- build --bundles nsis -- --locked`. Tauri writes the development installers under `src-tauri/target/release/bundle/`. [Desktop CI](https://github.com/myenen/Lusi/actions/workflows/ci.yml) is configured to retain both installers as workflow artifacts.

To install the macOS preview, open the DMG and drag Lusi to Applications. On Windows, open the installer and follow its prompts. There is no published release yet. Preview installers may trigger OS trust warnings.

See [CONTRIBUTING.md](CONTRIBUTING.md) for development checks, [the architecture overview](docs/architecture.md) for application boundaries, and [the design guidelines](docs/design-guidelines.md) for the interface direction.
