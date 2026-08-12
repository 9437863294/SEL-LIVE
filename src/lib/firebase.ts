
// Import the functions you need from the SDKs you need
import { initializeApp, getApp, getApps } from "firebase/app";
import { getFirestore, initializeFirestore, type Firestore } from "firebase/firestore";
import { getDatabase, type Database } from "firebase/database";
import {
  browserLocalPersistence,
  browserPopupRedirectResolver,
  browserSessionPersistence,
  getAuth,
  inMemoryPersistence,
  indexedDBLocalPersistence,
  initializeAuth,
  type Auth,
} from "firebase/auth";
import { getStorage } from "firebase/storage";

// Your web app's Firebase configuration
const firebaseConfig = {
  projectId: "module-hub-uc7tw",
  appId: "1:1098805626846:web:53c37d00f62dbbc19dbf4f",
  storageBucket: "module-hub-uc7tw.firebasestorage.app",
  apiKey: "AIzaSyBRnB-SvnQWuNipl2SOnuV4opME0ZmsdPQ",
  authDomain: "module-hub-uc7tw.firebaseapp.com",
  messagingSenderId: "1098805626846",
  databaseURL:
    process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL ||
    "https://module-hub-uc7tw-default-rtdb.firebaseio.com",
};

// Initialize Firebase
const app = getApps().length ? getApp() : initializeApp(firebaseConfig);

// Initialize Firestore with auto-detected long polling. This makes the SDK
// fall back to plain long-polling XHR when the default streaming WebChannel
// connection is blocked or mangled (common on corporate proxies/VPNs/AV/ad
// blockers), which otherwise surfaces as "Could not reach Cloud Firestore
// backend" and drops the client into offline mode.
const createFirestore = (): Firestore => {
  try {
    return initializeFirestore(app, {
      experimentalAutoDetectLongPolling: true,
    });
  } catch (error) {
    // Firestore was already initialized for this app (e.g. Fast Refresh) -
    // reuse the existing instance instead of throwing.
    return getFirestore(app);
  }
};

const db: Firestore = createFirestore();
const realtimeDb: Database = getDatabase(app);

const createAuth = (): Auth => {
  if (typeof window === "undefined") {
    return getAuth(app);
  }

  try {
    return initializeAuth(app, {
      persistence: [
        indexedDBLocalPersistence,
        browserLocalPersistence,
        browserSessionPersistence,
        inMemoryPersistence,
      ],
      popupRedirectResolver: browserPopupRedirectResolver,
    });
  } catch (error) {
    // If auth was already initialized, fall back to the existing instance.
    return getAuth(app);
  }
};

const auth = createAuth();
const storage = getStorage(app);

export { app, db, realtimeDb, auth, storage };
