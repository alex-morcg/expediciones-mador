# MA D'OR TRACKER - Context for Claude (v1.0 — 27 Jan 2026)

## EXECUTIVE SUMMARY

**Ma d'Or** is a gold expedition management app for a gold buying/refining business. It has two modules:
1. **Expediciones** (main): Tracks packages of gold from jewelry stores (clientes) through to the refiner (Jofisa), with pricing, margins, invoicing
2. **Lingotes** (gold bars): Tracks physical gold bar inventory — deliveries to clients, closures, payments, and forward sales (FUTURA)

**Stack**: Vite 6 + React 18 + Tailwind CSS v4 + Firebase Firestore + Recharts
**Hosting**: Vercel (auto-deploy from GitHub push to main)
**Repo**: `alex-morcg/expediciones-mador` (private)
**URL**: `https://expediciones-mador-b3fp.vercel.app/?user=maria`
**Numeric format**: European (1.234,56)
**Language**: Spanish UI, code in English/Spanish mix

---

## PROJECT STRUCTURE

```
Expediciones Ma d'Or/
  index.html                    # Entry HTML, emoji favicon, no-zoom viewport
  package.json                  # Vite 6, React 18, Tailwind 4, Firebase 11, Recharts
  vite.config.js                # React + Tailwind v4 plugins
  vercel.json                   # SPA rewrite (all routes → /index.html)
  .env                          # VITE_FIREBASE_* vars (6 vars)
  .gitignore                    # node_modules, dist, .env, .env.local
  api/
    verify.js                   # Vercel serverless: AI invoice verification via Claude API
  src/
    main.jsx                    # React root (StrictMode)
    App.jsx                     # Wrapper → <MadorTracker />
    index.css                   # @import "tailwindcss" (v4 syntax)
    firebase.js                 # Firebase init from VITE_FIREBASE_* env vars
    mador-tracker.jsx           # Main app component (~3100 lines)
    hooks/
      useFirestore.js           # Data layer: real-time listeners + CRUD (~845 lines)
    components/
      LingotesTracker.jsx       # Gold bars sub-component (~1320 lines)
  import-data.mjs               # One-time CSV → Firestore import (paquetes)
  import-lingotes.mjs           # One-time CSV → Firestore import (lingotes)
  import-resultados.mjs         # Import fino sobra results
  create-estado-jofisa.mjs      # Create en_jofisa status
  update-seguro.mjs             # Add seguro field to expediciones
  import data/
    MADOR_CONTEXT.md            # Older context file (outdated — use THIS file instead)
    *.csv                       # Original CSV data files
```

---

## FIREBASE / FIRESTORE SCHEMA

### Collections (11 total, all with real-time onSnapshot listeners)

**Expediciones module:**
```
categorias/           → {nombre: string, esFino: boolean}
clientes/             → {nombre, abreviacion (3-4 chars), color (hex), descuentoEstandar, descuentoFino, lineasNegativasNoCuentanPeso: boolean, kilatajes: [{nombre, ley}]}
expediciones/         → {nombre ("E53"), precioOro, precioPorDefecto, fechaExportacion, seguro, resultados: {clientes: {[clienteId]: {finoSobra}}}}
paquetes/             → {expedicionId, numero, nombre ("E53-1"), clienteId, categoriaId, descuento, igi, precioFino, cierreJofisa, estado (estadoId), lineas: [{id, bruto, ley}], factura: {nombre, tipo, data}, verificacionIA, comentarios: [{id, fecha, usuario, texto}], logs: [{id, fecha, usuario, accion, detalles}], ultimaModificacion}
estadosPaquete/       → {nombre, icon, color}
usuarios/             → {nombre}  (fixed IDs: maria, pedro, ana, carlos)
config/settings       → {expedicionActualId}
```

**Lingotes module:**
```
lingotes_exportaciones/ → {nombre, grExport, fecha}
lingotes_entregas/      → {clienteId, exportacionId, fechaEntrega, lingotes: [{peso, precio, importe, nFactura, fechaCierre, pesoCerrado, pesoDevuelto, estado, pagado, esDevolucion, euroOnza, base, precioJofisa, importeJofisa, margen}]}
lingotes_config/settings → {stockMador, umbralRojo, umbralNaranja, umbralAmarillo}
lingotes_futura/        → {clienteId, peso, precio, importe, nFactura, fechaCierre, pagado, euroOnza, base, precioJofisa, importeJofisa, margen}
```

