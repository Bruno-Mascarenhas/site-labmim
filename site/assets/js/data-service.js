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

const DATA_SERVICE_CACHE_LIMIT = 200;
const DATA_SERVICE_FAILURE_TTL_MS = 60000;

class LabmimDataService {
  constructor(options = {}) {
    this.cacheLimit = options.cacheLimit || DATA_SERVICE_CACHE_LIMIT;
    this.failureTtlMs = options.failureTtlMs || DATA_SERVICE_FAILURE_TTL_MS;
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
      const { id, data, error } = e.data;
      const callback = this._workerCallbacks.get(id);
      if (!callback) return;
      this._workerCallbacks.delete(id);
      if (error) callback.reject(new Error(error));
      else callback.resolve(data);
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
      return Promise.resolve(this._cache.get(url));
    }

    const failedAt = this._failedAt.get(url);
    if (failedAt !== undefined) {
      if (Date.now() - failedAt < this.failureTtlMs) {
        return Promise.reject(new Error(`Dados não encontrados (${url})`));
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
          this._failedAt.set(url, Date.now());
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
      if (!res.ok) throw new Error(`Dados não encontrados (HTTP ${res.status})`);
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

  _storeInCache(url, data) {
    if (this._cache.size >= this.cacheLimit) {
      const firstKey = this._cache.keys().next().value;
      this._cache.delete(firstKey);
    }
    this._cache.set(url, data);
  }
}

window.LabmimDataService = LabmimDataService;
