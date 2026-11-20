# Architecture

The desktop shell in `src-tauri/` hosts the React application in the platform WebView. Vite serves the UI on loopback during development and bundles static assets into the desktop build. Two commands scoped to the main window load and save the theme, language choice, pane widths, and sidebar state in a small JSON file under the application configuration directory. The packaged build uses a restricted content security policy.

The workspace fills the desktop content area. On macOS, the native title bar is overlaid on the workspace so the system window controls sit above the sidebar. Only the main macOS window can use the drag region. The browser preview reserves the same space on macOS, and Windows uses its native title bar.

The React shell in `src/app/` coordinates folder, search, filters, selection, and appearance. It combines static fixtures from `src/features/mail/demo-mail.ts` with session-only message changes, drafts, and demo sends. Message bodies and text attachment previews render as plain text. Sample attachment bytes come from app assets, and selected local files stay in memory during the session. The demo send flow does not call a mail provider.

The typed catalog in `src/app/i18n.ts` contains English and Turkish interface text. The desktop reads the preferred OS locale when it loads preferences. The browser preview uses the browser language. Unsupported languages fall back to English. The Turkish demo fixtures live in `src/features/mail/demo-mail.tr.ts`.

The theme registry in `src/app/themes.ts` resolves saved theme IDs and follows OS appearance in system mode. Theme stylesheets set colors, radii, spacing, surface effects, and motion through CSS variables. Scoped component rules can refine layout within a theme. Rust stores the theme ID separately from the system, light, or dark preference.

As real account support is added, Rust will own mail transport, MIME, credential storage, SQLite, and background tasks. React will consume narrowly scoped typed commands and events. Account credentials belong in the OS credential store. Message HTML will require sanitization and isolation before it can be rendered.

## Sample image

The image at `public/demo/dolomites.jpg` was generated with the built-in image generation tool from this prompt.

> Use case: photorealistic-natural. Asset type: wide travel photograph embedded in a sample desktop email. Create an original panoramic high-Alps landscape, jagged snow-covered Dolomite ridges above low clouds with blue shadow and gentle peach-lavender sunrise light, photographed from a distance. The most distinct ridge runs across the middle third so it survives a wide 2.9:1 center crop. Quiet realistic editorial photography, crisp ridges and atmospheric depth. Full bleed, no borders, people, text, logos, or watermark.
