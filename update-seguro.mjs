import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, updateDoc, doc } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: "AIzaSyDZ4lVMupSzp4MOZMs1zNUNgNckUjqiHbs",
  authDomain: "mador-32292.firebaseapp.com",
  projectId: "mador-32292",
  storageBucket: "mador-32292.firebasestorage.app",
  messagingSenderId: "1069967702460",
  appId: "1:1069967702460:web:691ffc7d60ff9513d2d3b9"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

async function updateSeguro() {
  const snap = await getDocs(collection(db, 'expediciones'));
  let updated = 0;
  for (const d of snap.docs) {
    const data = d.data();
    if (!data.seguro) {
      await updateDoc(doc(db, 'expediciones', d.id), { seguro: 600000 });
      console.log(`  ${data.nombre}: seguro → 600000`);
      updated++;
    } else {
      console.log(`  ${data.nombre}: ya tiene seguro = ${data.seguro}`);
    }
  }
  console.log(`\nDone. Updated ${updated} expediciones.`);
  process.exit(0);
}

updateSeguro().catch(e => { console.error(e); process.exit(1); });
