import { readFileSync } from 'fs';
import { initializeApp } from 'firebase/app';
import {
  getFirestore, collection, doc, addDoc, setDoc, getDocs, deleteDoc, writeBatch
} from 'firebase/firestore';

// Firebase config (same as .env)
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

// --- CSV parser (handles quoted fields with commas AND newlines) ---
function parseCSV(text) {
  const rows = splitCSVRows(text);
  const headers = parseCSVLine(rows[0]);
  return rows.slice(1).map(line => {
    const values = parseCSVLine(line);
    const obj = {};
    headers.forEach((h, i) => obj[h.trim()] = (values[i] || '').trim());
    return obj;
  });
}

function splitCSVRows(text) {
  const rows = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
      current += ch;
    } else if (ch === '\n' && !inQuotes) {
      if (current.trim()) rows.push(current.replace(/\r$/, ''));
      current = '';
    } else {
      current += ch;
    }
  }
  if (current.trim()) rows.push(current.replace(/\r$/, ''));
  return rows;
}

function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result;
}

// --- Helpers ---
function parseEuro(str) {
  if (!str) return null;
  const cleaned = str.replace(/[€,]/g, '').trim();
  const num = parseFloat(cleaned);
  return isNaN(num) ? null : num;
}

function parsePercent(str) {
  if (!str) return 0;
  const cleaned = str.replace('%', '').trim();
  const num = parseFloat(cleaned);
  return isNaN(num) ? 0 : num;
}

function parseNum(str) {
  if (!str) return 0;
  const cleaned = str.replace(/,/g, '').trim();
  const num = parseFloat(cleaned);
  return isNaN(num) ? 0 : num;
}

// Normalize expedition names: "52" → "E52", "53" → "E53"
function normalizeExpName(name) {
  if (!name) return name;
  name = name.trim();
  if (/^\d/.test(name)) return 'E' + name;
  return name;
}

// Normalize paquete names: "52_1" → "E52-1", "E50_1" → "E50-1"
// Special case: "_12" stays as "_12" (no expedition prefix)
function normalizePaqName(name) {
  if (!name) return name;
  name = name.trim();
  if (name.startsWith('_')) return name; // Keep as-is for underscore-prefixed
  if (/^\d/.test(name)) name = 'E' + name;
  return name.replace(/_/g, '-');
}

// --- Clear existing data ---
async function clearCollection(collName) {
  const snap = await getDocs(collection(db, collName));
  if (snap.empty) return;
  // Batch delete in groups of 500
  let batch = writeBatch(db);
  let count = 0;
  for (const d of snap.docs) {
    batch.delete(d.ref);
    count++;
    if (count % 450 === 0) {
      await batch.commit();
      batch = writeBatch(db);
    }
  }
  if (count % 450 !== 0) await batch.commit();
  console.log(`  Cleared ${count} docs from ${collName}`);
}