### Key schema notes:
- Firestore rules: `allow read, write: if true` (open, no auth)
- No auth system — user selected from URL param `?user=maria`
- Arrays (lineas, logs, comentarios, lingotes) are nested inside parent docs
- Lingote states: `en_curso` → `pendiente_pago` → `finalizado`
- FUTURA = standalone docs in `lingotes_futura` (orphan sales, not in any entrega)

---

## DATA LAYER: useFirestore.js (845 lines)

Single custom React hook managing ALL app state via Firestore real-time listeners.

### Architecture
- 11 `onSnapshot` listeners (one per collection/doc)
- Loading state: counts 11 responses, `setLoading(false)` when all done
- Seed on first run: if `categorias` is empty, auto-seeds all collections
- `useRef(seedTriggered)` prevents double-seed in React Strict Mode

### State returned
```js
categorias, clientes, expediciones, paquetes, estadosPaquete, usuarios,
expedicionActualId, loading,
lingotesExportaciones, lingotesEntregas, lingotesConfig, lingotesFutura
```

### CRUD functions returned
```js
// Expediciones module
saveCategoria, deleteCategoria
saveCliente, deleteCliente, updateClienteKilatajes
saveExpedicion, deleteExpedicion  // deleteExpedicion cascades: deletes all paquetes
setExpedicionActualId
savePaquete, deletePaquete  // savePaquete auto-generates name, logs changes
addLineaToPaquete, removeLineaFromPaquete
updatePaqueteCierre, updatePaqueteFactura, updatePaqueteVerificacion, validarVerificacion
updatePaqueteEstado, marcarTodosComoEstado
addComentarioToPaquete, deleteComentarioFromPaquete
agregarUsuario, eliminarUsuario, guardarEdicionUsuario
agregarEstado, eliminarEstado, guardarEdicionEstado
updateExpedicionResultados

// Lingotes module
saveLingoteExportacion, deleteLingoteExportacion
saveLingoteEntrega, deleteLingoteEntrega, updateLingoteEntrega
updateLingotesConfig
saveLingoteFutura, deleteLingoteFutura, updateLingoteFutura
```

### Audit logging
Every paquete modification creates a log entry with: `{id, fecha, usuario, accion, detalles}`
Actions: `crear_paquete`, `editar_datos`, `añadir_linea`, `eliminar_linea`, `actualizar_cierre`, `cambiar_estado`, `subir_factura`, `verificar_ia`, `validar_verificacion`, `añadir_comentario`, `eliminar_comentario`

---

## MAIN COMPONENT: mador-tracker.jsx (~3100 lines)

### Structure
- Imports: React, Recharts, useFirestore, LingotesTracker
- Formatting helpers: `formatNum`, `formatEur`, `formatEurInt`, `formatGr`
- Expedition helpers: `getExpNum`, `sortExpDescending`, `tiempoRelativo`
- Main component: `MadorTracker()` at line ~49
- Internal UI components: Card, Button, Input, Select, Checkbox, TabButton
- Modal components: ModalForm, TextModal, CategoriasResumenModal, ResultadosModal
- Tab views: Expediciones, Clientes, Parametros, Stats, Lingotes

### UI state
```js
showLingotes               // Toggle lingotes module
activeTab                  // 'expediciones' | 'clientes' | 'parametros' | 'stats'
selectedExpedicion         // drill into expedition
selectedPaquete            // drill into package
usuarioActivo              // from URL ?user=X
modalOpen, modalType       // 'categoria' | 'cliente' | 'expedicion' | 'paquete'
editingItem                // item being edited in modal
ordenVista                 // 'normal' | 'cliente' | 'estado' | 'categoria'
showTextModal, showLogsModal, marcarTodosModal
newLinea, cierreData, newComentario  // form state
statsExpDesde, statsExpHasta, statsClienteId  // stats filters
```

### Key calculation functions

