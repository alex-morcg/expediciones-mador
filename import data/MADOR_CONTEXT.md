# MA D'OR TRACKER - Hoja de Contexto para Claude

## RESUMEN EJECUTIVO

**Ma d'Or** es una aplicacion de gestion de expediciones de oro para una empresa de compraventa. Gestiona el flujo de paquetes de oro desde clientes (joyerias) hasta el refinador (Jofisa), calculando precios, margenes y generando documentacion.

**Stack**: Vite + React 18 + Tailwind CSS v4 + Recharts + Firebase/Firestore
**Componente principal**: `src/mador-tracker.jsx` (~2800 lineas)
**Hook de datos**: `src/hooks/useFirestore.js` (~700 lineas)
**Firebase config**: `src/firebase.js`
**Formato numerico**: Europeo (1.234,56)
**Version actual**: v0.3

---

## INFRAESTRUCTURA Y DEPLOY

### Stack Tecnico
- **Frontend**: Vite + React 18 + Tailwind CSS v4 (@tailwindcss/vite)
- **Base de datos**: Firebase Firestore (real-time sync via onSnapshot)
- **Hosting**: Vercel (auto-deploy desde GitHub)
- **Repo**: `alex-morcg/expediciones-mador` (privado)
- **URL**: `https://expediciones-mador-b3fp.vercel.app/?user=maria`

### Estructura del Proyecto
```
Expediciones Ma d'Or/
  index.html
  package.json
  vite.config.js
  vercel.json              # SPA rewrite
  .env                     # VITE_FIREBASE_* vars
  import-data.mjs          # Script one-time import CSV -> Firestore
  import data/             # CSVs originales + este archivo
  src/
    main.jsx               # Entry point
    App.jsx                 # Wrapper
    index.css               # Tailwind v4 import
    firebase.js             # Firebase init con env vars
    hooks/
      useFirestore.js       # Real-time listeners + CRUD + seed
    mador-tracker.jsx       # Componente principal (~2800 lineas)
```

### Variables de Entorno (Vercel + .env)
```
VITE_FIREBASE_API_KEY
VITE_FIREBASE_AUTH_DOMAIN
VITE_FIREBASE_PROJECT_ID
VITE_FIREBASE_STORAGE_BUCKET
VITE_FIREBASE_MESSAGING_SENDER_ID
VITE_FIREBASE_APP_ID
```

### Acceso
- URL requiere `?user=maria` (o pedro, ana, carlos) en el parametro
- Sin auth real — el dropdown de usuario lee del URL param
- Firestore rules: `allow read, write: if true` (abierto)

---

## ARQUITECTURA DE DATOS (FIRESTORE)

### Colecciones
```
categorias/       -> {nombre, esFino}
clientes/         -> {nombre, abreviacion, color, descuentoEstandar, descuentoFino, lineasNegativasNoCuentanPeso, kilatajes[]}
expediciones/     -> {nombre, precioOro, precioPorDefecto, fechaExportacion}
paquetes/         -> {expedicionId, numero, nombre, clienteId, categoriaId, descuento, igi, precioFino, cierreJofisa, estado, lineas[], comentarios[], logs[], factura, verificacionIA, ultimaModificacion}
estadosPaquete/   -> {nombre, icon, color}
usuarios/         -> {nombre}
config/settings   -> {expedicionActualId}
```

Arrays anidados (lineas, logs, comentarios, kilatajes) dentro del documento padre.

### Jerarquia Principal
```
EXPEDICIONES (E50, E51, E52, E53...)
  -> PAQUETES (E50-1, E50-2...)
       -> LINEAS DE ORO (bruto + ley = fino)
```

### Entidades de Soporte
- **CLIENTES**: Joyerias que venden oro (Gaudia, Gemma d'Or, OrCash, Nova Joia, Alquimia, La Milla d'Or, Mador stock, Contratos particulares)
- **CATEGORIAS**: Tipos de material (Chatarra 18K, Lingote fino, etc.) — `esFino` determina IGI y descuento
- **ESTADOS**: Flujo del paquete (Por recoger -> En banco -> En casa) — editables por usuario
- **USUARIOS**: Quien opera el sistema (Maria, Pedro, Ana, Carlos)

---

## MODELO DE DATOS DETALLADO

### Expedicion
```javascript
{
  id: string,               // Firestore auto-ID
  nombre: string,           // "E53"
  precioOro: number|null,   // Precio referencia historico
  precioPorDefecto: number|null, // Precio fino para paquetes sin precio (v0.3)
  fechaExportacion: string|null  // ISO date
}
// expedicionActualId se guarda en config/settings
```

