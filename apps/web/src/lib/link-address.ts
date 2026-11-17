import { z } from 'zod';

/**
 * Where a link in markdown someone writes can go, as the renderer allows (`markdown.ts`): a web
 * address, an email address, or a path on this site. Typed as people would, without the scheme
 * ("example.com/bread", "sam@example.com"), it's completed; anything else is refused, rather than
 * saved as a link the recipe would show without its address.
 */

const PATH = /^\/(?![/\\])/;
const WEB = /^https?:\/\//i;
const MAILTO = /^mailto:/i;
const EMAIL = /^[^\s@/:]+@[^\s@/:]+\.[^\s@/:]+$/;

/** The address to link to, or `undefined` if it can't be one. */
export function linkAddress(text: string): string | undefined {
  const address = text.trim();
  if (address === '' || /\s/.test(address)) return undefined;
  // Not "//host" or "/\\host", which browsers read as another site.
  if (address.startsWith('/')) return PATH.test(address) ? address : undefined;
  if (MAILTO.test(address))
    return EMAIL.test(address.slice('mailto:'.length)) ? address : undefined;
  if (EMAIL.test(address)) return `mailto:${address}`;
  const web = WEB.test(address) ? address : `https://${address}`;
  // A host with a dot: not "javascript:…" or "tel:…" read as a host and port.
  return URL.canParse(web) && new URL(web).hostname.includes('.') ? web : undefined;
}

export const linkAddressSchema = z
  .string()
  .trim()
  .min(1, 'Enter where the link goes.')
  .transform((text, context) => {
    const address = linkAddress(text);
    if (address !== undefined) return address;
    context.issues.push({
      code: 'custom',
      input: text,
      message: 'Enter a web address or an email address.',
    });
    return z.NEVER;
  });
