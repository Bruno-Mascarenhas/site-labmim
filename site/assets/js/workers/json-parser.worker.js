/**
 * Web Worker: JSON Parser
 *
 * Offloads JSON parsing from the main thread. For large JSON files
 * (300 KB+), parsing can block the UI for 50-100ms. This worker
 * keeps the main thread responsive during data loading.
 *
 * Message protocol:
 *   Input:  { url: string, id: string }
 *   Output: { id: string, data: object } | { id: string, error: string }
 */

self.onmessage = async function (e) {
  const { url, id } = e.data;

  try {
    const response = await fetch(url);
    if (!response.ok) {
      // Forward the HTTP status so the main thread can distinguish a
      // deterministically-absent file (404) from a transient failure.
      self.postMessage({ id, error: `HTTP ${response.status}`, status: response.status });
      return;
    }

    // Parse JSON in the worker thread — frees main thread
    const data = await response.json();
    self.postMessage({ id, data });
  } catch (err) {
    self.postMessage({ id, error: err.message });
  }
};
