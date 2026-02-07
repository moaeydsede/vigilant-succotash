// Firebase Firestore + Auth (Modular v9) – ضع بياناتك هنا
import { initializeApp } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-app.js";
import {
  getFirestore, collection, doc, getDoc, setDoc, addDoc, updateDoc, deleteDoc,
  getDocs, query, where, orderBy, limit, serverTimestamp, Timestamp
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";

import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword,
  createUserWithEmailAndPassword, signOut
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-auth.js";

export const firebaseConfig = {
  apiKey: "PUT_YOUR_API_KEY",
  authDomain: "PUT_YOUR_AUTH_DOMAIN",
  projectId: "PUT_YOUR_PROJECT_ID",
  storageBucket: "PUT_YOUR_STORAGE_BUCKET",
  messagingSenderId: "PUT_YOUR_SENDER_ID",
  appId: "PUT_YOUR_APP_ID"
};

export const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const auth = getAuth(app);

export const fs = {
  collection, doc, getDoc, setDoc, addDoc, updateDoc, deleteDoc,
  getDocs, query, where, orderBy, limit, serverTimestamp, Timestamp
};

export const fa = {
  onAuthStateChanged, signInWithEmailAndPassword,
  createUserWithEmailAndPassword, signOut
};