**`calcularFinoLinea(bruto, ley)`**
```js
fino = bruto * (ley / 1000)
// TRUNCATED to 2 decimals (NOT rounded): Math.trunc(fino * 100) / 100
```

**`calcularTotalesPaquete(paquete, precioPorDefecto)`**
```
finoTotal = sum(fino per linea)          // Negative lines excluded from weight if client flag set
finoTotalCalculo = sum(ALL fino)         // Always all lines for euro calculations
precioEfectivo = paquete.precioFino || precioPorDefecto || null
base = finoTotalCalculo * precioEfectivo
descuentoImporte = base * (descuento / 100)
baseCliente = base - descuentoImporte
igi = baseCliente * (igi% / 100)
totalFra = baseCliente + igi             // What client pays
cierreJofisa = precioEfectivo - 0.25     // Always 0.25 less
fraJofisa = cierreJofisa * finoTotalCalculo
margen = fraJofisa - baseCliente
```

**`calcularTotalesExpedicion(expedicionId)`**
Aggregates all packages: sumaBruto, sumaFino, totalFra, totalFraJofisa, totalMargen, porCategoria, porCliente

### Business rules
1. **Cierre Jofisa**: Always `precioFino - 0.25`. Red warning if differs.
2. **Negative lines**: Don't count for weight display but DO count for euro calculations. Shown in red.
3. **Fino category**: IGI=0%, uses `descuentoFino`. Shows "FINO" badge.
4. **Precio por defecto**: If paquete has no precioFino, uses expedition's precioPorDefecto. Values shown with `~` prefix in grey italic.
5. **Auto-status**: When export date passes, marks packages as "en_jofisa"
6. **Logs**: Every paquete change is logged (infinite growth, no cleanup)

### Tab navigation
```
Expediciones → Lista → Detalle Expedicion → Detalle Paquete
  Views: Normal | Por Cliente | Por Estado | Por Categoria
Clientes → CRUD + kilatajes
Parametros → Usuarios + Estados + Categorias
Stats → Recharts bar charts (volume, margins)
Lingotes → LingotesTracker component (separate module)
```

### Color system
Uses `cliente.color` (hex) throughout. Background: `color + '10'`, borders, headers, inputs, badges all styled from client color.

---

## LINGOTES TRACKER: LingotesTracker.jsx (~1320 lines)

### Props received
```js
clientes, exportaciones, entregas, futuraLingotes, config,
onBack, onSaveExportacion, onDeleteExportacion,
onSaveEntrega, onDeleteEntrega, onUpdateEntrega, onUpdateConfig,
onSaveFutura, onDeleteFutura, onUpdateFutura
```

### How mador-tracker.jsx passes lingotes props
```js
// In mador-tracker.jsx, the LingotesTracker is rendered with:
<LingotesTracker
  clientes={clientes}
  exportaciones={lingotesExportaciones}
  entregas={lingotesEntregas}
  futuraLingotes={lingotesFutura}
  config={lingotesConfig}
  onBack={() => setShowLingotes(false)}
  onSaveExportacion={saveLingoteExportacion}
  onDeleteExportacion={deleteLingoteExportacion}
  onSaveEntrega={saveLingoteEntrega}
  onDeleteEntrega={deleteLingoteEntrega}
  onUpdateEntrega={updateLingoteEntrega}
  onUpdateConfig={updateLingotesConfig}
  onSaveFutura={saveLingoteFutura}
  onDeleteFutura={deleteLingoteFutura}
  onUpdateFutura={updateLingoteFutura}
/>
```

### Top-level helpers (lines 1-52)

```js
// Formatting
formatNum(num, decimals=2)     // European locale: 1.234,56
formatEur(num)                 // formatNum + ' €'
formatEntregaShort(fecha)      // "2025-01-19" → "25-1" (YY-M badge label)

// Entrega badge colors (20-color palette, deterministic hash on date label)
ENTREGA_COLORS = ['#e11d48', '#db2777', ...]  // 20 colors
getEntregaColor(fecha)         // hash-based consistent color per date

// Lingote status helpers
isCerrado(l)                   // l.estado === 'pendiente_pago' || l.estado === 'finalizado'
pesoEntrega(entrega)           // sum all lingotes peso
pesoCerrado(entrega)           // sum cerrado lingotes (peso - pesoDevuelto)
pesoDevuelto(entrega)          // sum pesoDevuelto
importeEntrega(entrega)        // sum cerrado lingotes importe
numLingotes(entrega)           // count
lingotesEnCurso(entrega)       // filter estado === 'en_curso'
lingotesPendientePago(entrega) // filter estado === 'pendiente_pago'
lingotesFinalizados(entrega)   // filter estado === 'finalizado'
lingotesCerrados(entrega)      // filter isCerrado()
isEntregaFinalizada(entrega)   // ALL lingotes are isCerrado()
isEntregaEnCurso(entrega)      // !isEntregaFinalizada
```

