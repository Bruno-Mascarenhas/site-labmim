self.onmessage = async function (e) {
  const { url, id } = e.data;

  try {
    const response = await fetch(url);
    if (!response.ok) {
      // data-service reads `status` to tell a deterministically-absent file
      // (404) from a transient failure.
      self.postMessage({ id, error: `HTTP ${response.status}`, status: response.status });
      return;
    }

    const data = await response.json();
    self.postMessage({ id, data });
  } catch (err) {
    self.postMessage({ id, error: err.message });
  }
};
