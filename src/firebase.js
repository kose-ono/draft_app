// src/firebase.js
import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";

// ご自身の Firebase 設定値に置き換えてください
const firebaseConfig = {
  apiKey: "AIzaSyAQKrtXqrzq0SDxGdMd92nu1nxfCZ8ZUDY",
  authDomain: "npb-draft-app.firebaseapp.com",
  projectId: "npb-draft-app",
  storageBucket: "npb-draft-app.firebasestorage.app",
  messagingSenderId: "389608853",
  appId: "1:389608853:web:b08c412aee7bc60a65729c",
  measurementId: "G-E3ZWVNWD2V"
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);