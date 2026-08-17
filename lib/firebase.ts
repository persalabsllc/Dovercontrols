import { getApp, getApps, initializeApp } from "firebase/app";
import { getAuth, type Auth } from "firebase/auth";

const firebaseConfig = {
  apiKey: "AIzaSyBsAilApy0bezl_ENzgfTRlLXCOAWxsOPY",
  authDomain: "dovercontrols.firebaseapp.com",
  projectId: "dovercontrols",
  storageBucket: "dovercontrols.firebasestorage.app",
  messagingSenderId: "812439006468",
  appId: "1:812439006468:web:67bd7b1bb764ff87ed7451",
};

let authInstance: Auth | undefined;

export function getFirebaseAuth(): Auth {
  if (!authInstance) {
    const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
    authInstance = getAuth(app);
  }

  return authInstance;
}
