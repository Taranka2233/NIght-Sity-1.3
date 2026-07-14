import { readFile, writeFile } from 'node:fs/promises';

const file = new URL('../index.html', import.meta.url);
let html = await readFile(file, 'utf8');

html = html.replaceAll('2.077.202', '2.077.208').replaceAll('2.077.203', '2.077.208').replaceAll('2.077.204', '2.077.208').replaceAll('2.077.205', '2.077.208').replaceAll('2.077.206', '2.077.208').replaceAll('2.077.207', '2.077.208');

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

if (!html.includes('const _wallImgCss = String(s.chatWallImg') && !html.includes('pickChatWallpaper = () =>')) {
  const oldWallBackground = `    const wallBg = (_wallKey === 'custom' && s.chatWallImg)
      ? 'background:#0a0a0f'`;
  const newWallBackground = `    const _wallImgCss = String(s.chatWallImg || '').replace(/["\\\\\\n\\r]/g, '');
    const wallBg = (_wallKey === 'custom' && _wallImgCss)
      ? \`background-color:#0a0a0f;background-image:linear-gradient(rgba(5,7,10,.30),rgba(5,7,10,.48)),url("\${_wallImgCss}");background-size:cover;background-position:center;background-repeat:no-repeat;background-attachment:scroll\``;
  if (!html.includes(oldWallBackground)) throw new Error('Cannot repair custom wallpaper: source block not found');
  html = html.replace(oldWallBackground, newWallBackground);
}

// Custom wallpapers are user data: restore the image itself (not only the
// selected "custom" flag) after restart and persist it only after setState.
if (!html.includes('chatWallImg: d.chatWallImg || null') && !html.includes('chatWalls: {},')) {
  const restoreOld = "chatWall: d.chatWall || this.state.chatWall, chatFont:";
  const restoreNew = "chatWall: d.chatWall || this.state.chatWall, chatWallImg: d.chatWallImg || null, chatFont:";
  if (!html.includes(restoreOld)) throw new Error('Cannot restore saved custom wallpaper: session block not found');
  html = html.replaceAll(restoreOld, restoreNew);
}

if (!html.includes('pickChatWallpaper = () =>') && !html.includes("_applyWall = (img) => {\n    this.setState(\n      st => ({ chatWall: 'custom'")) {
  const oldApplyWall = "  _applyWall = (img) => { this.setState(st => ({ chatWall: 'custom', chatWallImg: img, contacts: st.contacts.map(c => c.wall ? { ...c, wall: null } : c) })); try { this.persist(); } catch (e) {} this._toast('Фон установлен ✓'); };";
  const newApplyWall = `  _applyWall = (img) => {
    this.setState(
      st => ({ chatWall: 'custom', chatWallImg: img, contacts: st.contacts.map(c => c.wall ? { ...c, wall: null } : c) }),
      () => { try { this.persist(); } catch (e) {} this._toast('Фон установлен ✓'); }
    );
  };`;
  if (!html.includes(oldApplyWall)) throw new Error('Cannot persist custom wallpaper: apply block not found');
  html = html.replace(oldApplyWall, newApplyWall);
}

if (!html.includes('const maxEdge = 1280, maxPixels = 1600000;')) {
  const oldResize = `                const maxW = 1280; let w = im.width || 1280, h = im.height || 1280;
                if (w > maxW) { h = Math.round(h * maxW / w); w = maxW; }
                const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
                cv.getContext('2d').drawImage(im, 0, 0, w, h);
                this._applyWall(cv.toDataURL('image/jpeg', 0.85));`;
  const newResize = `                const maxEdge = 1280, maxPixels = 1600000;
                const srcW = im.width || maxEdge, srcH = im.height || maxEdge;
                const scale = Math.min(1, maxEdge / srcW, maxEdge / srcH, Math.sqrt(maxPixels / (srcW * srcH)));
                const w = Math.max(1, Math.round(srcW * scale)), h = Math.max(1, Math.round(srcH * scale));
                const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
                cv.getContext('2d').drawImage(im, 0, 0, w, h);
                this._applyWall(cv.toDataURL('image/jpeg', 0.80));`;
  if (!html.includes(oldResize)) throw new Error('Cannot optimize custom wallpaper: image resize block not found');
  html = html.replace(oldResize, newResize);
}

