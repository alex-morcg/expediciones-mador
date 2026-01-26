import { readFileSync } from 'fs';
import { initializeApp } from 'firebase/app';
import {
  getFirestore, collection, addDoc, getDocs
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

// --- CSV parser ---
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
    if (ch === '"') { inQuotes = !inQuotes; current += ch; }
    else if (ch === '\n' && !inQuotes) { if (current.trim()) rows.push(current.replace(/\r$/, '')); current = ''; }
    else { current += ch; }
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
    if (ch === '"') { inQuotes = !inQuotes; }
    else if (ch === ',' && !inQuotes) { result.push(current); current = ''; }
    else { current += ch; }
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

// Normalize expedition name: "E35\n" → "E35", "52" → "E52"
function normalizeExpName(name) {
  if (!name) return name;
  name = name.replace(/[\r\n"]/g, '').trim();
  if (/^\d/.test(name)) return 'E' + name;
  return name;
}

// Normalize paquete name: "E35\n_1" → "E35-1", "E30_4" → "E30-4"
function normalizePaqName(name) {
  if (!name) return name;
  name = name.replace(/[\r\n"]/g, '').trim();
  if (name.startsWith('_')) return name;
  if (/^\d/.test(name)) name = 'E' + name;
  return name.replace(/_/g, '-');
}

// --- Expediciones to SKIP ---
const SKIP_EXPEDICIONES = new Set(['E39', 'E40', 'STOCK']);

// --- Precio Oro from CSV ---
const PRECIO_ORO_MAP = {
  'E30': 54,
  'E31': 55,
  'E32': 58,
  'E33': 57,
  'E34': 57,
  'E35': 57,
  'E36': 59,
  'E37': 59,
  'E38': 65.56,
};

async function main() {
  console.log('=== Ma d\'Or Data Import E30-E38 (append, skip E39/E40/STOCK) ===\n');

  // 1. Read existing Firestore data
  console.log('Reading existing Firestore data...');

  const cliSnap = await getDocs(collection(db, 'clientes'));
  const clienteMap = {};
  cliSnap.forEach(d => { clienteMap[d.data().nombre] = d.id; });
  console.log(`  Existing clientes: ${Object.keys(clienteMap).join(', ')}`);

  const expSnap = await getDocs(collection(db, 'expediciones'));
  const existingExpNames = new Set();
  const expedicionMap = {};
  expSnap.forEach(d => {
    existingExpNames.add(d.data().nombre);
    expedicionMap[d.data().nombre] = d.id;
  });
  console.log(`  Existing expediciones: ${[...existingExpNames].join(', ')}`);

  // 2. Read CSVs
  const expCSV = parseCSV(readFileSync('import data/Expedición-Grid view30-40.csv', 'utf-8'));
  const paqCSV = parseCSV(readFileSync('import data/Paquetes-export30-40.csv', 'utf-8'));
  const linCSV = parseCSV(readFileSync('import data/Lineas-Grid view30-40.csv', 'utf-8'));

  console.log(`\nRead: ${expCSV.length} expediciones, ${paqCSV.length} paquetes, ${linCSV.length} lineas from CSV`);

  // 3. Create new expediciones
  let expCreated = 0;
  let expSkipped = 0;
  for (const exp of expCSV) {
    const nombre = normalizeExpName(exp['Name']);
    if (!nombre) { expSkipped++; continue; }
    if (SKIP_EXPEDICIONES.has(nombre)) {
      console.log(`  Skipping expedition ${nombre} (overlap/excluded)`);
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

    // Skip lines from excluded expediciones
    const expMatch = normalized.match(/^(E\d+)-/) || normalized.match(/^(STOCK)-/i);
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
  console.log(`\nLineas: ${totalLineas} mapped, ${linesSkipped} skipped`);

  // 5. Create paquetes
  let paqCount = 0;
  let paqSkipped = 0;

  for (const paq of paqCSV) {
    const rawName = paq['Paquete']?.trim();
    if (!rawName) { paqSkipped++; continue; }

    const nombre = normalizePaqName(rawName);

    // Determine expedition
    const expMatch = nombre.match(/^(E\d+)-/) || nombre.match(/^(STOCK)-/i);
    let expName = expMatch ? expMatch[1] : normalizeExpName(paq['Expedición']);
    // Normalize E35 corruption in Expedición column
    if (expName) expName = normalizeExpName(expName);

    // Skip excluded expediciones
    if (SKIP_EXPEDICIONES.has(expName)) {
      paqSkipped++;
      continue;
    }

    // Skip empty placeholder rows
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
    const numMatch = nombre.match(/-(\d+(?:\.\d+)?[A-Z]?)$/i);
    const numStr = numMatch ? numMatch[1] : '0';
    const numero = parseFloat(numStr) || 0;

    const clienteId = rawCliente ? (clienteMap[rawCliente] || null) : null;
    if (rawCliente && !clienteId) {
      console.log(`  WARNING: Unmapped client: ${rawCliente}`);
    }

    const descuento = parsePercent(paq['Dto.']);
    const igi = parsePercent(paq['Igi']);
    const precioFino = parseEuro(paq['Fixing']);
    const cierreJofisa = parseEuro(paq['P.V. Jof OK']);
    const lineas = linesByPaquete[nombre] || [];

    await addDoc(collection(db, 'paquetes'), {
      expedicionId,
      numero,
      nombre,
      clienteId,
      categoriaId: null,
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
