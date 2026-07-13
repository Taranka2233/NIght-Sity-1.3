// Night City push gateway for authenticated, data-only incoming-call FCM.

const TOKEN_TTL_MS = 55 * 60 * 1000;
const JWKS_TTL_MS = 60 * 60 * 1000;
const MAX_BODY_BYTES = 16 * 1024;

let accessTokenCache = { token: '', expiresAt: 0 };
let jwksCache = { keys: [], expiresAt: 0 };

export default {
  async fetch(request, env, ctx) {
    const cors = corsHeaders(request, env);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (request.method === 'GET' && new URL(request.url).pathname === '/health') {
      return json({ ok: true, service: 'nightcity-push' }, 200, cors);
    }
    if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405, cors);

    const declaredLength = Number(request.headers.get('content-length') || 0);
    if (declaredLength > MAX_BODY_BYTES) return json({ error: 'payload_too_large' }, 413, cors);

    try {
      const rawBody = await request.text();
      if (new TextEncoder().encode(rawBody).byteLength > MAX_BODY_BYTES) {
        return json({ error: 'payload_too_large' }, 413, cors);
      }
      let body;
      try { body = JSON.parse(rawBody); } catch (_) { return json({ error: 'bad_request' }, 400, cors); }
      requireEnv(env, ['FB_PROJECT_ID', 'FB_CLIENT_EMAIL', 'FB_PRIVATE_KEY']);
      const idToken = cleanString(body?.idToken, 8192);
      const toUid = cleanId(body?.toUid);
      const chatId = cleanId(body?.chatId);
      const callId = cleanId(body?.callId);
      const callType = body?.callType === 'video' ? 'video' : body?.callType === 'audio' ? 'audio' : '';
      if (!idToken || !toUid || !chatId || !callId || !callType) return json({ error: 'bad_request' }, 400, cors);

      const claims = await verifyFirebaseToken(idToken, env.FB_PROJECT_ID);
      const fromUid = cleanId(claims?.sub);
      if (!fromUid) return json({ error: 'unauthorized' }, 401, cors);
      if (fromUid === toUid) return json({ error: 'invalid_recipient' }, 403, cors);

      const accessToken = await getAccessToken(env);
      const [chat, call, sender, targetPush] = await Promise.all([
        getDocument(env, accessToken, `chats/${encodeURIComponent(chatId)}`),
        getDocument(env, accessToken, `calls/${encodeURIComponent(callId)}`),
        getDocument(env, accessToken, `users/${encodeURIComponent(fromUid)}`),
        getDocument(env, accessToken, `users/${encodeURIComponent(toUid)}/private/push`),
      ]);

      const members = firestoreValue(chat?.fields?.members) || [];
      if (!Array.isArray(members) || !members.includes(fromUid) || !members.includes(toUid)) {
        return json({ error: 'not_in_same_chat' }, 403, cors);
      }

      const callData = firestoreFields(call?.fields);
      const createdAt = Number(callData.createdAt || 0);
      const fresh = createdAt > 0 && Math.abs(Date.now() - createdAt) < 90_000;
      if (!fresh || callData.from !== fromUid || callData.to !== toUid || callData.chatId !== chatId || callData.status !== 'ringing') {
        return json({ error: 'invalid_call' }, 403, cors);
      }

      const token = cleanString(firestoreValue(targetPush?.fields?.fcmToken), 4096);
      if (!token) return json({ error: 'target_not_registered' }, 404, cors);

      const duplicate = await isDuplicate(request.url, callId);
      if (duplicate) return json({ ok: true, duplicate: true }, 200, cors);

      const senderData = firestoreFields(sender?.fields);
      const fromName = cleanString(senderData.name || senderData.handle || 'Абонент', 80) || 'Абонент';
      const fcmResponse = await fetch(`https://fcm.googleapis.com/v1/projects/${encodeURIComponent(env.FB_PROJECT_ID)}/messages:send`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: {
            token,
            android: { priority: 'high', ttl: '45s' },
            data: {
              type: 'call', callId, chatId, callType,
              fromUid, fromName,
            },
          },
        }),
      });

      if (!fcmResponse.ok) {
        const detail = (await fcmResponse.text()).slice(0, 500);
        console.warn('FCM rejected request', fcmResponse.status, detail);
        return json({ error: 'fcm_rejected' }, 502, cors);
      }

      ctx.waitUntil(markDuplicate(request.url, callId));
      return json({ ok: true }, 200, cors);
    } catch (error) {
      const message = String(error?.message || error);
      console.error('Push gateway error', message.slice(0, 500));
      const status = message.startsWith('AUTH_') ? 401 : message.startsWith('CONFIG_') ? 503 : 500;
      return json({ error: status === 401 ? 'unauthorized' : status === 503 ? 'not_configured' : 'internal_error' }, status, cors);
    }
  },
};

function corsHeaders(request, env) {
  const origin = request.headers.get('origin') || '';
  const allowed = String(env.ALLOWED_ORIGINS || 'https://localhost,http://localhost,capacitor://localhost')
    .split(',').map((value) => value.trim()).filter(Boolean);
  const selected = allowed.includes(origin) ? origin : allowed[0] || 'https://localhost';
  return {
    'Access-Control-Allow-Origin': selected,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
    'Cache-Control': 'no-store',
  };
}

function json(value, status, headers) {
  return new Response(JSON.stringify(value), { status, headers: { ...headers, 'Content-Type': 'application/json; charset=utf-8' } });
}

function cleanString(value, maxLength) {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, maxLength);
}

