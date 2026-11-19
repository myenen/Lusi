# Lusi — UI/UX Design Guidelines

> Version 1.0 · Desktop email client · macOS & Windows

## 1. Product direction

Lusi is a minimal, local-first, open-source desktop email client. Its interface should feel calm, clear, fast, and carefully crafted. Use an Apple-inspired **Liquid Glass** visual language without copying platform-specific proprietary assets. The latest approved direction is a detailed three-column mail interface in both light and dark themes, with translucent layered surfaces, restrained blue/violet accents, and the Lusi bird mark.

**Priority order:** readability → usability → accessibility → performance → visual effects.

## 2. Core principles

- **Quiet by default:** no busy dashboards, marketing banners, or decorative controls.
- **Content first:** email reading surfaces must be more opaque than navigation surfaces.
- **Glass with purpose:** translucency communicates hierarchy; avoid glass on every nested element.
- **Consistent cross-platform experience:** honor macOS and Windows window controls, keyboard shortcuts, and system settings.
- **Progressive disclosure:** show primary actions, place advanced actions in overflow menus.
- **Responsive desktop:** usable at compact window widths, not only full-screen.
- **Respect user preference:** system light/dark mode, reduced motion, and high contrast.

## 3. Layout

Default: three columns.

| Region | Suggested width | Contents |
| --- | --- | --- |
| Navigation sidebar | 220–250 px | Lusi logo, Compose, Inbox, Starred, Sent, Drafts, Trash, Archive, folders, accounts, settings |
| Message list | 340–400 px | Search, filters, message rows, timestamps, unread and starred states |
| Reading pane | Remaining space, min ~420 px | Subject, sender, actions, sanitized message body, attachments, reply |

- Allow resizing between panes; persist widths locally.
- At narrow sizes collapse sidebar to icons or a drawer; at smaller widths switch to list/detail navigation.
- Use a continuous window surface, not three isolated floating cards.
- Respect macOS traffic lights and Windows native title-bar conventions. Do not paint fake platform controls into the product.
- Prefer an 8 px spacing scale: 4 / 8 / 12 / 16 / 24 / 32 px.
- Corner radii: 10–14 px for controls; 16–22 px for elevated panels; avoid excessive rounding on every row.

## 4. Liquid Glass material system

Use three surface tiers:

1. **Window backdrop:** subtle, low-contrast blue/violet atmospheric tint. No distracting wallpaper is required.
2. **Navigation glass:** semi-transparent, backdrop blur, subtle inner highlight, 1 px translucent edge.
3. **Reading surface:** high-opacity, calm background to preserve long-form text contrast.

Recommended CSS starting point (tune after platform testing):

```css
:root {
  --accent: #5368ed;
  --accent-alt: #8664ef;
  --radius-control: 12px;
  --radius-panel: 20px;
  --motion-fast: 160ms;
  --motion-normal: 220ms;
}
[data-theme="light"] {
  --text: #17213a;
  --text-muted: #61708c;
  --glass: rgba(255,255,255,.64);
  --reading: rgba(255,255,255,.91);
  --stroke: rgba(255,255,255,.68);
  --divider: rgba(46,65,105,.12);
}
[data-theme="dark"] {
  --text: #edf2ff;
  --text-muted: #a8b5d1;
  --glass: rgba(24,34,61,.65);
  --reading: rgba(16,24,45,.92);
  --stroke: rgba(225,235,255,.14);
  --divider: rgba(210,225,255,.12);
}
.glass-panel {
  background: var(--glass);
  border: 1px solid var(--stroke);
  backdrop-filter: blur(20px) saturate(135%);
  -webkit-backdrop-filter: blur(20px) saturate(135%);
}
.mail-reading-pane { background: var(--reading); color: var(--text); }
@media (prefers-reduced-transparency: reduce) {
  .glass-panel { backdrop-filter: none; -webkit-backdrop-filter: none; background: var(--reading); }
}
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation-duration: .01ms !important; transition-duration: .01ms !important; }
}
```

Do not use strong neon glows, thick luminous borders, or multiple overlapping blur layers as defaults. Glass should look refined, not like a gaming dashboard. Reserve vivid accents for active selection and focus.

## 5. Typography and color

- Use system fonts: `-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`.
- Base body: 14–15 px; email reading: 15–16 px with 1.5–1.65 line height.
- Sender names: medium/semibold; subjects: semibold only for unread messages.
- Secondary timestamps and previews: muted but readable.
- Avoid text on highly transparent backgrounds; check WCAG AA contrast (4.5:1 normal text, 3:1 large text and meaningful UI graphics).
- Primary accent: blue-violet, consistent with the approved Lusi logo. Cyan is a restrained secondary accent.
- Error, success, and warning colors should have semantic meaning, not decorative use.

## 6. Components and states

### Sidebar
- Show Lusi mark at top; one clear **Compose** action.
- Folder icons should be thin, consistent, and legible at 16–20 px.
- Highlight active folder with a soft translucent pill and restrained accent.
- Show unread counts as compact badges, not oversized bright bubbles.
- Account switcher belongs at bottom or in a clearly labeled section.

### Message list
- Search input at top; compact `All / Unread / Starred` filters.
- Rows show sender, subject, one-line preview, time, unread marker, and optional star.
- Selected row: subtle tinted glass fill and crisp focus indication.
- Unread state must not depend on color alone.
- Support loading, empty, offline, error, and syncing states without layout jumps.

### Reading pane
- Top bar: Reply, Forward, Archive, Delete, More; avoid duplicate toolbars.
- Clear subject and sender metadata; expand recipients on demand.
- Sanitized HTML email body displayed in an isolated, restricted context; never inherit application privileges.
- External images are blocked or user-controlled by default to reduce tracking.
- Attachments display filename, size, file type, and download affordance.
- Reply / Reply all / Forward at bottom as a compact action group.

