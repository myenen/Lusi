# Architecture

The desktop shell in `src-tauri/` hosts the React application in the platform WebView. Vite serves the UI on loopback during development and bundles static assets into the desktop build. Two commands scoped to the main window load and save the theme, language choice, pane widths, and sidebar state in a small JSON file under the application configuration directory. The packaged build uses a restricted content security policy.

The workspace fills the desktop content area. On macOS, the native title bar is overlaid on the workspace so the system window controls sit above the sidebar. Only the main macOS window can use the drag region. The browser preview reserves the same space on macOS, and Windows uses its native title bar.

The React shell in `src/app/` coordinates folder navigation, search, unread filters, selection, and appearance. It loads the connected Inbox snapshot from the desktop core and opens setup in light Liquid Glass when the account store is empty. The browser preview shows account setup. Fresh preferences default to light Liquid Glass.

The typed catalog in `src/app/i18n.ts` contains English and Turkish interface text. The desktop reads the preferred OS locale when it loads preferences. The browser preview uses the browser language. Unsupported languages fall back to English.

The theme registry in `src/app/themes.ts` resolves saved theme IDs and follows OS appearance in system mode. Theme stylesheets set colors, radii, spacing, surface effects, and motion through CSS variables. Scoped component rules can refine layout within a theme. Rust stores the theme ID separately from the system, light, or dark preference.

The Rust mail core discovers implicit TLS settings using the domain’s `_imaps._tcp` DNS SRV record with a bounded lookup. Lusi shows the discovered hostname and port and asks for explicit confirmation when the server uses another domain. The DNS query contains only the email domain, and the app only connects to the server after the user submits the sign-in form. When there is no usable record, setup offers manual TLS settings.

The Rust mail core signs in over implicit TLS with certificate and hostname verification. Rust stores the password in macOS Keychain, Windows Credential Manager, or Linux Secret Service and uses an SQLite migration for connection metadata and the recent Inbox header snapshot. The snapshot is replaced atomically on refresh. A message key contains its UID and UIDVALIDITY, which the reader checks again before fetching the message.

IMAP LIST discovers selectable folders. Lusi localizes folder roles when the server provides special-use attributes and keeps the original mailbox name for protocol commands. The inbox snapshot remains cached on disk. Other folder headers are loaded on selection. Messages open read-only and are identified by folder, UIDVALIDITY, and UID. The WebView renders text through React. SMTP, provider-specific OAuth, and background sync will use the same command boundary.