### Cliente
```javascript
{
  id: string,               // Firestore auto-ID
  nombre: string,           // "Gaudia"
  abreviacion: string,      // "GAU" (3-4 chars)
  color: string,            // "#f59e0b" (hex)
  descuentoEstandar: number,// 5, 6.5...
  descuentoFino: number,    // Para categorias "fino"
  lineasNegativasNoCuentanPeso: boolean,
  kilatajes: [{nombre, ley}] // Atajos de ley frecuentes
}
```

### Categoria
```javascript
{
  id: string,
  nombre: string,           // "Lingote Chatarra 18K"
  esFino: boolean           // true = IGI 0%, descuento fino
}
```

### Paquete (ENTIDAD CENTRAL)
```javascript
{
  id: string,               // Firestore auto-ID
  expedicionId: string,
  numero: number,           // Numero dentro de expedicion
  nombre: string,           // "E53-1" (auto-generado)
  clienteId: string,
  categoriaId: string,
  descuento: number,        // % descuento aplicado
  igi: number,              // % IGI (0 o 4.5)
  precioFino: number|null,  // euros/g al cerrar (fixing)
  cierreJofisa: number|null,// Precio Jofisa (precioFino - 0.25)
  estado: string|null,      // ID de estadosPaquete
  lineas: [Linea],
  factura: {nombre, tipo, data}|null, // Base64 imagen/PDF
  verificacionIA: {...}|null,
  comentarios: [{id, fecha, usuario, texto}],
  logs: [{id, fecha, usuario, accion, detalles}],
  ultimaModificacion: {usuario, fecha}|null
}
```

### Linea de Oro
```javascript
{
  id: number,       // Date.now() + Math.random()
  bruto: number,    // Peso bruto en gramos (puede ser negativo)
  ley: number       // Pureza en milesimas (708, 750, 916, 1000...)
}
```

---

## FORMULAS DE CALCULO

### Fino por Linea
```javascript
fino = bruto * (ley / 1000)
// IMPORTANTE: Se trunca a 2 decimales, NO redondea
fino = Math.trunc(fino * 100) / 100
```

### Totales de Paquete
```javascript
// calcularTotalesPaquete(paquete, precioPorDefecto)
// Para PESO: lineas negativas NO cuentan (si cliente.lineasNegativasNoCuentanPeso)
// Para euros: lineas negativas SI cuentan siempre

finoTotal = sum(fino de cada linea)     // Con regla de negativos para peso
finoTotalCalculo = sum(fino de TODAS)   // Siempre todas para euros

// precioEfectivo = paquete.precioFino || precioPorDefecto || null
// esEstimado = !paquete.precioFino && !!precioPorDefecto

base = finoTotalCalculo * precioEfectivo
descuentoImporte = base * (descuento / 100)
baseCliente = base - descuentoImporte
igi = baseCliente * (igi% / 100)
totalFra = baseCliente + igi           // Lo que paga el cliente

// Margen Mador
cierreJofisa = precioEfectivo - 0.25   // Siempre 0.25 euros menos
fraJofisa = cierreJofisa * finoTotalCalculo
margen = fraJofisa - baseCliente

// Return: { finoTotal, finoTotalCalculo, brutoTotal, base, descuento,
//           baseCliente, igi, totalFra, fraJofisa, margen, cierreJofisa, esEstimado }
```

### Precio por Defecto (v0.3)
```javascript
// getExpedicionPrecioPorDefecto(expedicionId):
// 1. Si expedicion tiene precioPorDefecto guardado -> usar ese
// 2. Fallback: ultimo precioFino de paquetes de esa expedicion
// 3. null si no hay nada

// Se usa en calcularTotalesPaquete cuando paquete.precioFino es null
// Los valores calculados con precio por defecto llevan esEstimado=true
// En la UI se muestran con ~ prefijo, gris, cursiva
```

### Totales de Expedicion
```javascript
// calcularTotalesExpedicion(expedicionId)
// Suma todos los paquetes, incluyendo estimados
// Return: { sumaBruto, sumaFino, totalFra, totalFraJofisa, totalMargen,
//           totalFraEstimado, precioMedioBruto, porCategoria, numPaquetes }
```

### Regla de Categoria "Fino"
```javascript
if (categoria.esFino) {
  igi = 0%
  descuento = cliente.descuentoFino
} else {
  igi = 4.5%
  descuento = cliente.descuentoEstandar
}
```

---

## SISTEMA DE UI

