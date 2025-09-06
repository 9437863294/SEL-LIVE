
// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
import { getFirestore, initializeFirestore, persistentLocalCache, persistentMultipleTabManager } from "firebase/firestore";
import { getAuth } from "firebase/auth";
import { getStorage } from "firebase/storage";

// Your web app's Firebase configuration
const firebaseConfig = {
  projectId: "module-hub-uc7tw",
  appId: "1:1098805626846:web:53c37d00f62dbbc19dbf4f",
  storageBucket: "module-hub-uc7tw.appspot.com",
  apiKey: "AIzaSyBRnB-SvnQWuNipl2SOnuV4opME0ZmsdPQ",
  authDomain: "module-hub-uc7tw.firebaseapp.com",
  messagingSenderId: "1098805626846",
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

const db = initializeFirestore(app, {
    localCache: persistentLocalCache({
        tabManager: persistentMultipleTabManager(),
    }),
    experimentalForceLongPolling: true,
});

const auth = getAuth(app);
const storage = getStorage(app);

export { db, auth, storage };