### Compose
- Calm, spacious editor; To, Cc/Bcc, Subject, Body, Attachments.
- Autosave drafts, clear send status, safe handling of unsent changes.
- Use the same material system but keep the editor surface mostly opaque.

### Notifications and tray
- Native OS notifications; allow hiding sender/subject/body previews.
- Tray/menu bar icon should have a high-contrast monochrome variant.
- Never depend on the colorful gradient logo at tiny 16 px sizes.

## 7. Light and dark theme

- **Light:** frosted white panels, cool pale-blue atmospheric backdrop, navy typography, subtle violet-blue highlights.
- **Dark:** deep midnight navy panels, controlled blue/violet tint, soft edge lighting, near-white text.
- Themes must be independently tuned; do not simply invert colors.
- Follow OS theme by default, with manual override saved locally.
- Test both themes with real long emails, links, tables, attachments, and images.

### Adding a theme

Liquid Glass is the default theme in `src/styles/themes/default.css`. Flat in `src/styles/themes/flat.css` changes the palette, corner shapes, panel materials, message density, and transitions. Both themes use the separate system, light, or dark appearance setting.

1. Add a stylesheet under `src/styles/themes/`. Set theme tokens in the `themes` cascade layer, scoped by `data-theme-id`. Tokens inherit from the default theme in the current appearance. Scope component layout refinements by the same ID outside the layer, as Flat does for the reply toolbar.
2. Import the stylesheet after the default stylesheet in `src/app/themes.ts` and add its ID and English and Turkish names to `themePresets`. Use a stable ID of at most 32 characters that starts with a lowercase ASCII letter and contains lowercase ASCII letters, digits, or hyphens.
3. Check the new theme in light, dark, and system appearance. Verify text, focus indicators, selection, compact windows, and reduced transparency and motion.

For example, a theme with the ID `forest` can override these tokens.

```css
@layer themes {
  [data-theme-id="forest"] {
    --radius-action: 8px;
    --navigation-filter: none;
    --row-height: 70px;
  }

  [data-theme-id="forest"][data-color-scheme="light"] {
    --accent: #22604d;
    --focus: #187454;
  }

  [data-theme-id="forest"][data-color-scheme="dark"] {
    --accent: #a3e5c9;
    --focus: #8fddb9;
  }
}
```

The theme picker appears when at least two themes are registered. The desktop stores the theme ID separately from the appearance. An unavailable theme ID displays Liquid Glass in the chosen appearance.

## 8. Motion and interactions

- Hover/focus: 120–180 ms; panel transitions: 180–250 ms.
- Use opacity and transform when possible; avoid animating blur or large shadow radii.
- No gratuitous bouncing or floating animation.
- Keyboard navigation and visible focus rings are mandatory.
- Support standard shortcuts (platform-aware) for Compose, Reply, Search, Send, and Archive.
- Confirm destructive operations when recovery is not available; provide Undo when possible.

## 9. Logo and iconography

- Brand: **Lusi**.
- Approved symbol: the abstract Lusi bird. Use the blue-violet variant in light mode and the white variant in dark mode.
- Use the approved transparent PNGs as the source for interface and application assets. Preserve their proportions. The app icon places the blue-violet variant on a light rounded tile on both light and dark desktops. Preview the icon at `/src-tauri/icons/app-icon.html` in the local Vite server.
- Export required sizes: 16, 24, 32, 64, 128, 256, 512, 1024 px as appropriate; also prepare monochrome tray icons.
- Maintain clear space and avoid putting the icon inside another unnecessary frame.
- Any visual reference mockup is guidance, not a pixel-perfect implementation requirement.

## 10. Implementation rules for AI coding agents

- Stack: Tauri 2, React, TypeScript, Tailwind CSS, Radix UI; Rust handles mail, sync, storage, and OS integration.
- Build reusable UI primitives: `GlassPanel`, `IconButton`, `SegmentedFilter`, `MailRow`, `Toolbar`, `AttachmentChip`, `ThemeProvider`.
- Centralize tokens in CSS variables. Never scatter arbitrary colors, blur values, and radii throughout components.
- Use semantic HTML, accessible labels, keyboard focus, and correct ARIA patterns.
- Keep React render work small: virtualize long mail lists; memoize only when profiling shows benefit.
- Avoid heavy animation libraries unless necessary; CSS transitions first.
- Do not implement security-sensitive email HTML using `dangerouslySetInnerHTML` in the privileged app document.
- Test WebView differences on macOS and Windows, including blur, transparency, font rendering, resizing, and DPI scaling.
- Keep all interface copy localization-ready; initial UI language may be English.
- Do not add features, screens, or dependencies beyond the agreed scope without explaining why.

## 11. Acceptance checklist

- [ ] Three-column layout is usable and resizable.
- [ ] Light and dark themes are visually coherent and legible.
- [ ] Glass effect is visible but never obscures content.
- [ ] Narrow window behavior is defined and functional.
- [ ] Keyboard navigation and screen-reader labels work.
- [ ] Reduced motion and reduced transparency are respected.
- [ ] Mail list has realistic loading, empty, unread, selected, and error states.
- [ ] Message body and attachments are readable in both themes.
- [ ] Brand icon looks good at app-icon and tray sizes.
- [ ] macOS and Windows builds are visually tested.
- [ ] No noticeable scroll lag with a large message list.

## 12. Scope and references

This document captures the agreed design direction from the Lusi concept conversation: Apple-inspired Liquid Glass, a minimalist three-column email UI, detailed light/dark views, and the approved blue-violet and white bird marks. Values are implementation starting points, not measured performance guarantees. Revisit them after testing actual Tauri WebViews on both operating systems.
