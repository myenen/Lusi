# Lusi — Let your messages flow.

![Lusi, an email client for a simpler, focused inbox on macOS, Windows, and Linux](docs/screenshots/lusi-banner.png)

Inspired by *Luscinia*, the nightingale, Lusi was born from a simple idea: communication should feel natural, effortless, and free.

Just as a little bird carries its song across the distance, Lusi helps your messages find their way.

No unnecessary noise. No complexity. Just your messages, beautifully presented.

Lusi is a lightweight, privacy-focused desktop mail client in development.

## Download the test build

Open [GitHub Releases](https://github.com/myenen/Lusi/releases) and choose the asset for your system.

| Platform | File | Setup |
| --- | --- | --- |
| macOS (Apple Silicon and Intel) | `.dmg` | Open the disk image and drag Lusi to Applications. |
| Windows (x64) | `-setup.exe` | Run the installer. It downloads WebView2 if the runtime is missing. |
| Linux (x86-64) | `.deb` or `.AppImage` | Use the package installer on Debian/Ubuntu, or mark the AppImage executable and open it. AppImage support depends on your distribution and its FUSE support. |

Preview installers ship with SHA-256 checksums. macOS builds are ad hoc signed without Apple notarization and Windows builds have no publisher signature, so either OS may show a trust warning or enforce its local policy.

## What works today

- When no account is connected, Lusi opens the account setup screen in light Liquid Glass.
- Three resizable panes, a collapsible sidebar, and a folder drawer on narrow windows.
- Read-only IMAP folders, message search by sender and subject, sorting, and an unread filter.
- The desktop build remembers the theme and pane widths locally.
- Liquid Glass and Flat themes with different shapes, surfaces, density, and motion. Both support light and dark appearance.
- Open Settings with the gear in the upper-right corner. The drawer contains the Account Center and system settings for appearance, theme, and language. The sidebar also provides quick access to system, light, and dark appearance.
- Turkish and English. The interface follows the system language by default, with English as the fallback.

### Connect a real mailbox

In the desktop build, start with your email address. Lusi looks for the domain’s `_imaps._tcp` DNS SRV record. If discovery returns usable settings, confirm the server details and enter your IMAP password or app password. Otherwise, enter the hostname and implicit TLS port from your provider (usually 993). The full email address is the IMAP login. Linux needs an available Secret Service keyring.

Lusi currently supports a single read-only IMAP account. The sidebar shows selectable folders discovered with IMAP LIST. Lusi caches up to 50 recent Inbox headers for startup and offline listing. Other folders load up to 50 recent headers as you open them. Open a message to read its text (up to 1 MiB). SMTP, OAuth sign-in, background sync, and notifications are planned.

## Preview in a browser first

Install Node.js 24 LTS, then run these commands from your terminal.

```sh
git clone https://github.com/myenen/Lusi.git
cd Lusi
npm ci
npm run dev -- --port 1421
```

Open [the local HTML preview](http://127.0.0.1:1421/). It shows the account setup interface. Mail and folder access require the desktop build.

## Run the desktop development build

Install stable Rust in addition to Node.js 24 LTS. Follow the [Tauri platform prerequisites](https://v2.tauri.app/start/prerequisites/) for Xcode or the Windows build tools and WebView2.

```sh
npm ci
npm run tauri -- dev
```

## Build an installer

On macOS, run `npm run tauri -- build --bundles dmg -- --locked`. On Windows, use `--bundles nsis`. On Linux, use `--bundles deb,appimage` after installing the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/). Tauri writes native builds to `src-tauri/target/release/bundle/`. A build with `--target universal-apple-darwin` writes to `src-tauri/target/universal-apple-darwin/release/bundle/` and requires both Rust macOS targets. [Desktop CI](https://github.com/myenen/Lusi/actions/workflows/ci.yml) builds and retains the installers for all three platforms.

See [CONTRIBUTING.md](CONTRIBUTING.md) for development checks, [the architecture overview](docs/architecture.md) for application boundaries, and [the design guidelines](docs/design-guidelines.md) for the interface direction.
