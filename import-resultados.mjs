import { initializeApp } from 'firebase/app';
import {
  getFirestore, collection, getDocs, updateDoc, doc
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

// Data from Jofisa spreadsheet - FINO SOBRA per client per expedition
// Client names in spreadsheet → app client names mapping:
// GAUDIA → Gaudia
// GEMADOR / GEMA DOR → Gemma d'Or
// ORCASH / MAJORO → OrCash
// MILLA / LA MILLA → La Milla d'Or
// NOVAJOIA / NOVA JOIA → Nova Joia
// ALQUIMIA → Alquimia
// STOCK → Mador stock
// PARTICULAR → Contratos particulares

const finoSobraData = {
  'E52': {
    'Contratos particulares': { finoSobra: -0.15 },
    'Gaudia': { finoSobra: 53.96 },
    'OrCash': { finoSobra: 8.61 },
    "Gemma d'Or": { finoSobra: 5.35 },
    'Nova Joia': { finoSobra: 20.61 },
    "La Milla d'Or": { finoSobra: 1.23 },
  },
  'E51': {
    "La Milla d'Or": { finoSobra: -1.64 },
    "Gemma d'Or": { finoSobra: 11.43 },
    'OrCash': { finoSobra: 8.78 },
    'Gaudia': { finoSobra: 27.79 },
    'Nova Joia': { finoSobra: 19.03 },
    'Alquimia': { finoSobra: 0.34 },
  },
  'E50': {
    'Gaudia': { finoSobra: 33.85 },
    "Gemma d'Or": { finoSobra: 9.30 },
    'Mador stock': { finoSobra: -2.97 },
    'OrCash': { finoSobra: 2.61 },
    "La Milla d'Or": { finoSobra: 18.90 },
    'Nova Joia': { finoSobra: 29.33 },
  },
};

async function main() {
  // Load expediciones and clientes
  const expSnap = await getDocs(collection(db, 'expediciones'));
  const expediciones = expSnap.docs.map(d => ({ id: d.id, ...d.data() }));

  const cliSnap = await getDocs(collection(db, 'clientes'));
  const clientes = cliSnap.docs.map(d => ({ id: d.id, ...d.data() }));

  console.log('Expediciones:', expediciones.map(e => `${e.nombre} (${e.id})`).join(', '));
  console.log('Clientes:', clientes.map(c => `${c.nombre} (${c.id})`).join(', '));

  for (const [expNombre, clienteData] of Object.entries(finoSobraData)) {
    const exp = expediciones.find(e => e.nombre === expNombre);
    if (!exp) {
      console.log(`SKIP: Expedition ${expNombre} not found`);
      continue;
    }

    const resultados = exp.resultados || {};
    const clientesRes = resultados.clientes || {};

    for (const [clienteNombre, data] of Object.entries(clienteData)) {
      const cliente = clientes.find(c => c.nombre === clienteNombre);
      if (!cliente) {
        console.log(`  SKIP: Client "${clienteNombre}" not found for ${expNombre}`);
        continue;
      }

      clientesRes[cliente.id] = {
        ...(clientesRes[cliente.id] || {}),
        finoSobra: data.finoSobra,
      };
      console.log(`  ${expNombre} / ${clienteNombre} (${cliente.id}): finoSobra = ${data.finoSobra}`);
    }

    const newResultados = { ...resultados, clientes: clientesRes };
    await updateDoc(doc(db, 'expediciones', exp.id), { resultados: newResultados });
    console.log(`✓ Updated ${expNombre} (${exp.id}) with resultados`);
  }

  console.log('\nDone!');
  process.exit(0);
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
