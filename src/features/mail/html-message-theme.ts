const rules = `
html {
  --mail-scroll-thumb: transparent;
  scrollbar-width: thin;
  scrollbar-color: var(--mail-scroll-thumb) transparent;
}
html:is(:hover, :focus-visible, :has(:focus-visible)) {
  --mail-scroll-thumb: color-mix(in srgb, var(--mail-muted) 58%, transparent);
}
html::-webkit-scrollbar { width: 7px; height: 7px; }
html::-webkit-scrollbar-track { background: transparent; }
html::-webkit-scrollbar-thumb { background: var(--mail-scroll-thumb); border-radius: 999px; }

.mail-theme {
  margin: 0;
  background: var(--mail-surface);
  color: var(--mail-text);
  font: 15px/1.6 system-ui, sans-serif;
  overflow-wrap: anywhere;
}

.mail-theme * {
  background-color: transparent !important;
  border-color: var(--mail-divider) !important;
  color: inherit !important;
  text-decoration-color: currentColor !important;
}

.mail-theme :is([bgcolor], [style*="background-color:"]) {
  background-color: var(--mail-surface) !important;
}

.mail-theme :is(th, pre, code) {
  background-color: var(--mail-subtle) !important;
}

.mail-theme a { color: var(--mail-accent) !important; }
.mail-theme :is(blockquote, small) { color: var(--mail-muted) !important; }
.mail-theme :is(img, table) { max-width: 100% !important; }
.mail-theme img { height: auto; }
.mail-theme pre { white-space: pre-wrap; }
`;

const tokens = {
  surface: ['--reading', 'Canvas'],
  text: ['--ink', 'CanvasText'],
  muted: ['--muted', 'CanvasText'],
  accent: ['--accent', 'LinkText'],
  divider: ['--divider', 'GrayText'],
  subtle: ['--control', 'Canvas'],
} as const;

export function htmlMessageTheme(element: HTMLElement, scheme: 'light' | 'dark') {
  const computed = getComputedStyle(element);
  const palette = Object.entries(tokens).map(([role, [token, fallback]]) => {
    const color = computed.getPropertyValue(token).trim();
    // Copy color values only. The stylesheet is embedded in a separate document.
    const valid = /^[#a-z\d(),.% /-]+$/i.test(color) && (globalThis.CSS?.supports?.('color', color) ?? true);
    return `--mail-${role}:${valid ? color : fallback};`;
  });
  return `html { color-scheme:${scheme}; ${palette.join(' ')} }\n${rules}`;
}
