import { readFile, writeFile } from 'node:fs/promises';

const file = new URL('../index.html', import.meta.url);
let html = await readFile(file, 'utf8');

html = html.replaceAll('2.077.202', '2.077.206').replaceAll('2.077.203', '2.077.206').replaceAll('2.077.204', '2.077.206').replaceAll('2.077.205', '2.077.206');

if (!html.includes('<script src="./firebase-bundle.js"></script>')) {
  const configStart = html.indexOf('<script>window.FIREBASE_CONFIG');
  const configEnd = configStart >= 0 ? html.indexOf('</script>', configStart) : -1;
  if (configEnd < 0) throw new Error('Cannot install local Firebase bundle: config block not found');
  const insertAt = configEnd + '</script>'.length;
  html = html.slice(0, insertAt) + '\n<script src="./firebase-bundle.js"></script>' + html.slice(insertAt);
}

if (!html.includes("firebaseErrorMessage = (error, fallback = 'ОШИБКА FIREBASE')")) {
  const replaceBlock = (before, after, label) => {
    if (!html.includes(before)) throw new Error(`Cannot apply ${label}: source block not found`);
    html = html.replace(before, after);
  };

  replaceBlock(
`  async function signIn(email, pass) {
    await init();
    const { authMod, fsMod } = fb;
    const cred = await authMod.signInWithEmailAndPassword(auth, email, pass);
    if (!cred.user.emailVerified) { try { await authMod.signOut(auth); } catch (e) {} const err = new Error('EMAIL_NOT_VERIFIED'); err.code = 'email-not-verified'; throw err; }
    const snap = await fsMod.getDoc(fsMod.doc(db, 'users', cred.user.uid));
    return snap.exists() ? snap.data() : { uid: cred.user.uid, email, handle: handleFromEmail(email) };
  }`,
`  async function signIn(email, pass) {
    await init();
    const { authMod } = fb;
    const cred = await authMod.signInWithEmailAndPassword(auth, email, pass);
    if (!cred.user.emailVerified) { try { await authMod.signOut(auth); } catch (e) {} const err = new Error('EMAIL_NOT_VERIFIED'); err.code = 'email-not-verified'; throw err; }
    return cred.user;
  }`,
    'sign-in fix',
  );

  replaceBlock(
`  function onAuthChange(cb) { init().then(() => fb.authMod.onAuthStateChanged(auth, cb)).catch(() => {}); }`,
`  function onAuthChange(cb) {
    init()
      .then(() => fb.authMod.onAuthStateChanged(auth, (user) => cb(user, null), (error) => cb(null, error)))
      .catch((error) => cb(null, error));
  }`,
    'auth observer fix',
  );

  replaceBlock(
`  initBackend = () => { NC.onAuthChange((user) => { if (user) this.enterBackend(user); else this.setState({ screen: 'auth' }); }); setTimeout(() => { if (this.state.screen === 'boot') this.setState({ screen: 'auth' }); }, 8000); };`,
`  firebaseErrorMessage = (error, fallback = 'ОШИБКА FIREBASE') => {
    const raw = String((error && (error.code || error.message)) || '').toLowerCase();
    if (raw.includes('email-not-verified') || raw.includes('email_not_verified')) return 'ПОДТВЕРДИ ПОЧТУ';
    if (raw.includes('email-already-in-use')) return 'EMAIL УЖЕ ЗАРЕГИСТРИРОВАН';
    if (raw.includes('invalid-credential') || raw.includes('wrong-password') || raw.includes('user-not-found') || raw.includes('invalid-login')) return 'НЕВЕРНЫЙ EMAIL ИЛИ ПАРОЛЬ';
    if (raw.includes('weak-password')) return 'ПАРОЛЬ ДОЛЖЕН БЫТЬ НЕ КОРОЧЕ 6 СИМВОЛОВ';
    if (raw.includes('invalid-email')) return 'НЕВЕРНЫЙ EMAIL';
    if (raw.includes('operation-not-allowed')) return 'ВКЛЮЧИ EMAIL/PASSWORD В FIREBASE';
    if (raw.includes('too-many-requests')) return 'СЛИШКОМ МНОГО ПОПЫТОК · ПОДОЖДИ';
    if (raw.includes('failed to fetch dynamically') || raw.includes('firebase bundle')) return 'НЕ ЗАГРУЗИЛСЯ МОДУЛЬ FIREBASE';
    if (raw.includes('failed to fetch') || raw.includes('webview_xhr_failed')) return 'ANDROID WEBVIEW НЕ ПОДКЛЮЧИЛСЯ К FIREBASE';
    if (raw.includes('network') || raw.includes('unavailable')) return 'НЕТ СВЯЗИ С FIREBASE';
    if (raw.includes('permission-denied')) return 'FIRESTORE: НЕТ ДОСТУПА ПО ПРАВИЛАМ';
    if (raw.includes('failed-precondition')) return 'FIRESTORE: НУЖЕН ИНДЕКС ИЛИ НАСТРОЙКА';
    if (raw.includes('app-check')) return 'FIREBASE APP CHECK БЛОКИРУЕТ ЗАПРОС';
    if (raw.includes('configuration') || raw.includes('api-key')) return 'ПРОВЕРЬ КЛЮЧИ FIREBASE';
    const code = raw.match(/(?:auth|firestore)\\/[a-z0-9-]+/)?.[0] || raw.match(/[a-z][a-z0-9-]{2,48}/)?.[0] || '';
    return code ? fallback + ' · ' + code.toUpperCase() : fallback;
  };

  initBackend = () => {
    NC.onAuthChange((user, error) => {
      if (error) {
        console.error('Firebase initialization failed', error);
        this.setState({ screen: 'auth', authInfo: null, authError: this.firebaseErrorMessage(error, 'ОШИБКА ИНИЦИАЛИЗАЦИИ') });
        return;
      }
      if (!user) { this.setState({ screen: 'auth' }); return; }
      // createUserWithEmailAndPassword fires onAuthStateChanged immediately.
      // Registration itself owns profile creation until the email is verified;
      // entering here as well used to race the Firestore transaction.
      if (!user.emailVerified) {
        this.setState({ screen: 'auth', authError: null, authInfo: null, verifySent: user.email || this.state.authEmail });
        return;
      }
      this.enterBackend(user);
    });
    setTimeout(() => { if (this.state.screen === 'boot') this.setState({ screen: 'auth', authError: 'СЕРВИС FIREBASE НЕ ОТВЕТИЛ' }); }, 8000);
  };`,
    'registration race fix',
  );

  replaceBlock(
`    } catch (e) { this.setState({ authError: 'ОШИБКА ПОДКЛЮЧЕНИЯ' }); }
  };

  openRename = () => {`,
`    } catch (e) {
      console.error('Backend profile initialization failed', e);
      this.setState({ screen: 'auth', authInfo: null, authError: this.firebaseErrorMessage(e, 'ОШИБКА ПРОФИЛЯ') });
      try { await NC.signOut(); } catch (_) {}
    }
  };

  openRename = () => {`,
    'profile recovery fix',
  );

  replaceBlock(
`    } catch (e) {
      const code = (e && (e.code || e.message)) || '';
      let msg = 'ОШИБКА ВХОДА';
      if (code.includes('email-not-verified') || code.includes('EMAIL_NOT_VERIFIED')) { this.setState({ authError: null, authInfo: null, verifySent: email }); return; }
      else if (code.includes('email-already-in-use')) msg = 'EMAIL УЖЕ ЗАРЕГИСТРИРОВАН';
      else if (code.includes('invalid-credential') || code.includes('wrong-password') || code.includes('user-not-found') || code.includes('invalid-login')) msg = 'НЕВЕРНЫЙ EMAIL ИЛИ ПАРОЛЬ';
      else if (code.includes('weak-password')) msg = 'СЛИШКОМ ПРОСТОЙ ПАРОЛЬ';
      else if (code.includes('network')) msg = 'НЕТ СЕТИ';
      else if (code.includes('configuration') || code.includes('api-key')) msg = 'ПРОВЕРЬ КЛЮЧИ FIREBASE';
      this.setState({ authError: msg, authInfo: null });
    }`,
`    } catch (e) {
      const code = String((e && (e.code || e.message)) || '');
      console.error('Authentication failed', e);
      if (code.includes('email-not-verified') || code.includes('EMAIL_NOT_VERIFIED')) { this.setState({ authError: null, authInfo: null, verifySent: email }); return; }
      this.setState({ authError: this.firebaseErrorMessage(e, s.authMode === 'register' ? 'ОШИБКА РЕГИСТРАЦИИ' : 'ОШИБКА ВХОДА'), authInfo: null });
    }`,
    'auth diagnostics fix',
  );
}

