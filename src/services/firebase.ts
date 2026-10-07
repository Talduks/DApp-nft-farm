import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

const env = import.meta.env;

// The Firebase web config is public by design; access control lives in firestore.rules.
// Values can be overridden per environment with VITE_FIREBASE_* variables.
const firebaseConfig = {
  apiKey: env.VITE_FIREBASE_API_KEY || 'AIzaSyDTUnfxVVdv64rQMAbleDATTunKCNPA4Q4',
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN || 'dapp-farm.firebaseapp.com',
  projectId: env.VITE_FIREBASE_PROJECT_ID || 'dapp-farm',
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET || 'dapp-farm.firebasestorage.app',
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID || '291109797810',
  appId: env.VITE_FIREBASE_APP_ID || '1:291109797810:web:7c73e6a27e77a327cd6eab',
  measurementId: env.VITE_FIREBASE_MEASUREMENT_ID || 'G-VE179176BK',
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);

// Analytics is optional and breaks in some browsers/webviews; load it lazily when supported.
import('firebase/analytics')
  .then(async ({ getAnalytics, isSupported }) => {
    if (await isSupported()) getAnalytics(app);
  })
  .catch(() => undefined);
