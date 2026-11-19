# Minimal Mail

Minimal Mail is the working name for a lightweight, privacy-focused desktop mail client in development for macOS and Windows.

The current build opens a sample mailbox with folders, search, a plain-text reader, and system, light, and dark appearance options. Real account setup, sending, sync, and notifications are planned.

## Run the development build

Install Node.js 24 LTS and stable Rust, then follow the [Tauri platform prerequisites](https://v2.tauri.app/start/prerequisites/) for Xcode or the Windows build tools and WebView2.

```sh
npm ci
npm run tauri -- dev
```

Run `npm run dev` to preview the sample mailbox in a browser.

## Build an installer

On macOS, run `npm run tauri -- build --bundles dmg -- --locked`. On Windows, run `npm run tauri -- build --bundles nsis -- --locked`. Tauri writes the development installers under `src-tauri/target/release/bundle/`. GitHub Actions is configured to build and retain both installers as workflow artifacts.

To install the macOS preview, open the DMG and drag Minimal Mail to Applications. On Windows, open the installer and follow its prompts. There is no published release yet. Preview installers may trigger OS trust warnings.

See [CONTRIBUTING.md](CONTRIBUTING.md) for development checks and [the architecture overview](docs/architecture.md) for the application boundaries.