if (!html.includes("_pushErrorMessage = (code, status) =>")) {
  const start = html.indexOf("  _pushUrl = 'https://nightcity-push.konovalova-2017.workers.dev/';");
  const end = start >= 0 ? html.indexOf('  _startCallListener = () => {', start) : -1;
  if (start < 0 || end < 0) throw new Error('Cannot apply push diagnostics fix: source block not found');
  const replacement = String.raw`  _pushUrl = 'https://nightcity-push.konovalova-2017.workers.dev/';
  _pushErrorMessage = (code, status) => {
    const value = String(code || '').toLowerCase();
    if (value === 'target_not_registered') return 'У получателя не включены push-уведомления';
    if (value === 'fcm_token_invalid') return 'Push-токен получателя устарел · пусть откроет приложение';
    if (value === 'fcm_rejected') return 'Firebase отклонил push · проверь Cloud Messaging API';
    if (value === 'not_configured') return 'Cloudflare Worker не настроен';
    if (value === 'unauthorized') return 'Сессия Firebase устарела · войди заново';
    if (value === 'not_in_same_chat' || value === 'invalid_call') return 'Сервер отклонил данные звонка';
    if (value === 'failed_to_fetch' || value === 'network_error') return 'Нет связи с сервером push';
    return 'Push не доставлен' + (status ? ' · HTTP ' + status : '');
  };
  _sendCallPush = async (uid, kind, callId, chatId) => {
    try {
      const idToken = await NC.getIdToken();
      const response = await fetch(this._pushUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          idToken,
          toUid: uid,
          chatId,
          callId,
          callType: kind,
        })
      });
      let result = {};
      try { result = await response.json(); } catch (e) {}
      if (!response.ok || !result.ok) {
        const error = new Error((result && result.error) || ('HTTP_' + response.status));
        error.pushCode = (result && result.error) || '';
        error.httpStatus = response.status;
        throw error;
      }
      return true;
    } catch (e) {
      const raw = String((e && (e.pushCode || e.message)) || 'network_error');
      const code = raw.toLowerCase().includes('failed to fetch') ? 'failed_to_fetch' : raw;
      console.error('Call push failed', { code, status: e && e.httpStatus });
      this._toast(this._pushErrorMessage(code, e && e.httpStatus));
      return false;
    }
  };
  _savePushToken = async (token) => {
    const value = String((token && token.value) || token || '').trim();
    if (!value || !this._myUid) throw new Error('PUSH_TOKEN_EMPTY');
    this._fcmToken = value;
    await NC.savePrivate(this._myUid, 'push', { fcmToken: value, updatedAt: Date.now(), platform: 'android' });
    const saved = await NC.getPrivate(this._myUid, 'push');
    if (!saved || saved.fcmToken !== value) throw new Error('PUSH_TOKEN_NOT_SAVED');
    return value;
  };
  _registerPush = async () => {
    try {
      const PN = this.plugin('PushNotifications');
      if (!PN) return;
      if (!this._pushInit) {
        this._pushInit = true;
        await PN.addListener('registration', (token) => {
          this._savePushToken(token).then(() => {
            if (this._pushRegistrationResolve) this._pushRegistrationResolve(true);
          }).catch((error) => {
            console.error('Push token persistence failed', error);
            if (this._pushRegistrationReject) this._pushRegistrationReject(error);
          });
        });
        await PN.addListener('registrationError', (error) => {
          console.error('FCM registration failed', error);
          if (this._pushRegistrationReject) this._pushRegistrationReject(error || new Error('FCM_REGISTRATION_FAILED'));
        });
        await PN.addListener('pushNotificationReceived', () => { try { this._startCallListener(); } catch (e) {} });
        await PN.addListener('pushNotificationActionPerformed', () => { try { this._startCallListener(); } catch (e) {} });
      }
      let perm = await PN.checkPermissions();
      if (perm.receive !== 'granted') perm = await PN.requestPermissions();
      if (perm.receive !== 'granted') {
        this._toast('Разреши уведомления, чтобы принимать звонки');
        return;
      }
      const registered = new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('FCM_REGISTRATION_TIMEOUT')), 12000);
        this._pushRegistrationResolve = (value) => { clearTimeout(timer); resolve(value); };
        this._pushRegistrationReject = (error) => { clearTimeout(timer); reject(error); };
      });
      await PN.register();
      await registered;
      this._pushRegistrationResolve = null;
      this._pushRegistrationReject = null;
      try {
        const LN = this.plugin('LocalNotifications');
        if (LN && LN.createChannel) {
          await LN.createChannel({ id: 'calls', name: 'Звонки', description: 'Входящие звонки', importance: 5, visibility: 1, sound: 'default', vibration: true, lights: true, lightColor: '#00f0ff' });
        }
      } catch (e) {}
    } catch (e) {
      this._pushRegistrationResolve = null;
      this._pushRegistrationReject = null;
      console.error('Push setup failed', e);
      this._toast('Push не подключён · проверь разрешение уведомлений');
    }
  };
`;
  html = html.slice(0, start) + replacement + html.slice(end);
}

