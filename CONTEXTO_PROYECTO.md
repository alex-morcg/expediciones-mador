# Expediciones Ma d'Or - Hoja de Contexto

## Resumen del Proyecto
Aplicación web React para gestión de entregas de lingotes de oro. Tiene dos módulos principales:
1. **MadorTracker** (`mador-tracker.jsx`): Gestión de expediciones/paquetes de oro
2. **LingotesTracker** (`src/components/LingotesTracker.jsx`): Gestión de entregas de lingotes a clientes

## Stack Tecnológico
- React 18 + Vite
- Tailwind CSS 4
- Firebase Firestore (base de datos en tiempo real)
- Sin gestión de estado externa (useState/useMemo)

## Estructura de Archivos Clave
```
src/
├── App.jsx                    # Punto de entrada
├── mador-tracker.jsx          # Módulo expediciones (~3500 líneas)
├── components/
│   └── LingotesTracker.jsx    # Módulo lingotes (~3400 líneas)
├── hooks/
│   └── useFirestore.js        # Hook CRUD Firestore
└── firebase.js                # Configuración Firebase
```

---

## LingotesTracker.jsx - Arquitectura

### Props que recibe
```javascript
{
  clientes,           // Array de clientes
  exportaciones,      // Array de exportaciones (stock disponible)
  entregas,           // Array de entregas a clientes
  futuraLingotes,     // Array de lingotes FUTURA (vendidos sin stock)
  facturas,           // Array de facturas
  config,             // Configuración (umbrales, etc)
  onBack,             // Volver a MadorTracker
  onSaveExportacion, onDeleteExportacion,
  onSaveEntrega, onDeleteEntrega, onUpdateEntrega,
  onUpdateConfig,
  onSaveFutura, onDeleteFutura, onUpdateFutura,
  onSaveFactura, onDeleteFactura, onUpdateFactura,
}
```

### Estados principales (líneas 81-103)
```javascript
activeTab              // 'stock' | 'exportaciones' | 'parametros'
selectedCliente        // ID del cliente seleccionado para ver detalle
showEntregaModal       // Modal para crear entrega
showCierreModal        // Modal para cerrar lingotes
selectedEntrega        // Entrega seleccionada para cierre
selectedLingoteIdx     // Índice del lingote a cerrar
selectedLingoteIndices // Array de índices para cierre bulk
cierreCantidad         // { entregaId_peso: cantidad } - selector de cantidad
devolucionCantidad     // { entregaId_peso: cantidad } - selector devolución
futuraCierreCantidad   // { clienteId_peso: cantidad } - selector FUTURA
showFuturaModal        // Modal para crear FUTURA
showAssignFuturaModal  // Modal para asignar FUTURA a entrega
selectedFuturaId       // ID de FUTURA para cierre individual
selectedFuturaIds      // Array IDs para cierre bulk FUTURA
showFacturaModal       // Modal para subir factura
viewingFactura         // Factura que se está visualizando
```

### Estados de un Lingote
```javascript
{
  estado: 'en_curso' | 'pendiente_pago' | 'finalizado' | 'devuelto',
  peso: number,           // gramos
  precio: number,         // €/g (cuando cerrado)
  importe: number,        // precio * peso
  euroOnza: number,       // €/onza de referencia
  baseCliente: number,    // base €/g del cliente
  precioJofisa: number,   // precio Jofisa €/g
  margen: number,         // % margen
  nFactura: string,       // ID de factura asignada
  fechaCierre: string,    // fecha de cierre
  pagado: boolean,        // si está pagado
  pesoDevuelto: number,   // gramos devueltos parcialmente
}
```

### Flujo de Lingotes
```
1. EXPORTACIÓN (stock global)
      ↓
2. ENTREGA a cliente (estado: 'en_curso')
      ↓
3. CERRAR (selector 1,2,4 → estado: 'pendiente_pago')
      ↓
4. PAGAR (estado: 'finalizado')

Alternativas:
- DEVOLVER → estado: 'devuelto'
- FUTURA → lingote vendido sin stock, se asigna después
```

---

## Funciones CRUD Principales

### addEntrega (línea 195)
Crea entrega desde exportación, descuenta stock.

### cerrarLingotes (línea 326)
Cierra uno o más lingotes con precio. Soporta cierre multi-entrega.

### cerrarFutura / cerrarFuturaMultiple (líneas 414, 438)
Cierra lingotes FUTURA (individual o bulk).

### devolverLingotes (línea 464)
Marca lingotes como devueltos.

### marcarPagado (línea 507)
Toggle entre pendiente_pago ↔ finalizado.

### addFuturaLingote (línea 269)
Crea lingote FUTURA (venta sin stock físico).