### Tabs Principales
1. **Expediciones**: Lista -> Detalle Expedicion -> Detalle Paquete
2. **Clientes**: CRUD clientes con kilatajes
3. **Parametros**: Usuarios + Estados + Categorias
4. **Stats**: Graficos de volumen

### Navegacion en Expediciones
```
Lista Expediciones
  | click
Detalle Expedicion (lista paquetes + selector vista)
  | click paquete
Detalle Paquete (lineas, cierre, estado, comentarios, factura...)
```

### Vistas de Ordenacion (en expedicion)
- **Normal**: Por numero de paquete
- **Por cliente**: Agrupado con headers + suma bruto
- **Por estado**: Agrupado por estado + "marcar todos como" (solo en esta vista)
- **Por categoria**: Agrupado + suma bruto + badge FINO

### Sistema de Colores de Cliente
Todo el detalle del paquete usa `cliente.color`:
- Bordes de cards, fondos suaves (`color + '10'`), headers, inputs, botones, badges

### Indicadores de Precio Estimado (v0.3)
- Tarjeta paquete: fra en gris cursiva con ~prefijo
- Detalle paquete: banner "Precio estimado (X euros/g)" + valores en gris
- Totales expedicion: linea extra "~X euros estimado" bajo Total Fra

### Componentes Reutilizables (internos)
```javascript
Card      // Contenedor con borde, acepta style={{}}
Button    // variant: primary|secondary|danger|ghost, disabled, disabledReason
Input     // Con label
Select    // Con label y options
Checkbox  // Con label
TabButton // Para navegacion principal
```

---

## FUNCIONES PRINCIPALES

### Getters
```javascript
getCliente(id)                        -> cliente object
getCategoria(id)                      -> categoria object
getUsuario(id)                        -> usuario object
getExpedicionNombre(id)               -> string
getNextPaqueteNumber(expedicionId)    -> number
getPrecioRefExpedicion(expedicionId)  -> number // Ultimo precioFino
getExpedicionPrecioPorDefecto(expId)  -> number|null // (v0.3)
```

### Calculos
```javascript
calcularFinoLinea(bruto, ley) -> number
calcularTotalesPaquete(paquete, precioPorDefecto?) -> {
  finoTotal, finoTotalCalculo, brutoTotal,
  base, descuento, baseCliente, igi, totalFra,
  fraJofisa, margen, cierreJofisa, esEstimado
}
calcularTotalesExpedicion(expedicionId) -> {
  sumaBruto, sumaFino, totalFra, totalFraJofisa, totalMargen,
  totalFraEstimado, precioMedioBruto, porCategoria, numPaquetes
}
```

### CRUD (delegadas a useFirestore.js)
```javascript
// En useFirestore.js — todas async, escriben a Firestore
saveExpedicion(data, editingItem)
deleteExpedicion(id)                  // Cascade: borra paquetes
savePaquete(data, editingItem, ctx)   // Auto-genera nombre, logs
deletePaquete(id)
addLineaToPaquete(paqueteId, linea, usuario)
removeLineaFromPaquete(paqueteId, lineaId, usuario)
updatePaqueteCierre(paqueteId, precioFino, cierreJofisa, usuario)
updatePaqueteEstado(paqueteId, estadoId, usuario)
updatePaqueteFactura(paqueteId, factura, usuario)
updatePaqueteVerificacion(paqueteId, verificacion)
addComentarioToPaquete(paqueteId, texto, usuario)
deleteComentarioFromPaquete(paqueteId, comentarioId)
marcarTodosComoEstado(expedicionId, estadoId, usuario)
saveCategoria, saveCliente, etc.
```

### Generacion de Texto
```javascript
generarTexto(paquete) -> string  // Formato para enviar a refinador
```

---

## CAPA DE DATOS: useFirestore.js

### Arquitectura
- Single custom hook que gestiona TODO el estado de datos
- `onSnapshot` real-time listeners para las 6 colecciones + config doc
- Loading state: cuenta 7 listeners, `setLoading(false)` cuando todos han respondido
- Seed reactivo: si categorias esta vacia, hace seed automatico (para DBs nuevas)
- `useRef(seedTriggered)` para evitar double-seed en React Strict Mode

### Pattern
```javascript
const {
  categorias, clientes, expediciones, paquetes, estadosPaquete, usuarios,
  expedicionActualId, loading,
  saveExpedicion, deleteExpedicion, savePaquete, deletePaquete,
  // ... todas las funciones CRUD
} = useFirestore();
```