if (!html.includes('let _localUi = {}; try { _localUi = this.loadData(user.email) || {}; }')) {
  const oldBackendUi = `      let _savedAliases = {}; try { _savedAliases = (this.loadData(user.email) || {}).aliases || {}; } catch (e) {}
      this.setState({ screen: 'list', myUid: user.uid, myName: prof.name || (prof.handle || '@me').slice(1).toUpperCase(), myHandle: prof.handle || '@me', myEmail: user.email || '', myStatus: prof.status || this.state.myStatus, myPhone: prof.phone || '', myAvatar: prof.avatar || this.state.myAvatar || null, contacts: [], threads: {}, aliases: _savedAliases, authError: null, authInfo: null, authPass: '', codeSent: false });`;
  const newBackendUi = `      let _localUi = {}; try { _localUi = this.loadData(user.email) || {}; } catch (e) {}
      const _savedAliases = _localUi.aliases || {};
      this.setState({ screen: 'list', myUid: user.uid, myName: prof.name || (prof.handle || '@me').slice(1).toUpperCase(), myHandle: prof.handle || '@me', myEmail: user.email || '', myStatus: prof.status || _localUi.myStatus || this.state.myStatus, myPhone: prof.phone || _localUi.myPhone || '', myAvatar: prof.avatar || _localUi.myAvatar || this.state.myAvatar || null, contacts: [], threads: {}, aliases: _savedAliases, chatWall: _localUi.chatWall || this.state.chatWall, chatWallImg: _localUi.chatWallImg || null, chatFont: _localUi.chatFont || this.state.chatFont, appIcon: _localUi.appIcon || this.state.appIcon, variant: _localUi.variant || this.state.variant, prefs: _localUi.prefs || this.state.prefs, blocked: _localUi.blocked || this.state.blocked, authError: null, authInfo: null, authPass: '', codeSent: false });`;
  if (!html.includes(oldBackendUi)) throw new Error('Cannot restore backend custom wallpaper: profile block not found');
  html = html.replace(oldBackendUi, newBackendUi);
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

// Version 2.077.208: wallpaper belongs to a concrete chat, never to the
// whole account. This also survives Firebase contact-list rebuilds because it
// is stored in a local map keyed by chat ID.
if (!html.includes('chatWalls: {},')) {
  const stateOld = `    chatWall: 'dark',
    chatWallImg: null,`;
  if (!html.includes(stateOld)) throw new Error('Cannot create per-chat wallpaper state');
  html = html.replace(stateOld, '    chatWalls: {},');

  html = html.replaceAll('chatWall: s.chatWall, chatWallImg: s.chatWallImg, ', 'chatWalls: s.chatWalls, ');
  html = html.replaceAll('chatWall: d.chatWall || this.state.chatWall, chatWallImg: d.chatWallImg || null, chatFont:', 'chatWalls: d.chatWalls || {}, chatFont:');
  html = html.replace('chatWall: _localUi.chatWall || this.state.chatWall, chatWallImg: _localUi.chatWallImg || null, chatFont:', 'chatWalls: _localUi.chatWalls || {}, chatFont:');

  const pickerStart = html.indexOf("  _applyWall = (img) => {");
  const pickerEnd = pickerStart >= 0 ? html.indexOf('  _deviceInfo = () => {', pickerStart) : -1;
  if (pickerStart < 0 || pickerEnd < 0) throw new Error('Cannot replace global wallpaper picker');
  const perChatPicker = String.raw`  _setChatWallpaperImage = (chatId, img) => {
    if (!chatId || !img) return;
    this.setState(
      st => ({ chatMenu: false, chatWalls: { ...(st.chatWalls || {}), [chatId]: { type: 'custom', image: img } } }),
      () => { try { this.persist(); } catch (e) {} this._toast('Фон установлен для этого чата ✓'); }
    );
  };
  pickChatWallpaper = () => {
    const chatId = this.state.activeId;
    if (!chatId) return;
    try {
      const inp = document.createElement('input');
      inp.type = 'file'; inp.accept = 'image/*';
      inp.style.position = 'fixed'; inp.style.left = '-9999px'; inp.style.top = '0';
      inp.onchange = () => {
        const f = inp.files && inp.files[0];
        try { if (inp.parentNode) inp.parentNode.removeChild(inp); } catch (e) {}
        if (!f) return;
        const isGif = /gif/i.test(f.type || '');
        const r = new FileReader();
        r.onload = () => {
          const data = r.result;
          if (isGif) { this._setChatWallpaperImage(chatId, data); return; }
          try {
            const im = new Image();
            im.onload = () => {
              try {
                const maxEdge = 1280, maxPixels = 1600000;
                const srcW = im.width || maxEdge, srcH = im.height || maxEdge;
                const scale = Math.min(1, maxEdge / srcW, maxEdge / srcH, Math.sqrt(maxPixels / (srcW * srcH)));
                const w = Math.max(1, Math.round(srcW * scale)), h = Math.max(1, Math.round(srcH * scale));
                const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
                cv.getContext('2d').drawImage(im, 0, 0, w, h);
                this._setChatWallpaperImage(chatId, cv.toDataURL('image/jpeg', 0.80));
              } catch (e) { this._setChatWallpaperImage(chatId, data); }
            };
            im.onerror = () => this._setChatWallpaperImage(chatId, data);
            im.src = data;
          } catch (e) { this._setChatWallpaperImage(chatId, data); }
        };
        r.onerror = () => this._toast('Не удалось прочитать файл');
        r.readAsDataURL(f);
      };
      document.body.appendChild(inp);
      inp.click();
    } catch (e) {}
  };
`;
  html = html.slice(0, pickerStart) + perChatPicker + html.slice(pickerEnd);

  const oldSetter = `  setChatWall = (w) => this.setState(s => ({ contacts: s.contacts.map(c => c.id === s.activeId ? { ...c, wall: w } : c) }));`;
  const newSetter = `  setChatWall = (type) => {
    const chatId = this.state.activeId;
    if (!chatId) return;
    this.setState(s => ({ chatWalls: { ...(s.chatWalls || {}), [chatId]: { type } } }), () => { try { this.persist(); } catch (e) {} });
  };
  clearChatWallpaper = () => this.setChatWall('dark');`;
  if (!html.includes(oldSetter)) throw new Error('Cannot replace chat wallpaper setter');
  html = html.replace(oldSetter, newSetter);

  html = html.replace(`      const _bwActive = this.state.contacts.find(c => c.id === this.state.activeId) || {}; const _bwKey = (_bwActive.wall && !_bwActive.isChannel && !_bwActive.isGroup) ? _bwActive.wall : this.state.chatWall; const _busyWall = (_bwKey === 'custom' || _bwKey === 'matrix');`, `      const _bwKey = ((this.state.chatWalls || {})[this.state.activeId] || {}).type || 'dark'; const _busyWall = (_bwKey === 'custom' || _bwKey === 'matrix');`);
  const oldWallHead = `    const _wallKey = (active && !active.isChannel && !active.isGroup && active.wall) ? active.wall : s.chatWall;
    this._lastWallKey = _wallKey;
    const _wallImgCss = String(s.chatWallImg || '').replace(/["\\\\\\n\\r]/g, '');`;
  const newWallHead = `    const _wallEntry = (active && s.chatWalls && s.chatWalls[active.id]) || { type: 'dark' };
    const _wallKey = _wallEntry.type || 'dark';
    this._lastWallKey = _wallKey;
    const _wallImgCss = String(_wallEntry.image || '').replace(/["\\\\\\n\\r]/g, '');`;
  if (!html.includes(oldWallHead)) throw new Error('Cannot use per-chat wallpaper in thread');
  html = html.replace(oldWallHead, newWallHead);

  html = html.replace(`      chatSettingsShow: !!(active && !active.isChannel && !active.isGroup),
      chatMenuOpen: !!(s.chatMenu && active && !active.isChannel && !active.isGroup),`, `      chatSettingsShow: !!active,
      chatMenuOpen: !!(s.chatMenu && active),
      chatMenuPersonal: !!(active && !active.isChannel && !active.isGroup),`);
  const oldWallProps = `      wallDark: () => this.setChatWall('dark'), wallGrid: () => this.setChatWall('grid'), wallRed: () => this.setChatWall('red'),
      wallCur: (active && active.wall) ? active.wall : 'dark',
      wallStyleDark: 'flex:1;height:44px;cursor:pointer;background:#0a0a0f;border:2px solid ' + (((active && active.wall) || 'dark') === 'dark' ? 'var(--nc-accent)' : '#23232e'),
      wallStyleGrid: 'flex:1;height:44px;cursor:pointer;background-color:#0a0a0f;background-image:repeating-linear-gradient(90deg,rgba(0,240,255,.15) 0 1px,transparent 1px 8px),repeating-linear-gradient(0deg,rgba(0,240,255,.12) 0 1px,transparent 1px 8px);border:2px solid ' + ((active && active.wall) === 'grid' ? 'var(--nc-accent)' : '#23232e'),
      wallStyleRed: 'flex:1;height:44px;cursor:pointer;background:radial-gradient(120% 80% at 50% 0%,#1a070d 0%,#0a0a0f 65%);border:2px solid ' + ((active && active.wall) === 'red' ? 'var(--nc-accent)' : '#23232e'),`;
  const newWallProps = `      wallDark: () => this.setChatWall('dark'), wallGrid: () => this.setChatWall('grid'), wallRed: () => this.setChatWall('red'), pickChatWallpaper: this.pickChatWallpaper, clearChatWallpaper: this.clearChatWallpaper,
      wallCur: (((s.chatWalls || {})[s.activeId] || {}).type || 'dark'),
      chatHasOwnWallpaper: ((((s.chatWalls || {})[s.activeId] || {}).type || '') === 'custom'),
      wallStyleDark: 'flex:1;height:44px;cursor:pointer;background:#0a0a0f;border:2px solid ' + (((((s.chatWalls || {})[s.activeId] || {}).type || 'dark') === 'dark') ? 'var(--nc-accent)' : '#23232e'),
      wallStyleGrid: 'flex:1;height:44px;cursor:pointer;background-color:#0a0a0f;background-image:repeating-linear-gradient(90deg,rgba(0,240,255,.15) 0 1px,transparent 1px 8px),repeating-linear-gradient(0deg,rgba(0,240,255,.12) 0 1px,transparent 1px 8px);border:2px solid ' + (((((s.chatWalls || {})[s.activeId] || {}).type || '') === 'grid') ? 'var(--nc-accent)' : '#23232e'),
      wallStyleRed: 'flex:1;height:44px;cursor:pointer;background:radial-gradient(120% 80% at 50% 0%,#1a070d 0%,#0a0a0f 65%);border:2px solid ' + (((((s.chatWalls || {})[s.activeId] || {}).type || '') === 'red') ? 'var(--nc-accent)' : '#23232e'),`;
  if (!html.includes(oldWallProps)) throw new Error('Cannot expose per-chat wallpaper controls');
  html = html.replace(oldWallProps, newWallProps);

  html = html.replace(`              <div style="font-family:'JetBrains Mono',monospace;font-size:9px;color:#5a5a66;letter-spacing:1px;margin-bottom:6px">// ОБОИ ЧАТА</div>`, `              <div style="font-family:'JetBrains Mono',monospace;font-size:9px;color:#5a5a66;letter-spacing:1px;margin-bottom:6px">// ФОН ЭТОГО ЧАТА</div>`);
  const menuInsert = `              </div>
              <button onclick="{{ toggleChatMute }}"`;
  const menuReplacement = `              </div>
              <button onclick="{{ pickChatWallpaper }}" style="width:100%;padding:12px;margin-bottom:8px;background:rgba(0,240,255,.08);border:1px solid #00f0ff;color:#00f0ff;font-family:'JetBrains Mono',monospace;font-size:12px;font-weight:700;letter-spacing:.5px;cursor:pointer;text-align:left">▧ ВЫБРАТЬ ИЗОБРАЖЕНИЕ ДЛЯ ЭТОГО ЧАТА</button>
              <sc-if value="{{ chatHasOwnWallpaper }}"><button onclick="{{ clearChatWallpaper }}" style="width:100%;padding:10px;margin-bottom:8px;background:transparent;border:1px solid #6a6a76;color:#a8a8b2;font-family:'JetBrains Mono',monospace;font-size:11px;font-weight:700;cursor:pointer;text-align:left">✕ УБРАТЬ СВОЙ ФОН</button></sc-if>
              <sc-if value="{{ chatMenuPersonal }}">
              <button onclick="{{ toggleChatMute }}"`;
  if (!html.includes(menuInsert)) throw new Error('Cannot add chat wallpaper menu button');
  html = html.replace(menuInsert, menuReplacement);
  html = html.replace(`              <button onclick="{{ toggleBlock }}" style="width:100%;padding:12px;background:transparent;border:1px solid #ff003c;color:#ff003c;font-family:'JetBrains Mono',monospace;font-size:12px;font-weight:700;letter-spacing:.5px;cursor:pointer;text-align:left">{{ blockLabel }}</button>
            </div>`, `              <button onclick="{{ toggleBlock }}" style="width:100%;padding:12px;background:transparent;border:1px solid #ff003c;color:#ff003c;font-family:'JetBrains Mono',monospace;font-size:12px;font-weight:700;letter-spacing:.5px;cursor:pointer;text-align:left">{{ blockLabel }}</button>
              </sc-if>
            </div>`);

  html = html.replace(`        { label: 'Оформление чатов', sub: 'обои, размер шрифта', icon: '▤', color: '#fcee0a', key: 'chats' },`, `        { label: 'Вид сообщений', sub: 'стиль, размер шрифта, иконка', icon: '▤', color: '#fcee0a', key: 'chats' },`);
  html = html.replace(`      chats: { title: 'ОФОРМЛЕНИЕ ЧАТОВ', rows: [
        { kind: 'chatpreview', label: '' },
        { kind: 'head', label: '// ОБОИ ЧАТА' },
        { kind: 'choice', label: 'Фон', opts: [['dark', 'ТЬМА'], ['grid', 'СЕТКА'], ['red', 'БАГРОВЫЙ'], ['matrix', 'МАТРИЦА'], ['synth', 'СИНТ'], ['circuit', 'СХЕМА'], ['custom', 'СВОЙ']], cur: s.chatWall, set: (v) => v === 'custom' ? this.pickWallpaper() : this.setState(st => ({ chatWall: v, contacts: st.contacts.map(c => c.wall ? { ...c, wall: null } : c) }), this.persist) },`, `      chats: { title: 'ВИД СООБЩЕНИЙ', rows: [`);
  html = html.replace(`this._faq(3, 'Как сменить обои чата или поставить своё фото?', 'Оформление чатов → «Фон». Вариант СВОЙ откроет выбор фото или GIF из телефона. МАТРИЦА — анимированный падающий код.'),`, `this._faq(3, 'Как сменить обои чата или поставить своё фото?', 'Открой нужный чат → три точки вверху → «Выбрать изображение для этого чата». Фон сохраняется отдельно для каждого диалога, группы или канала.'),`);
  html = html.replace(`this._faq(6, 'Как сменить иконку приложения?', 'Оформление чатов → «Иконка приложения». Выбери из 10 вариантов и нажми «Сохранить». Работает в установленном APK.'),`, `this._faq(6, 'Как сменить иконку приложения?', 'Настройки → «Вид сообщений» → «Иконка приложения». Выбери из 10 вариантов и нажми «Сохранить». Работает в установленном APK.'),`);
}

await writeFile(file, html);
