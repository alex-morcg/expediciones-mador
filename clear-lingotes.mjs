import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, deleteDoc } from 'firebase/firestore';

// Firebase config
const firebaseConfig = {
  apiKey: 'AIzaSyDZ4lVMupSzp4MOZMs1zNUNgNckUjqiHbs',
  authDomain: 'mador-32292.firebaseapp.com',
  projectId: 'mador-32292',
  storageBucket: 'mador-32292.firebasestorage.app',
  messagingSenderId: '1069967702460',
  appId: '1:1069967702460:web:691ffc7d60ff9513d2d3b9',
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

async function clearLingotes() {
  console.log('=== Borrando datos de lingotes ===\n');

  const collections = [
    'lingotes_exportaciones',
    'lingotes_entregas',
    'lingotes_futura',
    'lingotes_config'
  ];

  for (const collName of collections) {
    const snap = await getDocs(collection(db, collName));
    let count = 0;
    for (const d of snap.docs) {
      await deleteDoc(d.ref);
      count++;
    }
    console.log(`✓ ${collName}: ${count} docs eliminados`);
  }

  console.log('\n✅ Datos de lingotes borrados. Puedes empezar de cero.');
  process.exit(0);
}

clearLingotes().catch(e => { console.error(e); process.exit(1); });
