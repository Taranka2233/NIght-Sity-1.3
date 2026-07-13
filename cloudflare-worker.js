// Найт-Сити Нет — защищённый FCM Worker для звонков.
// Cloudflare secrets: FB_PROJECT_ID, FB_CLIENT_EMAIL, FB_PRIVATE_KEY.
// The Firebase service account needs Firebase Cloud Messaging Admin and Firestore read access.

let accessCache = { token: '', exp: 0 };
let jwksCache = { keys: [], exp: 0 };
const rate = new Map();

export default {
  async fetch(request, env) {
    const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' };
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });
    if (request.method !== 'POST') return reply({ ok: true }, 200, cors);
    try {
      const { idToken, toUid, chatId, callType = 'audio', callId = '' } = await request.json();
      const claims = await verifyFirebaseToken(idToken, env.FB_PROJECT_ID);
      if (!claims || !toUid || !chatId) return reply({ error: 'unauthorized or incomplete request' }, 401, cors);
      const fromUid = claims.sub;
      if (fromUid === toUid || !allowCall(fromUid)) return reply({ error: 'forbidden or rate limited' }, 429, cors);

      const token = await serviceToken(env);
      const members = await chatMembers(env, token, chatId);
      // Fail closed: a nonexistent or unreadable chat never permits a call.
      if (!members || !members.includes(fromUid) || !members.includes(toUid)) return reply({ error: 'not chat participants' }, 403, cors);
      const receiver = await firestoreDoc(env, token, `users/${encodeURIComponent(toUid)}`);
      const sender = await firestoreDoc(env, token, `users/${encodeURIComponent(fromUid)}`);
      const fcmToken = receiver?.fcmToken;
      if (!fcmToken) return reply({ error: 'target has no registered device' }, 404, cors);
      const fromName = sender?.name || sender?.handle || 'Абонент';

      const result = await fetch(`https://fcm.googleapis.com/v1/projects/${env.FB_PROJECT_ID}/messages:send`, {
        method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: { token: fcmToken, android: { priority: 'high' }, data: { type: 'call', callType: String(callType), fromUid, fromName: String(fromName), chatId: String(chatId), callId: String(callId) } } })
      });
      const payload = await result.json().catch(() => ({}));
      return reply({ ok: result.ok, result: payload }, result.ok ? 200 : 502, cors);
    } catch (error) {
      return reply({ error: String(error?.message || error) }, 500, cors);
    }
  }
};

function reply(data, status, cors) { return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', ...cors } }); }
function allowCall(uid) { const now = Date.now(), old = rate.get(uid) || []; const fresh = old.filter(t => now - t < 60_000); if (fresh.length >= 8) return false; fresh.push(now); rate.set(uid, fresh); return true; }

async function verifyFirebaseToken(token, projectId) {
  try {
    const [h, p, s] = String(token || '').split('.'); if (!h || !p || !s) return null;
    const header = JSON.parse(base64urlText(h)), payload = JSON.parse(base64urlText(p)), now = Math.floor(Date.now() / 1000);
    if (header.alg !== 'RS256' || !header.kid || payload.aud !== projectId || payload.iss !== `https://securetoken.google.com/${projectId}` || typeof payload.sub !== 'string' || !payload.sub || typeof payload.exp !== 'number' || payload.exp <= now || typeof payload.iat !== 'number' || payload.iat > now + 300) return null;
    const jwk = await googleJwk(header.kid); if (!jwk) return null;
    const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
    return await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, base64urlBytes(s), new TextEncoder().encode(`${h}.${p}`)) ? payload : null;
  } catch (_) { return null; }
}
async function googleJwk(kid) {
  if (jwksCache.exp < Date.now()) {
    const res = await fetch('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com');
    const data = await res.json(); jwksCache = { keys: data.keys || [], exp: Date.now() + 3_600_000 };
  }
  return jwksCache.keys.find(k => k.kid === kid) || null;
}
async function firestoreDoc(env, token, path) {
  const res = await fetch(`https://firestore.googleapis.com/v1/projects/${env.FB_PROJECT_ID}/databases/(default)/documents/${path}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) return null; const data = await res.json(); return fields(data.fields || {});
}
async function chatMembers(env, token, chatId) { const chat = await firestoreDoc(env, token, `chats/${encodeURIComponent(chatId)}`); return Array.isArray(chat?.members) ? chat.members : null; }
function fields(input) { const out = {}; for (const [key, value] of Object.entries(input)) out[key] = value.stringValue ?? value.integerValue ?? value.booleanValue ?? (value.arrayValue?.values || []).map(v => v.stringValue).filter(Boolean) ?? null; return out; }
async function serviceToken(env) {
  const now = Math.floor(Date.now() / 1000); if (accessCache.token && accessCache.exp > now + 60) return accessCache.token;
  const header = base64url(new TextEncoder().encode(JSON.stringify({ alg: 'RS256', typ: 'JWT' })));
  const claim = base64url(new TextEncoder().encode(JSON.stringify({ iss: env.FB_CLIENT_EMAIL, scope: 'https://www.googleapis.com/auth/firebase.messaging https://www.googleapis.com/auth/datastore', aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 })));
  const unsigned = `${header}.${claim}`, key = await importPrivateKey(env.FB_PRIVATE_KEY), signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(unsigned));
  const body = new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${unsigned}.${base64url(new Uint8Array(signature))}` });
  const res = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body }); const data = await res.json();
  if (!data.access_token) throw new Error('Google OAuth token was not issued'); accessCache = { token: data.access_token, exp: now + Number(data.expires_in || 3600) }; return accessCache.token;
}
async function importPrivateKey(pem) { const clean = String(pem).replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\\n|\s/g, ''); return crypto.subtle.importKey('pkcs8', base64urlBytes(clean), { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']); }
function base64url(bytes) { return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
function base64urlBytes(value) { const text = String(value).replace(/-/g, '+').replace(/_/g, '/'); const raw = atob(text + '='.repeat((4 - text.length % 4) % 4)); return Uint8Array.from(raw, c => c.charCodeAt(0)); }
function base64urlText(value) { return new TextDecoder().decode(base64urlBytes(value)); }
