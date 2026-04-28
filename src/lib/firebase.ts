
// Import the functions you need from the SDKs you need
import { initializeApp, getApp, getApps } from "firebase/app";
import { getFirestore, type Firestore } from "firebase/firestore";
import {
  browserLocalPersistence,
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
};

// Initialize Firebase
const app = getApps().length ? getApp() : initializeApp(firebaseConfig);

// Use getFirestore() for robust initialization
const db: Firestore = getFirestore(app);

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
    });
  } catch (error) {
    // If auth was already initialized, fall back to the existing instance.
    return getAuth(app);
  }
};

const auth = createAuth();
const storage = getStorage(app);

export { db, auth, storage };
