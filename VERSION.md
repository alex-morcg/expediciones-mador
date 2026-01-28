# Ma d'Or Tracker - Version History

## v1.1.0 (2026-01-28)

### Added: Confirmation Dialogs
All destructive actions and form cancellations now require user confirmation to prevent accidental data loss.

#### Delete Confirmations (mador-tracker.jsx)
- **Delete Expedicion**: Shows expedition name and number of packages that will be deleted
- **Delete Paquete**: Shows package name and number of lines
- **Delete Cliente**: Shows client name
- **Delete Categoria**: Shows category name
- **Remove Linea**: Shows line details (bruto/ley)
- **Delete Comentario**: Shows comment preview (first 30 chars)

#### Modal Cancel Confirmations (LingotesTracker.jsx)
- **EntregaModal**: Confirms if cantidad, peso, cliente, or fecha changed from defaults
- **CierreModal**: Confirms if euroOnza, precioJofisa, margen, nFactura, or devolucion was entered
- **FuturaModal**: Confirms if cantidad, peso, precio, nFactura, or cliente changed
- **ExportacionesView (New Form)**: Confirms if nombre, grExport, or fecha was entered
- Backdrop clicks now also check for changes before closing

#### Modal Cancel Confirmations (mador-tracker.jsx)
- **ModalForm (categoria)**: Confirms if nombre was entered
- **ModalForm (cliente)**: Confirms if nombre or abreviacion was entered
- **ModalForm (expedicion)**: Confirms if nombre was entered
- **ModalForm (paquete)**: Already had confirmation (lineas or precioFino)

---

## v1.0.0 (Initial)

- Expediciones module: Track packages from jewelry stores to refiner
- Lingotes module: Track gold bar inventory, deliveries, and forward sales
- Real-time Firestore sync
- Multi-user support via URL parameter