if (!html.includes('grid-template-columns:38px repeat(2,minmax(0,1fr))')) {
  const oldSelectionBar = '<div style="flex:none;display:flex;gap:6px;align-items:center;padding:8px 12px;background:#12121a;border-bottom:1px solid #00f0ff">';
  const newSelectionBar = '<div style="flex:none;display:grid;grid-template-columns:38px repeat(2,minmax(0,1fr));gap:6px;align-items:stretch;padding:8px 12px;background:#12121a;border-bottom:1px solid #00f0ff">';
  if (!html.includes(oldSelectionBar)) throw new Error('Cannot repair selection toolbar: source block not found');
  html = html.replace(oldSelectionBar, newSelectionBar);
}

const brokenCustomWall = '            <sc-if value="{{ customWallOn }}"><div style="position:sticky;top:0;left:0;height:0;z-index:0;pointer-events:none;overflow:visible"><img src="{{ chatWallImgSrc }}" ref="{{ customWallRef }}" style="position:absolute;top:0;left:0;width:100%;object-fit:cover;object-position:center"/></div></sc-if>\n';
html = html.replace(brokenCustomWall, '');

if (!html.includes('const _wallImgCss = String(s.chatWallImg')) {
  const oldWallBackground = `    const wallBg = (_wallKey === 'custom' && s.chatWallImg)
      ? 'background:#0a0a0f'`;
  const newWallBackground = `    const _wallImgCss = String(s.chatWallImg || '').replace(/["\\\\\\n\\r]/g, '');
    const wallBg = (_wallKey === 'custom' && _wallImgCss)
      ? \`background-color:#0a0a0f;background-image:linear-gradient(rgba(5,7,10,.30),rgba(5,7,10,.48)),url("\${_wallImgCss}");background-size:cover;background-position:center;background-repeat:no-repeat;background-attachment:scroll\``;
  if (!html.includes(oldWallBackground)) throw new Error('Cannot repair custom wallpaper: source block not found');
  html = html.replace(oldWallBackground, newWallBackground);
}

