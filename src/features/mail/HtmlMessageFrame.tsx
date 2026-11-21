import { useLayoutEffect, useRef } from 'react';
import { htmlMessageTheme } from './html-message-theme';

export function HtmlMessageFrame({ content, title, language, themeId, colorScheme }: {
  content: string;
  title: string;
  language: 'en' | 'tr';
  themeId: string;
  colorScheme: 'light' | 'dark';
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  useLayoutEffect(() => {
    const element = frame.current;
    if (!element) return;
    const stylesheet = htmlMessageTheme(element, colorScheme);
    const document = `<!doctype html>
      <html lang="${language}">
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <meta name="color-scheme" content="${colorScheme}">
        <meta name="referrer" content="no-referrer">
        <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: https:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-src 'none'">
        <style>${stylesheet}</style>
      </head>
      <body class="mail-theme">${content}</body>
      </html>`;
    if (element.srcdoc !== document) element.srcdoc = document;
  }, [content, language, themeId, colorScheme]);
  return <iframe ref={frame} className="message-html-frame" sandbox="" referrerPolicy="no-referrer" title={title} />;
}
