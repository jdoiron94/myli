/**
 * Where to go once signed in: the `redirect` query value, if it's a path on this site, or else the
 * home page. Anything else, such as `https://example.com` or `//example.com`, would let a link to
 * myli's sign-in page send people to another site afterwards (an open redirect).
 */
export function safeRedirect(value: unknown): string {
  if (typeof value !== 'string' || !value.startsWith('/')) return '/';
  // The URL parser decides, as the browser would: it reads `/\example.com` as `//example.com`, and
  // drops tabs and newlines.
  const url = new URL(value, location.origin);
  return url.origin === location.origin ? url.pathname + url.search + url.hash : '/';
}

/** The query that brings someone back to `route` after signing in. The home page needs none. */
export function comeBackTo({ fullPath }: { fullPath: string }): { redirect?: string } {
  return fullPath === '/' ? {} : { redirect: fullPath };
}
