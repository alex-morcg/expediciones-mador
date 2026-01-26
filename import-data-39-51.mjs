import { readFileSync } from 'fs';
import { initializeApp } from 'firebase/app';
import {
  getFirestore, collection, doc, addDoc, getDocs, query, where
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

function normalizeExpName(name) {
  if (!name) return name;
  name = name.trim();
  if (/^\d/.test(name)) return 'E' + name;
  return name;
}

function normalizePaqName(name) {
  if (!name) return name;
  name = name.trim();
  if (name.startsWith('_')) return name;
  if (/^\d/.test(name)) name = 'E' + name;
  return name.replace(/_/g, '-');
}

// --- Category mapping ---
// Maps CSV category names to existing Firestore category names
const CATEGORY_MAPPING = {
  'Chatarra': 'Chatarra',
  'Lingote Chatarra': 'Lingote Chatarra 18K',
  'Lingote fino': 'Lingote fino',
  'plancha oro fino 999.9': 'Lingote fino',
  'Or inversion lingot o lámina de mes de 995': 'lingot o làmina amb llei menor a 995',
  'Lingote Chatarra 18K': 'Lingote Chatarra 18K',
  'Lingote Chatarra 22K': 'Lingote Chatarra 22K',
  'Milla Chatarra': 'Milla Chatarra',
  'Njoia Chatarra': 'Chatarra',
};

// For multi-category fields, use Lingote Chatarra 18K
function mapCategory(rawCategory) {
  if (!rawCategory) return null;
  // Multi-category: comma separated → use Lingote Chatarra 18K
  if (rawCategory.includes(',')) {
    return 'Lingote Chatarra 18K';
  }
  return CATEGORY_MAPPING[rawCategory] || null;
}

// --- Client mapping ---
// Racó d'Or → Gaudia
function mapClientName(name) {
  if (!name) return null;
  if (name === "Racó d'Or") return 'Gaudia';
  return name;
}

// --- Expediciones to SKIP (already in DB) ---
const SKIP_EXPEDICIONES = new Set(['E50', 'E51']);

// --- Precio Oro map from CSV data ---
const PRECIO_ORO_MAP = {
  'E39': null, // Not specified in CSV
  'E40': 70,
  'E41': 71,
  'E42': 80,
  'E43': 80,
  'E44': null, // Not specified in CSV
  'E45': 88,
  'E46': 93,
  'E47': 92,
  'E48': 92,
  'E49': 104,
};

async function main() {
  console.log('=== Ma d\'Or Data Import E39-E51 (append, skip E50/E51) ===\n');

  // 1. Read existing Firestore data to get IDs
  console.log('Reading existing Firestore data...');

  // Get existing categories
  const catSnap = await getDocs(collection(db, 'categorias'));
  const categoriaMap = {}; // nombre → firestoreId
  catSnap.forEach(d => {
    categoriaMap[d.data().nombre] = d.id;
  });
  console.log(`  Existing categorias: ${Object.keys(categoriaMap).join(', ')}`);

  // Get existing clients
  const cliSnap = await getDocs(collection(db, 'clientes'));
  const clienteMap = {}; // nombre → firestoreId
  cliSnap.forEach(d => {
    clienteMap[d.data().nombre] = d.id;
  });
  console.log(`  Existing clientes: ${Object.keys(clienteMap).join(', ')}`);

  // Get existing expediciones
  const expSnap = await getDocs(collection(db, 'expediciones'));
  const existingExpNames = new Set();
  expSnap.forEach(d => {
    existingExpNames.add(d.data().nombre);
  });
  console.log(`  Existing expediciones: ${[...existingExpNames].join(', ')}`);

  // 2. Read CSVs
  const expCSV = parseCSV(readFileSync('import data/Expedición-Grid view39-51.csv', 'utf-8'));
  const paqCSV = parseCSV(readFileSync('import data/Paquetes-export39-51.csv', 'utf-8'));
  const linCSV = parseCSV(readFileSync('import data/Lineas-Grid view39-51.csv', 'utf-8'));

  console.log(`\nRead: ${expCSV.length} expediciones, ${paqCSV.length} paquetes, ${linCSV.length} lineas from CSV`);

  // 3. Create new expediciones (skip E50, E51, empty rows, and already existing)
  const expedicionMap = {}; // nombre → firestoreId (includes existing + new)

  // First add existing expediciones to map
  expSnap.forEach(d => {
    expedicionMap[d.data().nombre] = d.id;
  });

  let expCreated = 0;
  let expSkipped = 0;
  for (const exp of expCSV) {
    const nombre = normalizeExpName(exp['Name']);
    if (!nombre) { expSkipped++; continue; }
    if (SKIP_EXPEDICIONES.has(nombre)) {
      console.log(`  Skipping expedition ${nombre} (overlap)`);
      expSkipped++;
      continue;
    }
    if (existingExpNames.has(nombre)) {
      console.log(`  Skipping expedition ${nombre} (already exists)`);
      expSkipped++;
      continue;
    }

    const precioOro = PRECIO_ORO_MAP[nombre] || null;
    const ref = await addDoc(collection(db, 'expediciones'), {
      nombre,
      precioOro,
    });
    expedicionMap[nombre] = ref.id;
    expCreated++;
    console.log(`  Created expedition ${nombre} (precioOro: ${precioOro})`);
  }
  console.log(`\nExpediciones: ${expCreated} created, ${expSkipped} skipped`);

  // 4. Group lines by paquete
  const linesByPaquete = {};
  let linesSkipped = 0;
  for (const lin of linCSV) {
    const paqName = lin['Paquete']?.trim();
    if (!paqName) continue;
    const normalized = normalizePaqName(paqName);

    // Skip lines from E50/E51
    const expMatch = normalized.match(/^(E\d+)-/);
    if (expMatch && SKIP_EXPEDICIONES.has(expMatch[1])) {
      linesSkipped++;
      continue;
    }

    if (!linesByPaquete[normalized]) linesByPaquete[normalized] = [];
    linesByPaquete[normalized].push({
      id: Date.now() + Math.random(),
      bruto: parseNum(lin['Peso Bruto _ CL']),
      ley: parseNum(lin['Ley_CL']),
    });
  }

  let totalLineas = 0;
  for (const key of Object.keys(linesByPaquete)) {
    totalLineas += linesByPaquete[key].length;
  }
  console.log(`\nLineas: ${totalLineas} mapped, ${linesSkipped} skipped (E50/E51)`);

  // 5. Create paquetes
  let paqCount = 0;
  let paqSkipped = 0;
  let unmappedCategories = new Set();
  let unmappedClients = new Set();

  for (const paq of paqCSV) {
    const rawName = paq['Paquete']?.trim();
    if (!rawName) { paqSkipped++; continue; }

    const nombre = normalizePaqName(rawName);

    // Skip E50/E51 paquetes
    const expMatch = nombre.match(/^(E\d+)-/);
    const expName = expMatch ? expMatch[1] : normalizeExpName(paq['Expedición']);
    if (SKIP_EXPEDICIONES.has(expName)) {
      paqSkipped++;
      continue;
    }

    // Skip empty placeholder rows (no client, bruto=0)
    const rawCliente = paq['Cliente']?.trim();
    if (!rawCliente && parseNum(paq['bruto']) === 0) {
      console.log(`  Skipping empty paquete: ${nombre}`);
      paqSkipped++;
      continue;
    }

    const expedicionId = expedicionMap[expName] || null;
    if (!expedicionId) {
      console.log(`  WARNING: No expedition found for paquete ${nombre} (exp: ${expName})`);
    }

    // Parse numero from name
    const numMatch = nombre.match(/-(\d+(?:\.\d+)?)$/);
    const numero = numMatch ? parseFloat(numMatch[1]) : 0;

    // Map client (Racó d'Or → Gaudia)
    const clienteName = mapClientName(rawCliente);
    const clienteId = clienteName ? (clienteMap[clienteName] || null) : null;
    if (clienteName && !clienteId) {
      unmappedClients.add(clienteName);
    }

    // Map category
    const rawCategoria = paq['Tipo genero']?.trim();
    const mappedCatName = mapCategory(rawCategoria);
    const categoriaId = mappedCatName ? (categoriaMap[mappedCatName] || null) : null;
    if (rawCategoria && !categoriaId) {
      unmappedCategories.add(rawCategoria);
    }

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

  console.log(`\nPaquetes: ${paqCount} created, ${paqSkipped} skipped`);

  if (unmappedCategories.size > 0) {
    console.log(`\n⚠️  Unmapped categories: ${[...unmappedCategories].join(', ')}`);
  }
  if (unmappedClients.size > 0) {
    console.log(`\n⚠️  Unmapped clients: ${[...unmappedClients].join(', ')}`);
  }

  // 6. Summary
  console.log('\n=== Import Complete ===');
  console.log(`Expediciones created: ${expCreated}`);
  console.log(`Paquetes created: ${paqCount}`);
  console.log(`Lineas mapped: ${totalLineas}`);

  process.exit(0);
}

main().catch(err => {
  console.error('Import failed:', err);
  process.exit(1);
});