### Lingote lifecycle
```
en_curso → (cerrar) → pendiente_pago → (marcar pagado) → finalizado
                                      ← (unmark pagado) ←
```

### UI state
```js
activeTab                  // 'stock' | 'exportaciones' | 'parametros'
selectedCliente            // drill into client detail
showEntregaModal           // new entrega form
showCierreModal            // close lingote form
showFuturaModal            // new FUTURA form
showAssignFuturaModal      // assign FUTURA to entrega
selectedEntrega            // entrega being operated on
selectedLingoteIdx         // lingote index within entrega
selectedFuturaId           // FUTURA doc being closed
editingEntregaClienteId    // pre-selected client for new entrega
entregaFilter              // 'en_curso' | 'finalizada' | 'todas'
```

### Key functions

**`addEntrega(data)`** — Creates new entrega with N lingotes (all `en_curso`). After creation, checks if client has FUTURA orphan lingotes → shows AssignFuturaModal.

**`addFuturaLingote(data)`** — Creates standalone FUTURA doc in `lingotes_futura`.

**`assignFuturaToEntrega(futuraIds, targetEntregaId)`** — Moves selected FUTURA lingotes into target entrega's lingotes array (preserving their pricing data), then deletes FUTURA docs.

**`cerrarLingote(entregaId, lingoteIdx, data)`** — Closes a lingote within an entrega. Sets estado to `pendiente_pago`. Saves all pricing fields:
```js
{
  euroOnza, base, precioJofisa, importeJofisa, margen,
  precio: precioCliente,        // base * (1 + margen%)
  importe: precioCliente * pesoNeto,
  nFactura, fechaCierre,
  pesoCerrado: lingote.peso,
  pesoDevuelto: devolucion || 0,
  estado: 'pendiente_pago',
  pagado: false,
}
```

**`cerrarFutura(futuraId, data)`** — Same as cerrarLingote but for standalone FUTURA docs. Updates the doc in `lingotes_futura` with pricing fields.

**`marcarPagado(entregaId, lingoteIdx)`** — Toggles between `pendiente_pago` ↔ `finalizado` (also toggles `pagado` boolean).

### Views & Modals

**StockOverview** — Top-level: stock Ma d'Or card + stock en clientes + FUTURA card (red, if any). Grid of client cards with pending weight and FUTURA indicator.

**ClienteDetalle** — Client header with stats (entregado/cerrado/devuelto/pendiente). Filter buttons (En Curso / Finalizadas / Todas). Sections:
1. FUTURA orphan lingotes (red card, with "Cerrar" and "Asignar a entrega" buttons)
2. En Curso entregas (amber cards with lingote list, each has "Cerrar" button)
3. Cerrados flat table (both pendiente_pago and finalizado lingotes, with entrega date as colored badge, pagado toggle)
4. Bottom: "+ Nueva Entrega" and "+ FUTURA" buttons

**EntregaModal** — Client, exportacion, date, quantity (preset buttons 1/2/4/6/10), peso (50g/100g). Total summary.

**CierreModal** — Full pricing chain for closing a lingote:
```
€/Onza (input, e.g. 3693.42)
  → Base (display: ROUNDUP(€/Onza ÷ 31.10349, 2))
Precio Jofisa (auto-fills from base once, then editable)
  → Importe Jofisa (display: peso × precioJofisa)
Margen % (default 6%, editable) + Precio Cliente (display: base × (1 + margen%))
  → Resumen Cliente box (peso neto, precio cliente, IMPORTE CLIENTE)
Fecha Cierre (date input)
N Factura (text input)
Devolucion gramos (only for non-FUTURA)
```

