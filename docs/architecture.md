# Architecture

The desktop shell in `src-tauri/` hosts the React application in the platform WebView. Vite serves the UI on loopback during development and bundles static assets into the desktop build. Two commands scoped to the main window load and save theme and pane widths in a small JSON file under the application configuration directory. The packaged build uses a restricted content security policy.

The React shell in `src/app/` coordinates folder, search, filters, selection, and appearance. It reads static fixtures from `src/features/mail/demo-mail.ts` and renders message bodies as plain text. The example image and download links resolve to assets bundled with the app. The compose preview keeps new message text in memory for the session.

As real account support is added, Rust will own mail transport, MIME, credential storage, SQLite, and background tasks. React will consume narrowly scoped typed commands and events. Account credentials belong in the OS credential store. Message HTML will require sanitization and isolation before it can be rendered.

## Sample image

The image at `public/demo/dolomites.jpg` was generated with the built-in image generation tool from this prompt.

> Use case: photorealistic-natural. Asset type: wide travel photograph embedded in a sample desktop email. Create an original panoramic high-Alps landscape, jagged snow-covered Dolomite ridges above low clouds with blue shadow and gentle peach-lavender sunrise light, photographed from a distance. The most distinct ridge runs across the middle third so it survives a wide 2.9:1 center crop. Quiet realistic editorial photography, crisp ridges and atmospheric depth. Full bleed, no borders, people, text, logos, or watermark.