if (!html.includes('threads: { ...s.threads, [id]: ((s.threads || {})[id] || []).map(m => ({ ...m })) }')) {
  const oldToggle = `  togglePostSel = (mid) => { const k = String(mid); this.setState(s => { const cur = s.selPosts.map(String); return ({ selPosts: cur.includes(k) ? cur.filter(x => x !== k) : [...cur, k], threads: Object.assign({}, s.threads, { [this.state.activeId]: [ ...((s.threads || {})[this.state.activeId] || []) ] }) }); }); };`;
  const newToggle = `  togglePostSel = (mid) => { const k = String(mid); this.setState(s => { const cur = s.selPosts.map(String); const id = s.activeId; return ({ selPosts: cur.includes(k) ? cur.filter(x => x !== k) : [...cur, k], threads: { ...s.threads, [id]: ((s.threads || {})[id] || []).map(m => ({ ...m })) } }); }); };`;
  if (!html.includes(oldToggle)) throw new Error('Cannot repair selection toggle: source block not found');
  html = html.replace(oldToggle, newToggle);
}

if (!html.includes('return { selPosts: [], threads: { ...s.threads')) {
  const oldClear = `  clearPostSel = () => { try { if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); } catch (e) {} this.setState(s => ({ selPosts: [], threads: Object.assign({}, s.threads, { [this.state.activeId]: [ ...((s.threads || {})[this.state.activeId] || []) ] }) })); };`;
  const newClear = `  clearPostSel = () => { try { if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); } catch (e) {} this.setState(s => { const id = s.activeId; return { selPosts: [], threads: { ...s.threads, [id]: ((s.threads || {})[id] || []).map(m => ({ ...m })) } }; }, () => { try { this.forceUpdate(); } catch (e) {} }); };`;
  if (!html.includes(oldClear)) throw new Error('Cannot repair selection clearing: source block not found');
  html = html.replace(oldClear, newClear);
}

html = html.replace('isPostSelected: s.selPosts.includes(m.id),', 'isPostSelected: s.selPosts.map(String).includes(String(m.id)),');

await writeFile(file, html);
