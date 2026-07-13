import { readFile, writeFile } from 'node:fs/promises';

const file = new URL('../index.html', import.meta.url);
let html = await readFile(file, 'utf8');

html = html.replaceAll('2.077.202', '2.077.204').replaceAll('2.077.203', '2.077.204');

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

await writeFile(file, html);
