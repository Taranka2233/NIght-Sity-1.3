import assert from 'node:assert/strict';
import { test } from 'node:test';
import worker from '../worker.js';

const ctx = { waitUntil() {} };

test('health endpoint is available without exposing configuration', async () => {
  const response = await worker.fetch(new Request('https://worker.example/health'), {}, ctx);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, service: 'nightcity-push' });
});

test('unsupported methods are rejected', async () => {
  const response = await worker.fetch(new Request('https://worker.example/', { method: 'PUT' }), {}, ctx);
  assert.equal(response.status, 405);
});

test('invalid JSON is a client error', async () => {
  const response = await worker.fetch(new Request('https://worker.example/', { method: 'POST', body: '{' }), {
    FB_PROJECT_ID: 'project', FB_CLIENT_EMAIL: 'service@example.test', FB_PRIVATE_KEY: 'unused',
  }, ctx);
  assert.equal(response.status, 400);
});

test('oversized bodies are rejected before authentication', async () => {
  const response = await worker.fetch(new Request('https://worker.example/', { method: 'POST', body: 'x'.repeat(17 * 1024) }), {}, ctx);
  assert.equal(response.status, 413);
});