**Key calculations in CierreModal:**
```js
base = Math.ceil((euroOnzaNum / 31.10349) * 100) / 100  // ROUNDUP to 2 decimals
precioCliente = Math.round((base * (1 + margenNum / 100)) * 100) / 100
importeCliente = precioCliente * pesoNeto
// precioJofisa auto-fills from base once (jofisaAutoFilled flag)
// Confirm button disabled until precioCliente > 0
```

**FuturaModal** — Register orphan lingotes: client, quantity, peso, optional precio/factura/fecha.

**AssignFuturaModal** — Select target entrega + checkboxes for FUTURA lingotes to assign. "Seleccionar todos" button.

**ExportacionesView** — CRUD for gold exports with per-client breakdown and progress bars.

**ParametrosView** — Stock Ma d'Or amount, color threshold settings (rojo/naranja/amarillo) with live preview.

### Cerrados table structure
```
Entrega (colored badge) | Cierre date | Peso | €/g | Importe | Pagado (toggle circle)
```
- pendiente_pago rows: amber background tint
- finalizado rows: normal background
- Pagado toggle: green circle with checkmark when paid

### Entrega filter behavior
The filter tabs (En Curso / Finalizadas / Todas) filter which **entregas** feed into ALL sections (both En Curso and Cerrados). They do NOT control which sections are visible — both sections always show.

---

## IMPORT SCRIPTS

### import-lingotes.mjs
- Parses CSV with Spanish date formats ("23/feb/23", "3/03/2023")
- Client name mapping: NJ → Nova Joia, Milla → La Milla d'Or, etc.
- Groups rows into entregas by (client + date)
- FUTURA rows → standalone docs in `lingotes_futura`
- Estado mapping: `precio !== null ? (pagado ? 'finalizado' : 'pendiente_pago') : 'en_curso'`
- Result: 9 exportaciones, 65 entregas, 381 lingotes, 16 FUTURA standalone

### import-data.mjs
- Imports expediciones/paquetes/lineas from CSV
- 4 expediciones (E50-E53), 51 paquetes with nested lineas

### import-resultados.mjs
- Imports fino sobra (leftover fine gold) per client per expedition

---

## DEPLOYMENT

- **Vercel**: Auto-deploys on `git push` to main
- **Firebase**: Project `mador-32292`, Firestore open rules
- **Environment**: `VITE_FIREBASE_*` vars in Vercel dashboard (build-time embedded)
- **Build**: `npm run build` → `vite build` → `dist/`
- **Dev**: `npm run dev` → `vite` dev server

---

## CLIENTS (as of Jan 2026)

| Name | Abbrev | Color | Descuento | Descuento Fino |
|------|--------|-------|-----------|----------------|
| Gaudia | GAU | #f59e0b (amber) | 5% | 5% |
| Gemma d'Or | GEM | #3b82f6 (blue) | 6.5% | 6% |
| La Milla d'Or | MIL | #10b981 (green) | 6.5% | 6.5% |
| OrCash | ORC | #8b5cf6 (purple) | 5% | 5% |
| Nova Joia | NOV | #ef4444 (red) | 6.5% | 6.5% |
| Alquimia | ALQ | #ec4899 (pink) | 6.5% | 6.5% |
| Mador stock | MAD | #06b6d4 (cyan) | 0% | 0% |
| Contratos particulares | PAR | #84cc16 (lime) | 6.5% | 6.5% |
| Suissa | SUI | #6b7280 (gray) | 6.5% | 6.5% |

---

## API ENDPOINT

**POST /api/verify** (Vercel serverless function)
- Forwards `{messages, max_tokens}` to Claude Sonnet 4 via Anthropic API
- Used for AI invoice verification (extract totals from invoice images)
- Requires `ANTHROPIC_API_KEY` env var in Vercel

---

## RECENT GIT HISTORY (Jan 2026)