function cleanId(value) {
  const id = cleanString(value, 180);
  return /^[A-Za-z0-9_.@-]+$/.test(id) ? id : '';
}

function requireEnv(env, names) {
  for (const name of names) if (!env[name]) throw new Error(`CONFIG_MISSING_${name}`);
}

async function verifyFirebaseToken(token, projectId) {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('AUTH_MALFORMED_TOKEN');
  const header = JSON.parse(decodeBase64UrlText(parts[0]));
  const payload = JSON.parse(decodeBase64UrlText(parts[1]));
  if (header.alg !== 'RS256' || !header.kid) throw new Error('AUTH_BAD_HEADER');

  const now = Math.floor(Date.now() / 1000);
  if (payload.aud !== projectId || payload.iss !== `https://securetoken.google.com/${projectId}`) throw new Error('AUTH_BAD_AUDIENCE');
  if (typeof payload.sub !== 'string' || !payload.sub || payload.sub.length > 128) throw new Error('AUTH_BAD_SUBJECT');
  if (!Number.isFinite(payload.exp) || payload.exp <= now) throw new Error('AUTH_EXPIRED');
  if (!Number.isFinite(payload.iat) || payload.iat > now + 300 || payload.iat < now - 24 * 60 * 60) throw new Error('AUTH_BAD_IAT');

  const keys = await getGoogleJwks();
  const jwk = keys.find((key) => key.kid === header.kid);
  if (!jwk) throw new Error('AUTH_UNKNOWN_KEY');
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const valid = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5', key, decodeBase64Url(parts[2]), new TextEncoder().encode(`${parts[0]}.${parts[1]}`),
  );
  if (!valid) throw new Error('AUTH_BAD_SIGNATURE');
  return payload;
}

async function getGoogleJwks() {
  if (jwksCache.keys.length && jwksCache.expiresAt > Date.now()) return jwksCache.keys;
  const response = await fetch('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com');
  if (!response.ok) throw new Error('AUTH_JWKS_UNAVAILABLE');
  const body = await response.json();
  jwksCache = { keys: body.keys || [], expiresAt: Date.now() + JWKS_TTL_MS };
  return jwksCache.keys;
}

async function getAccessToken(env) {
  if (accessTokenCache.token && accessTokenCache.expiresAt > Date.now()) return accessTokenCache.token;
  const now = Math.floor(Date.now() / 1000);
  const header = encodeBase64UrlText(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = encodeBase64UrlText(JSON.stringify({
    iss: env.FB_CLIENT_EMAIL,
    scope: 'https://www.googleapis.com/auth/datastore https://www.googleapis.com/auth/firebase.messaging',
    aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600,
  }));
  const unsigned = `${header}.${claims}`;
  const privateKey = await importPrivateKey(env.FB_PRIVATE_KEY);
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', privateKey, new TextEncoder().encode(unsigned));
  const assertion = `${unsigned}.${encodeBase64Url(new Uint8Array(signature))}`;
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }),
  });
  if (!response.ok) throw new Error('CONFIG_SERVICE_ACCOUNT_REJECTED');
  const body = await response.json();
  if (!body.access_token) throw new Error('CONFIG_ACCESS_TOKEN_MISSING');
  accessTokenCache = { token: body.access_token, expiresAt: Date.now() + Math.min(TOKEN_TTL_MS, Number(body.expires_in || 3600) * 1000 - 60_000) };
  return accessTokenCache.token;
}

async function importPrivateKey(pem) {
  const normalized = String(pem).replace(/\\n/g, '\n');
  const base64 = normalized.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g, '');
  const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
  return crypto.subtle.importKey('pkcs8', bytes.buffer, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
}

async function getDocument(env, accessToken, path) {
  const response = await fetch(`https://firestore.googleapis.com/v1/projects/${encodeURIComponent(env.FB_PROJECT_ID)}/databases/(default)/documents/${path}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`FIRESTORE_${response.status}`);
  return response.json();
}

function firestoreFields(fields = {}) {
  return Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, firestoreValue(value)]));
}

function firestoreValue(value) {
  if (!value || typeof value !== 'object') return null;
  if ('stringValue' in value) return value.stringValue;
  if ('integerValue' in value) return Number(value.integerValue);
  if ('doubleValue' in value) return Number(value.doubleValue);
  if ('booleanValue' in value) return value.booleanValue;
  if ('nullValue' in value) return null;
  if ('timestampValue' in value) return Date.parse(value.timestampValue);
  if (value.arrayValue) return (value.arrayValue.values || []).map(firestoreValue);
  if (value.mapValue) return firestoreFields(value.mapValue.fields || {});
  return null;
}

async function isDuplicate(baseUrl, callId) {
  const key = new Request(`${new URL(baseUrl).origin}/__dedupe/${encodeURIComponent(callId)}`);
  return Boolean(await caches.default.match(key));
}

async function markDuplicate(baseUrl, callId) {
  const key = new Request(`${new URL(baseUrl).origin}/__dedupe/${encodeURIComponent(callId)}`);
  await caches.default.put(key, new Response('1', { headers: { 'Cache-Control': 'public, max-age=120' } }));
}

function decodeBase64UrlText(value) {
  return new TextDecoder().decode(decodeBase64Url(value));
}

function decodeBase64Url(value) {
  const normalized = String(value).replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - normalized.length % 4) % 4);
  return Uint8Array.from(atob(padded), (char) => char.charCodeAt(0));
}

function encodeBase64UrlText(value) {
  return encodeBase64Url(new TextEncoder().encode(value));
}

function encodeBase64Url(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}