### assignFuturaToEntrega (línea 288)
Asigna lingotes FUTURA a una entrega existente.

---

## Vistas Principales

### StockOverview (línea 570)
- Stock global Ma d'Or
- Stock por cliente
- Lista de clientes con stats
- Si hay cliente seleccionado → ClienteDetalle

### ClienteDetalle (línea 690)
- Header con stats del cliente
- Filtros: En Curso / Finalizadas / Todas
- **FUTURA pendientes de asignar** (si hay stock)
- **En Curso**: entregas con selector [1][2][4] para Cerrar/Devolver
- **Cerrados**: tabla de lingotes cerrados
- **Facturas**: sección para subir/ver facturas
- **FUTURA Exportación** (si NO hay stock): crear/cerrar FUTURA
- Historial de logs

### ExportacionesView (línea 1476)
- CRUD de exportaciones
- Cada exportación tiene lingotes por peso
- Barra de progreso: entregado vs disponible

### ParametrosView (línea 2127)
- Stock Ma d'Or
- Umbrales de color (rojo, naranja, amarillo)
- Zona peligrosa: borrar todos los datos

---

## Modales

### EntregaModal (línea 2265)
- Seleccionar exportación, cliente, fecha
- Elegir cantidad por tipo de lingote

### CierreModal (línea 2485)
- Cierre de lingotes (normal o FUTURA)
- Campos: €/Onza, Base Cliente, Precio Jofisa, Margen
- Calcula precio cliente automáticamente
- Soporta cierre bulk (múltiples lingotes)

### FuturaModal (línea 2744)
- Crear lingotes FUTURA
- Cantidad, peso, precio opcional

### AssignFuturaModal (línea 2850)
- Asignar FUTURA a entrega existente

### MultiCierreModal (línea 2948)
- Selección múltiple de lingotes de diferentes entregas

### FacturaModal (línea 3118)
- Subir PDF/imagen de factura
- Asignar a lingotes cerrados

---

## Selector de Cantidad (UI Pattern)

Usado en ClienteDetalle para Cerrar y Devolver lingotes:

```jsx
// Agrupa lingotes por peso
const porPeso = {};
entrega.lingotes.forEach((l, idx) => {
  if (l.estado !== 'en_curso') return;
  if (!porPeso[l.peso]) porPeso[l.peso] = { peso: l.peso, indices: [] };
  porPeso[l.peso].indices.push(idx);
});

// Para cada grupo:
const key = `${entrega.id}_${grupo.peso}`;
const cantidad = cierreCantidad[key] || 1;
const maxCantidad = grupo.indices.length;
const quickOptions = [1, 2, 4].filter(n => n <= maxCantidad);

// Renderiza: [1] [2] [4] [input] [Cerrar]
```

**También implementado para FUTURA** (líneas 791-879 y 1274-1371):
- Agrupa FUTURA sin cerrar por peso
- Mismo patrón de selectores [1][2][4]
- Sección separada para FUTURA cerrados

---

## Colecciones Firestore

```
lingotesExportaciones    # Exportaciones con lingotes disponibles
lingotesEntregas         # Entregas a clientes con array de lingotes
lingotesFutura           # Lingotes FUTURA (vendidos sin stock)
lingotesFacturas         # Facturas subidas
lingotesConfig           # Configuración (umbrales, etc)
```

---

## Helpers Importantes (líneas 33-58)

```javascript
isCerrado(l)           // estado === 'pendiente_pago' || 'finalizado'
pesoEntrega(e)         // suma peso de todos los lingotes
pesoCerrado(e)         // suma peso de cerrados - devueltos parciales
pesoDevuelto(e)        // suma lingotes devueltos + devoluciones parciales
importeEntrega(e)      // suma importe de cerrados
isEntregaFinalizada(e) // todos cerrados o devueltos
lingotesEnCurso(e)     // filtra estado === 'en_curso'
```

---

## Notas de Implementación

1. **Cierre Bulk FUTURA** (líneas 2497-2499, 2597-2602):
   - `selectedFuturaIds` guarda array de IDs
   - `cerrarFuturaMultiple()` cierra todos con mismos datos

2. **Sección FUTURA con selectores**:
   - Si `stockRealTotal > 0`: sección "FUTURA pendientes de asignar" (línea 776)
   - Si `stockRealTotal === 0`: sección "FUTURA Exportación" (línea 1262)
   - Ambas usan mismo patrón de selectores [1][2][4]

3. **Logs de actividad**: Cada acción crea log con `createLog()` (línea 186)

4. **Color por fecha de entrega**: `getEntregaColor()` genera color único por fecha

---

## Versión Actual: v2.7

Última actualización: Módulo FUTURA reimplementado con selectores de cantidad iguales a entregas normales.
