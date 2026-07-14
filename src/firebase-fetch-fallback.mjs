// Some Android System WebView versions report `Failed to fetch` for Google
// APIs while XMLHttpRequest still works. Install the fallback before Firebase
// Auth captures the global fetch implementation.
const originalFetch = globalThis.fetch?.bind(globalThis);
const firebaseHosts = new Set([
  'identitytoolkit.googleapis.com',
  'securetoken.googleapis.com',
  'firebaseinstallations.googleapis.com',
]);

function isFirebaseRequest(input) {
  try {
    const url = input instanceof Request ? input.url : String(input);
    return firebaseHosts.has(new URL(url, globalThis.location?.href).hostname);
  } catch (_) {
    return false;
  }
}

async function xhrFetch(request, originalError) {
  const body = request.method === 'GET' || request.method === 'HEAD' ? null : await request.arrayBuffer();
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    let settled = false;
    const fail = (reason) => {
      if (settled) return;
      settled = true;
      const error = new Error(`WEBVIEW_XHR_FAILED: ${reason || originalError?.message || 'network error'}`);
      error.code = 'webview-network-failed';
      reject(error);
    };

    xhr.open(request.method, request.url, true);
    xhr.responseType = 'arraybuffer';
    xhr.timeout = 25_000;
    xhr.withCredentials = request.credentials === 'include';
    request.headers.forEach((value, name) => {
      try { xhr.setRequestHeader(name, value); } catch (_) {}
    });
    xhr.onload = () => {
      if (settled) return;
      if (xhr.status === 0) { fail('status 0'); return; }
      settled = true;
      const headers = new Headers();
      String(xhr.getAllResponseHeaders() || '').trim().split(/[\r\n]+/).forEach((line) => {
        const index = line.indexOf(':');
        if (index > 0) headers.append(line.slice(0, index).trim(), line.slice(index + 1).trim());
      });
      resolve(new Response(xhr.response, { status: xhr.status, statusText: xhr.statusText, headers }));
    };
    xhr.onerror = () => fail('network error');
    xhr.ontimeout = () => fail('timeout');
    xhr.onabort = () => fail('aborted');
    if (request.signal) {
      if (request.signal.aborted) { xhr.abort(); return; }
      request.signal.addEventListener('abort', () => xhr.abort(), { once: true });
    }
    xhr.send(body);
  });
}

if (originalFetch && typeof XMLHttpRequest !== 'undefined' && !globalThis.__NC_FIREBASE_FETCH_FALLBACK__) {
  globalThis.__NC_FIREBASE_FETCH_FALLBACK__ = true;
  globalThis.fetch = async (input, init) => {
    if (!isFirebaseRequest(input)) return originalFetch(input, init);
    const backup = new Request(input, init);
    try {
      return await originalFetch(backup.clone());
    } catch (error) {
      return xhrFetch(backup, error);
    }
  };
}
