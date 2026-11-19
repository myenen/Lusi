# Architecture

The desktop shell in `src-tauri/` hosts the React application in the platform WebView. Vite serves the UI on loopback during development and bundles static assets into the desktop build. The preview has no privileged Tauri commands or window capabilities. The packaged build uses a restricted content security policy.

The React shell in `src/app/` coordinates folder, search, selection, and appearance state. It reads static fixtures from `src/features/mail/demo-mail.ts` and renders message bodies as plain text. The preview discards UI state when it closes.

As real account support is added, Rust will own mail transport, MIME, credential storage, SQLite, and background tasks. React will consume narrowly scoped typed commands and events. Account credentials belong in the OS credential store. Message HTML will require sanitization and isolation before it can be rendered.
