/**
 * Stops Zod compiling schemas with `new Function`. The Content Security Policy has no
 * `'unsafe-eval'` (apps/web/Caddyfile), and Zod's own check whether eval is allowed shows up as a
 * violation on every page. Without that fast path, Zod parses the same way, a little more slowly.
 *
 * Each page's entry imports this first, before any schema runs. Scalar uses the same copy of Zod,
 * so the API docs page needs it too.
 */
import { z } from 'zod';

z.config({ jitless: true });
