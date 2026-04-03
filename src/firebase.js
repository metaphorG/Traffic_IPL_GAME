import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyCI3fvZZjxFzNTi8XZDXwCmm7MffkCk0Ik",
  authDomain: "traffic-ipl-small.firebaseapp.com",
  projectId: "traffic-ipl-small",
  storageBucket: "traffic-ipl-small.firebasestorage.app",
  messagingSenderId: "478216848953",
  appId: "1:478216848953:web:5639898fb6e8e42e352fe8"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
const provider = new GoogleAuthProvider();

export const loginWithGoogle = () => signInWithPopup(auth, provider);
export const logout = () => signOut(auth);