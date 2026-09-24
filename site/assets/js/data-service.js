const DATA_SERVICE_CACHE_LIMIT = 400;
const DATA_SERVICE_CACHE_BUDGET_BYTES = 32 * 1024 * 1024;
const RETAINED_BYTES_PER_JSON_NUMBER = 16;
// Deterministic 404s (files the pipeline never exports) stay cached for a full
// minute; transient failures may recover at any moment.
const DATA_SERVICE_FAILURE_TTL_MS = 60000;
const DATA_SERVICE_TRANSIENT_FAILURE_TTL_MS = 4000;

function countJsonNumbers(node) {
  if (typeof node === "number") return 1;
  if (node === null || typeof node !== "object") return 0;
  let count = 0;
  for (const child of Array.isArray(node) ? node : Object.values(node)) count += countJsonNumbers(child);
  return count;
}

class LabmimDataService {
  constructor(options = {}) {
    this.cacheLimit = DATA_SERVICE_CACHE_LIMIT;
    this.cacheBudgetBytes = DATA_SERVICE_CACHE_BUDGET_BYTES;
    this.failureTtlMs = DATA_SERVICE_FAILURE_TTL_MS;
    this.transientFailureTtlMs = DATA_SERVICE_TRANSIENT_FAILURE_TTL_MS;
    this._cache = new Map();
    this._cacheBytes = 0;
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
        // The worker reply carries no URL, so the failing file is named from
        // the stored callback — an incomplete FTP upload otherwise yields N
        // indistinguishable console errors.
        callback.reject(Number.isFinite(status) ? this._httpError(status, callback.url) : new Error(error));
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
   * Workers fail asynchronously, so the constructor try/catch cannot see a
   * script that never loads or later crashes. Pending requests are rejected
   * with a marker error `_fetchAndParse` retries on the main thread.
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
   * `options.signal` aborts only this caller's view of the request — the
   * shared underlying fetch keeps running for the other callers.
   */
  fetchJson(url, options = {}) {
    if (options.signal?.aborted) {
      return Promise.reject(new DOMException("Aborted", "AbortError"));
    }

    if (this._cache.has(url)) {
      // delete+set moves the key to the end of the Map, making eviction LRU
      // instead of FIFO — a FIFO drops entries still hot in the playback loop.
      const cached = this._cache.get(url);
      this._cache.delete(url);
      this._cache.set(url, cached);
      return Promise.resolve(cached.data);
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
      this._workerCallbacks.set(id, { resolve, reject, url });
      const absoluteUrl = new URL(url, window.location.href).href;
      this._worker.postMessage({ url: absoluteUrl, id });
    });
  }

  /**
   * `notFound` marks a deterministically absent resource — e.g. SWDOWN night
   * hours the pipeline never exports — which callers treat as an expected gap
   * rather than a failure.
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
    const bytes = countJsonNumbers(data) * RETAINED_BYTES_PER_JSON_NUMBER;
    this._removeFromCache(url);
    this._cache.set(url, { data, bytes });
    this._cacheBytes += bytes;
    while (this._cache.size > 1 && (this._cache.size > this.cacheLimit || this._cacheBytes > this.cacheBudgetBytes)) {
      this._removeFromCache(this._cache.keys().next().value);
    }
  }

  _removeFromCache(url) {
    const entry = this._cache.get(url);
    if (!entry) return;
    this._cache.delete(url);
    this._cacheBytes -= entry.bytes;
  }

  ensureCacheLimit(limit) {
    if (Number.isFinite(limit) && limit > this.cacheLimit) {
      this.cacheLimit = limit;
    }
  }

  /**
   * Called when a new pipeline run is detected: the fixed-name files now hold
   * different data, so nothing cached under the old run may be served again.
   */
  clear() {
    this._cache.clear();
    this._cacheBytes = 0;
    this._failedAt.clear();
  }
}

window.LabmimDataService = LabmimDataService;
