// Script para añadir códigos a usuarios existentes en Firestore
// Ejecutar con: node add-codigos-usuarios.mjs

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

// Generar código único de 8 caracteres
const generarCodigo = () => {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let codigo = '';
  for (let i = 0; i < 8; i++) {
    codigo += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return codigo;
};

async function main() {
  console.log('Leyendo usuarios...');

  const usuariosSnap = await getDocs(collection(db, 'usuarios'));
  const usuarios = [];
  usuariosSnap.forEach(doc => {
    usuarios.push({ id: doc.id, ...doc.data() });
  });

  console.log(`Encontrados ${usuarios.length} usuarios:`);

  const codigosUsados = new Set();

  for (const usuario of usuarios) {
    if (usuario.codigo) {
      console.log(`  - ${usuario.nombre} (${usuario.id}): ya tiene código ${usuario.codigo}`);
      codigosUsados.add(usuario.codigo);
      continue;
    }

    // Generar código único
    let codigo;
    if (usuario.id === 'alex') {
      codigo = 'admin001'; // Alex siempre tiene este código
    } else {
      do {
        codigo = generarCodigo();
      } while (codigosUsados.has(codigo));
    }
    codigosUsados.add(codigo);

    // Actualizar en Firestore
    await updateDoc(doc(db, 'usuarios', usuario.id), { codigo });
    console.log(`  - ${usuario.nombre} (${usuario.id}): código asignado → ${codigo}`);
  }

  console.log('\n✅ Códigos asignados correctamente');
  console.log('\nURLs de acceso:');

  // Leer de nuevo para mostrar todos los códigos
  const usuariosActualizados = await getDocs(collection(db, 'usuarios'));
  usuariosActualizados.forEach(docSnap => {
    const u = docSnap.data();
    console.log(`  ${u.nombre}: https://expediciones-mador-b3fp.vercel.app/?${u.codigo}`);
  });

  process.exit(0);
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
