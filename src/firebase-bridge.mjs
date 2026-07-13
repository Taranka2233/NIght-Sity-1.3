import * as appMod from 'firebase/app';
import * as authMod from 'firebase/auth';
import * as fsMod from 'firebase/firestore';

// The legacy single-file client expects Firebase namespaces. Expose only the
// modules it uses, while keeping the SDK bundled locally for offline startup.
window.NCFirebaseModules = Object.freeze({ appMod, authMod, fsMod });
