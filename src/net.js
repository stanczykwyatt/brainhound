// Every request brainhound makes goes through here. It only talks to the archives it knows, over
// HTTPS, with a plain user agent, a timeout and a small pause between calls to the same host. It
// never sends cookies, keys or anything about you.

export const VERSION = "0.1.0";
export const USER_AGENT = `brainhound/${VERSION} (+https://github.com/stanczykwyatt/brainhound)`;

/** The only hosts brainhound will contact. Redirects anywhere else are refused. */
export const HOSTS = new Set([
  "api.dandiarchive.org",
  "dandiarchive.s3.amazonaws.com",
  "openneuro.org",
  "neuromorpho.org",
  "api.brain-map.org",
  "brainglobe.s3.us-west-2.amazonaws.com",
]);

export class NetError extends Error {}

export function checkUrl(url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    throw new NetError(`Not a web address: ${url}`);
  }
  if (u.protocol !== "https:") throw new NetError(`Only https addresses are allowed, not ${u.protocol}//${u.host}.`);
  if (!HOSTS.has(u.hostname)) throw new NetError(`brainhound only reads from the archives it supports, not ${u.hostname}.`);
  if (u.username || u.password) throw new NetError("Addresses with a user name or password aren't allowed.");
  return u;
}

export class Net {
  /**
   * @param {object} options
   * @param {typeof fetch} [options.fetch] for tests: a stand-in for the real fetch
   * @param {number} [options.timeout] milliseconds before a request gives up
   * @param {number} [options.gap] milliseconds to wait between requests to the same host
   */
  constructor({ fetch: fetcher = globalThis.fetch, timeout = 30000, gap = 100 } = {}) {
    this.fetch = fetcher;
    this.timeout = timeout;
    this.gap = gap;
    this.last = new Map();
    this.count = 0;
  }

  async request(url, init = {}, hops = 0) {
    const u = checkUrl(url);
    const wait = (this.last.get(u.hostname) ?? 0) + this.gap - Date.now();
    this.last.set(u.hostname, Date.now() + Math.max(0, wait));
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    this.count++;
    let response;
    try {
      response = await this.fetch(u.href, {
        ...init,
        redirect: "manual",
        headers: { "user-agent": USER_AGENT, ...init.headers },
        signal: AbortSignal.timeout(this.timeout),
      });
    } catch (e) {
      const why = e?.name === "TimeoutError" ? "it took too long" : (e?.cause?.code ?? e?.message ?? "no connection");
      throw new NetError(`Couldn't reach ${u.hostname} (${why}).`);
    }
    if (response.status >= 300 && response.status < 400 && response.headers.get("location")) {
      if (hops >= 5) throw new NetError(`Too many redirects from ${u.hostname}.`);
      return this.request(new URL(response.headers.get("location"), u).href, init, hops + 1);
    }
    return response;
  }

  async json(url, init) {
    const response = await this.request(url, init);
    if (response.status === 404) throw new NetError(`Not found: ${url}`);
    if (!response.ok) {
      // GraphQL servers explain a bad query in the body; pass the first line of that on.
      const detail = await response.json().then((d) => d?.errors?.[0]?.message ?? d?.detail, () => null);
      throw new NetError(`${new URL(url).hostname} answered ${response.status}${detail ? `: ${String(detail).slice(0, 200)}` : "."}`);
    }
    try {
      return await response.json();
    } catch {
      throw new NetError(`${new URL(url).hostname} sent something that isn't JSON.`);
    }
  }

  async text(url) {
    const response = await this.request(url);
    if (!response.ok) throw new NetError(`${new URL(url).hostname} answered ${response.status}.`);
    return response.text();
  }

  async graphql(url, query, variables) {
    const data = await this.json(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query, variables }) });
    if (data.errors?.length) throw new NetError(`${new URL(url).hostname}: ${data.errors[0].message}`);
    return data.data;
  }

  /** Bytes `start` to `end` (inclusive) of a file, and the file's total size when the server says. */
  async range(url, start, end) {
    const response = await this.request(url, { headers: { range: `bytes=${start}-${end}` } });
    if (response.status === 416) throw new RangeError(`The file ends before byte ${start}.`);
    if (response.status !== 206 && response.status !== 200) throw new NetError(`${new URL(url).hostname} answered ${response.status} to a range request.`);
    let body = Buffer.from(await response.arrayBuffer());
    let total;
    const contentRange = response.headers.get("content-range");
    const match = contentRange && /\/(\d+)\s*$/.exec(contentRange);
    if (match) total = Number(match[1]);
    if (response.status === 200) {
      // The server ignored the range and sent everything; keep only what was asked for.
      total = body.length;
      body = body.subarray(start, end + 1);
    }
    return { body, total };
  }
}
