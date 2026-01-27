import { readFileSync } from 'fs';
import { initializeApp } from 'firebase/app';
import {
  getFirestore, collection, doc, addDoc, setDoc, getDocs, deleteDoc
} from 'firebase/firestore';

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

// --- CSV parser ---
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

// Parse number with Spanish comma decimals: "126,83" → 126.83
function parseNumES(str) {
  if (!str || str.trim() === '') return null;
  const cleaned = str.trim().replace(/\./g, '').replace(',', '.');
  const num = parseFloat(cleaned);
  return isNaN(num) ? null : num;
}

// Parse date: "23/feb/23" → "2023-02-23", "12/dic/24" → "2024-12-12", etc.
const monthMap = {
  'ene': '01', 'feb': '02', 'mar': '03', 'abr': '04', 'apr': '04',
  'may': '05', 'jun': '06', 'jul': '07', 'ago': '08',
  'sep': '09', 'oct': '10', 'nov': '11', 'dic': '12',
};

function parseDate(str) {
  if (!str || str.trim() === '') return null;
  str = str.trim();

  // Format: "3/03/2023" or "19/01/2026" (dd/mm/yyyy)
  const isoMatch = str.match(/^(\d{1,2})\/(\d{2})\/(\d{4})$/);
  if (isoMatch) {
    const [, d, m, y] = isoMatch;
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }

  // Format: "23/feb/23" or "12/dic/24" or "02/abr/2025" or "11/JUN/25"
  const match = str.match(/^(\d{1,2})\/([a-zA-Z]+)\/(\d{2,4})$/);
  if (match) {
    const [, d, mStr, yStr] = match;
    const m = monthMap[mStr.toLowerCase()];
    if (!m) return null;
    const y = yStr.length === 2 ? (parseInt(yStr) >= 50 ? '19' + yStr : '20' + yStr) : yStr;
    return `${y}-${m}-${d.padStart(2, '0')}`;
  }

  return null;
}

// --- Client name mapping CSV → Firestore ---
const clienteNameMap = {
  'NJ': 'Nova Joia',
  'Milla': "La Milla d'Or",
  'Orcash': 'OrCash',
  'Gemma': "Gemma d'Or",
  'Raco/Gaudia': 'Gaudia',
  'Suissa': 'Suissa',
};

// Export batch grExport from image 3
const exportGramos = {
  '22-4': 1000,
  '26-9': 3000,
  '7-5': 2500,
  '16-9': 3058.5,
  '5-11': 4155,
  '19-3': null,  // not shown in image, will calculate
  '11-12': null, // not shown in image, will calculate
  'stock': null,
  'FUTURA': null,
};