### Seed Data
- `useFirestore.js` contiene arrays de seed data (seedCategorias, seedClientes, etc.)
- Solo se usan si la DB esta completamente vacia
- Los datos reales se importaron via `import-data.mjs`

---

## ESTADOS DE LA APP

```javascript
// Datos (vienen de useFirestore)
categorias, clientes, expediciones, paquetes, estadosPaquete, usuarios
expedicionActualId, loading

// Navegacion
const [activeTab, setActiveTab] = useState('expediciones');
const [selectedExpedicion, setSelectedExpedicion] = useState(null);
const [selectedPaquete, setSelectedPaquete] = useState(null);
const [ordenVista, setOrdenVista] = useState('normal');

// Usuario
const [usuarioActivo, setUsuarioActivo] = useState(...); // Lee de ?user=X

// Modales
const [modalOpen, setModalOpen] = useState(false);
const [modalType, setModalType] = useState(null); // 'categoria'|'cliente'|'expedicion'|'paquete'
const [editingItem, setEditingItem] = useState(null);
const [showTextModal, setShowTextModal] = useState(false);
const [showLogsModal, setShowLogsModal] = useState(false);
const [marcarTodosModal, setMarcarTodosModal] = useState({open, estadoId});

// Formularios temporales
const [newLinea, setNewLinea] = useState({bruto:'', ley:''});
const [cierreData, setCierreData] = useState({precioFino:'', cierreJofisa:''});
const [newComentario, setNewComentario] = useState('');

// IA
const [verificandoFactura, setVerificandoFactura] = useState(false);
```

---

## REGLAS DE NEGOCIO IMPORTANTES

1. **Cierre Jofisa**: Siempre `precioFino - 0.25`. Si difiere, se muestra warning rojo.

2. **Lineas negativas**:
   - NO cuentan para peso bruto/fino mostrado
   - SI cuentan para calculo de euros
   - Se muestran en rojo

3. **Categoria Fino**:
   - IGI = 0%
   - Usa descuentoFino del cliente
   - Muestra badge "FINO"

4. **Expedicion Actual**: Una sola activa. Los nuevos paquetes van ahi por defecto.

5. **Precio por Defecto** (v0.3): Si un paquete no tiene precioFino, usa el precioPorDefecto de su expedicion. Los calculos se marcan como "estimados" y se muestran con estilo diferente.

6. **Auto-suggest expedicion** (v0.2): Al crear nueva expedicion, sugiere E{max+1}.

7. **Verificacion IA**: Extrae total de factura (imagen/PDF) via API Anthropic (client-side).

8. **Logs**: Toda modificacion de paquete queda registrada con usuario y timestamp.

---

## TIPS PARA MODIFICAR

1. **Anadir campo a expedicion/paquete**: Modificar en useFirestore.js (save function) + mador-tracker.jsx (form defaults + modal form)

2. **Cambiar calculos**: Funcion `calcularTotalesPaquete` en mador-tracker.jsx

3. **Nuevo tab**: Anadir en `TabButton` nav + crear componente + case en render

4. **Nuevo estado de paquete**: Se hace desde Parametros (editable por usuario)

5. **Colores de cliente**: Buscar `clienteColor` — se propaga a todo el detalle

6. **Validaciones de cierre**: Buscar `esIncorrecto` y `diferencia > 0.001`

7. **Version**: Actualizar `<span>v0.X</span>` en el header de mador-tracker.jsx

---

## CUIDADO CON

1. **Truncado vs Redondeo**: El fino usa `Math.trunc`, no `Math.round`

2. **Formato numerico**: Siempre `formatNum()` para mostrar, `parseFloat()` para calcular

3. **IDs**: Firestore auto-genera string IDs. Lineas usan `Date.now() + Math.random()`

4. **React Strict Mode**: El useEffect en useFirestore usa `cancelled` flag y `useRef(seedTriggered)` para evitar problemas de double-mount

5. **Logs**: Se acumulan infinitamente, no hay limpieza

6. **Env vars en Vite**: Deben ser `VITE_*` y se embeben en build-time. Cambiar en Vercel requiere redeploy

7. **Siempre push**: Despues de cada cambio, hacer `git add + commit + push` para que Vercel despliegue

---

## CHANGELOG

- **v0.1**: Deploy inicial — Vite + React + Firebase/Firestore + Vercel
- **v0.2**: Ocultar "marcar todos como" fuera de vista estado, auto-suggest E{n+1} para expediciones, version en header
- **v0.3**: Precio por defecto en expediciones para paquetes sin precioFino, indicadores visuales de valores estimados
