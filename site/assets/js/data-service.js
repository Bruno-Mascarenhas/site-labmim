/**
 * DATA SERVICE
 *
 * Shared JSON fetch/cache layer for the WebGIS pages.
 *
 * Responsibilities:
 *   - In-memory LRU-ish cache of parsed JSON payloads (bounded size).
 *   - In-flight request deduplication: concurrent requests for the same URL
 *     share a single network fetch + parse.
 *   - Short-lived negative cache: URLs that failed recently are not
 *     re-requested on every playback tick.
 *   - Off-main-thread parsing via the JSON parser Web Worker, with a
 *     transparent fallback to main-thread fetch when the worker script
 *     fails to load or crashes (workers fail asynchronously, so the
 *     constructor try/catch alone cannot catch that).
 */

// 400 entries x ~47KB average parsed payload keeps one full playback loop
// (73 steps + wind overlays) AND an open time-series modal in memory at
// once (~19MB, fine for a data-viz page); 200 caused mid-loop evictions.
// When the manifest advertises a longer timeline the map manager raises the
// limit via ensureCacheLimit() so longer runs never thrash mid-loop.
const DATA_SERVICE_CACHE_LIMIT = 400;
// Deterministic 404s (files the pipeline never exports) stay negative-cached
// for a full minute; transient failures (network/5xx) may recover at any
// moment, so they only get a few playback ticks.
const DATA_SERVICE_FAILURE_TTL_MS = 60000;
const DATA_SERVICE_TRANSIENT_FAILURE_TTL_MS = 4000;

class LabmimDataService {
  constructor(options = {}) {
    this.cacheLimit = DATA_SERVICE_CACHE_LIMIT;
    this.failureTtlMs = DATA_SERVICE_FAILURE_TTL_MS;
    this.transientFailureTtlMs = DATA_SERVICE_TRANSIENT_FAILURE_TTL_MS;
    this._cache = new Map();
    this._inflight = new Map();
    this._failedAt = new Map();

    this._worker = null;
    this._workerCallbacks = new Map();
    this._workerRequestId = 0;
    if (options.workerUrl) this._initWorker(options.workerUrl);
  }

  _initWorker(workerUrl) {
    if (typeof Worker === "undefined") return;

    try {
      this._worker = new Worker(workerUrl);
    } catch (err) {
      console.warn("Web Workers not available, falling back to main thread:", err);
      this._worker = null;
      return;
    }

    this._worker.onmessage = (e) => {
      const { id, data, error, status } = e.data;
      const callback = this._workerCallbacks.get(id);
      if (!callback) return;
      this._workerCallbacks.delete(id);
      if (error) {
        callback.reject(Number.isFinite(status) ? this._httpError(status, "worker") : new Error(error));
      } else {
        callback.resolve(data);
      }
    };

    const onWorkerFailure = (event) => {
      this._handleWorkerFailure(event?.message || "worker error event");
    };
    this._worker.onerror = onWorkerFailure;
    this._worker.onmessageerror = onWorkerFailure;
  }

  /**
   * Worker script failed to load or crashed. Pending requests are rejected
   * with a marker error so fetchJson can transparently retry them on the
   * main thread; later requests skip the worker entirely.
   */
  _handleWorkerFailure(reason) {
    console.warn("JSON worker failed, falling back to main-thread fetch:", reason);

    const pending = [...this._workerCallbacks.values()];
    this._workerCallbacks.clear();

    if (this._worker) {
      try {
        this._worker.terminate();
      } catch {
        /* worker already gone */
      }
      this._worker = null;
    }

    pending.forEach(({ reject }) => {
      const error = new Error("JSON worker failed");
      error.workerFailure = true;
      reject(error);
    });
  }

  /**
   * Fetch and parse a JSON URL with caching, in-flight deduplication and
   * negative caching. `options.signal` aborts only this caller's view of
   * the request — the shared underlying fetch keeps running for others.
   */
  fetchJson(url, options = {}) {
    if (options.signal?.aborted) {
      return Promise.reject(new DOMException("Aborted", "AbortError"));
    }

    if (this._cache.has(url)) {
      // Refresh recency (delete+set moves the key to the end of the Map) so
      // eviction is LRU instead of insertion-order FIFO — otherwise entries
      // still hot in the current playback loop get evicted first.
      const cached = this._cache.get(url);
      this._cache.delete(url);
      this._cache.set(url, cached);
      return Promise.resolve(cached);
    }

    const failure = this._failedAt.get(url);
    if (failure !== undefined) {
      const ttl = failure.notFound ? this.failureTtlMs : this.transientFailureTtlMs;
      if (Date.now() - failure.at < ttl) {
        return Promise.reject(this._failureError(url, failure.notFound));
      }
      this._failedAt.delete(url);
    }

    let inflight = this._inflight.get(url);
    if (!inflight) {
      inflight = this._fetchAndParse(url)
        .then((data) => {
          this._storeInCache(url, data);
          return data;
        })
        .catch((err) => {
          this._failedAt.set(url, { at: Date.now(), notFound: err?.notFound === true });
          throw err;
        })
        .finally(() => {
          this._inflight.delete(url);
        });
      this._inflight.set(url, inflight);
    }

    if (!options.signal) return inflight;

    const signal = options.signal;
    return inflight.then((data) => {
      if (signal.aborted) throw new DOMException("Aborted", "AbortError");
      return data;
    });
  }

  _fetchAndParse(url) {
    if (!this._worker) return this._mainThreadFetch(url);

    return this._workerFetch(url).catch((err) => {
      if (err?.workerFailure) return this._mainThreadFetch(url);
      throw err;
    });
  }

  _mainThreadFetch(url) {
    return fetch(url).then((res) => {
      if (!res.ok) throw this._httpError(res.status, url);
      return res.json();
    });
  }

  _workerFetch(url) {
    return new Promise((resolve, reject) => {
      const id = String(++this._workerRequestId);
      this._workerCallbacks.set(id, { resolve, reject });
      const absoluteUrl = new URL(url, window.location.href).href;
      this._worker.postMessage({ url: absoluteUrl, id });
    });
  }

  /**
   * Builds a fetch error tagged with the HTTP status and a `notFound` flag.
   * `notFound` marks a deterministically absent resource (404/403/410) — e.g.
   * SWDOWN night hours the pipeline never exports — which callers may treat as
   * expected rather than as a transient failure.
   */
  _httpError(status, url) {
    const error = new Error(`Dados não encontrados (HTTP ${status}): ${url}`);
    error.status = status;
    error.notFound = status === 404 || status === 403 || status === 410;
    return error;
  }

  _failureError(url, notFound) {
    const error = new Error(`Dados não encontrados (${url})`);
    error.notFound = notFound === true;
    return error;
  }

  _storeInCache(url, data) {
    if (this._cache.size >= this.cacheLimit) {
      const firstKey = this._cache.keys().next().value;
      this._cache.delete(firstKey);
    }
    this._cache.set(url, data);
  }

  /** Grow (never shrink) the cache so a full playback loop stays resident. */
  ensureCacheLimit(limit) {
    if (Number.isFinite(limit) && limit > this.cacheLimit) {
      this.cacheLimit = limit;
    }
  }

  /**
   * Drops every cached payload and negative-cache entry (in-flight requests
   * finish on their own). Used when a new pipeline run is detected: the
   * fixed-name files now hold different data, so nothing cached under the
   * old run may be served again.
   */
  clear() {
    this._cache.clear();
    this._failedAt.clear();
  }
}

window.LabmimDataService = LabmimDataService;