async function main() {
  console.log('=== Importación Lingotes ===\n');

  // 1. Read CSV
  const csvText = readFileSync('import data/LINGOTES MAd\'OR - log.csv', 'utf-8');
  const lines = csvText.split('\n').map(l => l.replace(/\r$/, ''));

  // Header is line 3 (index 2)
  // Data starts at line 4 (index 3)
  // Columns: 0=cliente, 1=ENTREGA(fecha), 2=peso, 3=precio, 4=importe, 5=Nºfra,
  //          6=fecha cierre, 7=Peso cerrado, 8=Peso Devuelto, 9=Exportación,
  //          10=entrega terminada?, 11=pagado, 12=DEVOLUCIÓN, 13=FILTER

  console.log('Parsing CSV...');
  const dataRows = [];
  for (let i = 3; i < lines.length; i++) {
    const cols = parseCSVLine(lines[i]);
    const clienteCSV = (cols[0] || '').trim();
    const fechaStr = (cols[1] || '').trim();
    const peso = parseNumES(cols[2]);

    // Skip empty rows (no client, no date, or no peso)
    if (!clienteCSV || !fechaStr || peso === null || peso === 0) continue;

    // Skip special text rows (like "El client respon de la custòdia...")
    if (fechaStr.length > 20) continue;

    const precio = parseNumES(cols[3]);
    const isFutura = fechaStr === 'FUTURA';

    const importe = parseNumES(cols[4]);
    const nFactura = (cols[5] || '').trim() || null;
    const fechaCierre = parseDate((cols[6] || '').trim());
    const pesoCerrado = parseNumES(cols[7]) || 0;
    const pesoDevuelto = parseNumES(cols[8]) || 0;
    const exportacion = (cols[9] || '').trim() || null;
    const estado = (cols[10] || '').trim().toLowerCase();
    const pagado = (cols[11] || '').trim().toUpperCase() === 'TRUE';
    const esDevolucion = (cols[12] || '').trim().toUpperCase() === 'TRUE';

    // Determine if this is a pure devolution row (no precio, has pesoDevuelto)
    const isPureDevolucion = esDevolucion && precio === null;

    dataRows.push({
      clienteCSV,
      fechaEntrega: fechaStr === 'stock' ? 'stock' : isFutura ? 'FUTURA' : parseDate(fechaStr),
      fechaEntregaRaw: fechaStr,
      isFutura,
      peso,
      precio,
      importe,
      nFactura,
      fechaCierre,
      pesoCerrado,
      pesoDevuelto,
      exportacion,
      estado: estado.includes('finalizado') ? 'finalizado' : 'en_curso',
      pagado,
      esDevolucion: isPureDevolucion,
    });
  }

  console.log(`Parsed ${dataRows.length} lingote rows`);

  // 2. Get existing clients from Firestore
  console.log('\nFetching clients from Firestore...');
  const clientesSnap = await getDocs(collection(db, 'clientes'));
  const clientesFB = {};
  clientesSnap.forEach(doc => {
    clientesFB[doc.data().nombre] = doc.id;
  });
  console.log(`Found ${Object.keys(clientesFB).length} clients:`, Object.keys(clientesFB).join(', '));

  // Map CSV client names to Firestore IDs
  const clienteIdMap = {};
  for (const [csvName, fbName] of Object.entries(clienteNameMap)) {
    if (clientesFB[fbName]) {
      clienteIdMap[csvName] = clientesFB[fbName];
      console.log(`  ${csvName} → ${fbName} (${clientesFB[fbName]})`);
    } else {
      console.log(`  ${csvName} → ${fbName} NOT FOUND, creating...`);
      const ref = await addDoc(collection(db, 'clientes'), {
        nombre: fbName,
        abreviacion: fbName.substring(0, 3).toUpperCase(),
        color: '#6b7280',
        descuentoEstandar: 6.5,
        descuentoFino: 6.5,
        lineasNegativasNoCuentanPeso: true,
        kilatajes: [],
      });
      clienteIdMap[csvName] = ref.id;
      console.log(`  Created ${fbName} → ${ref.id}`);
    }
  }

  // 3. Clear existing lingotes data
  console.log('\nClearing existing lingotes data...');
  for (const collName of ['lingotes_exportaciones', 'lingotes_entregas', 'lingotes_futura']) {
    const snap = await getDocs(collection(db, collName));
    let count = 0;
    for (const d of snap.docs) {
      await deleteDoc(d.ref);
      count++;
    }
    console.log(`  Deleted ${count} docs from ${collName}`);
  }

  // 4. Create exportaciones
  console.log('\nCreating exportaciones...');
  const uniqueExports = [...new Set(dataRows.map(r => r.exportacion).filter(Boolean))];
  const exportIdMap = {};

  for (const nombre of uniqueExports) {
    const grExport = exportGramos[nombre] || null;
    // Get first fecha from rows with this exportacion
    const firstRow = dataRows.find(r => r.exportacion === nombre && r.fechaEntrega && r.fechaEntrega !== 'stock' && r.fechaEntrega !== 'FUTURA');
    const fecha = firstRow?.fechaEntrega || null;

    const ref = await addDoc(collection(db, 'lingotes_exportaciones'), {
      nombre,
      grExport: grExport || 0,
      fecha: fecha || '',
    });
    exportIdMap[nombre] = ref.id;
    console.log(`  ${nombre} → ${ref.id} (${grExport || '?'}g, fecha: ${fecha || '?'})`);
  }

  // Also handle rows without exportacion (old entries)
  exportIdMap[null] = null;
  exportIdMap[''] = null;

  // 5. Separate FUTURA rows from regular rows
  const futuraRows = dataRows.filter(r => r.isFutura);
  const regularRows = dataRows.filter(r => !r.isFutura);
  console.log(`\nFUTURA rows: ${futuraRows.length}, Regular rows: ${regularRows.length}`);

  // 5a. Group regular rows into entregas: (clienteCSV + fechaEntregaRaw) = 1 entrega
  console.log('\nGrouping regular rows into entregas...');
  const entregaGroups = {};
  for (const row of regularRows) {
    const key = `${row.clienteCSV}|||${row.fechaEntregaRaw}`;
    if (!entregaGroups[key]) {
      entregaGroups[key] = {
        clienteCSV: row.clienteCSV,
        fechaEntrega: row.fechaEntrega,
        fechaEntregaRaw: row.fechaEntregaRaw,
        exportacion: row.exportacion,
        lingotes: [],
      };
    }
    entregaGroups[key].lingotes.push({
      peso: row.peso,
      precio: row.precio,
      importe: row.importe || 0,
      nFactura: row.nFactura,
      fechaCierre: row.fechaCierre,
      pesoCerrado: row.pesoCerrado,
      pesoDevuelto: row.pesoDevuelto,
      estado: row.estado,
      pagado: row.pagado,
      esDevolucion: row.esDevolucion,
    });
  }

  const entregas = Object.values(entregaGroups);
  console.log(`Grouped into ${entregas.length} entregas`);

  // 6. Upload entregas to Firestore
  console.log('\nUploading entregas...');
  let totalLingotes = 0;
  let entregaCount = 0;

  for (const entrega of entregas) {
    const clienteId = clienteIdMap[entrega.clienteCSV];
    if (!clienteId) {
      console.log(`  SKIP: client "${entrega.clienteCSV}" not mapped`);
      continue;
    }

    const exportacionId = entrega.exportacion ? (exportIdMap[entrega.exportacion] || null) : null;

    await addDoc(collection(db, 'lingotes_entregas'), {
      clienteId,
      exportacionId,
      fechaEntrega: entrega.fechaEntrega || '',
      lingotes: entrega.lingotes,
    });

    totalLingotes += entrega.lingotes.length;
    entregaCount++;
  }

  console.log(`Uploaded ${entregaCount} entregas with ${totalLingotes} lingotes total`);

  // 6b. Upload FUTURA rows as standalone docs in lingotes_futura
  console.log('\nUploading FUTURA lingotes...');
  let futuraCount = 0;
  for (const row of futuraRows) {
    const clienteId = clienteIdMap[row.clienteCSV];
    if (!clienteId) {
      console.log(`  SKIP FUTURA: client "${row.clienteCSV}" not mapped`);
      continue;
    }

    await addDoc(collection(db, 'lingotes_futura'), {
      clienteId,
      peso: row.peso,
      precio: row.precio || null,
      importe: row.importe || 0,
      nFactura: row.nFactura || null,
      fechaCierre: row.fechaCierre || null,
      pagado: row.pagado || false,
    });
    futuraCount++;
  }
  console.log(`Uploaded ${futuraCount} FUTURA standalone lingotes`);

  // 7. Upload config
  console.log('\nUploading config...');
  await setDoc(doc(db, 'lingotes_config', 'settings'), {
    stockMador: 0,
    umbralRojo: 200,
    umbralNaranja: 500,
    umbralAmarillo: 1000,
  });
  console.log('Config saved');

  // 8. Summary
  console.log('\n=== Summary ===');
  console.log(`Exportaciones: ${uniqueExports.length}`);
  console.log(`Entregas: ${entregaCount}`);
  console.log(`Lingotes (in entregas): ${totalLingotes}`);
  console.log(`FUTURA (standalone): ${futuraCount}`);

  // Count per client
  const perClient = {};
  for (const entrega of entregas) {
    const name = entrega.clienteCSV;
    if (!perClient[name]) perClient[name] = { entregas: 0, lingotes: 0 };
    perClient[name].entregas++;
    perClient[name].lingotes += entrega.lingotes.length;
  }
  console.log('\nPer client:');
  for (const [name, stats] of Object.entries(perClient)) {
    console.log(`  ${name}: ${stats.entregas} entregas, ${stats.lingotes} lingotes`);
  }

  console.log('\nDone!');
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
