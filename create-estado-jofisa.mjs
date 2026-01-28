import { initializeApp } from 'firebase/app';
import {
  getFirestore, collection, getDocs, updateDoc, doc, setDoc
} from 'firebase/firestore';

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

async function main() {
  // 1. Create "en jofisa" estado
  const estadoId = 'en_jofisa';
  await setDoc(doc(db, 'estadosPaquete', estadoId), {
    nombre: 'En Jofisa',
    icon: '🏭',
    color: '#7c3aed', // purple
  });
  console.log('✓ Created estado "En Jofisa" 🏭');

  // 2. Get all expeditions
  const expSnap = await getDocs(collection(db, 'expediciones'));
  const expediciones = expSnap.docs.map(d => ({ id: d.id, ...d.data() }));

  // 3. Get all paquetes
  const paqSnap = await getDocs(collection(db, 'paquetes'));
  const paquetes = paqSnap.docs.map(d => ({ id: d.id, ...d.data() }));

  // 4. Find expeditions before E53
  const expAntiguas = expediciones.filter(e => {
    const num = parseInt(e.nombre?.replace(/\D/g, '') || '0');
    return num < 53;
  });

  console.log(`\nExpediciones antes de E53: ${expAntiguas.map(e => e.nombre).join(', ')}`);

  // 5. Set all their paquetes to "en_jofisa"
  let count = 0;
  for (const exp of expAntiguas) {
    const expPaquetes = paquetes.filter(p => p.expedicionId === exp.id);
    for (const paq of expPaquetes) {
      if (paq.estado !== estadoId) {
        await updateDoc(doc(db, 'paquetes', paq.id), { estado: estadoId });
        count++;
        console.log(`  ${exp.nombre} / ${paq.nombre || paq.numero}: → en_jofisa`);
      }
    }
  }

  console.log(`\n✓ Updated ${count} paquetes to "en_jofisa"`);
  console.log('\nDone!');
  process.exit(0);
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
