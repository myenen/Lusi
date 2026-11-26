import DOMPurify from 'dompurify';

const supportedStyles = ['color', 'font-family', 'font-size', 'font-style', 'font-weight', 'text-align', 'text-decoration'];

export function safeMarkup(html: string, disableLinks = false) {
  const markup = DOMPurify.sanitize(html, {
    RETURN_DOM_FRAGMENT: true,
    ALLOWED_TAGS: ['a', 'b', 'blockquote', 'br', 'code', 'del', 'div', 'em', 'font', 'h1', 'h2', 'h3', 'hr',
      'i', 'img', 'li', 'ol', 'p', 'pre', 's', 'span', 'strike', 'strong', 'sub', 'sup', 'u', 'ul'],
    ALLOWED_ATTR: ['href', 'style', 'align', 'color', 'face', 'size', 'src', 'alt', 'width', 'height'],
    ALLOWED_URI_REGEXP: /^(?:https?:\/\/|mailto:)/i,
    ALLOW_ARIA_ATTR: false,
    ALLOW_DATA_ATTR: false,
  });
  for (const element of markup.querySelectorAll<HTMLElement>('[style]')) {
    const values = supportedStyles.map((property) => [property, element.style.getPropertyValue(property)] as const);
    element.removeAttribute('style');
    for (const [property, value] of values) {
      if (value) element.style.setProperty(property, value);
    }
  }
  if (disableLinks) {
    for (const link of markup.querySelectorAll('a[href]')) link.removeAttribute('href');
  }
  for (const image of markup.querySelectorAll('img')) {
    const source = image.getAttribute('src') ?? '';
    let remote = false;
    try {
      const url = new URL(source);
      remote = url.protocol === 'https:' && Boolean(url.hostname) && !url.username && !url.password;
    } catch { /* Relative and malformed image references have no usable URL. */ }
    const raster = /^data:image\/(png|jpeg|gif);base64,[a-z0-9+/=]+$/i.test(source);
    if (!remote && !raster) image.removeAttribute('src');
    image.setAttribute('referrerpolicy', 'no-referrer');
  }
  const container = document.createElement('div');
  container.append(markup);
  return container.innerHTML;
}

export function markupFromText(text: string) {
  const container = document.createElement('div');
  for (const line of text.split(/\r?\n/)) {
    const block = document.createElement('div');
    if (line) block.textContent = line;
    else block.append(document.createElement('br'));
    container.append(block);
  }
  return text ? container.innerHTML : '';
}

export function draftBodyWithSignature(body: string, signature: string, isHtml: boolean) {
  if (!signature) return { body: body ? '\n\n' + body : '' };
  const spacing = body ? '\n\n' : '';
  if (!isHtml) return { body: `\n\n-- \n${signature}${spacing}${body}` };

  const html = markupFromText('\n\n-- ') + safeMarkup(signature)
    + (body ? markupFromText(spacing + body) : '');
  return { body, editor: { html, source: false } };
}