async function main() {
  console.log('=== Ma d\'Or Data Import ===\n');

  // 1. Clear existing data
  console.log('Clearing existing data...');
  for (const coll of ['paquetes', 'expediciones', 'categorias', 'clientes', 'estadosPaquete', 'usuarios']) {
    await clearCollection(coll);
  }

  // 2. Read CSVs
  const expCSV = parseCSV(readFileSync('import data/Expedición-Grid view.csv', 'utf-8'));
  const paqCSV = parseCSV(readFileSync('import data/Paquetes-export.csv', 'utf-8'));
  const linCSV = parseCSV(readFileSync('import data/Lineas-Grid view.csv', 'utf-8'));

  console.log(`\nRead: ${expCSV.length} expediciones, ${paqCSV.length} paquetes, ${linCSV.length} lineas`);

  // 3. Extract unique categorias from paquetes
  const catNames = [...new Set(paqCSV.map(p => p['Tipo genero']).filter(Boolean))];
  console.log(`\nCategorias: ${catNames.join(', ')}`);

  // Determine esFino
  const finoCategories = ['lingot o làmina amb llei menor a 995', 'Lingote fino'];
  const categoriaMap = {}; // name → firestoreId
  for (const name of catNames) {
    const ref = await addDoc(collection(db, 'categorias'), {
      nombre: name,
      esFino: finoCategories.includes(name),
    });
    categoriaMap[name] = ref.id;
  }
  console.log(`Created ${catNames.length} categorias`);

  // 4. Extract unique clientes from paquetes
  const clienteNames = [...new Set(paqCSV.map(p => p['Cliente']).filter(Boolean))];
  console.log(`\nClientes: ${clienteNames.join(', ')}`);

  // Client config from the original app
  const clienteConfig = {
    'Gaudia': { abreviacion: 'GAU', color: '#f59e0b', descuentoEstandar: 5, descuentoFino: 5, lineasNegativasNoCuentanPeso: true },
    "Gemma d'Or": { abreviacion: 'GEM', color: '#3b82f6', descuentoEstandar: 6.5, descuentoFino: 6, lineasNegativasNoCuentanPeso: true },
    "La Milla d'Or": { abreviacion: 'MIL', color: '#10b981', descuentoEstandar: 6.5, descuentoFino: 6.5, lineasNegativasNoCuentanPeso: true },
    'OrCash': { abreviacion: 'ORC', color: '#8b5cf6', descuentoEstandar: 5, descuentoFino: 5, lineasNegativasNoCuentanPeso: true },
    'Nova Joia': { abreviacion: 'NOV', color: '#ef4444', descuentoEstandar: 6.5, descuentoFino: 6.5, lineasNegativasNoCuentanPeso: true },
    'Alquimia': { abreviacion: 'ALQ', color: '#ec4899', descuentoEstandar: 6.5, descuentoFino: 6.5, lineasNegativasNoCuentanPeso: true },
    'Mador stock': { abreviacion: 'MAD', color: '#06b6d4', descuentoEstandar: 0, descuentoFino: 0, lineasNegativasNoCuentanPeso: true },
    'Contratos particulares': { abreviacion: 'PAR', color: '#84cc16', descuentoEstandar: 6.5, descuentoFino: 6.5, lineasNegativasNoCuentanPeso: true },
  };

  const clienteMap = {}; // name → firestoreId
  for (const name of clienteNames) {
    const config = clienteConfig[name] || {
      abreviacion: name.substring(0, 3).toUpperCase(),
      color: '#6b7280',
      descuentoEstandar: 6.5,
      descuentoFino: 6.5,
      lineasNegativasNoCuentanPeso: true,
    };
    const ref = await addDoc(collection(db, 'clientes'), {
      nombre: name,
      ...config,
      kilatajes: [],
    });
    clienteMap[name] = ref.id;
  }
  console.log(`Created ${clienteNames.length} clientes`);

  // 5. Create expediciones
  const precioOroMap = { 'E50': 110, 'E51': 112, 'E52': 120, 'E53': 138 };
  const expedicionMap = {}; // normalized name → firestoreId
  let expedicionActualId = null;

  for (const exp of expCSV) {
    const nombre = normalizeExpName(exp['Name']);
    const precioOro = precioOroMap[nombre] || null;
    const ref = await addDoc(collection(db, 'expediciones'), {
      nombre,
      precioOro,
    });
    expedicionMap[nombre] = ref.id;
    // E53 is the current expedition (has "checked" in envio actual)
    if (exp['envio actual'] === 'checked' || nombre === 'E53') {
      expedicionActualId = ref.id;
    }
  }
  console.log(`Created ${expCSV.length} expediciones`);

  // 6. Group lines by paquete
  const linesByPaquete = {};
  for (const lin of linCSV) {
    const paqName = lin['Paquete']?.trim();
    if (!paqName) continue; // orphan lines without paquete
    const normalized = normalizePaqName(paqName);
    if (!linesByPaquete[normalized]) linesByPaquete[normalized] = [];
    linesByPaquete[normalized].push({
      id: Date.now() + Math.random(),
      bruto: parseNum(lin['Peso Bruto _ CL']),
      ley: parseNum(lin['Ley_CL']),
    });
  }

  // 7. Create paquetes
  let paqCount = 0;
  let skipped = 0;
  for (const paq of paqCSV) {
    const rawName = paq['Paquete']?.trim();
    if (!rawName) { skipped++; continue; }

    const nombre = normalizePaqName(rawName);

    // Skip empty placeholder rows (bruto=0, no client)
    const cliente = paq['Cliente']?.trim();
    if (!cliente && parseNum(paq['bruto']) === 0) {
      console.log(`  Skipping empty paquete: ${nombre}`);
      skipped++;
      continue;
    }

    // Parse expedicion from paquete name (e.g., "E50-1" → "E50")
    const expMatch = nombre.match(/^(E\d+)-/);
    const expName = expMatch ? expMatch[1] : normalizeExpName(paq['Expedición']);
    const expedicionId = expedicionMap[expName] || null;

    // Parse numero from name
    const numMatch = nombre.match(/-(\d+)$/);
    const numero = numMatch ? parseInt(numMatch[1]) : 0;

    const clienteId = clienteMap[cliente] || null;
    const categoriaId = categoriaMap[paq['Tipo genero']?.trim()] || null;
    const descuento = parsePercent(paq['Dto.']);
    const igi = parsePercent(paq['Igi']);
    const precioFino = parseEuro(paq['Fixing']);
    const cierreJofisa = parseEuro(paq['P.V. Jof Cierre']) || parseEuro(paq['P.V. Jof OK']);
    const lineas = linesByPaquete[nombre] || [];

    await addDoc(collection(db, 'paquetes'), {
      expedicionId,
      numero,
      nombre,
      clienteId,
      categoriaId,
      descuento,
      igi,
      precioFino,
      cierreJofisa,
      lineas,
      logs: [],
      comentarios: [],
    });
    paqCount++;
  }
  console.log(`\nCreated ${paqCount} paquetes (skipped ${skipped})`);

  // 8. Create usuarios
  const usuarios = [
    { id: 'maria', nombre: 'María' },
    { id: 'pedro', nombre: 'Pedro' },
    { id: 'ana', nombre: 'Ana' },
    { id: 'carlos', nombre: 'Carlos' },
  ];
  for (const usr of usuarios) {
    await setDoc(doc(db, 'usuarios', usr.id), { nombre: usr.nombre });
  }
  console.log(`Created ${usuarios.length} usuarios`);

  // 9. Create estados
  const estados = [
    { id: 'por_recoger', nombre: 'Por recoger', icon: '📍', color: '#ef4444' },
    { id: 'en_banco', nombre: 'En el banco', icon: '🏦', color: '#3b82f6' },
    { id: 'en_casa', nombre: 'En casa', icon: '🏠', color: '#10b981' },
  ];
  for (const est of estados) {
    await setDoc(doc(db, 'estadosPaquete', est.id), { nombre: est.nombre, icon: est.icon, color: est.color });
  }
  console.log(`Created ${estados.length} estados`);

  // 10. Set config
  await setDoc(doc(db, 'config', 'settings'), {
    expedicionActualId: expedicionActualId,
  });
  console.log(`\nSet expedición actual: E53`);

  // 11. Summary
  console.log('\n=== Import Complete ===');
  console.log(`Expediciones: ${Object.keys(expedicionMap).length}`);
  console.log(`Categorias: ${catNames.length}`);
  console.log(`Clientes: ${clienteNames.length}`);
  console.log(`Paquetes: ${paqCount}`);

  // Cross-check: count lines per paquete
  let totalLineas = 0;
  for (const key of Object.keys(linesByPaquete)) {
    totalLineas += linesByPaquete[key].length;
  }
  console.log(`Lineas mapped: ${totalLineas} (from ${linCSV.length} CSV rows, ${linCSV.length - totalLineas} orphans skipped)`);

  process.exit(0);
}

main().catch(err => {
  console.error('Import failed:', err);
  process.exit(1);
});
