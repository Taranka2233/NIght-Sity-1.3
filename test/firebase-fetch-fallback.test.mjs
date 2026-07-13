import test from 'node:test';
import assert from 'node:assert/strict';

test('Firebase requests fall back to XMLHttpRequest after WebView fetch failure', async () => {
  const savedFetch = globalThis.fetch;
  const savedXhr = globalThis.XMLHttpRequest;
  const savedFlag = globalThis.__NC_FIREBASE_FETCH_FALLBACK__;
  let xhrCalls = 0;

  class MockXMLHttpRequest {
    open(method, url) { this.method = method; this.url = url; }
    setRequestHeader() {}
    getAllResponseHeaders() { return 'content-type: application/json\r\n'; }
    send(body) {
      xhrCalls += 1;
      assert.equal(this.method, 'POST');
      assert.match(this.url, /identitytoolkit\.googleapis\.com/);
      assert.ok(body instanceof ArrayBuffer);
      this.status = 200;
      this.statusText = 'OK';
      this.response = new TextEncoder().encode('{"ok":true}').buffer;
      queueMicrotask(() => this.onload());
    }
    abort() { this.onabort?.(); }
  }

  try {
    globalThis.fetch = async () => { throw new TypeError('Failed to fetch'); };
    globalThis.XMLHttpRequest = MockXMLHttpRequest;
    delete globalThis.__NC_FIREBASE_FETCH_FALLBACK__;
    await import(`../src/firebase-fetch-fallback.mjs?test=${Date.now()}`);

    const response = await globalThis.fetch('https://identitytoolkit.googleapis.com/v1/test', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true });
    assert.equal(xhrCalls, 1);
  } finally {
    globalThis.fetch = savedFetch;
    if (savedXhr === undefined) delete globalThis.XMLHttpRequest;
    else globalThis.XMLHttpRequest = savedXhr;
    if (savedFlag === undefined) delete globalThis.__NC_FIREBASE_FETCH_FALLBACK__;
    else globalThis.__NC_FIREBASE_FETCH_FALLBACK__ = savedFlag;
  }
});
