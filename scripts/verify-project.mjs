import { access, readFile, stat } from 'node:fs/promises';
import vm from 'node:vm';

const required = [
  'index.html',
  'worker.js',
  'firestore.rules',
  'firebase.json',
  'google-services.json',
  'capacitor.config.json',
  'setup_calls.py',
  'setup_icons.py',
];

for (const file of required) await access(file);

const html = await readFile('index.html', 'utf8');
const worker = await readFile('worker.js', 'utf8');
const rules = await readFile('firestore.rules', 'utf8');
const google = JSON.parse(await readFile('google-services.json', 'utf8'));
const capacitor = JSON.parse(await readFile('capacitor.config.json', 'utf8'));
const androidGradle = await readFile('android/app/build.gradle', 'utf8');
const htmlSize = (await stat('index.html')).size;

function expect(condition, message) {
  if (!condition) throw new Error(message);
}

expect(htmlSize > 1_000_000, 'index.html is not the complete application');
expect(html.includes('ВЕРСИЯ 2.077.203'), 'unexpected client version');
expect(!html.includes('night-city-net-demo'), 'demo client must never be packaged');
expect(html.includes("import('./firebase-bundle.js')"), 'Firebase must load from the local bundle');
expect(!html.includes('www.gstatic.com/firebasejs'), 'remote Firebase SDK import is forbidden');
expect(html.includes('getIdToken'), 'authenticated push contract is missing');
expect(html.includes('if (!user.emailVerified)'), 'unverified users must not race profile initialization');
expect(html.includes('FIRESTORE: НЕТ ДОСТУПА ПО ПРАВИЛАМ'), 'Firebase errors must remain diagnosable');
expect(/savePrivate\([^)]*['"]push['"]/.test(html), 'private push-token storage is missing');
expect(!html.includes("saveProfile(this._myUid, { fcmToken"), 'FCM token is still stored in the public profile');
expect(worker.includes('callId') && worker.includes('chatId'), 'Worker must validate call and chat context');
expect(rules.includes('request.resource.data.from == request.auth.uid'), 'message sender anti-spoof rule is missing');
expect(rules.includes('match /private/{document}'), 'private user documents are not protected');
expect(rules.includes('inviteDecision()') && html.includes('acceptGroupInvite'), 'explicit group invitation flow is missing');
expect(capacitor.appId === 'net.nightcity.chat', 'unexpected Capacitor appId');
expect(androidGradle.includes('versionCode 2077203') && androidGradle.includes('versionName "2.077.203"'), 'unexpected Android version');

const androidClient = google.client?.find((entry) => entry.client_info?.android_client_info?.package_name === capacitor.appId);
expect(androidClient, 'google-services.json does not contain the Capacitor appId');

const logic = html.match(/<script type="text\/x-dc"[^>]*>([\s\S]*?)<\/script>/)?.[1];
expect(logic, 'application logic block is missing');
new vm.Script(logic, { filename: 'index.logic.js' });

console.log('Project verification passed');
