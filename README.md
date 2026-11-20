# Lusi — Let your messages flow.

![Lusi, an email client for a simpler, focused inbox on macOS, Windows, and Linux](docs/screenshots/lusi-banner.png)

Inspired by *Luscinia*, the nightingale, Lusi was born from a simple idea: communication should feel natural, effortless, and free.

Just as a little bird carries its song across the distance, Lusi helps your messages find their way.

No unnecessary noise. No complexity. Just your messages, beautifully presented.

Lusi is a lightweight, privacy-focused desktop mail client in development. Preview builds target macOS, Windows, and Linux and use a sample mailbox you can explore without adding an account.

## Download the test build

Open [GitHub Releases](https://github.com/myenen/Lusi/releases) and choose the asset for your system.

| Platform | File | Setup |
| --- | --- | --- |
| macOS (Apple Silicon and Intel) | `.dmg` | Open the disk image and drag Lusi to Applications. |
| Windows (x64) | `-setup.exe` | Run the installer. It downloads WebView2 if the runtime is missing. |
| Linux (x86-64) | `.deb` or `.AppImage` | Use the package installer on Debian/Ubuntu, or mark the AppImage executable and open it. AppImage support depends on your distribution and its FUSE support. |

Preview installers ship with SHA-256 checksums. macOS builds are ad hoc signed without Apple notarization and Windows builds have no publisher signature, so either OS may show a trust warning or enforce its local policy.

## What works today

- Three resizable panes, with a collapsible icon rail on desktop and a folder drawer and list-to-reader view in narrow windows.
- Switch between two demo accounts from the account picker at the bottom of the sidebar. Each account keeps its own messages, drafts, and sent mail during the session.
- Search the current folder or all mail, sort by date, and filter by unread, starred, or attached files.
- Select messages individually or select all visible results. Archive, move to Trash, restore, or change read status in bulk. Undo reverses the whole batch.
- Archive or move messages to Trash, undo the last move, and restore messages from Trash. Snooze a message for one hour or until 09:00 the next day, then use the Snoozed folder to end a snooze early.
- The reader displays plain text, previews supported image and text attachments, and shows a collapsible Smart Summary card with sample content and loading, unavailable, and error states.
- Compose, reply, reply all, and forward in the sample mailbox. Drafts appear in Drafts when edited and retain local attachments. Demo send validates recipients and moves the message to Sent. Use `fail@example.test` to try the failure state. Drafts and mailbox changes last until the window is reloaded.
- The desktop build remembers the theme and pane widths locally.
- Liquid Glass and Flat themes with different shapes, surfaces, density, and motion. Both support light and dark appearance.
- Turkish and English. The interface follows the system language by default, with English as the fallback. Hover over the appearance controls or focus them with the keyboard to reveal the language and theme settings.

Real account setup, sending, sync, and notifications are planned.

## Screenshots

![Lusi in light mode with the folder sidebar, message list, and an open sample email](docs/screenshots/lusi-light.jpg)

[View dark mode](docs/screenshots/lusi-dark.jpg)

## Preview in a browser first

Install Node.js 24 LTS, then run these commands from your terminal.

```sh
git clone https://github.com/myenen/Lusi.git
cd Lusi
npm ci
npm run dev -- --port 1421
```

Open [the local HTML preview](http://127.0.0.1:1421/). It runs the interactive Lusi interface with two sample mailboxes. Desktop-specific behavior can be verified in Tauri after the interface review.

## Run the desktop development build

Install stable Rust in addition to Node.js 24 LTS. Follow the [Tauri platform prerequisites](https://v2.tauri.app/start/prerequisites/) for Xcode or the Windows build tools and WebView2.

```sh
npm ci
npm run tauri -- dev
```

## Build an installer

On macOS, run `npm run tauri -- build --bundles dmg -- --locked`. On Windows, use `--bundles nsis`. On Linux, use `--bundles deb,appimage` after installing the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/). Tauri writes native builds to `src-tauri/target/release/bundle/`. A build with `--target universal-apple-darwin` writes to `src-tauri/target/universal-apple-darwin/release/bundle/` and requires both Rust macOS targets. [Desktop CI](https://github.com/myenen/Lusi/actions/workflows/ci.yml) builds and retains the installers for all three platforms.

See [CONTRIBUTING.md](CONTRIBUTING.md) for development checks, [the architecture overview](docs/architecture.md) for application boundaries, and [the design guidelines](docs/design-guidelines.md) for the interface direction.
