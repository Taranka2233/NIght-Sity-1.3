import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { after, before, beforeEach, test } from 'node:test';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';

let env;

before(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-night-city',
    firestore: { rules: await readFile('firestore.rules', 'utf8'), host: '127.0.0.1', port: 8080 },
  });
});

beforeEach(async () => env.clearFirestore());
after(async () => env?.cleanup());

const db = (uid) => env.authenticatedContext(uid).firestore();

async function seedProfile(uid) {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'users', uid), { uid, handle: `@${uid}`, name: uid, nameLower: uid, status: '' });
  });
}

test('profiles require authentication and reject private public fields', async () => {
  await seedProfile('alice');
  await assertFails(getDoc(doc(env.unauthenticatedContext().firestore(), 'users', 'alice')));
  await assertSucceeds(updateDoc(doc(db('alice'), 'users', 'alice'), { name: 'Alice', nameLower: 'alice' }));
  await assertFails(updateDoc(doc(db('alice'), 'users', 'alice'), { email: 'secret@example.com' }));
});

test('private user documents are owner-only', async () => {
  await seedProfile('alice');
  await assertSucceeds(setDoc(doc(db('alice'), 'users', 'alice', 'private', 'push'), { fcmToken: 'token' }));
  await assertFails(getDoc(doc(db('bob'), 'users', 'alice', 'private', 'push')));
});

test('a handle cannot point at another user', async () => {
  await assertFails(setDoc(doc(db('alice'), 'handles', '@alice'), { uid: 'bob' }));
  await assertSucceeds(setDoc(doc(db('alice'), 'handles', '@alice'), { uid: 'alice' }));
});

test('message sender spoofing is rejected', async () => {
  await seedProfile('alice');
  await seedProfile('bob');
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'chats', 'alice__bob'), { members: ['alice', 'bob'], createdBy: 'alice' });
  });
  const messages = db('alice');
  await assertFails(setDoc(doc(messages, 'chats', 'alice__bob', 'messages', 'bad'), { from: 'bob', type: 'text', text: 'spoof', ts: 1, e2e: true }));
  const okMessage = doc(messages, 'chats', 'alice__bob', 'messages', 'ok');
  await assertSucceeds(setDoc(okMessage, { from: 'alice', type: 'text', text: '🔒', encText: 'cipher', encIv: 'iv', ts: 1, e2e: true }));
  await assertFails(setDoc(doc(messages, 'chats', 'alice__bob', 'messages', 'fake-e2e'), { from: 'alice', type: 'text', text: 'plaintext', ts: 1, e2e: true }));
  await assertFails(updateDoc(okMessage, { text: 'plaintext', edited: true }));
});

test('ordinary group members cannot change membership or admins', async () => {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'chats', 'group'), { members: ['alice', 'bob'], owner: 'alice', admins: ['alice'], isGroup: true });
  });
  await assertFails(updateDoc(doc(db('bob'), 'chats', 'group'), { admins: ['bob'] }));
  await assertFails(updateDoc(doc(db('bob'), 'chats', 'group'), { members: ['bob'] }));
  await assertSucceeds(updateDoc(doc(db('alice'), 'chats', 'group'), { admins: ['alice', 'bob'] }));
});

test('group invitations require an explicit decision by the invited user', async () => {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'chats', 'invite'), {
      members: ['alice'], pending: ['bob'], owner: 'alice', admins: ['alice'], isGroup: true,
      memberNames: { alice: 'Alice' }, pendingNames: { bob: 'Bob' },
    });
  });
  const invite = doc(db('bob'), 'chats', 'invite');
  await assertSucceeds(getDoc(invite));
  await assertFails(updateDoc(doc(db('eve'), 'chats', 'invite'), { members: ['alice', 'eve'] }));
  await assertSucceeds(updateDoc(invite, {
    members: ['alice', 'bob'], pending: [],
    memberNames: { alice: 'Alice', bob: 'Bob' }, pendingNames: {},
  }));
});

test('call identity fields are immutable', async () => {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'chats', 'alice__bob'), { members: ['alice', 'bob'], createdBy: 'alice' });
  });
  const callRef = doc(db('alice'), 'calls', 'call-1');
  await assertSucceeds(setDoc(callRef, { from: 'alice', to: 'bob', chatId: 'alice__bob', kind: 'audio', status: 'ringing', createdAt: Date.now() }));
  await assertFails(updateDoc(doc(db('bob'), 'calls', 'call-1'), { from: 'bob' }));
  await assertSucceeds(updateDoc(doc(db('bob'), 'calls', 'call-1'), { status: 'accepted' }));
  assert.ok(true);
});