```
dfb2fcf Rewrite CierreModal: €/Onza → base → precioJofisa → precioCliente
1a98a21 Add pendiente_pago status and FUTURA cierre support
3848dac Style entrega dates as colored badges (25-1 format) in finalizados table
0d97a66 Revert filter gating: both En Curso and Finalizados always visible
6493b31 FUTURA standalone docs, finalizados flat table with Entrega column, filter sections
4e7b80c Add entrega status filter to ClienteDetalle (En Curso/Finalizadas/Todas)
457d1c5 Add FUTURA lingotes support (ventas sin stock)
66c61a6 Rewrite LingotesTracker for new lingotes[] array model + add import script
a7af03c Add LingotesTracker component with Firestore integration (v1.0)
```

---

## PENDING TASK

**Add field validation to CierreModal** — User's last request before session ended. Issue: entering "9" as €/Onza produces 0.29 base which is nonsense for gold pricing (real values are ~2500-5000+ €/Onza). User said: "hay que anadir validador de campo xq me estas volviendo a hacer lo del firebase jaja" — meaning invalid values were reaching Firebase.

Needed:
- Minimum value validation for €/Onza (realistic gold: 1000+)
- Show warning when value looks suspicious
- Ensure no NaN/undefined/null/empty values leak to Firebase
- Validate all numeric fields parse correctly before saving
- Keep confirm button disabled until all values are sensible

---

## CRITICAL RULES (learned from user corrections)

1. **Filter tabs filter ENTREGAS, not SECTIONS**: The En Curso/Finalizadas/Todas tabs filter which entregas feed into ALL sections (both En Curso cards and Cerrados table). They do NOT hide/show sections. This was explicitly corrected by the user after an incorrect implementation.

2. **Truncation NOT rounding** for fino calculation: `Math.trunc(fino * 100) / 100`

3. **ROUNDUP for base**: `Math.ceil((euroOnza / 31.10349) * 100) / 100` (Excel ROUNDUP equivalent)

4. **precioJofisa auto-fill ONCE**: Uses `jofisaAutoFilled` flag to only populate from base the first time, then user can freely edit.

5. **Push after every change**: User expects `git push` after commits so Vercel auto-deploys.

6. **European number format**: Always use `formatNum()` for display, never raw numbers. Locale: `de-DE`.

7. **No emojis in code/output** unless user explicitly requests them.

8. **Entrega colored badges**: Format `YY-M` (e.g. "25-1") with deterministic color from 20-color palette via hash function.

---

## COMMON PATTERNS IN THIS CODEBASE

### Adding a new field to lingotes
1. Add to Firestore write in `cerrarLingote`/`cerrarFutura`
2. Add to CierreModal form state
3. Add to CierreModal calculations and JSX
4. Update `import-lingotes.mjs` estado mapping if needed
5. Build and verify

### Adding new lingote status
1. Add to `isCerrado()` helper if it should count as "closed"
2. Update relevant aggregate functions (pesoCerrado, importeEntrega, etc.)
3. Update `isEntregaFinalizada` if needed
4. Add UI treatment (badge, row styling) in ClienteDetalle
5. Update import script estado mapping

### Modifying CierreModal pricing
1. All calculations are inline in the component (not extracted)
2. Form state in `formData` object
3. Derived values computed on every render (not stored in state)
4. Auto-fill logic uses a flag to run once only
5. Confirm button enabled/disabled based on calculated precioCliente

### Adding new modal
1. Add state: `showXModal` boolean + any data states
2. Add component as function inside LingotesTracker
3. Add render: `{showXModal && <XModal />}` at bottom
4. Add trigger: button/link that sets show state to true

---

## WARNINGS

1. **Tailwind v4**: Uses `@import "tailwindcss"` in CSS, NOT `@tailwind` directives. Plugin is `@tailwindcss/vite`, NOT PostCSS.
2. **No TypeScript**: Pure JavaScript/JSX throughout.
3. **Single-file components**: Most UI is in one large file (mador-tracker.jsx ~3100 lines). LingotesTracker was extracted but is still ~1320 lines.
4. **No state management library**: All state via useState + useFirestore hook.
5. **No router**: Tab-based navigation via state. Back button via state reset.
6. **Logs grow infinitely**: Every paquete change appends to logs array. No cleanup.
7. **React Strict Mode**: Double-mount prevention via `useRef` flags.
8. **Firestore completely open**: No auth, no security rules. URL param selects user.
