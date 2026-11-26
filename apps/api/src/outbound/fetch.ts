import { lookup as dnsLookup, type LookupAddress } from 'node:dns';
import { request as httpRequest, type IncomingMessage } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { isIP, type LookupFunction } from 'node:net';
import { pipeline } from 'node:stream/promises';
import { createBrotliDecompress, createGunzip, createInflate } from 'node:zlib';
import { isPublicAddress } from './addresses.ts';

/** Why an outbound fetch failed: the first two mean the URL may not be fetched at all. */
export type FetchFailure =
  | 'scheme'
  | 'address'
  | 'redirects'
  | 'status'
  | 'too-large'
  | 'timeout'
  | 'network';

export class FetchRefused extends Error {
  readonly reason: FetchFailure;

  constructor(reason: FetchFailure, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'FetchRefused';
    this.reason = reason;
  }
}

export interface Fetched {
  /** Where the body came from, after any redirects. */
  url: URL;
  contentType: string | null;
  body: Buffer;
}

export interface FetchOptions {
  /** The `Accept` header. */
  accept: string;
  /** The most the body may hold, counted after decompression. */
  maxBytes: number;
  /** For the whole fetch, redirects included. */
  timeoutMs?: number;
  /** Only tests pass another, so a server on the loopback address can stand in for a public site. */
  isAllowed?: (address: string) => boolean;
}

/** How the API fetches from other sites: `fetchPublic`, except in tests, which never reach the internet. */
export type Outbound = (url: string, options: FetchOptions) => Promise<Fetched>;

export const FETCH_TIMEOUT_MS = 10_000;
export const MAX_REDIRECTS = 5;

/** No contact details: it's sent on behalf of whoever runs this instance. */
const USER_AGENT = 'Mozilla/5.0 (compatible; myli recipe import)';

const REDIRECTS = new Set([301, 302, 303, 307, 308]);

/**
 * GETs `url` from the public internet, and only from there (ADR 0017): every address it connects
 * to, after any redirect, is checked as it's connected to, so no name can resolve its way past the
 * check. No cookies or credentials are sent. Throws `FetchRefused` for anything but a 2xx answer
 * within the limits.
 */
export async function fetchPublic(url: string, options: FetchOptions): Promise<Fetched> {
  const { isAllowed = isPublicAddress, timeoutMs = FETCH_TIMEOUT_MS } = options;
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, timeoutMs);
  try {
    let current = parseUrl(url);
    for (let redirects = 0; ; redirects++) {
      const response = await get(current, options.accept, isAllowed, controller.signal);
      const location = response.headers.location;
      if (REDIRECTS.has(response.statusCode ?? 0) && location !== undefined) {
        response.destroy();
        if (redirects === MAX_REDIRECTS) {
          throw new FetchRefused('redirects', `more than ${String(MAX_REDIRECTS)} redirects`);
        }
        current = parseUrl(location, current);
        continue;
      }
      const status = response.statusCode ?? 0;
      if (status < 200 || status > 299) {
        response.destroy();
        throw new FetchRefused('status', `answered ${String(status)}`);
      }
      const body = await readBody(response, options.maxBytes);
      return { url: current, contentType: response.headers['content-type'] ?? null, body };
    }
  } catch (error) {
    if (error instanceof FetchRefused) throw error;
    if (controller.signal.aborted) {
      throw new FetchRefused('timeout', `no answer within ${String(timeoutMs)} ms`);
    }
    throw new FetchRefused('network', 'could not be fetched', { cause: error });
  } finally {
    clearTimeout(timer);
  }
}

/** An http(s) URL, relative to `base` if given, without the credentials it may carry. */
function parseUrl(text: string, base?: URL): URL {
  let url: URL;
  try {
    url = new URL(text, base);
  } catch {
    throw new FetchRefused('scheme', 'not a URL');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new FetchRefused('scheme', `${url.protocol} URLs aren't fetched`);
  }
  url.username = '';
  url.password = '';
  return url;
}

/** Resolves a name as Node would, refusing it if any of its addresses isn't allowed. */
function checkedLookup(isAllowed: (address: string) => boolean): LookupFunction {
  return (hostname, options, callback) => {
    dnsLookup(hostname, { ...options, all: true }, (error, addresses: LookupAddress[]) => {
      if (error) {
        callback(error, '');
        return;
      }
      const [first] = addresses;
      if (!first || !addresses.every(({ address }) => isAllowed(address))) {
        callback(new FetchRefused('address', `${hostname} isn't a public address`), '');
      } else if (options.all) {
        callback(null, addresses);
      } else {
        callback(null, first.address, first.family);
      }
    });
  };
}

function get(
  url: URL,
  accept: string,
  isAllowed: (address: string) => boolean,
  signal: AbortSignal,
): Promise<IncomingMessage> {
  // `hostname` keeps an IPv6 address's brackets. Node never looks an address up, so it's checked here.
  const host = url.hostname.replace(/^\[(.*)\]$/, '$1');
  if (isIP(host) !== 0 && !isAllowed(host)) {
    return Promise.reject(new FetchRefused('address', `${host} isn't a public address`));
  }
  const request = url.protocol === 'https:' ? httpsRequest : httpRequest;
  return new Promise((resolve, reject) => {
    request(
      {
        host,
        port: url.port || undefined,
        path: `${url.pathname}${url.search}`,
        headers: {
          accept,
          'accept-encoding': 'gzip, deflate, br',
          'user-agent': USER_AGENT,
        },
        lookup: checkedLookup(isAllowed),
        // A connection of its own, never one kept from an earlier request.
        agent: false,
        signal,
      },
      resolve,
    )
      .on('error', reject)
      .end();
  });
}

/** The body, decompressed, refused as soon as it holds more than `maxBytes`. */
async function readBody(response: IncomingMessage, maxBytes: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  const collect = async (source: AsyncIterable<Buffer>) => {
    for await (const chunk of source) {
      size += chunk.length;
      if (size > maxBytes) {
        throw new FetchRefused('too-large', `larger than ${String(maxBytes)} bytes`);
      }
      chunks.push(chunk);
    }
  };
  const encoding = response.headers['content-encoding']?.trim().toLowerCase() ?? 'identity';
  const decompress = {
    gzip: createGunzip,
    'x-gzip': createGunzip,
    deflate: createInflate,
    br: createBrotliDecompress,
  }[encoding];
  if (decompress) await pipeline(response, decompress(), collect);
  else if (encoding === 'identity') await pipeline(response, collect);
  else {
    response.destroy();
    throw new FetchRefused('network', `sent in an encoding it can't read: ${encoding}`);
  }
  return Buffer.concat(chunks);
}
