import React, { useState, useMemo } from 'react';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, Cell, ComposedChart, Line } from 'recharts';
import { LOGO_MADOR_BASE64 } from '../assets/logo';

const formatNum = (num, decimals = 2) => {
  if (num === null || num === undefined || isNaN(num)) return '-';
  return num.toLocaleString('de-DE', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
};

const formatEur = (num) => formatNum(num, 2) + ' €';

// Entrega date as short label: "2025-01-29" → "29-1" (día-mes)
const formatEntregaShort = (fecha) => {
  if (!fecha || fecha === '-') return '-';
  const m = fecha.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return fecha;
  return `${parseInt(m[3])}-${parseInt(m[2])}`;
};

// Fecha cierre compacta: "2026-01-28" → "26-01-28"
const formatFechaCierre = (fecha) => {
  if (!fecha || fecha === '-') return '-';
  const m = fecha.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return fecha;
  return `${m[1].slice(2)}-${m[2]}-${m[3]}`;
};

// 20-color palette for entrega badges
const ENTREGA_COLORS = [
  '#e11d48', '#db2777', '#c026d3', '#9333ea', '#7c3aed',
  '#4f46e5', '#2563eb', '#0284c7', '#0891b2', '#0d9488',
  '#059669', '#16a34a', '#65a30d', '#ca8a04', '#d97706',
  '#ea580c', '#dc2626', '#be185d', '#7e22ce', '#1d4ed8',
];

const getEntregaColor = (fecha) => {
  const label = formatEntregaShort(fecha);
  let hash = 0;
  for (let i = 0; i < label.length; i++) hash = ((hash << 5) - hash + label.charCodeAt(i)) | 0;
  return ENTREGA_COLORS[Math.abs(hash) % ENTREGA_COLORS.length];
};

// Lingote is "cerrado" when it has been closed (pendiente_pago or finalizado)
const isCerrado = (l) => l.estado === 'pendiente_pago' || l.estado === 'finalizado';

// Helper: sum all lingotes peso in an entrega
const pesoEntrega = (entrega) => (entrega.lingotes || []).reduce((s, l) => s + (l.peso || 0), 0);
const pesoCerrado = (entrega) => (entrega.lingotes || []).filter(l => isCerrado(l)).reduce((s, l) => s + (l.peso || 0) - (l.pesoDevuelto || 0), 0);
// Peso devuelto incluye lingotes enteros devueltos (estado='devuelto') + devoluciones parciales de gramos
const pesoDevuelto = (entrega) => {
  const lingotes = entrega.lingotes || [];
  const pesoLingotesDevueltos = lingotes.filter(l => l.estado === 'devuelto').reduce((s, l) => s + (l.peso || 0), 0);
  const pesoGramosDevueltos = lingotes.reduce((s, l) => s + (l.pesoDevuelto || 0), 0);
  return pesoLingotesDevueltos + pesoGramosDevueltos;
};
const importeEntrega = (entrega) => (entrega.lingotes || []).filter(l => isCerrado(l)).reduce((s, l) => s + (l.importe || 0), 0);
const numLingotes = (entrega) => (entrega.lingotes || []).length;
const lingotesEnCurso = (entrega) => (entrega.lingotes || []).filter(l => l.estado === 'en_curso');
const lingotesPendientePago = (entrega) => (entrega.lingotes || []).filter(l => l.estado === 'pendiente_pago');
const lingotesFinalizados = (entrega) => (entrega.lingotes || []).filter(l => l.estado === 'finalizado');
const lingotesCerrados = (entrega) => (entrega.lingotes || []).filter(l => isCerrado(l));
const lingotesDevueltos = (entrega) => (entrega.lingotes || []).filter(l => l.estado === 'devuelto');
// An entrega is "finalizada" when ALL lingotes are:
// - devueltos, OR
// - cerrados + con factura + pagados (estado === 'finalizado')
const isEntregaFinalizada = (entrega) => {
  const all = entrega.lingotes || [];
  if (all.length === 0) return false;
  return all.every(l => {
    if (l.estado === 'devuelto') return true;
    // Cerrado, pagado Y con factura
    return l.estado === 'finalizado' && l.nFactura;
  });
};
const isEntregaEnCurso = (entrega) => !isEntregaFinalizada(entrega);

export default function LingotesTracker({
  clientes,
  exportaciones,
  entregas,
  futuraLingotes,
  facturas,
  config,
  currentUser = 'Usuario',
  canViewStats = true,
  onBack,
  onSaveExportacion,
  onDeleteExportacion,
  onSaveEntrega,
  onDeleteEntrega,
  onUpdateEntrega,
  onUpdateConfig,
  onSaveFutura,
  onDeleteFutura,
  onUpdateFutura,
  onSaveFactura,
  onDeleteFactura,
  onUpdateFactura,
  onAddLogGeneral = () => {}, // (accion, descripcion, detalles) => void
  logsGenerales = [],
  loadLogsGenerales = () => {},
}) {
  const [activeTab, setActiveTab] = useState('stock');
  const [selectedCliente, setSelectedCliente] = useState(null);
  const [showEntregaModal, setShowEntregaModal] = useState(false);
  const [showCierreModal, setShowCierreModal] = useState(false);
  const [selectedEntrega, setSelectedEntrega] = useState(null);
  const [selectedLingoteIdx, setSelectedLingoteIdx] = useState(null);
  const [selectedLingoteIndices, setSelectedLingoteIndices] = useState([]); // For bulk closing
  const [cierreCantidad, setCierreCantidad] = useState({}); // { entregaId_peso: cantidad }
  const [devolucionCantidad, setDevolucionCantidad] = useState({}); // { entregaId_peso: cantidad }
  const [futuraCierreCantidad, setFuturaCierreCantidad] = useState({}); // { clienteId_peso: cantidad }
  const [editingEntregaClienteId, setEditingEntregaClienteId] = useState(null);
  const [entregaFilter, setEntregaFilter] = useState('en_curso');
  const [showFuturaModal, setShowFuturaModal] = useState(false);
  // showAssignFuturaModal removed — FUTURA now auto-merged during entrega creation
  const [selectedFuturaId, setSelectedFuturaId] = useState(null);
  const [selectedFuturaIds, setSelectedFuturaIds] = useState([]); // For bulk FUTURA closing
  const [showHistorial, setShowHistorial] = useState(false);
  const [importExportacionId, setImportExportacionId] = useState(''); // Para importación NJ
  const [showMultiCierreModal, setShowMultiCierreModal] = useState(false);
  const [multiCierreSelection, setMultiCierreSelection] = useState({}); // { entregaId_idx: true }
  const [showFacturaModal, setShowFacturaModal] = useState(false);
  const [facturaFile, setFacturaFile] = useState(null);
  const [facturaSelection, setFacturaSelection] = useState({}); // { entregaId_idx: true }
  const [viewingFactura, setViewingFactura] = useState(null); // factura object to view
  const [viewingExportFactura, setViewingExportFactura] = useState(null); // { exp, factura } - factura de exportación
  const [showNewFuturaModal, setShowNewFuturaModal] = useState(false); // Modal para crear FUTURA con precio
  const [newFuturaData, setNewFuturaData] = useState(null); // { clienteId, cantidad, peso }

  const stockMador = config.stockMador || 0;
  const umbralStock = {
    rojo: config.umbralRojo || 200,
    naranja: config.umbralNaranja || 500,
    amarillo: config.umbralAmarillo || 1000,
  };

  const getCliente = (id) => clientes.find(c => c.id === id);
  const getExportacion = (id) => exportaciones.find(e => e.id === id);

  // Stats per client (including futura standalone docs)
  const statsClientes = useMemo(() => {
    return clientes.map(cliente => {
      const entregasCliente = entregas.filter(e => e.clienteId === cliente.id);
      const entregado = entregasCliente.reduce((sum, e) => sum + pesoEntrega(e), 0);
      const cerrado = entregasCliente.reduce((sum, e) => sum + pesoCerrado(e), 0);
      const devuelto = entregasCliente.reduce((sum, e) => sum + pesoDevuelto(e), 0);
      const pendiente = entregado - cerrado - devuelto;
      const enCurso = entregasCliente.reduce((sum, e) => sum + lingotesEnCurso(e).length, 0);
      const importeTotal = entregasCliente.reduce((sum, e) => sum + importeEntrega(e), 0);
      // Stats solo de entregas en curso (no finalizadas)
      const entregasEnCursoList = entregasCliente.filter(e => isEntregaEnCurso(e));
      const enCursoEntregado = entregasEnCursoList.reduce((sum, e) => sum + pesoEntrega(e), 0);
      const enCursoCerrado = entregasEnCursoList.reduce((sum, e) => sum + pesoCerrado(e), 0);
      const enCursoDevuelto = entregasEnCursoList.reduce((sum, e) => sum + pesoDevuelto(e), 0);
      const enCursoPendiente = enCursoEntregado - enCursoCerrado - enCursoDevuelto;
      // Futura: standalone orphan lingotes (sold but not in any entrega)
      const clienteFutura = (futuraLingotes || []).filter(f => f.clienteId === cliente.id);
      const futuraCount = clienteFutura.length;
      const futuraWeight = clienteFutura.reduce((sum, f) => sum + (f.peso || 0), 0);
      const futuraCerradoWeight = clienteFutura.filter(f => f.precio).reduce((sum, f) => sum + (f.peso || 0), 0);
      return { ...cliente, entregado, cerrado, devuelto, pendiente, enCurso, importeTotal, enCursoEntregado, enCursoCerrado, enCursoDevuelto, enCursoPendiente, futuraCount, futuraWeight, futuraCerradoWeight };
    }).filter(c => c.entregado > 0 || c.enCurso > 0 || c.futuraCount > 0);
  }, [clientes, entregas, futuraLingotes]);

  const stockTotal = useMemo(() => {
    const totalEntregado = entregas.reduce((sum, e) => sum + pesoEntrega(e), 0);
    const totalCerrado = entregas.reduce((sum, e) => sum + pesoCerrado(e), 0);
    const totalDevuelto = entregas.reduce((sum, e) => sum + pesoDevuelto(e), 0);
    const stockClientes = totalEntregado - totalCerrado - totalDevuelto;
    // Futura: only count CLOSED futura (with precio) as negative stock - these are actual sales without physical stock
    const totalFutura = (futuraLingotes || []).filter(f => f.precio).reduce((sum, f) => sum + (f.peso || 0), 0);
    return { totalEntregado, totalCerrado, totalDevuelto, stockClientes, totalFutura };
  }, [entregas, futuraLingotes]);

  // Stock disponible por exportacion = lingotes originales - consumidos por entregas
  const stockDisponiblePorExp = useMemo(() => {
    const result = {};
    exportaciones.forEach(exp => {
      // Start with original lingotes
      const disponible = {};
      (exp.lingotes || []).forEach(l => {
        disponible[l.peso] = (disponible[l.peso] || 0) + (l.cantidad || 0);
      });
      // Subtract lingotes consumed by entregas linked to this exportacion
      entregas.filter(e => e.exportacionId === exp.id).forEach(entrega => {
        (entrega.lingotes || []).forEach(l => {
          // Only subtract non-devuelto lingotes (devueltos are "returned" to stock)
          if (l.estado !== 'devuelto') {
            disponible[l.peso] = (disponible[l.peso] || 0) - 1;
          }
        });
      });
      // Convert to array format, keep only positive
      result[exp.id] = Object.entries(disponible)
        .map(([peso, cantidad]) => ({ peso: parseFloat(peso), cantidad: Math.max(0, cantidad) }))
        .filter(l => l.cantidad > 0);
    });
    return result;
  }, [exportaciones, entregas]);

  const getStockDisponible = (expId) => stockDisponiblePorExp[expId] || [];

  // CRUD
  // Calculate global stock from all exportaciones (using calculated available stock)
  const stockGlobal = useMemo(() => {
    const stockByPeso = {};
    exportaciones.forEach(exp => {
      const disponible = getStockDisponible(exp.id);
      disponible.forEach(l => {
        const peso = l.peso;
        if (!stockByPeso[peso]) stockByPeso[peso] = { cantidad: 0, exportaciones: [] };
        if (l.cantidad > 0) {
          stockByPeso[peso].cantidad += l.cantidad;
          const existing = stockByPeso[peso].exportaciones.find(e => e.nombre === exp.nombre);
          if (existing) {
            existing.cantidad += l.cantidad;
          } else {
            stockByPeso[peso].exportaciones.push({ nombre: exp.nombre, cantidad: l.cantidad });
          }
        }
      });
    });
    return Object.entries(stockByPeso)
      .map(([peso, data]) => ({ peso: parseFloat(peso), cantidad: data.cantidad, exportaciones: data.exportaciones }))
      .filter(s => s.cantidad > 0)
      .sort((a, b) => a.peso - b.peso);
  }, [exportaciones, stockDisponiblePorExp]);

  // Total stock real in grams
  const stockRealTotal = useMemo(() => {
    return stockGlobal.reduce((sum, s) => sum + (s.cantidad * s.peso), 0);
  }, [stockGlobal]);

  const stockRealLingotes = useMemo(() => {
    return stockGlobal.reduce((sum, s) => sum + s.cantidad, 0);
  }, [stockGlobal]);

  // Comprimir imagen para que no supere el límite de Firestore (1MB)
  const comprimirImagen = (file, maxSizeKB = 500) => {
    return new Promise((resolve) => {
      // Si no es imagen, devolver tal cual
      if (!file.type.startsWith('image/')) {
        const reader = new FileReader();
        reader.onload = () => resolve({ name: file.name, type: file.type, data: reader.result });
        reader.readAsDataURL(file);
        return;
      }

      const img = new Image();
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');

      img.onload = () => {
        // Calcular dimensiones máximas manteniendo aspect ratio
        let { width, height } = img;
        const maxDim = 1600; // Máximo 1600px en cualquier dimensión

        if (width > maxDim || height > maxDim) {
          if (width > height) {
            height = (height / width) * maxDim;
            width = maxDim;
          } else {
            width = (width / height) * maxDim;
            height = maxDim;
          }
        }

        canvas.width = width;
        canvas.height = height;
        ctx.drawImage(img, 0, 0, width, height);

        // Comprimir iterativamente hasta estar bajo el límite
        let quality = 0.8;
        let result = canvas.toDataURL('image/jpeg', quality);

        while (result.length > maxSizeKB * 1024 * 1.37 && quality > 0.1) { // 1.37 = factor base64
          quality -= 0.1;
          result = canvas.toDataURL('image/jpeg', quality);
        }

        resolve({
          name: file.name.replace(/\.[^.]+$/, '.jpg'),
          type: 'image/jpeg',
          data: result,
        });
      };

      img.src = URL.createObjectURL(file);
    });
  };

  // Helper para crear logs
  const createLog = (tipo, descripcion) => ({
    id: Date.now().toString(),
    tipo, // 'entrega', 'cierre', 'devolucion', 'pago', 'cancelar_devolucion'
    descripcion,
    usuario: currentUser,
    timestamp: new Date().toISOString(),
  });

  const addEntrega = async (data) => {
    // data.items = [{ peso, cantidad }, ...]
    // data.futuraIdsToAssign = [futuraDocId, ...] (optional)
    const items = data.items || [];
    const futuraIdsToAssign = data.futuraIdsToAssign || [];
    const exportacion = exportaciones.find(e => e.id === data.exportacionId);

    if (!exportacion) {
      alert('Selecciona una exportación válida');
      return;
    }

    // Validate all items have sufficient stock IN THIS EXPORTACION (calculated)
    // ALL lingotes count as stock deduction (including FUTURA-matched ones)
    const disponible = getStockDisponible(data.exportacionId);
    for (const item of items) {
      const stockItem = disponible.find(l => l.peso === item.peso);
      const stockCantidad = stockItem?.cantidad || 0;
      if (stockCantidad < item.cantidad) {
        alert(`No hay suficiente stock de lingotes de ${item.peso}g en ${exportacion.nombre}. Disponibles: ${stockCantidad}, Requeridos: ${item.cantidad}`);
        return;
      }
    }

    // Build FUTURA lookup and queues by peso (oldest first)
    const futuraById = {};
    for (const fId of futuraIdsToAssign) {
      const f = (futuraLingotes || []).find(fl => fl.id === fId);
      if (f) futuraById[fId] = f;
    }
    const futuraQueueByPeso = {};
    for (const fId of futuraIdsToAssign) {
      const f = futuraById[fId];
      if (!f) continue;
      if (!futuraQueueByPeso[f.peso]) futuraQueueByPeso[f.peso] = [];
      futuraQueueByPeso[f.peso].push(fId);
    }

    // Create lingotes: mix FUTURA-converted and fresh en_curso
    const lingotes = [];
    let futuraAssignedCount = 0;
    for (const item of items) {
      const queue = futuraQueueByPeso[item.peso] || [];
      for (let i = 0; i < item.cantidad; i++) {
        if (queue.length > 0) {
          // Consume oldest FUTURA
          const fId = queue.shift();
          const f = futuraById[fId];
          const hasPrecio = !!f.precio;
          lingotes.push({
            peso: f.peso,
            precio: f.precio || null,
            importe: f.importe || 0,
            nFactura: f.nFactura || null,
            fechaCierre: f.fechaCierre || null,
            pesoCerrado: hasPrecio ? f.peso : 0,
            pesoDevuelto: 0,
            estado: hasPrecio ? (f.pagado ? 'finalizado' : 'pendiente_pago') : 'en_curso',
            pagado: f.pagado || false,
            esDevolucion: false,
            esFutura: true,
            ...(f.euroOnza != null && { euroOnza: f.euroOnza }),
            ...(f.base != null && { base: f.base }),
            ...(f.baseCliente != null && { baseCliente: f.baseCliente }),
            ...(f.precioJofisa != null && { precioJofisa: f.precioJofisa }),
            ...(f.margen != null && { margen: f.margen }),
            ...(f.margenCierre != null && { margenCierre: f.margenCierre }),
            ...(f.margenTotal != null && { margenTotal: f.margenTotal }),
          });
          futuraAssignedCount++;
        } else {
          // Fresh lingote from stock
          lingotes.push({
            peso: item.peso,
            precio: null,
            importe: 0,
            nFactura: null,
            fechaCierre: null,
            pesoCerrado: 0,
            pesoDevuelto: 0,
            estado: 'en_curso',
            pagado: false,
            esDevolucion: false,
          });
        }
      }
    }

    // Crear log inicial
    const totalPeso = items.reduce((s, item) => s + (item.peso * item.cantidad), 0);
    const totalLingotes = items.reduce((s, item) => s + item.cantidad, 0);
    const logDesc = futuraAssignedCount > 0
      ? `Entrega creada: ${totalLingotes} lingotes (${totalPeso}g) — ${futuraAssignedCount} FUTURA incluidos`
      : `Entrega creada: ${totalLingotes} lingote${totalLingotes > 1 ? 's' : ''} (${totalPeso}g)`;
    const initialLog = createLog('entrega', logDesc);

    await onSaveEntrega({
      clienteId: data.clienteId,
      exportacionId: data.exportacionId,
      fechaEntrega: data.fechaEntrega,
      lingotes,
      logs: [initialLog],
    });

    // Delete consumed FUTURA docs
    for (const fId of futuraIdsToAssign) {
      if (futuraById[fId]) {
        await onDeleteFutura(fId);
      }
    }

    setShowEntregaModal(false);
    setEditingEntregaClienteId(null);

    // Log general
    const clienteNombre = getCliente(data.clienteId)?.nombre || 'Desconocido';
    const logGeneralDesc = futuraAssignedCount > 0
      ? `Entrega a ${clienteNombre}: ${totalLingotes} lingotes (${totalPeso}g) — ${futuraAssignedCount} FUTURA`
      : `Entrega a ${clienteNombre}: ${totalLingotes} lingotes (${totalPeso}g)`;
    onAddLogGeneral('crear_entrega', logGeneralDesc, {
      clienteId: data.clienteId,
      exportacionId: data.exportacionId,
      totalLingotes,
      totalPeso,
      futuraAssigned: futuraAssignedCount,
    });
  };

  const addFuturaLingote = async (data) => {
    // data: { clienteId, peso, precio, nFactura, fechaCierre, pagado }
    // FUTURA = lingotes vendidos sin stock físico, marcados como "futura" hasta que se asigne exportación
    const importe = data.precio ? data.peso * data.precio : 0;
    await onSaveFutura({
      clienteId: data.clienteId,
      peso: data.peso,
      precio: data.precio || null,
      importe,
      nFactura: data.nFactura || null,
      fechaCierre: data.fechaCierre || null,
      pagado: data.pagado || false,
      estado: 'futura', // Estado especial: vendido sin exportación asignada
      fechaCreacion: new Date().toISOString(),
    });

    // Log general
    const clienteNombre = getCliente(data.clienteId)?.nombre || 'Desconocido';
    onAddLogGeneral('crear_futura', `FUTURA creado para ${clienteNombre}: ${data.peso}g`, {
      clienteId: data.clienteId,
      peso: data.peso,
      precio: data.precio || null,
    });

    setShowFuturaModal(false);
  };

  // Cerrar múltiples lingotes a la vez (bulk)
  const cerrarLingotes = async (entregaId, lingoteIndices, data) => {
    const entregaRef = entregas.find(e => e.id === entregaId);
    if (!entregaRef) return;

    // Si hay _allEntregasIndices, cerrar lingotes de múltiples entregas
    const allEntregasIndices = selectedEntrega?._allEntregasIndices;

    if (allEntregasIndices && allEntregasIndices.length > 1) {
      // Cerrar lingotes de TODAS las entregas
      let totalLingotes = 0;
      let totalPeso = 0;

      for (const { entregaId: eId, indices } of allEntregasIndices) {
        const entrega = entregas.find(e => e.id === eId);
        if (!entrega) continue;

        const lingotes = [...entrega.lingotes];
        for (const idx of indices) {
          const pesoNeto = (lingotes[idx].peso || 0) - (data.devolucion || 0);
          totalPeso += pesoNeto;
          totalLingotes++;
          lingotes[idx] = {
            ...lingotes[idx],
            euroOnza: data.euroOnza || null,
            base: data.base || null,
            baseCliente: data.baseCliente || null,
            precioJofisa: data.precioJofisa || null,
            importeJofisa: (data.precioJofisa || 0) * pesoNeto,
            margen: data.margen || 0,
            precio: data.precio,
            importe: data.precio * pesoNeto,
            nFactura: data.nFactura,
            fechaCierre: data.fechaCierre,
            pesoCerrado: lingotes[idx].peso,
            pesoDevuelto: data.devolucion || 0,
            estado: 'pendiente_pago',
            pagado: false,
          };
        }

        // Log para esta entrega
        const entregaPeso = indices.reduce((s, idx) => s + (entrega.lingotes[idx]?.peso || 0), 0);
        const log = createLog('cierre', `Cerrado (bulk): ${indices.length} lingotes (${entregaPeso}g) a ${formatNum(data.precio)}€/g`);
        const logs = [...(entrega.logs || []), log];

        await onUpdateEntrega(eId, { lingotes, logs });
      }

      // Log general para cierre bulk multi-entrega
      onAddLogGeneral('cerrar_lingotes', `Cierre bulk multi-entrega: ${totalLingotes} lingotes (${totalPeso}g) a ${formatNum(data.precio)}€/g`, {
        totalLingotes,
        totalPeso,
        precio: data.precio,
        importe: data.precio * totalPeso,
      });
    } else {
      // Cierre normal de una sola entrega
      const lingotes = [...entregaRef.lingotes];
      const peso = lingotes[lingoteIndices[0]]?.peso || 0;

      for (const idx of lingoteIndices) {
        const pesoNeto = (lingotes[idx].peso || 0) - (data.devolucion || 0);
        lingotes[idx] = {
          ...lingotes[idx],
          euroOnza: data.euroOnza || null,
          base: data.base || null,
          baseCliente: data.baseCliente || null,
          precioJofisa: data.precioJofisa || null,
          importeJofisa: (data.precioJofisa || 0) * pesoNeto,
          margen: data.margen || 0,
          precio: data.precio,
          importe: data.precio * pesoNeto,
          nFactura: data.nFactura,
          fechaCierre: data.fechaCierre,
          pesoCerrado: lingotes[idx].peso,
          pesoDevuelto: data.devolucion || 0,
          estado: 'pendiente_pago',
          pagado: false,
        };
      }

      // Añadir log
      const totalPeso = lingoteIndices.length * peso;
      const log = createLog('cierre', `Cerrado: ${lingoteIndices.length} x ${peso}g (${totalPeso}g) a ${formatNum(data.precio)}€/g`);
      const logs = [...(entregaRef.logs || []), log];

      await onUpdateEntrega(entregaId, { lingotes, logs });

      // Log general
      const clienteNombre = getCliente(entregaRef.clienteId)?.nombre || 'Desconocido';
      onAddLogGeneral('cerrar_lingotes', `Cierre de ${clienteNombre}: ${lingoteIndices.length} x ${peso}g (${totalPeso}g) a ${formatNum(data.precio)}€/g`, {
        clienteId: entregaRef.clienteId,
        entregaId,
        totalLingotes: lingoteIndices.length,
        totalPeso,
        precio: data.precio,
        importe: data.precio * totalPeso,
      });
    }

    setShowCierreModal(false);
    setSelectedEntrega(null);
    setSelectedLingoteIdx(null);
    setSelectedLingoteIndices([]);
    setSelectedFuturaId(null);
  };

  const cerrarFutura = async (futuraId, data) => {
    const f = (futuraLingotes || []).find(fl => fl.id === futuraId);
    if (!f) return;
    const pesoNeto = (f.peso || 0) - (data.devolucion || 0);
    await onUpdateFutura(futuraId, {
      euroOnza: data.euroOnza || null,
      base: data.base || null,
      baseCliente: data.baseCliente || null,
      precioJofisa: data.precioJofisa || null,
      importeJofisa: data.importeJofisa || 0,
      margen: data.margen || 0,
      precio: data.precio,
      importe: data.precio * pesoNeto,
      nFactura: data.nFactura || null,
      fechaCierre: data.fechaCierre || null,
    });

    // Log general
    const clienteNombre = getCliente(f.clienteId)?.nombre || 'Desconocido';
    onAddLogGeneral('cerrar_futura', `Cierre FUTURA de ${clienteNombre}: ${f.peso}g a ${formatNum(data.precio)}€/g`, {
      clienteId: f.clienteId,
      futuraId,
      peso: f.peso,
      precio: data.precio,
      importe: data.precio * pesoNeto,
    });

    setShowCierreModal(false);
    setSelectedFuturaId(null);
    setSelectedEntrega(null);
    setSelectedLingoteIdx(null);
  };

  // Cerrar múltiples lingotes FUTURA a la vez
  const cerrarFuturaMultiple = async (futuraIds, data) => {
    let totalPeso = 0;
    let clienteId = null;
    for (const futuraId of futuraIds) {
      const f = (futuraLingotes || []).find(fl => fl.id === futuraId);
      if (!f) continue;
      if (!clienteId) clienteId = f.clienteId;
      const pesoNeto = (f.peso || 0) - (data.devolucion || 0);
      totalPeso += pesoNeto;
      await onUpdateFutura(futuraId, {
        euroOnza: data.euroOnza || null,
        base: data.base || null,
        baseCliente: data.baseCliente || null,
        precioJofisa: data.precioJofisa || null,
        importeJofisa: (data.precioJofisa || 0) * pesoNeto,
        margen: data.margen || 0,
        precio: data.precio,
        importe: data.precio * pesoNeto,
        nFactura: data.nFactura || null,
        fechaCierre: data.fechaCierre || null,
      });
    }

    // Log general
    const clienteNombre = getCliente(clienteId)?.nombre || 'Desconocido';
    onAddLogGeneral('cerrar_futura', `Cierre FUTURA bulk de ${clienteNombre}: ${futuraIds.length} lingotes (${totalPeso}g) a ${formatNum(data.precio)}€/g`, {
      clienteId,
      totalLingotes: futuraIds.length,
      totalPeso,
      precio: data.precio,
      importe: data.precio * totalPeso,
    });

    setShowCierreModal(false);
    setSelectedFuturaId(null);
    setSelectedFuturaIds([]);
    setSelectedEntrega(null);
    setSelectedLingoteIdx(null);
  };

  // Devolver lingotes: marcarlos como devueltos y volver al stock de la exportación
  const devolverLingotes = async (entregaId, lingoteIndices) => {
    const entrega = entregas.find(e => e.id === entregaId);
    if (!entrega) return;
    const lingotes = [...entrega.lingotes];
    const peso = lingotes[lingoteIndices[0]]?.peso || 0;

    for (const idx of lingoteIndices) {
      lingotes[idx] = {
        ...lingotes[idx],
        estado: 'devuelto',
        fechaDevolucion: new Date().toISOString().split('T')[0],
      };
    }

    // Añadir log
    const totalPeso = lingoteIndices.length * peso;
    const log = createLog('devolucion', `Devuelto: ${lingoteIndices.length} x ${peso}g (${totalPeso}g)`);
    const logs = [...(entrega.logs || []), log];

    await onUpdateEntrega(entregaId, { lingotes, logs });

    // Log general
    const clienteNombre = getCliente(entrega.clienteId)?.nombre || 'Desconocido';
    onAddLogGeneral('devolucion', `Devolución de ${clienteNombre}: ${lingoteIndices.length} x ${peso}g (${totalPeso}g)`, {
      clienteId: entrega.clienteId,
      entregaId,
      totalLingotes: lingoteIndices.length,
      totalPeso,
    });
  };

  // Cancelar devolución: volver a poner lingotes en estado 'en_curso' y quitar del stock
  const cancelarDevolucion = async (entregaId, lingoteIdx) => {
    const entrega = entregas.find(e => e.id === entregaId);
    if (!entrega) return;
    const lingotes = [...entrega.lingotes];
    const peso = lingotes[lingoteIdx]?.peso || 0;

    lingotes[lingoteIdx] = {
      ...lingotes[lingoteIdx],
      estado: 'en_curso',
      fechaDevolucion: null,
    };

    // Añadir log
    const log = createLog('cancelar_devolucion', `Cancelada devolución: 1 x ${peso}g`);
    const logs = [...(entrega.logs || []), log];

    await onUpdateEntrega(entregaId, { lingotes, logs });
  };

  const marcarPagado = async (entregaId, lingoteIdx) => {
    const entrega = entregas.find(e => e.id === entregaId);
    if (!entrega) return;
    const lingotes = [...entrega.lingotes];
    const l = lingotes[lingoteIdx];
    let log;
    let logAccion;
    let logDesc;
    if (l.estado === 'pendiente_pago') {
      // Mark as paid → finalizado
      lingotes[lingoteIdx] = { ...l, pagado: true, estado: 'finalizado' };
      log = createLog('pago', `Pagado: 1 x ${l.peso}g (${formatEur(l.importe || 0)})`);
      logAccion = 'marcar_pagado';
      logDesc = `Pago registrado: ${l.peso}g (${formatEur(l.importe || 0)})`;
    } else if (l.estado === 'finalizado') {
      // Unmark paid → back to pendiente_pago
      lingotes[lingoteIdx] = { ...l, pagado: false, estado: 'pendiente_pago' };
      log = createLog('pago', `Desmarcado pago: 1 x ${l.peso}g`);
      logAccion = 'desmarcar_pagado';
      logDesc = `Pago desmarcado: ${l.peso}g`;
    }
    const logs = [...(entrega.logs || []), log];
    await onUpdateEntrega(entregaId, { lingotes, logs });

    // Log general
    const clienteNombre = getCliente(entrega.clienteId)?.nombre || 'Desconocido';
    onAddLogGeneral(logAccion, `${logDesc} de ${clienteNombre}`, {
      clienteId: entrega.clienteId,
      entregaId,
      peso: l.peso,
      importe: l.importe,
    });
  };

  const marcarPagadoFutura = async (futuraId) => {
    const f = (futuraLingotes || []).find(fl => fl.id === futuraId);
    if (!f) return;
    const newPagado = !f.pagado;
    await onUpdateFutura(futuraId, { pagado: newPagado });
  };

  const deleteEntrega = async (entregaId) => {
    if (confirm('Eliminar esta entrega? Los lingotes volverán al stock de la exportación.')) {
      await onDeleteEntrega(entregaId);
    }
  };


  // UI Components
  const getStockColor = (stock) => {
    if (stock < umbralStock.rojo) return { bg: 'from-red-600 via-red-500 to-red-600', text: 'text-red-100', accent: 'text-white' };
    if (stock < umbralStock.naranja) return { bg: 'from-orange-600 via-orange-500 to-orange-600', text: 'text-orange-100', accent: 'text-white' };
    if (stock < umbralStock.amarillo) return { bg: 'from-[var(--warning)] via-yellow-500 to-[var(--warning)]', text: 'text-white/70', accent: 'text-white' };
    return { bg: 'from-emerald-600 via-green-500 to-emerald-600', text: 'text-emerald-100', accent: 'text-white' };
  };

  const Card = ({ children, className = '', onClick }) => (
    <div
      onClick={onClick}
      className={`glass-card p-5 ${onClick ? 'cursor-pointer glass-card-interactive' : ''} ${className}`}
    >
      {children}
    </div>
  );

  const Button = ({ children, onClick, variant = 'primary', size = 'md', className = '', disabled }) => {
    const variants = {
      primary: 'bg-[var(--accent)] text-white hover:bg-[var(--accent-hover)] shadow-[0_1px_3px_rgba(0,0,0,0.04)]',
      secondary: 'bg-[var(--accent-soft)] text-[var(--accent-text)] border border-[var(--accent-border)] hover:bg-[var(--accent-border)]',
      success: 'bg-[var(--success)] text-white hover:opacity-90 shadow-[0_1px_3px_rgba(0,0,0,0.04)]',
      danger: 'bg-[var(--danger-soft)] text-[var(--danger)] border border-[var(--danger-border)] hover:bg-[var(--danger)] hover:text-white',
      ghost: 'text-[var(--text-secondary)] hover:bg-black/[0.04]',
    };
    const sizes = { sm: 'px-3 py-1.5 text-xs', md: 'px-4 py-2 text-sm', lg: 'px-6 py-3 text-base' };
    return (
      <button onClick={onClick} disabled={disabled} className={`${variants[variant]} ${sizes[size]} rounded-[var(--radius-lg)] font-semibold transition-all duration-200 btn-press disabled:opacity-40 ${className}`}>
        {children}
      </button>
    );
  };

  // Stock Overview
  const StockOverview = () => {
    const stockColor = getStockColor(stockRealTotal);
    const [showComposicion, setShowComposicion] = useState(false);

    // Renderizar ClienteDetalle si hay cliente seleccionado
    if (selectedCliente) {
      return <ClienteDetalle />;
    }

    return (
      <div className="space-y-6">
        {/* Stock Ma d'Or + En Clientes lado a lado */}
        <div className="grid grid-cols-2 gap-3">
          {/* Stock Ma d'Or - clickable para desplegar composición */}
          <div
            className={`bg-gradient-to-br ${stockColor.bg} rounded-[var(--radius-xl)] p-4 text-white shadow-lg cursor-pointer transition-transform active:scale-95`}
            onClick={() => stockGlobal.length > 0 && setShowComposicion(!showComposicion)}
          >
            <div className="text-center">
              <div className="text-2xl mb-1">📦</div>
              <div className={`text-4xl font-black ${stockColor.accent}`}>{formatNum(stockRealTotal, 0)}</div>
              <p className={`text-xs ${stockColor.text} mt-1`}>Stock Ma d'Or</p>
              {stockGlobal.length > 0 && (
                <div className={`text-xs ${stockColor.text} mt-2`}>
                  {showComposicion ? '▲ ocultar' : '▼ ver desglose'}
                </div>
              )}
            </div>
          </div>

          {/* En Clientes */}
          <div className="bg-gradient-to-br from-stone-700 via-stone-600 to-stone-700 rounded-[var(--radius-xl)] p-4 text-white shadow-lg">
            <div className="text-center">
              <div className="text-2xl mb-1">👥</div>
              <div className="text-4xl font-black text-[var(--accent)]">{formatNum(stockTotal.stockClientes, 0)}</div>
              <p className="text-xs text-[var(--text-tertiary)] mt-1">En Clientes</p>
            </div>
          </div>
        </div>

        {/* Desglose de stock por tipo con exportaciones - desplegable */}
        {showComposicion && stockGlobal.length > 0 && (
          <div className="bg-white rounded-[var(--radius-xl)] p-4 shadow-[0_1px_3px_rgba(0,0,0,0.04)] border border-black/[0.06] animate-in slide-in-from-top-2">
            <p className="text-xs text-[var(--text-tertiary)] mb-3 font-medium">📦 Composición del stock</p>
            <div className="space-y-2">
              {stockGlobal.map((s, idx) => (
                <div key={idx} className="flex items-center justify-between bg-black/[0.02] rounded-[var(--radius-lg)] px-3 py-2">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-[var(--accent)] text-lg">{s.cantidad}</span>
                    <span className="text-[var(--text-tertiary)]">×</span>
                    <span className="font-semibold text-[var(--text-primary)]">{s.peso}g</span>
                  </div>
                  <div className="flex gap-1 flex-wrap justify-end">
                    {s.exportaciones.map((exp, i) => (
                      <span key={i} className="bg-[var(--accent-soft)] text-[var(--accent-text)] px-2 py-0.5 rounded text-xs font-medium">
                        {exp.nombre} ({exp.cantidad})
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {stockGlobal.length === 0 && (
          <div className="bg-black/[0.04] rounded-[var(--radius-xl)] p-4 text-center">
            <p className="text-[var(--text-tertiary)] text-sm">Sin stock. Crea una exportación.</p>
          </div>
        )}

        {/* FUTURA si existe */}
        {stockTotal.totalFutura > 0 && (
          <div className="bg-gradient-to-br from-red-700 via-red-600 to-red-700 rounded-[var(--radius-xl)] p-4 text-white shadow-lg">
            <div className="text-center">
              <div className="text-2xl mb-1">⚠️</div>
              <div className="text-3xl font-black text-white">-{formatNum(stockTotal.totalFutura, 0)}g</div>
              <p className="text-xs text-red-200 mt-1">FUTURA (vendido sin stock)</p>
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 gap-4">
          {statsClientes.map(cliente => (
            <Card key={cliente.id} onClick={() => setSelectedCliente(cliente.id)} className="relative overflow-hidden">
              <div className="absolute top-0 left-0 w-1.5 h-full" style={{ backgroundColor: cliente.color }} />
              <div className="pl-3">
                <h3 className="font-bold text-[var(--text-primary)] mb-2">{cliente.nombre}</h3>
                <div className="flex items-end justify-between">
                  <div>
                    <div className="text-3xl font-black" style={{ color: cliente.color }}>
                      {formatNum(cliente.enCursoPendiente, 0)}
                      <span className="text-lg font-normal text-[var(--text-tertiary)] ml-1">g</span>
                    </div>
                  </div>
                  <div className="text-right text-xs text-[var(--text-tertiary)]">
                    <div>📦 {formatNum(cliente.enCursoEntregado, 0)}g</div>
                    {cliente.enCursoCerrado > 0 && <div>✅ {formatNum(cliente.enCursoCerrado, 0)}g</div>}
                    {cliente.enCursoDevuelto > 0 && <div>↩️ {formatNum(cliente.enCursoDevuelto, 0)}g</div>}
                    <div>⏳ {formatNum(cliente.enCursoPendiente, 0)}g</div>
                    {cliente.futuraCerradoWeight > 0 && (
                      <div className="text-red-500 font-semibold">-{formatNum(cliente.futuraCerradoWeight, 0)}g FUTURA</div>
                    )}
                  </div>
                </div>
              </div>
            </Card>
          ))}
        </div>

        {statsClientes.length === 0 && (
          <Card>
            <p className="text-[var(--text-tertiary)] text-center py-6">No hay entregas registradas.</p>
          </Card>
        )}

        <Button className="w-full" size="lg" onClick={() => setShowEntregaModal(true)}>
          + Nueva Entrega
        </Button>
      </div>
    );
  };

  // Cliente Detalle
  const ClienteDetalle = () => {
    const cliente = getCliente(selectedCliente);
    if (!cliente) return null;
    const allEntregasCliente = entregas.filter(e => e.clienteId === cliente.id);

    // Count entregas by status
    const countEnCurso = allEntregasCliente.filter(e => isEntregaEnCurso(e)).length;
    const countFinalizadas = allEntregasCliente.filter(e => isEntregaFinalizada(e)).length;

    // Apply filter
    const entregasFiltered = entregaFilter === 'en_curso'
      ? allEntregasCliente.filter(e => isEntregaEnCurso(e))
      : entregaFilter === 'finalizada'
        ? allEntregasCliente.filter(e => isEntregaFinalizada(e))
        : allEntregasCliente;

    // Stats from filtered entregas
    const filteredEntregado = entregasFiltered.reduce((sum, e) => sum + pesoEntrega(e), 0);
    const filteredCerrado = entregasFiltered.reduce((sum, e) => sum + pesoCerrado(e), 0);
    const filteredDevuelto = entregasFiltered.reduce((sum, e) => sum + pesoDevuelto(e), 0);
    const filteredPendiente = filteredEntregado - filteredCerrado - filteredDevuelto;
    const filteredImporte = entregasFiltered.reduce((sum, e) => sum + importeEntrega(e), 0);

    // Stats solo de entregas EN CURSO (para los cuadrados grandes del resumen)
    const entregasEnCursoList = allEntregasCliente.filter(e => isEntregaEnCurso(e));
    const enCursoEntregado = entregasEnCursoList.reduce((sum, e) => sum + pesoEntrega(e), 0);
    const enCursoCerrado = entregasEnCursoList.reduce((sum, e) => sum + pesoCerrado(e), 0);
    const enCursoDevuelto = entregasEnCursoList.reduce((sum, e) => sum + pesoDevuelto(e), 0);
    const enCursoPendiente = enCursoEntregado - enCursoCerrado - enCursoDevuelto;

    // Últimas 3 entregas FINALIZADAS (para las líneas del resumen)
    const entregasFinalizadasList = allEntregasCliente
      .filter(e => isEntregaFinalizada(e))
      .sort((a, b) => (b.fechaEntrega || '').localeCompare(a.fechaEntrega || ''))
      .slice(0, 3);

    // Entregas with en_curso lingotes
    const entregasConEnCurso = entregasFiltered.filter(e => lingotesEnCurso(e).length > 0);

    // FUTURA orphan lingotes for this client
    const clienteFutura = (futuraLingotes || []).filter(f => f.clienteId === cliente.id);
    const futuraWeight = clienteFutura.reduce((sum, f) => sum + (f.peso || 0), 0);

    // All cerrados (pendiente_pago + finalizado) as flat list with entrega info, sorted by entrega date desc
    const entregasCerrados = [...entregasFiltered]
      .sort((a, b) => (b.fechaEntrega || '').localeCompare(a.fechaEntrega || ''))
      .flatMap(e =>
        (e.lingotes || []).map((l, idx) => ({ ...l, entregaId: e.id, lingoteIdx: idx, fechaEntrega: e.fechaEntrega }))
      ).filter(l => l.estado === 'pendiente_pago' || l.estado === 'finalizado');

    // FUTURA cerrados (tienen precio)
    const futuraCerrados = clienteFutura
      .filter(f => f.precio)
      .map(f => ({
        ...f,
        futuraId: f.id,
        isFutura: true,
        estado: f.pagado ? 'finalizado' : 'pendiente_pago',
        importe: f.importe || (f.precio * f.peso),
      }));

    // Combinar entregas cerradas + FUTURA cerrados
    const allLingotesCerrados = [...entregasCerrados, ...futuraCerrados];

    const FilterBtn = ({ id, label, count }) => (
      <button
        onClick={() => setEntregaFilter(id)}
        className={`px-3 py-1.5 rounded-[var(--radius-md)] text-xs font-semibold transition-colors ${
          entregaFilter === id
            ? 'tab-pill-active'
            : 'bg-black/[0.04] text-[var(--text-secondary)] hover:bg-black/[0.06]'
        }`}
      >
        {label} {count > 0 ? `(${count})` : ''}
      </button>
    );

    // Función para exportar PDF del cliente
    const exportarClientePDF = async () => {
      const doc = new jsPDF();
      const pageWidth = doc.internal.pageSize.getWidth();

      // Header con logo imagen
      doc.addImage(LOGO_MADOR_BASE64, 'JPEG', 14, 10, 55, 30);

      // Datos del cliente
      doc.setTextColor(0, 0, 0);
      doc.setFontSize(10);
      let yPos = 50;
      if (cliente.razonSocial) { doc.text(cliente.razonSocial, 14, yPos); yPos += 5; }
      else { doc.text(cliente.nombre, 14, yPos); yPos += 5; }
      if (cliente.direccion) { doc.text(cliente.direccion, 14, yPos); yPos += 5; }
      if (cliente.ciudad) { doc.text(`${cliente.codigoPostal || ''} ${cliente.ciudad}`.trim(), 14, yPos); yPos += 5; }
      if (cliente.pais) { doc.text(cliente.pais, 14, yPos); yPos += 5; }
      if (cliente.nrt) { doc.text(`NRT. ${cliente.nrt}`, 14, yPos); yPos += 5; }

      // Resumen entregas en curso
      yPos += 10;
      doc.setFontSize(11);
      doc.setFont('helvetica', 'bold');
      doc.text('Resumen entregas en curso', pageWidth / 2, yPos, { align: 'center' });
      yPos += 5;

      // Tabla resumen
      const resumenData = entregasEnCursoList.map(e => {
        const nombre = formatEntregaShort(e.fechaEntrega);
        return [nombre, pesoEntrega(e), pesoCerrado(e), pesoEntrega(e) - pesoCerrado(e) - pesoDevuelto(e)];
      });
      // Añadir FUTURA cerrados si hay (cuentan como entregado Y cerrado)
      const futuraCerrados = clienteFutura.filter(f => f.precio);
      if (futuraCerrados.length > 0) {
        const futuraPeso = futuraCerrados.reduce((sum, f) => sum + (f.peso || 0), 0);
        resumenData.push(['FUTURA', futuraPeso, futuraPeso, 0]);
      }
      // Total
      const totalEntregado = resumenData.reduce((sum, r) => sum + r[1], 0);
      const totalCerrado = resumenData.reduce((sum, r) => sum + r[2], 0);
      const totalPendiente = resumenData.reduce((sum, r) => sum + r[3], 0);

      autoTable(doc, {
        startY: yPos,
        head: [['Entregas vivas', 'Peso Entregado', 'Peso Cerrado', 'Pendiente']],
        body: [...resumenData, ['TOTAL', totalEntregado, totalCerrado, totalPendiente]],
        theme: 'grid',
        headStyles: { fillColor: [240, 240, 240], textColor: [0, 0, 0], fontStyle: 'bold', fontSize: 8 },
        bodyStyles: { fontSize: 8 },
        columnStyles: { 0: { cellWidth: 40 }, 1: { halign: 'center' }, 2: { halign: 'center' }, 3: { halign: 'center' } },
        margin: { left: 80 },
        tableWidth: 110,
      });

      yPos = (doc).lastAutoTable.finalY + 15;

      // Detalle de lingotes - TODOS los lingotes con sus datos
      const lingotesData = [];
      entregasEnCursoList.forEach(entrega => {
        const nombreEntrega = formatEntregaShort(entrega.fechaEntrega);
        (entrega.lingotes || []).forEach(l => {
          let estado = '';
          let precio = '';
          let importe = '';
          let fechaCierre = '';
          let pagado = '';

          if (l.estado === 'devuelto') {
            estado = 'DEVUELTO';
          } else if (l.estado === 'pendiente_pago' || l.estado === 'finalizado') {
            precio = l.precio ? formatNum(l.precio) : '';
            importe = l.importe ? formatNum(l.importe, 0) + ' €' : '';
            fechaCierre = l.fechaCierre || '';
            pagado = l.pagado ? '✓' : '';
          }
          // en_curso: sin datos adicionales

          lingotesData.push([
            nombreEntrega,
            `${l.peso}g`,
            estado,
            precio,
            importe,
            fechaCierre,
            pagado,
          ]);
        });
      });
      // Añadir FUTURA cerrados al detalle
      futuraCerrados.forEach(f => {
        lingotesData.push([
          'FUTURA',
          `${f.peso}g`,
          'CERRADO',
          f.precio ? formatNum(f.precio) : '',
          f.precio ? formatNum(f.peso * f.precio, 0) + ' €' : '',
          f.fechaCierre || '',
          f.pagado ? '✓' : '',
        ]);
      });

      if (lingotesData.length > 0) {
        autoTable(doc, {
          startY: yPos,
          head: [['Entrega', 'Peso', 'Estado', '€/g', 'Importe', 'F. Cierre', 'Pag.']],
          body: lingotesData,
          theme: 'grid',
          headStyles: { fillColor: [218, 165, 32], textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 8 },
          bodyStyles: { fontSize: 8 },
          columnStyles: {
            0: { cellWidth: 22 },
            1: { halign: 'center', cellWidth: 18 },
            2: { halign: 'center', cellWidth: 28 },
            3: { halign: 'center', cellWidth: 22 },
            4: { halign: 'right', cellWidth: 28 },
            5: { halign: 'center', cellWidth: 28 },
            6: { halign: 'center', cellWidth: 18 },
          },
        });
        yPos = (doc).lastAutoTable.finalY + 15;
      }

      // Texto legal
      doc.setFontSize(9);
      doc.setFont('helvetica', 'italic');
      doc.text("El client respon de la custòdia, assegurança i de qualsevol pèrdua, robatori, dany o", 14, yPos);
      yPos += 4;
      doc.text("eventualitat dels lingots.", 14, yPos);
      yPos += 15;

      // Firma
      doc.setFont('helvetica', 'normal');
      doc.text("firmat client:", 14, yPos);
      yPos += 5;
      doc.rect(14, yPos, 60, 25);
      yPos += 30;

      // Timestamp de generación
      const now = new Date();
      const timestamp = `arxiu generat a ${now.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: '2-digit' })} a les ${now.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}`;
      doc.setFontSize(7);
      doc.setTextColor(150, 150, 150);
      doc.text(timestamp, 14, yPos);

      // Generar blob y compartir
      const pdfBlob = doc.output('blob');
      const fileName = `Lingotes_${cliente.nombre.replace(/\s+/g, '_')}_${new Date().toISOString().split('T')[0]}.pdf`;
      const file = new File([pdfBlob], fileName, { type: 'application/pdf' });

      if (navigator.share && navigator.canShare({ files: [file] })) {
        try {
          await navigator.share({ files: [file], title: `Lingotes ${cliente.nombre}` });
        } catch (err) {
          if (err.name !== 'AbortError') {
            // Fallback: descargar
            const url = URL.createObjectURL(pdfBlob);
            const a = document.createElement('a');
            a.href = url;
            a.download = fileName;
            a.click();
            URL.revokeObjectURL(url);
          }
        }
      } else {
        // Fallback: descargar directamente
        const url = URL.createObjectURL(pdfBlob);
        const a = document.createElement('a');
        a.href = url;
        a.download = fileName;
        a.click();
        URL.revokeObjectURL(url);
      }
    };

    // Swipe back gesture
    const swipeStartX = React.useRef(null);
    const handleTouchStart = (e) => {
      // Solo detectar swipe desde el borde izquierdo (primeros 30px)
      if (e.touches[0].clientX < 30) {
        swipeStartX.current = e.touches[0].clientX;
      }
    };
    const handleTouchEnd = (e) => {
      if (swipeStartX.current !== null) {
        const swipeEndX = e.changedTouches[0].clientX;
        const swipeDistance = swipeEndX - swipeStartX.current;
        // Si desliza más de 80px hacia la derecha, volver atrás
        if (swipeDistance > 80) {
          setSelectedCliente(null);
        }
        swipeStartX.current = null;
      }
    };

    return (
      <div className="space-y-5" onTouchStart={handleTouchStart} onTouchEnd={handleTouchEnd}>
        <div className="rounded-[var(--radius-xl)] p-5 text-white shadow-lg relative overflow-hidden" style={{ background: `linear-gradient(135deg, ${cliente.color}, ${cliente.color}dd)` }}>
          <button onClick={() => setSelectedCliente(null)} className="absolute top-3 left-3 text-white/80 hover:text-white text-sm flex items-center gap-1 bg-white/20 rounded-[var(--radius-md)] px-2 py-1">
            ← Volver
          </button>
          <div className="text-center pt-6">
            <h2 className="text-xl font-bold mb-1">{cliente.nombre}</h2>
            {/* Cuadrados grandes: stats de entregas EN CURSO + FUTURA cerrados */}
            {(() => {
              // FUTURA cerrados (con precio) - estos cuentan como entregado y cerrado
              const futuraCerrados = clienteFutura.filter(f => f.precio);
              const futuraCerradosWeight = futuraCerrados.reduce((sum, f) => sum + (f.peso || 0), 0);

              // Nombres para mostrar
              const nombresEnCurso = entregasEnCursoList.map(e => {
                return formatEntregaShort(e.fechaEntrega);
              });
              const hasFuturaCerrados = futuraCerrados.length > 0;
              const todosNombres = [...nombresEnCurso, ...(hasFuturaCerrados ? ['FUTURA'] : [])].join(' · ');

              // Stats combinadas: FUTURA cerrados cuentan como entregado Y cerrado (pendiente = 0)
              const totalEntregado = enCursoEntregado + futuraCerradosWeight;
              const totalCerrado = enCursoCerrado + futuraCerradosWeight;
              const totalPendiente = enCursoPendiente; // FUTURA cerrados no tienen pendiente

              return (
                <div className="grid grid-cols-5 gap-2 mt-4">
                  {/* Primera columna: nombres de entregas en curso + FUTURA */}
                  <div className="flex items-center justify-center">
                    <span
                      className="px-1.5 py-0.5 rounded font-bold text-xs"
                      style={{ backgroundColor: entregasEnCursoList[0] ? getEntregaColor(entregasEnCursoList[0].fechaEntrega) + '40' : hasFuturaCerrados ? 'rgba(239,68,68,0.3)' : 'transparent' }}
                    >
                      {todosNombres || '-'}
                    </span>
                  </div>
                  <div className="bg-white/20 rounded-[var(--radius-lg)] p-2 text-center">
                    <div className="text-lg">📦</div>
                    <div className="text-lg font-bold">{formatNum(totalEntregado, 0)}</div>
                    <div className="text-xs text-white/70">Entregado</div>
                  </div>
                  <div className="bg-white/20 rounded-[var(--radius-lg)] p-2 text-center">
                    <div className="text-lg">✅</div>
                    <div className="text-lg font-bold">{formatNum(totalCerrado, 0)}</div>
                    <div className="text-xs text-white/70">Cerrado</div>
                  </div>
                  <div className="bg-white/20 rounded-[var(--radius-lg)] p-2 text-center">
                    <div className="text-lg">↩️</div>
                    <div className="text-lg font-bold">{formatNum(enCursoDevuelto, 0)}</div>
                    <div className="text-xs text-white/70">Devuelto</div>
                  </div>
                  <div className="bg-white/20 rounded-[var(--radius-lg)] p-2 text-center">
                    <div className="text-lg">⏳</div>
                    <div className="text-lg font-bold">{formatNum(totalPendiente, 0)}</div>
                    <div className="text-xs text-white/70">Pendiente</div>
                  </div>
                </div>
              );
            })()}

            {/* Últimas 3 entregas FINALIZADAS */}
            {entregasFinalizadasList.length > 0 && (
              <div className="mt-4 pt-4 border-t border-white/20">
                {/* Header de 5 columnas: Entrega + 4 stats */}
                <div className="grid grid-cols-5 gap-2 px-2 py-1 text-[10px] text-white/50 mb-1">
                  <span className="text-left">Entrega</span>
                  <span className="text-center">📦</span>
                  <span className="text-center">✅</span>
                  <span className="text-center">↩️</span>
                  <span className="text-center">⏳</span>
                </div>
                <div className="space-y-1">
                  {entregasFinalizadasList.map(entrega => {
                      const eEntregado = pesoEntrega(entrega);
                      const eCerrado = pesoCerrado(entrega);
                      const eDevuelto = pesoDevuelto(entrega);
                      const ePendiente = eEntregado - eCerrado - eDevuelto;
                      const exportacion = getExportacion(entrega.exportacionId);
                      const nombreEntrega = `${exportacion?.nombre || ''} ${formatEntregaShort(entrega.fechaEntrega)}`.trim();
                      return (
                        <div key={entrega.id} className="grid grid-cols-5 gap-2 bg-white/10 rounded-[var(--radius-md)] px-2 py-2 items-center">
                          <div className="flex items-center gap-1">
                            <span className="text-green-300 text-[10px]">✓</span>
                            <span
                              className="px-1 py-0.5 rounded font-bold text-[10px] truncate"
                              style={{ backgroundColor: getEntregaColor(entrega.fechaEntrega) + '40', color: 'white' }}
                            >
                              {nombreEntrega}
                            </span>
                          </div>
                          <span className="text-sm text-white/90 text-center">{formatNum(eEntregado, 0)}</span>
                          <span className="text-sm text-white/90 text-center">{formatNum(eCerrado, 0)}</span>
                          <span className="text-sm text-white/90 text-center">{formatNum(eDevuelto, 0)}</span>
                          <span className="text-sm text-white/90 text-center">{formatNum(ePendiente, 0)}</span>
                        </div>
                      );
                    })}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Filter buttons */}
        <div className="flex gap-2 items-center">
          <FilterBtn id="en_curso" label="En Curso" count={countEnCurso} />
          <FilterBtn id="finalizada" label="Finalizadas" count={countFinalizadas} />
          <div className="flex-1" />
          <button
            onClick={exportarClientePDF}
            className="px-3 py-1.5 rounded-[var(--radius-md)] text-xs font-semibold bg-stone-700 text-white hover:bg-stone-800 flex items-center gap-1"
          >
            🪪 Resum Cli.
          </button>
        </div>

        {/* FUTURA pendientes — informativo, se asignan al crear entrega */}
        {(() => {
          if (clienteFutura.length === 0 || stockRealTotal === 0) return null;

          const futuraPorPeso = {};
          clienteFutura.forEach(f => {
            if (!futuraPorPeso[f.peso]) futuraPorPeso[f.peso] = { total: 0, cerrados: 0 };
            futuraPorPeso[f.peso].total++;
            if (f.precio) futuraPorPeso[f.peso].cerrados++;
          });
          const totalWeight = clienteFutura.reduce((sum, f) => sum + (f.peso || 0), 0);

          return (
            <div className="bg-purple-50 border border-purple-200 rounded-[var(--radius-xl)] p-4">
              <div className="flex justify-between items-center mb-2">
                <div className="flex items-center gap-2">
                  <span className="text-lg">⏳</span>
                  <h3 className="font-bold text-purple-800">FUTURA pendientes</h3>
                </div>
                <span className="text-sm text-purple-600 font-semibold">
                  {clienteFutura.length} lingotes · {formatNum(totalWeight, 0)}g
                </span>
              </div>
              <p className="text-xs text-purple-600 mb-2">
                Se asignarán automáticamente al crear una nueva entrega.
              </p>
              {Object.entries(futuraPorPeso).map(([peso, data]) => (
                <div key={peso} className="flex justify-between text-sm py-0.5 px-2">
                  <span className="font-mono text-purple-700">{peso}g × {data.total}</span>
                  {data.cerrados > 0 && (
                    <span className="text-xs text-purple-500">{data.cerrados} cerrados</span>
                  )}
                </div>
              ))}
            </div>
          );
        })()}

        {/* En Curso */}
        {(() => {
          // Mostrar sección si: hay entregas en curso o no hay stock (para poder añadir FUTURA)
          const showEnCurso = entregasConEnCurso.length > 0 || stockRealTotal === 0;

          if (!showEnCurso) return null;

          const totalLingotesEnCurso = entregasConEnCurso.reduce((s, e) => s + lingotesEnCurso(e).length, 0);

          return (
          <Card>
            <div className="flex justify-between items-center mb-4">
              <h3 className="font-bold text-[var(--text-primary)]">En Curso</h3>
              <div className="flex items-center gap-2">
                <span className="text-sm text-[var(--text-tertiary)]">
                  {totalLingotesEnCurso} lingotes
                </span>
                {entregasConEnCurso.length > 1 && (
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => {
                      setMultiCierreSelection({});
                      setShowMultiCierreModal(true);
                    }}
                  >
                    Cerrar múltiples
                  </Button>
                )}
              </div>
            </div>

            <div className="space-y-3">
              {entregasConEnCurso.map(entrega => {
                const exportacion = getExportacion(entrega.exportacionId);
                const enCursoList = lingotesEnCurso(entrega);
                const totalPeso = enCursoList.reduce((s, l) => s + (l.peso || 0), 0);
                const hasCerrados = lingotesCerrados(entrega).length > 0;

                // Agrupar lingotes en_curso por peso
                const porPeso = {};
                entrega.lingotes.forEach((l, idx) => {
                  if (l.estado !== 'en_curso') return;
                  if (!porPeso[l.peso]) porPeso[l.peso] = { peso: l.peso, indices: [] };
                  porPeso[l.peso].indices.push(idx);
                });
                const grupos = Object.values(porPeso);

                return (
                  <div key={entrega.id} className="p-3 rounded-[var(--radius-lg)] bg-[var(--accent-soft)] border border-[var(--accent-border)]">
                    {/* Header: Fecha grande a la izquierda, summary + X a la derecha */}
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <span
                          className="px-2 py-1 rounded-[var(--radius-md)] font-bold text-base"
                          style={{ backgroundColor: getEntregaColor(entrega.fechaEntrega) + '20', color: getEntregaColor(entrega.fechaEntrega) }}
                        >{formatEntregaShort(entrega.fechaEntrega)}</span>
                        {exportacion && <span className="text-sm text-[var(--text-tertiary)]">• Exp: {exportacion.nombre}</span>}
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-sm text-[var(--text-secondary)]">{enCursoList.length} x {enCursoList[0]?.peso || '?'}g = {totalPeso}g</span>
                        {!hasCerrados && (
                          <Button size="sm" variant="danger" onClick={() => deleteEntrega(entrega.id)}>x</Button>
                        )}
                      </div>
                    </div>

                    {/* Sección CERRAR */}
                    <div className="mb-2">
                      <div className="text-xs font-semibold text-[var(--text-tertiary)] mb-1">Cerrar</div>
                      {grupos.map(grupo => {
                        const key = `${entrega.id}_${grupo.peso}`;
                        const cantidad = cierreCantidad[key] || 1;
                        const maxCantidad = grupo.indices.length;
                        const quickOptions = [1, 2, 4].filter(n => n <= maxCantidad);

                        const handleCerrar = () => {
                          const indicesToClose = grupo.indices.slice(0, cantidad);
                          setSelectedEntrega(entrega);
                          setSelectedLingoteIndices(indicesToClose);
                          setSelectedLingoteIdx(indicesToClose[0]);
                          setShowCierreModal(true);
                        };

                        return (
                          <div key={grupo.peso} className="flex items-center justify-between bg-white/60 rounded-[var(--radius-md)] p-2 mb-1">
                            <span className="font-mono font-semibold text-[var(--text-primary)]">{maxCantidad} x {grupo.peso}g</span>
                            <div className="flex items-center gap-2">
                              <div className="flex items-center gap-1">
                                {quickOptions.map(n => (
                                  <button
                                    key={n}
                                    onClick={() => setCierreCantidad({ ...cierreCantidad, [key]: n })}
                                    className={`w-7 h-7 rounded-[var(--radius-md)] text-xs font-bold transition-colors ${
                                      cantidad === n
                                        ? 'bg-[var(--accent)] text-white'
                                        : 'bg-black/[0.04] text-[var(--text-secondary)] hover:bg-black/[0.06]'
                                    }`}
                                  >
                                    {n}
                                  </button>
                                ))}
                                {maxCantidad > 1 && (
                                  <input
                                    type="number"
                                    inputMode="numeric"
                                    min="1"
                                    max={maxCantidad}
                                    value={cantidad}
                                    onChange={(e) => setCierreCantidad({ ...cierreCantidad, [key]: Math.min(maxCantidad, Math.max(1, parseInt(e.target.value) || 1)) })}
                                    className={`w-12 h-7 rounded-[var(--radius-md)] border text-center text-xs font-bold focus:outline-none focus:ring-2 focus:ring-[var(--accent)] ${
                                      !quickOptions.includes(cantidad) ? 'border-[var(--accent)] bg-[var(--accent-soft)]' : 'border-black/[0.08]'
                                    }`}
                                  />
                                )}
                              </div>
                              <button
                                onClick={handleCerrar}
                                className="px-3 py-1.5 text-xs rounded-[var(--radius-lg)] font-semibold bg-emerald-500 text-white hover:bg-emerald-600 transition-colors"
                              >
                                Cerrar {cantidad > 1 ? `(${cantidad})` : ''}
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    {/* Sección DEVOLVER */}
                    <div>
                      <div className="text-xs font-semibold text-[var(--text-tertiary)] mb-1">Devolver</div>
                      {grupos.map(grupo => {
                        const key = `${entrega.id}_${grupo.peso}_dev`;
                        const cantidad = devolucionCantidad[key] || 1;
                        const maxCantidad = grupo.indices.length;
                        const quickOptions = [1, 2, 4].filter(n => n <= maxCantidad);

                        const handleDevolver = () => {
                          if (confirm(`¿Devolver ${cantidad} lingote${cantidad > 1 ? 's' : ''} de ${grupo.peso}g?`)) {
                            const indicesToReturn = grupo.indices.slice(0, cantidad);
                            devolverLingotes(entrega.id, indicesToReturn);
                          }
                        };

                        return (
                          <div key={grupo.peso} className="flex items-center justify-between bg-red-50/50 rounded-[var(--radius-md)] p-2 mb-1">
                            <span className="font-mono font-semibold text-[var(--text-primary)]">{maxCantidad} x {grupo.peso}g</span>
                            <div className="flex items-center gap-2">
                              <div className="flex items-center gap-1">
                                {quickOptions.map(n => (
                                  <button
                                    key={n}
                                    onClick={() => setDevolucionCantidad({ ...devolucionCantidad, [key]: n })}
                                    className={`w-7 h-7 rounded-[var(--radius-md)] text-xs font-bold transition-colors ${
                                      cantidad === n
                                        ? 'bg-red-500 text-white'
                                        : 'bg-black/[0.04] text-[var(--text-secondary)] hover:bg-black/[0.06]'
                                    }`}
                                  >
                                    {n}
                                  </button>
                                ))}
                                {maxCantidad > 1 && (
                                  <input
                                    type="number"
                                    inputMode="numeric"
                                    min="1"
                                    max={maxCantidad}
                                    value={cantidad}
                                    onChange={(e) => setDevolucionCantidad({ ...devolucionCantidad, [key]: Math.min(maxCantidad, Math.max(1, parseInt(e.target.value) || 1)) })}
                                    className={`w-12 h-7 rounded-[var(--radius-md)] border text-center text-xs font-bold focus:outline-none focus:ring-2 focus:ring-red-400 ${
                                      !quickOptions.includes(cantidad) ? 'border-red-400 bg-red-50' : 'border-black/[0.08]'
                                    }`}
                                  />
                                )}
                              </div>
                              <button
                                onClick={handleDevolver}
                                className="px-3 py-1.5 text-xs rounded-[var(--radius-lg)] font-semibold bg-red-500 text-white hover:bg-red-600 transition-colors"
                              >
                                Devolver {cantidad > 1 ? `(${cantidad})` : ''}
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    {/* Lista de lingotes devueltos */}
                    {(() => {
                      const devueltos = lingotesDevueltos(entrega);
                      if (devueltos.length === 0) return null;
                      return (
                        <div className="mt-3 pt-3 border-t border-[var(--accent-border)]">
                          <div className="text-xs font-semibold text-[var(--text-tertiary)] mb-2">Devueltos ({devueltos.length})</div>
                          <div className="space-y-1">
                            {entrega.lingotes.map((l, idx) => {
                              if (l.estado !== 'devuelto') return null;
                              const log = (entrega.logs || []).find(log =>
                                log.tipo === 'devolucion' &&
                                log.descripcion.includes(`${l.peso}g`)
                              );
                              return (
                                <div key={idx} className="flex items-center justify-between bg-red-50 rounded-[var(--radius-md)] p-2 text-xs">
                                  <div>
                                    <span className="font-mono font-semibold text-red-700">{l.peso}g</span>
                                    <span className="text-[var(--text-tertiary)] ml-2">
                                      {l.fechaDevolucion || '-'}
                                      {log && ` • ${log.usuario}`}
                                    </span>
                                  </div>
                                  <button
                                    onClick={() => {
                                      if (confirm(`¿Cancelar devolución del lingote de ${l.peso}g?`)) {
                                        cancelarDevolucion(entrega.id, idx);
                                      }
                                    }}
                                    className="w-6 h-6 rounded-full bg-red-100 text-red-500 hover:bg-red-200 flex items-center justify-center font-bold"
                                  >
                                    ×
                                  </button>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                );
              })}
            </div>

            {/* FUTURA dentro de En Curso - solo cuando no hay stock */}
            {stockRealTotal === 0 && (
              <div className="p-3 rounded-[var(--radius-lg)] bg-red-50 border-2 border-red-300 mt-3">
                {/* Header: Etiqueta FUTURA */}
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <span className="px-2 py-1 rounded-[var(--radius-md)] font-bold text-base bg-red-100 text-red-700">FUTURA</span>
                    <span className="text-xs text-red-600">Sin stock físico</span>
                  </div>
                </div>

                {/* Selector directo: cantidad + peso + Cerrar */}
                <div className="flex items-center justify-between bg-white/60 rounded-[var(--radius-md)] p-2">
                  <div className="flex items-center gap-2">
                    <div className="flex items-center gap-1">
                      {[1, 2, 4].map(n => (
                        <button
                          key={n}
                          onClick={() => setFuturaCierreCantidad({ ...futuraCierreCantidad, [`new_${cliente.id}`]: n })}
                          className={`w-7 h-7 rounded-[var(--radius-md)] text-xs font-bold transition-colors ${
                            (futuraCierreCantidad[`new_${cliente.id}`] || 1) === n
                              ? 'bg-red-500 text-white'
                              : 'bg-black/[0.04] text-[var(--text-secondary)] hover:bg-black/[0.06]'
                          }`}
                        >
                          {n}
                        </button>
                      ))}
                      <input
                        type="number"
                        inputMode="numeric"
                        min="1"
                        max={99}
                        value={futuraCierreCantidad[`new_${cliente.id}`] || 1}
                        onChange={(e) => setFuturaCierreCantidad({ ...futuraCierreCantidad, [`new_${cliente.id}`]: Math.min(99, Math.max(1, parseInt(e.target.value) || 1)) })}
                        className={`w-12 h-7 rounded-[var(--radius-md)] border text-center text-xs font-bold focus:outline-none focus:ring-2 focus:ring-red-400 ${
                          ![1, 2, 4].includes(futuraCierreCantidad[`new_${cliente.id}`] || 1) ? 'border-red-400 bg-red-50' : 'border-black/[0.08]'
                        }`}
                      />
                    </div>
                    <span className="text-xs text-[var(--text-tertiary)]">x</span>
                    <select
                      value={futuraCierreCantidad[`newPeso_${cliente.id}`] || 50}
                      onChange={(e) => setFuturaCierreCantidad({ ...futuraCierreCantidad, [`newPeso_${cliente.id}`]: parseInt(e.target.value) })}
                      className="h-7 rounded-[var(--radius-md)] border border-black/[0.08] text-xs font-bold px-2 focus:outline-none focus:ring-2 focus:ring-red-400"
                    >
                      <option value={50}>50g</option>
                      <option value={100}>100g</option>
                    </select>
                  </div>
                  <Button
                    size="sm"
                    variant="success"
                    onClick={() => {
                      // Abrir modal de nuevo FUTURA (pedirá precio antes de crear)
                      setNewFuturaData({
                        clienteId: cliente.id,
                        cantidad: futuraCierreCantidad[`new_${cliente.id}`] || 1,
                        peso: futuraCierreCantidad[`newPeso_${cliente.id}`] || 50,
                      });
                      setShowNewFuturaModal(true);
                    }}
                  >
                    Cerrar {(futuraCierreCantidad[`new_${cliente.id}`] || 1) > 1 ? `(${futuraCierreCantidad[`new_${cliente.id}`]})` : ''}
                  </Button>
                </div>
              </div>
            )}
          </Card>
          );
        })()}

        {/* Cerrados agrupados por entrega */}
        {allLingotesCerrados.length > 0 && (
          <Card>
            <div className="flex justify-between items-center mb-4">
              <h3 className="font-bold text-[var(--text-primary)]">Cerrados ({allLingotesCerrados.length})</h3>
              <div className="flex items-center gap-3">
                {allLingotesCerrados.filter(l => !l.nFactura).length > 0 && (
                  <Button
                    size="sm"
                    onClick={() => {
                      setFacturaSelection({});
                      setFacturaFile(null);
                      setShowFacturaModal(true);
                    }}
                  >
                    + Subir factura
                  </Button>
                )}
                <div className="text-sm text-[var(--text-tertiary)]">
                  Importe: <span className="font-semibold text-emerald-600">{formatEur(allLingotesCerrados.reduce((s, l) => s + (l.importe || 0), 0))}</span>
                </div>
              </div>
            </div>
            {(() => {
              // Separar FUTURA de entregas normales
              const lingotesEntregas = allLingotesCerrados.filter(l => !l.isFutura);
              const lingotesFutura = allLingotesCerrados.filter(l => l.isFutura);

              // Agrupar entregas por entregaId
              const porEntrega = {};
              lingotesEntregas.forEach(l => {
                if (!porEntrega[l.entregaId]) {
                  porEntrega[l.entregaId] = { fechaEntrega: l.fechaEntrega, lingotes: [] };
                }
                porEntrega[l.entregaId].lingotes.push(l);
              });

              const renderTabla = (lingotes, isFutura = false) => (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-black/[0.06]">
                        <th className="text-left py-1.5 px-1 text-[var(--text-tertiary)] font-medium text-xs">Cierre</th>
                        <th className="text-right py-1.5 px-1 text-[var(--text-tertiary)] font-medium text-xs">Peso</th>
                        <th className="text-right py-1.5 px-1 text-[var(--text-tertiary)] font-medium text-xs">€/g</th>
                        <th className="text-right py-1.5 px-1 text-[var(--text-tertiary)] font-medium text-xs">Importe</th>
                        <th className="text-center py-1.5 px-1 text-[var(--text-tertiary)] font-medium text-xs w-10">Pag</th>
                        <th className="text-left py-1.5 px-1 text-[var(--text-tertiary)] font-medium text-xs">Fra</th>
                      </tr>
                    </thead>
                    <tbody>
                      {lingotes.map((l, i) => (
                        <tr key={i} className={`border-b border-stone-100 ${l.estado === 'pendiente_pago' ? 'bg-[var(--accent-soft)]/50' : 'hover:bg-black/[0.02]'}`}>
                          <td className="py-1.5 px-1 text-[10px] text-[var(--text-tertiary)]">{formatFechaCierre(l.fechaCierre)}</td>
                          <td className="py-1.5 px-1 text-right font-mono text-xs">{l.peso}g</td>
                          <td className="py-1.5 px-1 text-right font-mono text-xs">{formatNum(l.precio)}</td>
                          <td className="py-1.5 px-1 text-right font-mono font-semibold text-xs">{formatEur(l.importe || 0)}</td>
                          <td className="py-1.5 px-1 text-center">
                            <button
                              onClick={() => isFutura ? marcarPagadoFutura(l.futuraId) : marcarPagado(l.entregaId, l.lingoteIdx)}
                              className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition-colors text-xs ${
                                l.pagado ? 'bg-emerald-500 border-emerald-500 text-white' : 'border-black/[0.08] hover:border-emerald-400'
                              }`}
                            >
                              {l.pagado && '✓'}
                            </button>
                          </td>
                          <td className="py-1.5 px-1 text-left">
                            {l.nFactura ? (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  const factura = (facturas || []).find(f => f.id === l.nFactura);
                                  if (factura) setViewingFactura(factura);
                                }}
                                className="text-blue-500 hover:text-blue-700 text-xs flex items-center gap-1"
                                title="Ver factura"
                              >
                                <span>📄</span>
                                <span className="font-mono truncate max-w-[80px]">
                                  {(() => {
                                    const factura = (facturas || []).find(f => f.id === l.nFactura);
                                    return factura?.nombre?.replace(/\.pdf$/i, '') || '';
                                  })()}
                                </span>
                              </button>
                            ) : (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setFacturaSelection({});
                                  setFacturaFile(null);
                                  setShowFacturaModal(true);
                                }}
                                className="text-red-400 hover:text-red-600 text-sm cursor-pointer"
                                title="Subir factura"
                              >
                                ⚠️
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              );

              return (
                <>
                  {/* Entregas normales agrupadas */}
                  {Object.entries(porEntrega).map(([entregaId, grupo]) => (
                    <div key={entregaId} className="mb-4 last:mb-0">
                      <div className="flex items-center gap-2 mb-2">
                        <span
                          className="px-2 py-1 rounded-[var(--radius-md)] font-bold text-sm"
                          style={{ backgroundColor: getEntregaColor(grupo.fechaEntrega) + '20', color: getEntregaColor(grupo.fechaEntrega) }}
                        >{formatEntregaShort(grupo.fechaEntrega)}</span>
                        <span className="text-xs text-[var(--text-tertiary)]">{grupo.lingotes.length} lingotes</span>
                      </div>
                      {renderTabla(grupo.lingotes, false)}
                    </div>
                  ))}

                  {/* FUTURA cerrados */}
                  {lingotesFutura.length > 0 && (
                    <div className="mb-4 last:mb-0">
                      <div className="flex items-center gap-2 mb-2">
                        <span className="px-2 py-1 rounded-[var(--radius-md)] font-bold text-sm bg-red-100 text-red-700">
                          FUTURA
                        </span>
                        <span className="text-xs text-[var(--text-tertiary)]">{lingotesFutura.length} lingotes</span>
                      </div>
                      {renderTabla(lingotesFutura, true)}
                    </div>
                  )}
                </>
              );
            })()}
          </Card>
        )}

        {entregasFiltered.length === 0 && clienteFutura.length === 0 && (
          <Card>
            <p className="text-[var(--text-tertiary)] text-center py-6 text-sm">
              {entregaFilter === 'en_curso' ? 'No hay entregas en curso' : entregaFilter === 'finalizada' ? 'No hay entregas finalizadas' : 'No hay entregas'}
            </p>
          </Card>
        )}


        {/* Botón Nueva Entrega - solo si hay stock */}
        {(stockRealTotal > 0 || filteredPendiente > 0) && (
          <Button className="w-full" size="lg" onClick={() => { setEditingEntregaClienteId(cliente.id); setShowEntregaModal(true); }}>
            + Nueva Entrega
          </Button>
        )}

        {/* Historial de actividad */}
        {(() => {
          // Recopilar todos los logs de todas las entregas del cliente
          const allLogs = allEntregasCliente
            .flatMap(e => (e.logs || []).map(log => ({ ...log, entregaId: e.id, fechaEntrega: e.fechaEntrega })))
            .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
            .slice(0, 20); // Últimos 20 logs

          if (allLogs.length === 0) return null;

          const formatLogTime = (timestamp) => {
            const d = new Date(timestamp);
            const day = d.getDate();
            const month = d.getMonth() + 1;
            const hours = d.getHours().toString().padStart(2, '0');
            const mins = d.getMinutes().toString().padStart(2, '0');
            return `${day}/${month} ${hours}:${mins}`;
          };

          const getLogIcon = (tipo) => {
            switch (tipo) {
              case 'entrega': return '📦';
              case 'cierre': return '✅';
              case 'devolucion': return '↩️';
              case 'cancelar_devolucion': return '🔄';
              case 'pago': return '💰';
              default: return '📝';
            }
          };

          const getLogColor = (tipo) => {
            switch (tipo) {
              case 'entrega': return 'bg-blue-50 border-blue-200';
              case 'cierre': return 'bg-emerald-50 border-emerald-200';
              case 'devolucion': return 'bg-red-50 border-red-200';
              case 'cancelar_devolucion': return 'bg-orange-50 border-orange-200';
              case 'pago': return 'bg-green-50 border-green-200';
              default: return 'bg-black/[0.02] border-black/[0.06]';
            }
          };

          return (
            <>
            <Card className="mt-4">
              <button
                onClick={() => setShowHistorial(!showHistorial)}
                className="w-full flex items-center justify-between"
              >
                <h3 className="font-bold text-[var(--text-primary)]">Historial ({allLogs.length})</h3>
                <span className="text-[var(--text-tertiary)] text-sm">{showHistorial ? '▲' : '▼'}</span>
              </button>
              {showHistorial && (
                <div className="space-y-2 max-h-64 overflow-y-auto mt-3">
                  {allLogs.map((log, i) => (
                    <div key={log.id || i} className={`flex items-start gap-2 p-2 rounded-[var(--radius-md)] border ${getLogColor(log.tipo)}`}>
                      <span className="text-sm">{getLogIcon(log.tipo)}</span>
                      <div className="flex-1 min-w-0">
                        <div className="text-xs text-[var(--text-primary)]">{log.descripcion}</div>
                        <div className="text-[10px] text-[var(--text-tertiary)] flex items-center gap-2 flex-wrap">
                          <span>{formatLogTime(log.timestamp)}</span>
                          <span>•</span>
                          <span className="font-semibold text-[var(--text-secondary)]">{log.usuario}</span>
                          {log.fechaEntrega && (
                            <>
                              <span>•</span>
                              <span
                                className="px-1 py-0.5 rounded font-bold"
                                style={{ backgroundColor: getEntregaColor(log.fechaEntrega) + '20', color: getEntregaColor(log.fechaEntrega) }}
                              >{formatEntregaShort(log.fechaEntrega)}</span>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Card>
            </>
          );
        })()}
      </div>
    );
  };

  // Exportaciones View
  const ExportacionesView = () => {
    const [showNew, setShowNew] = useState(false);
    const [editingExp, setEditingExp] = useState(null); // null or exportacion object
    const [uploadingFactura, setUploadingFactura] = useState(null); // exportacion id being uploaded
    const defaultFecha = new Date().toISOString().split('T')[0];
    const defaultAno = new Date().getFullYear().toString();
    const defaultLingotes = [{ cantidad: 1, peso: 50 }];
    const [formData, setFormData] = useState({ nombre: '', fecha: defaultFecha, ano: defaultAno, lingotes: defaultLingotes, precioGramo: '' });

    // Años disponibles para selector
    const anosDisponibles = ['2024', '2025', '2026', '2027', '2028'];

    const resetForm = () => {
      setFormData({ nombre: '', fecha: defaultFecha, ano: defaultAno, lingotes: [{ cantidad: 1, peso: 50 }], precioGramo: '' });
    };

    const openNew = () => {
      resetForm();
      setEditingExp(null);
      setShowNew(true);
    };

    const openEdit = (expId) => {
      // Always get the original from exportaciones array to avoid stale data
      const exp = exportaciones.find(e => e.id === expId);
      if (!exp) return;
      setFormData({
        nombre: exp.nombre || '',
        fecha: exp.fecha || defaultFecha,
        ano: exp.ano || defaultAno,
        lingotes: exp.lingotes && exp.lingotes.length > 0 ? exp.lingotes.map(l => ({ ...l })) : [{ cantidad: 1, peso: 50 }],
        precioGramo: exp.precioGramo ? String(exp.precioGramo) : '',
      });
      setEditingExp(exp);
      setShowNew(true);
    };

    const handleCancel = () => {
      const isEditing = !!editingExp;
      const original = isEditing ? {
        nombre: editingExp.nombre || '',
        fecha: editingExp.fecha || defaultFecha,
        ano: editingExp.ano || defaultAno,
        lingotes: editingExp.lingotes || [{ cantidad: 1, peso: 50 }],
        precioGramo: editingExp.precioGramo ? String(editingExp.precioGramo) : '',
      } : { nombre: '', fecha: defaultFecha, ano: defaultAno, lingotes: defaultLingotes, precioGramo: '' };

      const hasChanges = formData.nombre !== original.nombre ||
        formData.fecha !== original.fecha ||
        formData.ano !== original.ano ||
        formData.precioGramo !== original.precioGramo ||
        JSON.stringify(formData.lingotes) !== JSON.stringify(original.lingotes);

      if (hasChanges && !confirm('¿Descartar los cambios?')) return;
      setShowNew(false);
      setEditingExp(null);
      resetForm();
    };

    // Check if exportacion has been used (any entregas reference it)
    const editingExpHasBeenUsed = editingExp
      ? entregas.some(e => e.exportacionId === editingExp.id)
      : false;

    // Calculate totals from lingotes array
    const calcTotals = (lingotes) => {
      const totalLingotes = lingotes.reduce((sum, l) => sum + (parseInt(l.cantidad) || 0), 0);
      const totalGramos = lingotes.reduce((sum, l) => sum + ((parseInt(l.cantidad) || 0) * (parseFloat(l.peso) || 0)), 0);
      return { totalLingotes, totalGramos };
    };

    const { totalLingotes: formTotalLingotes, totalGramos: formTotalGramos } = calcTotals(formData.lingotes);
    const formTotalFactura = formData.precioGramo ? formTotalGramos * parseFloat(formData.precioGramo) : 0;

    const addLingoteTipo = () => {
      setFormData({ ...formData, lingotes: [...formData.lingotes, { cantidad: 1, peso: 50 }] });
    };

    const removeLingoteTipo = (idx) => {
      if (formData.lingotes.length > 1) {
        setFormData({ ...formData, lingotes: formData.lingotes.filter((_, i) => i !== idx) });
      }
    };

    const updateLingoteTipo = (idx, field, value) => {
      const updated = [...formData.lingotes];
      updated[idx] = { ...updated[idx], [field]: value };
      setFormData({ ...formData, lingotes: updated });
    };

    const exportacionesStats = useMemo(() => {
      // Ordenar descendente por fecha o nombre
      const sorted = [...exportaciones].sort((a, b) => {
        // Primero por fecha si existe
        if (a.fecha && b.fecha) return b.fecha.localeCompare(a.fecha);
        // Si no hay fecha, por nombre descendente
        return (b.nombre || '').localeCompare(a.nombre || '');
      });
      return sorted.map(exp => {
        const entregasExp = entregas.filter(e => e.exportacionId === exp.id);
        const totalEntregado = entregasExp.reduce((sum, e) => sum + pesoEntrega(e), 0);
        const totalCerrado = entregasExp.reduce((sum, e) => sum + pesoCerrado(e), 0);
        const totalDevuelto = entregasExp.reduce((sum, e) => sum + pesoDevuelto(e), 0);
        const totalPendiente = totalEntregado - totalCerrado - totalDevuelto;
        const totalImporte = entregasExp.reduce((sum, e) => sum + importeEntrega(e), 0);
        const totalLingotes = entregasExp.reduce((sum, e) => sum + numLingotes(e), 0);

        // Calculate stock disponible (calculated, not from exp.lingotes)
        const stockLingotes = getStockDisponible(exp.id);
        const stockTotal = stockLingotes.reduce((sum, l) => sum + ((l.cantidad || 0) * (l.peso || 0)), 0);
        const stockCount = stockLingotes.reduce((sum, l) => sum + (l.cantidad || 0), 0);

        // Calculate factura total
        const facturaTotal = exp.precioGramo ? exp.grExport * exp.precioGramo : 0;

        const porCliente = clientes.map(c => {
          const ec = entregasExp.filter(e => e.clienteId === c.id);
          return {
            ...c,
            entregado: ec.reduce((sum, e) => sum + pesoEntrega(e), 0),
            cerrado: ec.reduce((sum, e) => sum + pesoCerrado(e), 0),
            devuelto: ec.reduce((sum, e) => sum + pesoDevuelto(e), 0),
            pendiente: ec.reduce((sum, e) => sum + pesoEntrega(e), 0) - ec.reduce((sum, e) => sum + pesoCerrado(e), 0) - ec.reduce((sum, e) => sum + pesoDevuelto(e), 0),
          };
        }).filter(c => c.entregado > 0);

        // Has been used = stock actual menor que original
        // Si grExport no existe, no podemos saber → asumimos no usado
        const hasBeenUsed = exp.grExport ? stockTotal < exp.grExport : false;

        return { ...exp, totalEntregado, totalCerrado, totalDevuelto, totalPendiente, totalImporte, totalLingotes, porCliente, stockTotal, stockCount, facturaTotal, hasBeenUsed };
      });
    }, [exportaciones, entregas, clientes, stockDisponiblePorExp]);

    const saveExportacion = async () => {
      if (formData.nombre && formTotalLingotes > 0) {
        const validLingotes = formData.lingotes.filter(l => l.cantidad > 0 && l.peso > 0);
        const grExport = validLingotes.reduce((sum, l) => sum + (l.cantidad * l.peso), 0);
        const data = {
          nombre: formData.nombre,
          grExport,
          fecha: formData.fecha,
          ano: formData.ano,
          lingotes: validLingotes,
          precioGramo: formData.precioGramo ? parseFloat(formData.precioGramo) : null,
        };

        if (editingExp) {
          // Keep existing factura if editing
          if (editingExp.factura) {
            data.factura = editingExp.factura;
          }
          await onSaveExportacion(data, editingExp.id);

          // Log general edición
          onAddLogGeneral('editar_exportacion', `Exportación editada: ${data.nombre} (${grExport}g)`, {
            exportacionId: editingExp.id,
            nombre: data.nombre,
            grExport,
          });
        } else {
          await onSaveExportacion(data);

          // Log general creación
          onAddLogGeneral('crear_exportacion', `Exportación creada: ${data.nombre} (${grExport}g)`, {
            nombre: data.nombre,
            grExport,
          });

          // Check if there are FUTURA lingotes pending assignment
          const totalFutura = (futuraLingotes || []).length;
          if (totalFutura > 0) {
            // Group by client
            const futuraByClient = {};
            (futuraLingotes || []).forEach(f => {
              const cliente = getCliente(f.clienteId);
              const nombre = cliente?.nombre || 'Desconocido';
              if (!futuraByClient[nombre]) futuraByClient[nombre] = [];
              futuraByClient[nombre].push(f);
            });
            const clientesList = Object.entries(futuraByClient)
              .map(([nombre, lingotes]) => `${nombre}: ${lingotes.length} lingotes (${formatNum(lingotes.reduce((s,l) => s + (l.peso||0), 0), 0)}g)`)
              .join('\n');

            alert(`Hay ${totalFutura} lingotes FUTURA pendientes de asignar:\n\n${clientesList}\n\nPuedes asignarlos desde la ficha de cada cliente.`);
          }
        }

        setShowNew(false);
        setEditingExp(null);
        resetForm();
      }
    };

    // Handle factura upload
    const handleFacturaUpload = async (expId, file) => {
      if (!file) return;
      setUploadingFactura(expId);
      try {
        // Comprimir imagen si es necesario
        const comprimido = await comprimirImagen(file, 500);
        const exp = exportaciones.find(ex => ex.id === expId);
        if (exp) {
          await onSaveExportacion({
            ...exp,
            factura: {
              nombre: comprimido.name,
              tipo: comprimido.type,
              data: comprimido.data,
              fecha: new Date().toISOString(),
            }
          }, expId);
        }
        setUploadingFactura(null);
      } catch (err) {
        console.error('Error uploading factura:', err);
        alert('Error al subir factura: ' + err.message);
        setUploadingFactura(null);
      }
    };

    const removeFactura = async (exp) => {
      if (!confirm('¿Eliminar la factura?')) return;
      const { factura, ...rest } = exp;
      await onSaveExportacion({ ...rest, factura: null }, exp.id);
    };

    return (
      <div className="space-y-6">
        <div className="flex justify-between items-center">
          <h2 className="text-xl font-bold text-[var(--text-primary)]">Importaciones</h2>
          <Button size="sm" onClick={openNew}>+ Nueva</Button>
        </div>

        {showNew && !editingExp && (
          <Card className="border-[var(--accent)] bg-[var(--accent-soft)]">
            <h3 className="font-bold text-[var(--text-primary)] mb-4">Nueva Importación</h3>
            <div className="space-y-4">
              <div className="flex gap-3">
                <div className="flex-1">
                  <label className="block text-sm font-medium text-[var(--text-primary)] mb-1">Nombre</label>
                  <input type="text" value={formData.nombre} onChange={(e) => setFormData({ ...formData, nombre: e.target.value })} placeholder="Ej: 28-1" className="w-full border border-black/[0.08] rounded-[var(--radius-lg)] px-4 py-2 focus:outline-none focus:ring-2 focus:ring-[var(--accent)]" />
                </div>
                <div className="w-24">
                  <label className="block text-sm font-medium text-[var(--text-primary)] mb-1">Año</label>
                  <select value={formData.ano} onChange={(e) => setFormData({ ...formData, ano: e.target.value })} className="w-full border border-black/[0.08] rounded-[var(--radius-lg)] px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[var(--accent)]">
                    {anosDisponibles.map(a => <option key={a} value={a}>{a}</option>)}
                  </select>
                </div>
                <div className="w-36">
                  <label className="block text-sm font-medium text-[var(--text-primary)] mb-1">Fecha</label>
                  <input type="date" value={formData.fecha} onChange={(e) => setFormData({ ...formData, fecha: e.target.value })} className="w-full border border-black/[0.08] rounded-[var(--radius-lg)] px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[var(--accent)]" />
                </div>
              </div>

              {/* Lingotes breakdown */}
              <div>
                <label className="block text-sm font-medium text-[var(--text-primary)] mb-2">Lingotes comprados</label>
                {editingExpHasBeenUsed && (
                  <div className="bg-orange-100 border border-orange-300 rounded-[var(--radius-lg)] p-2 mb-2 text-xs text-orange-700">
                    ⚠️ No se pueden modificar los lingotes porque ya se han usado de esta exportación.
                  </div>
                )}
                <div className={`space-y-2 ${editingExpHasBeenUsed ? 'opacity-50 pointer-events-none' : ''}`}>
                  {formData.lingotes.map((l, idx) => (
                    <div key={idx} className="flex items-center gap-2 flex-wrap">
                      <input
                        type="number"
                        inputMode="numeric"
                        value={l.cantidad}
                        onChange={(e) => updateLingoteTipo(idx, 'cantidad', parseInt(e.target.value) || 0)}
                        className="w-16 border border-black/[0.08] rounded-[var(--radius-lg)] px-2 py-2 text-center focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
                        min="1"
                        disabled={editingExpHasBeenUsed}
                      />
                      <span className="text-[var(--text-tertiary)]">×</span>
                      <div className="flex gap-1 items-center">
                        {[50, 100].map(peso => (
                          <button
                            key={peso}
                            type="button"
                            onClick={() => updateLingoteTipo(idx, 'peso', peso)}
                            disabled={editingExpHasBeenUsed}
                            className={`px-3 py-1 rounded-[var(--radius-md)] text-sm font-medium transition-colors ${
                              l.peso === peso
                                ? 'bg-[var(--accent)] text-white'
                                : 'bg-black/[0.06] text-[var(--text-secondary)] hover:bg-stone-300'
                            }`}
                          >
                            {peso}g
                          </button>
                        ))}
                        <div className="flex items-center gap-1 ml-1">
                          <input
                            type="number"
                            inputMode="decimal"
                            value={l.peso !== 50 && l.peso !== 100 ? l.peso : ''}
                            onChange={(e) => updateLingoteTipo(idx, 'peso', parseFloat(e.target.value) || 0)}
                            disabled={editingExpHasBeenUsed}
                            className={`w-16 border rounded-[var(--radius-md)] px-2 py-1 text-center text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent)] ${
                              l.peso !== 50 && l.peso !== 100 && l.peso > 0
                                ? 'border-[var(--accent)] bg-[var(--accent-soft)]'
                                : 'border-black/[0.08]'
                            }`}
                            placeholder="otro"
                          />
                          <span className="text-[var(--text-tertiary)] text-sm">g</span>
                        </div>
                      </div>
                      <span className="text-[var(--text-secondary)] font-medium">= {(l.cantidad || 0) * (l.peso || 0)}g</span>
                      {formData.lingotes.length > 1 && !editingExpHasBeenUsed && (
                        <button
                          type="button"
                          onClick={() => removeLingoteTipo(idx)}
                          className="text-red-400 hover:text-red-600 text-lg"
                        >
                          ×
                        </button>
                      )}
                    </div>
                  ))}
                </div>
                {!editingExpHasBeenUsed && (
                  <button
                    type="button"
                    onClick={addLingoteTipo}
                    className="mt-2 text-[var(--accent)] hover:text-[var(--accent-text)] text-sm font-medium"
                  >
                    + Añadir tipo
                  </button>
                )}
              </div>

              {/* Precio por gramo */}
              <div>
                <label className="block text-sm font-medium text-[var(--text-primary)] mb-1">Precio por gramo (€/g)</label>
                <input
                  type="number"
                  inputMode="decimal"
                  step="0.01"
                  value={formData.precioGramo}
                  onChange={(e) => setFormData({ ...formData, precioGramo: e.target.value })}
                  placeholder="Ej: 95.50"
                  className="w-full border border-black/[0.08] rounded-[var(--radius-lg)] px-4 py-2 focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
                />
              </div>

              {/* Total summary */}
              <div className="bg-[var(--accent-soft)] rounded-[var(--radius-lg)] p-3">
                <div className="text-center">
                  <span className="text-[var(--accent-text)] font-bold text-lg">
                    {formTotalLingotes} lingotes = {formatNum(formTotalGramos, 0)}g
                  </span>
                </div>
                {formData.precioGramo && (
                  <div className="text-center mt-1 pt-1 border-t border-[var(--accent-border)]">
                    <span className="text-[var(--accent-text)] font-bold">
                      Total factura: {formatEur(formTotalFactura)}
                    </span>
                  </div>
                )}
              </div>

              <div className="flex gap-2 pt-2">
                <Button variant="secondary" className="flex-1" onClick={handleCancel}>Cancelar</Button>
                <Button className="flex-1" onClick={saveExportacion} disabled={!formData.nombre || formTotalLingotes === 0}>
                  Crear
                </Button>
              </div>
            </div>
          </Card>
        )}

        <div className="space-y-4">
          {exportacionesStats.map(exp => (
            editingExp?.id === exp.id ? (
              /* Formulario de edición inline */
              <Card key={exp.id} className="border-[var(--accent)] bg-[var(--accent-soft)]">
                <h3 className="font-bold text-[var(--text-primary)] mb-4">Editar: {exp.nombre}</h3>
                <div className="space-y-4">
                  <div className="flex gap-3">
                    <div className="flex-1">
                      <label className="block text-sm font-medium text-[var(--text-primary)] mb-1">Nombre</label>
                      <input type="text" value={formData.nombre} onChange={(e) => setFormData({ ...formData, nombre: e.target.value })} placeholder="Ej: 28-1" className="w-full border border-black/[0.08] rounded-[var(--radius-lg)] px-4 py-2 focus:outline-none focus:ring-2 focus:ring-[var(--accent)]" />
                    </div>
                    <div className="w-24">
                      <label className="block text-sm font-medium text-[var(--text-primary)] mb-1">Año</label>
                      <select value={formData.ano} onChange={(e) => setFormData({ ...formData, ano: e.target.value })} className="w-full border border-black/[0.08] rounded-[var(--radius-lg)] px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[var(--accent)]">
                        {anosDisponibles.map(a => <option key={a} value={a}>{a}</option>)}
                      </select>
                    </div>
                    <div className="w-36">
                      <label className="block text-sm font-medium text-[var(--text-primary)] mb-1">Fecha</label>
                      <input type="date" value={formData.fecha} onChange={(e) => setFormData({ ...formData, fecha: e.target.value })} className="w-full border border-black/[0.08] rounded-[var(--radius-lg)] px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[var(--accent)]" />
                    </div>
                  </div>

                  {/* Lingotes breakdown */}
                  <div>
                    <label className="block text-sm font-medium text-[var(--text-primary)] mb-2">Lingotes comprados</label>
                    {editingExpHasBeenUsed && (
                      <div className="bg-orange-100 border border-orange-300 rounded-[var(--radius-lg)] p-2 mb-2 text-xs text-orange-700">
                        ⚠️ No se pueden modificar los lingotes porque ya se han usado de esta exportación.
                      </div>
                    )}
                    <div className={`space-y-2 ${editingExpHasBeenUsed ? 'opacity-50 pointer-events-none' : ''}`}>
                      {formData.lingotes.map((l, idx) => (
                        <div key={idx} className="flex items-center gap-2 flex-wrap">
                          <input
                            type="number"
                            inputMode="numeric"
                            value={l.cantidad}
                            onChange={(e) => updateLingoteTipo(idx, 'cantidad', parseInt(e.target.value) || 0)}
                            className="w-16 border border-black/[0.08] rounded-[var(--radius-lg)] px-2 py-2 text-center focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
                            min="1"
                            disabled={editingExpHasBeenUsed}
                          />
                          <span className="text-[var(--text-tertiary)]">×</span>
                          <div className="flex gap-1 items-center">
                            {[50, 100].map(peso => (
                              <button
                                key={peso}
                                type="button"
                                onClick={() => updateLingoteTipo(idx, 'peso', peso)}
                                disabled={editingExpHasBeenUsed}
                                className={`px-3 py-1 rounded-[var(--radius-md)] text-sm font-medium transition-colors ${
                                  l.peso === peso
                                    ? 'bg-[var(--accent)] text-white'
                                    : 'bg-black/[0.06] text-[var(--text-secondary)] hover:bg-stone-300'
                                }`}
                              >
                                {peso}g
                              </button>
                            ))}
                            <div className="flex items-center gap-1 ml-1">
                              <input
                                type="number"
                                inputMode="decimal"
                                value={l.peso !== 50 && l.peso !== 100 ? l.peso : ''}
                                onChange={(e) => updateLingoteTipo(idx, 'peso', parseFloat(e.target.value) || 0)}
                                disabled={editingExpHasBeenUsed}
                                className={`w-16 border rounded-[var(--radius-md)] px-2 py-1 text-center text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent)] ${
                                  l.peso !== 50 && l.peso !== 100 && l.peso > 0
                                    ? 'border-[var(--accent)] bg-[var(--accent-soft)]'
                                    : 'border-black/[0.08]'
                                }`}
                                placeholder="otro"
                              />
                              <span className="text-[var(--text-tertiary)] text-sm">g</span>
                            </div>
                          </div>
                          <span className="text-[var(--text-secondary)] font-medium">= {(l.cantidad || 0) * (l.peso || 0)}g</span>
                          {formData.lingotes.length > 1 && !editingExpHasBeenUsed && (
                            <button
                              type="button"
                              onClick={() => removeLingoteTipo(idx)}
                              className="text-red-400 hover:text-red-600 text-lg"
                            >
                              ×
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                    {!editingExpHasBeenUsed && (
                      <button
                        type="button"
                        onClick={addLingoteTipo}
                        className="mt-2 text-[var(--accent)] hover:text-[var(--accent-text)] text-sm font-medium"
                      >
                        + Añadir tipo
                      </button>
                    )}
                  </div>

                  {/* Precio por gramo */}
                  <div>
                    <label className="block text-sm font-medium text-[var(--text-primary)] mb-1">Precio por gramo (€/g)</label>
                    <input
                      type="number"
                      inputMode="decimal"
                      step="0.01"
                      value={formData.precioGramo}
                      onChange={(e) => setFormData({ ...formData, precioGramo: e.target.value })}
                      placeholder="Ej: 95.50"
                      className="w-full border border-black/[0.08] rounded-[var(--radius-lg)] px-4 py-2 focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
                    />
                  </div>

                  {/* Total summary */}
                  <div className="bg-[var(--accent-soft)] rounded-[var(--radius-lg)] p-3">
                    <div className="text-center">
                      <span className="text-[var(--accent-text)] font-bold text-lg">
                        {formTotalLingotes} lingotes = {formatNum(formTotalGramos, 0)}g
                      </span>
                    </div>
                    {formData.precioGramo && (
                      <div className="text-center mt-1 pt-1 border-t border-[var(--accent-border)]">
                        <span className="text-[var(--accent-text)] font-bold">
                          Total factura: {formatEur(formTotalFactura)}
                        </span>
                      </div>
                    )}
                  </div>

                  <div className="flex gap-2 pt-2">
                    <Button variant="secondary" className="flex-1" onClick={handleCancel}>Cancelar</Button>
                    <Button className="flex-1" onClick={saveExportacion} disabled={!formData.nombre || formTotalLingotes === 0}>
                      Guardar cambios
                    </Button>
                  </div>
                </div>
              </Card>
            ) : (
            /* Tarjeta normal de exportación */
            <Card key={exp.id}>
              <div className="flex justify-between items-start mb-3">
                <div className="flex items-start gap-2">
                  {/* Icono de factura si existe */}
                  {exp.factura ? (
                    <button
                      onClick={() => setViewingExportFactura({ exp, factura: exp.factura })}
                      className="text-xl hover:scale-110 transition-transform mt-0.5"
                      title="Ver factura"
                    >
                      📄
                    </button>
                  ) : (
                    <span className="text-xl opacity-30 mt-0.5" title="Sin factura">📄</span>
                  )}
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="text-lg font-bold text-[var(--text-primary)]">{exp.nombre}</h3>
                      {exp.ano && <span className="text-xs bg-[var(--accent-soft)] text-[var(--accent-text)] px-2 py-0.5 rounded-full font-medium">{exp.ano}</span>}
                    </div>
                    <p className="text-xs text-[var(--text-tertiary)]">{exp.fecha || 'Sin fecha'}</p>
                  </div>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => openEdit(exp.id)}
                    className="text-[var(--accent)] hover:text-[var(--accent-text)] text-sm font-medium"
                  >
                    ✏️ Editar
                  </button>
                  {!exp.hasBeenUsed && (
                    <button
                      onClick={async () => {
                        if (confirm(`¿Eliminar la exportación "${exp.nombre}"?\n\nEsto no se puede deshacer.`)) {
                          await onDeleteExportacion(exp.id);
                          // Log general
                          onAddLogGeneral('eliminar_exportacion', `Exportación eliminada: ${exp.nombre} (${exp.grExport}g)`, {
                            nombre: exp.nombre,
                            grExport: exp.grExport,
                          });
                        }
                      }}
                      className="text-red-400 hover:text-red-600 text-sm font-medium"
                    >
                      🗑️
                    </button>
                  )}
                </div>
              </div>

              {/* Factura info */}
              <div className="bg-black/[0.02] rounded-[var(--radius-lg)] p-3 mb-4 space-y-2">
                <div className="flex justify-between items-center">
                  <span className="text-sm text-[var(--text-secondary)]">Precio:</span>
                  <span className="font-mono font-bold text-[var(--text-primary)]">
                    {exp.precioGramo ? `${formatNum(exp.precioGramo)} €/g` : '— sin definir'}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm text-[var(--text-secondary)]">Total compra:</span>
                  <span className="font-mono font-bold text-emerald-600">
                    {exp.facturaTotal > 0 ? formatEur(exp.facturaTotal) : '—'}
                  </span>
                </div>
                <div className="flex justify-between items-center pt-2 border-t border-black/[0.06]">
                  <span className="text-sm text-[var(--text-secondary)]">Factura PDF:</span>
                  {exp.factura ? (
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => setViewingExportFactura({ exp, factura: exp.factura })}
                        className="text-blue-600 hover:text-blue-700 text-sm font-medium"
                      >
                        📄 {exp.factura.nombre}
                      </button>
                      <button
                        onClick={() => removeFactura(exp)}
                        className="text-red-400 hover:text-red-600 text-sm"
                      >
                        ×
                      </button>
                    </div>
                  ) : (
                    <label className="cursor-pointer text-[var(--accent)] hover:text-[var(--accent-text)] text-sm font-medium">
                      {uploadingFactura === exp.id ? '⏳ Subiendo...' : '📤 Subir PDF'}
                      <input
                        type="file"
                        accept=".pdf,image/*"
                        className="hidden"
                        onChange={(e) => handleFacturaUpload(exp.id, e.target.files[0])}
                        disabled={uploadingFactura === exp.id}
                      />
                    </label>
                  )}
                </div>
              </div>

              {/* Resumen exportación: original vs disponible */}
              <div className="bg-[var(--accent-soft)] rounded-[var(--radius-lg)] p-3 mb-4">
                <div className="flex justify-between items-start mb-2">
                  <div>
                    <p className="text-xs text-[var(--accent)] font-medium">📦 Importación</p>
                    <p className="text-[var(--accent-text)] font-bold">{formatNum(exp.grExport || 0, 0)}g</p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-emerald-600 font-medium">✓ Disponible</p>
                    <p className="text-emerald-700 font-bold">{formatNum(exp.stockTotal, 0)}g</p>
                  </div>
                </div>
                {exp.lingotes && exp.lingotes.length > 0 && (
                  <div className="flex flex-wrap gap-2 pt-2 border-t border-[var(--accent-border)]">
                    {exp.lingotes.map((l, idx) => (
                      <div key={idx} className="bg-white border border-[var(--accent-border)] rounded-[var(--radius-md)] px-2 py-1 text-sm">
                        <span className="font-bold text-[var(--accent-text)]">{l.cantidad}</span>
                        <span className="text-[var(--text-tertiary)]"> × </span>
                        <span className="text-[var(--text-primary)]">{l.peso}g</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Barra de progreso: 100% = grExport original */}
              {exp.grExport > 0 && (
                <div className="mb-4">
                  {/* Barra: clientes (entregados) + stock (gris) */}
                  <div className="relative h-8 bg-black/[0.04] rounded-full overflow-hidden border border-black/[0.06]">
                    {/* Segmentos por cliente (entregados) */}
                    {exp.porCliente.map((c, idx) => {
                      const prevEntregado = exp.porCliente.slice(0, idx).reduce((sum, pc) => sum + pc.entregado, 0);
                      const leftPercent = (prevEntregado / exp.grExport) * 100;
                      const widthPercent = (c.entregado / exp.grExport) * 100;
                      if (c.entregado === 0) return null;
                      return (
                        <div
                          key={c.id}
                          className="absolute h-full flex items-center justify-center"
                          style={{
                            left: `${leftPercent}%`,
                            width: `${widthPercent}%`,
                            backgroundColor: c.color,
                          }}
                        >
                          {widthPercent > 12 && (
                            <span className="text-white text-xs font-bold drop-shadow-[0_1px_3px_rgba(0,0,0,0.04)] whitespace-nowrap">
                              {formatNum(c.cerrado, 0)}/{formatNum(c.entregado, 0)}g
                            </span>
                          )}
                        </div>
                      );
                    })}
                    {/* Parte gris: stock = desde entregados hasta el 100% */}
                    {exp.stockTotal > 0 && (
                      <div
                        className="absolute h-full flex items-center justify-center bg-stone-300"
                        style={{
                          left: `${(exp.totalEntregado / exp.grExport) * 100}%`,
                          right: 0,
                        }}
                      >
                        <span className="text-[var(--text-secondary)] text-xs font-medium whitespace-nowrap">
                          Stock: {formatNum(exp.stockTotal, 0)}g
                        </span>
                      </div>
                    )}
                  </div>
                  {/* Leyenda debajo */}
                  <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2">
                    {exp.porCliente.map(c => (
                      <div key={c.id} className="flex items-center gap-1 text-xs">
                        <div className="w-2 h-2 rounded-full" style={{ backgroundColor: c.color }} />
                        <span className="text-[var(--text-secondary)]">{c.nombre}</span>
                        <span className="text-[var(--text-tertiary)]">({formatNum(c.cerrado, 0)}/{formatNum(c.entregado, 0)}g)</span>
                      </div>
                    ))}
                    {exp.stockTotal > 0 && (
                      <div className="flex items-center gap-1 text-xs">
                        <div className="w-2 h-2 rounded-full bg-stone-300" />
                        <span className="text-[var(--text-tertiary)]">Stock: {formatNum(exp.stockTotal, 0)}g</span>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </Card>
            )
          ))}
          {exportaciones.length === 0 && (
            <Card><p className="text-[var(--text-tertiary)] text-center py-6">No hay exportaciones. Crea una para empezar.</p></Card>
          )}
        </div>
      </div>
    );
  };

  // Estadisticas View
  const EstadisticasView = () => {
    // Calcular stats por cliente desde entregas cerradas
    const statsClientes = clientes.map(cliente => {
      const entregasCliente = entregas.filter(e => e.clienteId === cliente.id);

      // Sumar gramos vendidos (cerrados: pendiente_pago + finalizado)
      let gramosVendidos = 0;
      let margenTotal = 0;
      let margenCierre = 0;

      entregasCliente.forEach(entrega => {
        (entrega.lingotes || []).forEach(l => {
          if (l.estado === 'pendiente_pago' || l.estado === 'finalizado') {
            const pesoNeto = (l.peso || 0) - (l.pesoDevuelto || 0);
            gramosVendidos += pesoNeto;
            // Usar valores guardados si existen, sino calcular
            if (l.margenTotal !== undefined) {
              margenTotal += l.margenTotal;
              margenCierre += l.margenCierre || 0;
            } else if (l.precio && l.precioJofisa) {
              // Fallback para lingotes cerrados antes de v6
              const importeCliente = l.precio * pesoNeto;
              const importeJofisa = l.precioJofisa * pesoNeto;
              margenTotal += importeCliente - importeJofisa;
              if (l.baseCliente && l.base) {
                margenCierre += (l.baseCliente - l.base) * pesoNeto;
              }
            }
          }
        });
      });

      // También sumar FUTURA cerrados
      const futuraCliente = (futuraLingotes || []).filter(f => f.clienteId === cliente.id && f.precio);
      futuraCliente.forEach(f => {
        gramosVendidos += f.peso || 0;
        if (f.margenTotal !== undefined) {
          margenTotal += f.margenTotal;
          margenCierre += f.margenCierre || 0;
        } else if (f.precio && f.precioJofisa) {
          const importeCliente = f.precio * f.peso;
          const importeJofisa = f.precioJofisa * f.peso;
          margenTotal += importeCliente - importeJofisa;
          if (f.baseCliente && f.base) {
            margenCierre += (f.baseCliente - f.base) * f.peso;
          }
        }
      });

      const pctMargenCierre = margenTotal > 0 ? (margenCierre / margenTotal) * 100 : 0;

      return {
        id: cliente.id,
        nombre: cliente.nombre,
        color: cliente.color,
        gramosVendidos,
        margenTotal,
        margenCierre,
        pctMargenCierre,
      };
    }).filter(c => c.gramosVendidos > 0);

    // Totales
    const totalGramos = statsClientes.reduce((sum, c) => sum + c.gramosVendidos, 0);
    const totalMargen = statsClientes.reduce((sum, c) => sum + c.margenTotal, 0);
    const totalMargenCierre = statsClientes.reduce((sum, c) => sum + c.margenCierre, 0);
    const totalPctCierre = totalMargen > 0 ? (totalMargenCierre / totalMargen) * 100 : 0;

    // Stats por año - agrupar entregas por año de entrega y cliente
    const statsPorAnyo = useMemo(() => {
      // Mapeo de IDs de cliente
      const clienteIds = {
        'Gemma': 'LYn5VsQMazDk4qjT6r6M',
        'Milla': 'N6nDJCoBzFxhshm5dB6A',
        'NJ': 'i4s6s7L68w9ErFKxQ3qQ',
        'Orcash': 'yZTyXNSpM0jJvJRYj0Y7',
        'Gaudia': 'Uu5XbiExWFB0d5AiugIi',
        'Suissa': 'qZ29q4Iu7Qs94q1mqxBR',
      };

      // Datos históricos hardcodeados (2023-2025): peso y mgn (margen en €)
      const historicDataAnual = {
        '2023': {
          [clienteIds.Gemma]: { peso: 0, mgn: 0 },
          [clienteIds.Milla]: { peso: 700, mgn: 615 },
          [clienteIds.NJ]: { peso: 1800, mgn: 969 },
          [clienteIds.Orcash]: { peso: 200, mgn: 610 },
          [clienteIds.Gaudia]: { peso: 0, mgn: 0 },
          [clienteIds.Suissa]: { peso: 0, mgn: 0 },
        },
        '2024': {
          [clienteIds.Gemma]: { peso: 350, mgn: 1470 },
          [clienteIds.Milla]: { peso: 550, mgn: 2136 },
          [clienteIds.NJ]: { peso: 2550, mgn: 10165 },
          [clienteIds.Orcash]: { peso: 1200, mgn: 4853 },
          [clienteIds.Gaudia]: { peso: 150, mgn: 645 },
          [clienteIds.Suissa]: { peso: 200, mgn: 898 },
        },
        '2025': {
          [clienteIds.Gemma]: { peso: 450, mgn: 2547 },
          [clienteIds.Milla]: { peso: 605, mgn: 3416 },
          [clienteIds.NJ]: { peso: 5900, mgn: 34033 },
          [clienteIds.Orcash]: { peso: 859, mgn: 5499 },
          [clienteIds.Gaudia]: { peso: 3500, mgn: 21379 },
          [clienteIds.Suissa]: { peso: 0, mgn: 0 },
        },
      };

      const byYear = {}; // { year: { clienteId: { peso, mgn } } }
      const years = new Set(['2023', '2024', '2025']);

      // Inicializar con datos históricos
      Object.keys(historicDataAnual).forEach(year => {
        byYear[year] = { ...historicDataAnual[year] };
      });

      // Procesar entregas de 2026 en adelante (dinámico)
      entregas.forEach(entrega => {
        (entrega.lingotes || []).forEach(l => {
          if (l.estado !== 'finalizado' && l.estado !== 'pendiente_pago') return;
          const fecha = l.fechaCierre || entrega.fechaEntrega;
          if (!fecha) return;
          const year = fecha.substring(0, 4);
          if (year < '2026') return; // Solo 2026+

          years.add(year);
          if (!byYear[year]) byYear[year] = {};

          const clienteId = entrega.clienteId;
          if (!byYear[year][clienteId]) {
            byYear[year][clienteId] = { peso: 0, mgn: 0 };
          }

          const peso = (l.peso || 0) - (l.pesoDevuelto || 0);
          byYear[year][clienteId].peso += peso;
          byYear[year][clienteId].mgn += l.margenCierre || 0;
        });
      });

      // FUTURA cerrados de 2026+
      (futuraLingotes || []).forEach(f => {
        if (!f.precio || !f.fechaCierre) return;
        const year = f.fechaCierre.substring(0, 4);
        if (year < '2026') return;

        years.add(year);
        if (!byYear[year]) byYear[year] = {};

        const clienteId = f.clienteId;
        if (!byYear[year][clienteId]) {
          byYear[year][clienteId] = { peso: 0, mgn: 0 };
        }

        byYear[year][clienteId].peso += f.peso || 0;
        byYear[year][clienteId].mgn += f.margenCierre || 0;
      });

      // Ordenar años
      const sortedYears = [...years].sort();

      // Crear lista de clientes con datos
      const clientesConDatos = clientes.filter(c => {
        return sortedYears.some(year => byYear[year]?.[c.id]?.peso > 0);
      });

      // Calcular totales por año
      const totalesPorAnyo = {};
      sortedYears.forEach(year => {
        totalesPorAnyo[year] = { peso: 0, mgn: 0 };
        Object.values(byYear[year] || {}).forEach(data => {
          totalesPorAnyo[year].peso += data.peso || 0;
          totalesPorAnyo[year].mgn += data.mgn || 0;
        });
      });

      return { byYear, sortedYears, clientesConDatos, totalesPorAnyo };
    }, [entregas, futuraLingotes, clientes]);

    // Stats volumen anual para gráfico de barras + línea €/g (desde 2024)
    const statsVolumenAnual = useMemo(() => {
      const clienteIds = {
        'Gemma': 'LYn5VsQMazDk4qjT6r6M',
        'Milla': 'N6nDJCoBzFxhshm5dB6A',
        'NJ': 'i4s6s7L68w9ErFKxQ3qQ',
        'Orcash': 'yZTyXNSpM0jJvJRYj0Y7',
        'Gaudia': 'Uu5XbiExWFB0d5AiugIi',
        'Suissa': 'qZ29q4Iu7Qs94q1mqxBR',
      };

      // Datos históricos: peso y margen (mgn) por cliente/año (2024-2025)
      // €/gramo = margen total / peso total
      const historicDataAnual = {
        '2024': {
          [clienteIds.Gemma]: { peso: 350, mgn: 1470 },
          [clienteIds.Milla]: { peso: 550, mgn: 2136 },
          [clienteIds.NJ]: { peso: 2550, mgn: 10165 },
          [clienteIds.Orcash]: { peso: 1200, mgn: 4853 },
          [clienteIds.Gaudia]: { peso: 150, mgn: 645 },
          [clienteIds.Suissa]: { peso: 200, mgn: 898 },
        },
        '2025': {
          [clienteIds.Gemma]: { peso: 450, mgn: 2547 },
          [clienteIds.Milla]: { peso: 605, mgn: 3416 },
          [clienteIds.NJ]: { peso: 5900, mgn: 34033 },
          [clienteIds.Orcash]: { peso: 859, mgn: 5499 },
          [clienteIds.Gaudia]: { peso: 3500, mgn: 21379 },
          [clienteIds.Suissa]: { peso: 0, mgn: 0 },
        },
      };

      const byYear = {}; // { year: { clienteId: { peso, mgn } } }
      const years = new Set(['2024', '2025']);

      // Inicializar con datos históricos
      Object.keys(historicDataAnual).forEach(year => {
        byYear[year] = { ...historicDataAnual[year] };
      });

      // Procesar entregas de 2026 en adelante (dinámico)
      entregas.forEach(entrega => {
        (entrega.lingotes || []).forEach(l => {
          if (l.estado !== 'finalizado' && l.estado !== 'pendiente_pago') return;
          const fecha = l.fechaCierre || entrega.fechaEntrega;
          if (!fecha) return;
          const year = fecha.substring(0, 4);
          if (year < '2026') return;

          years.add(year);
          if (!byYear[year]) byYear[year] = {};

          const clienteId = entrega.clienteId;
          if (!byYear[year][clienteId]) {
            byYear[year][clienteId] = { peso: 0, mgn: 0 };
          }

          const peso = (l.peso || 0) - (l.pesoDevuelto || 0);
          byYear[year][clienteId].peso += peso;
          byYear[year][clienteId].mgn += l.margenCierre || 0;
        });
      });

      // FUTURA cerrados de 2026+
      (futuraLingotes || []).forEach(f => {
        if (!f.precio || !f.fechaCierre) return;
        const year = f.fechaCierre.substring(0, 4);
        if (year < '2026') return;

        years.add(year);
        if (!byYear[year]) byYear[year] = {};

        const clienteId = f.clienteId;
        if (!byYear[year][clienteId]) {
          byYear[year][clienteId] = { peso: 0, mgn: 0 };
        }

        byYear[year][clienteId].peso += f.peso || 0;
        byYear[year][clienteId].mgn += f.margenCierre || 0;
      });

      // Ordenar años (solo 2024+)
      const sortedYears = [...years].filter(y => y >= '2024').sort();

      // Clientes con datos en estos años
      const clientesConDatos = clientes.filter(c => {
        return sortedYears.some(year => byYear[year]?.[c.id]?.peso > 0);
      });

      // Crear chartData para el gráfico
      const chartData = sortedYears.map(year => {
        const entry = { year };
        let totalPeso = 0;
        let totalMgn = 0;

        clientesConDatos.forEach(c => {
          const data = byYear[year]?.[c.id] || { peso: 0, mgn: 0 };
          const shortName = c.nombre.substring(0, 6);
          entry[shortName] = data.peso;
          entry[`${shortName}_mgn`] = data.mgn;
          totalPeso += data.peso;
          totalMgn += data.mgn;
        });

        entry.totalPeso = totalPeso;
        entry.totalMgn = totalMgn;
        entry.euroGramo = totalPeso > 0 ? totalMgn / totalPeso : 0;

        return entry;
      });

      return { chartData, clientesConDatos, byYear };
    }, [entregas, futuraLingotes, clientes]);

    // Stats por mes para gráfico stacked - DATOS HISTÓRICOS HARDCODEADOS
    const statsPorMes = useMemo(() => {
      // Mapeo de nombres a IDs de cliente
      const clienteIds = {
        'Gemma': 'LYn5VsQMazDk4qjT6r6M',
        'Milla': 'N6nDJCoBzFxhshm5dB6A',
        'NJ': 'i4s6s7L68w9ErFKxQ3qQ',
        'Orcash': 'yZTyXNSpM0jJvJRYj0Y7',
        'Gaudia': 'Uu5XbiExWFB0d5AiugIi',
        'Suissa': 'qZ29q4Iu7Qs94q1mqxBR',
      };

      // Datos históricos hardcodeados (hasta 2025-dic)
      const historicData = {
        '2023-01': { Milla: 200 },
        '2023-02': { Milla: 50, NJ: 150 },
        '2023-03': { Milla: 50, NJ: 100 },
        '2023-04': { NJ: 350 },
        '2023-05': { NJ: 150 },
        '2023-06': { NJ: 350 },
        '2023-07': { NJ: 100 },
        '2023-08': { NJ: 50 },
        '2023-09': { Milla: 150, NJ: 150 },
        '2023-10': { NJ: 50 },
        '2023-11': { NJ: 250 },
        '2023-12': { Milla: 250, NJ: 100, Orcash: 200 },
        '2024-01': { Gemma: 50, NJ: 100, Orcash: 50 },
        '2024-02': { Milla: 200, NJ: 550 },
        '2024-03': { Milla: 50, NJ: 250 },
        '2024-04': { Gemma: 100, NJ: 400, Orcash: 800 },
        '2024-05': { NJ: 100, Orcash: 50 },
        '2024-06': { Orcash: 150, Suissa: 200 },
        '2024-07': { NJ: 50 },
        '2024-08': { Milla: 50, NJ: 350, Orcash: 50, Gaudia: 50 },
        '2024-09': { Milla: 150, Orcash: 100 },
        '2024-10': { Gemma: 50, Milla: 50, NJ: 250, Gaudia: 100 },
        '2024-11': { Milla: 50, NJ: 200 },
        '2024-12': { Gemma: 150, NJ: 300 },
        '2025-01': { Milla: 50, Gaudia: 50 },
        '2025-02': { NJ: 100 },
        '2025-03': { Gemma: 100, NJ: 450, Gaudia: 100 },
        '2025-04': { Gemma: 50, NJ: 950, Gaudia: 100 },
        '2025-05': { NJ: 800 },
        '2025-06': { Gemma: 50, Milla: 250, NJ: 400, Gaudia: 150 },
        '2025-07': { Gaudia: 150 },
        '2025-08': { Gemma: 50, Milla: 150, NJ: 150, Gaudia: 200 },
        '2025-09': { Gemma: 100, NJ: 1050, Orcash: 158.5, Gaudia: 250 },
        '2025-10': { Gemma: 50, NJ: 1300, Orcash: 300, Gaudia: 2050 },
        '2025-11': { Milla: 50, NJ: 350, Orcash: 400, Gaudia: 200 },
        '2025-12': { Gemma: 50, Milla: 105, NJ: 350, Gaudia: 250 },
      };

      // Combinar datos históricos con datos calculados de 2026+
      const byMonth = { ...historicData };

      // Procesar entregas de 2026 en adelante
      entregas.forEach(entrega => {
        (entrega.lingotes || []).forEach(l => {
          if (l.estado !== 'finalizado' && l.estado !== 'pendiente_pago') return;
          const fecha = l.fechaCierre || entrega.fechaEntrega;
          if (!fecha) return;
          const month = fecha.substring(0, 7);
          if (month.length !== 7 || month < '2026-01') return;

          if (!byMonth[month]) byMonth[month] = {};
          const cliente = clientes.find(c => c.id === entrega.clienteId);
          const clienteName = cliente?.nombre === 'Nova Joia' ? 'NJ' :
                             cliente?.nombre === 'La Milla d\'Or' ? 'Milla' :
                             cliente?.nombre === 'OrCash' ? 'Orcash' :
                             cliente?.nombre === 'Gemma d\'Or' ? 'Gemma' :
                             cliente?.nombre || entrega.clienteId;
          if (!byMonth[month][clienteName]) byMonth[month][clienteName] = 0;
          byMonth[month][clienteName] += (l.peso || 0) - (l.pesoDevuelto || 0);
        });
      });

      // FUTURA cerrados de 2026+
      (futuraLingotes || []).forEach(f => {
        if (!f.precio || !f.fechaCierre) return;
        const month = f.fechaCierre.substring(0, 7);
        if (month.length !== 7 || month < '2026-01') return;
        if (!byMonth[month]) byMonth[month] = {};
        const cliente = clientes.find(c => c.id === f.clienteId);
        const clienteName = cliente?.nombre === 'Nova Joia' ? 'NJ' :
                           cliente?.nombre === 'La Milla d\'Or' ? 'Milla' :
                           cliente?.nombre === 'OrCash' ? 'Orcash' :
                           cliente?.nombre === 'Gemma d\'Or' ? 'Gemma' :
                           cliente?.nombre || f.clienteId;
        if (!byMonth[month][clienteName]) byMonth[month][clienteName] = 0;
        byMonth[month][clienteName] += f.peso || 0;
      });

      const sortedMonths = Object.keys(byMonth).sort();
      const monthNames = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

      // Lista de clientes para el gráfico (orden fijo)
      const clienteOrder = ['Gemma', 'Milla', 'NJ', 'Orcash', 'Gaudia', 'Suissa'];
      const clientesConVentas = clienteOrder
        .filter(name => sortedMonths.some(m => byMonth[m]?.[name] > 0))
        .map(name => ({
          id: clienteIds[name],
          nombre: name === 'NJ' ? 'Nova Joia' :
                  name === 'Milla' ? 'La Milla d\'Or' :
                  name === 'Orcash' ? 'OrCash' :
                  name === 'Gaudia' ? 'Gaudia' :
                  name === 'Gemma' ? 'Gemma d\'Or' : name,
          color: clientes.find(c => c.id === clienteIds[name])?.color || '#888',
          shortName: name,
        }));

      const chartData = sortedMonths.map(month => {
        const [year, mes] = month.split('-');
        const label = `${monthNames[parseInt(mes) - 1]} ${year.slice(2)}`;
        const entry = { month, label };
        let total = 0;
        clientesConVentas.forEach(c => {
          const val = byMonth[month]?.[c.shortName] || 0;
          entry[c.shortName] = val;
          total += val;
        });
        entry.total = total;
        return entry;
      });

      return { chartData, clientesConVentas };
    }, [entregas, futuraLingotes, clientes]);

    // Ancho del gráfico basado en número de meses (20px por barra para que sean más estrechas)
    const chartWidth = Math.max(statsPorMes.chartData.length * 20, 400);

    // Estado para hover en el gráfico
    const [hoveredBarTotal, setHoveredBarTotal] = React.useState(null);

    // Calcular el máximo para el eje Y (redondeado a múltiplo de 500)
    const maxTotal = Math.max(...statsPorMes.chartData.map(d => d.total || 0), 500);
    const yAxisMax = Math.ceil(maxTotal / 500) * 500;
    const yAxisTicks = [];
    for (let i = 0; i <= yAxisMax; i += 500) {
      yAxisTicks.push(i);
    }

    // Ref para scroll automático a la derecha
    const chartScrollRef = React.useRef(null);
    React.useEffect(() => {
      if (chartScrollRef.current) {
        chartScrollRef.current.scrollLeft = chartScrollRef.current.scrollWidth;
      }
    }, [statsPorMes.chartData]);

    return (
      <div className="space-y-4">
        {/* Gráfico Mensual Stacked */}
        {canViewStats && statsPorMes.chartData.length > 0 && (
          <Card>
            <h2 className="text-lg font-bold text-[var(--text-primary)] mb-4">📈 Volumen Vendido por Mes</h2>
            <div ref={chartScrollRef} className="overflow-x-auto pb-2">
              <div style={{ width: chartWidth, minWidth: '100%', height: 280 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={statsPorMes.chartData}
                    margin={{ top: 10, right: 45, left: 0, bottom: 20 }}
                    barCategoryGap="30%"
                    onMouseMove={(state) => {
                      if (state?.activePayload?.length > 0) {
                        const total = state.activePayload[0]?.payload?.total || 0;
                        setHoveredBarTotal(total);
                      }
                    }}
                    onMouseLeave={() => setHoveredBarTotal(null)}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e5e5" />
                    <XAxis
                      dataKey="label"
                      tick={{ fontSize: 9, fill: '#78716c' }}
                      angle={-45}
                      textAnchor="end"
                      height={50}
                      interval={0}
                    />
                    <YAxis
                      yAxisId="left"
                      tick={{ fontSize: 10, fill: '#78716c' }}
                      tickFormatter={(v) => `${v}g`}
                      width={45}
                      domain={[0, yAxisMax]}
                      ticks={yAxisTicks}
                    />
                    <YAxis
                      yAxisId="right"
                      orientation="right"
                      tick={{ fontSize: 10, fill: '#78716c' }}
                      tickFormatter={(v) => `${v}g`}
                      width={45}
                      domain={[0, yAxisMax]}
                      ticks={yAxisTicks}
                    />
                    <Tooltip
                      formatter={(value, name) => {
                        const cliente = statsPorMes.clientesConVentas.find(c => c.shortName === name);
                        return [`${formatNum(value, 0)}g`, cliente?.nombre || name];
                      }}
                      labelFormatter={(label) => `Mes: ${label}`}
                      contentStyle={{ fontSize: 12, borderRadius: 8 }}
                    />
                    <Legend
                      formatter={(value) => {
                        const cliente = statsPorMes.clientesConVentas.find(c => c.shortName === value);
                        return cliente?.nombre || value;
                      }}
                      wrapperStyle={{ fontSize: 10, paddingTop: 10 }}
                    />
                    {statsPorMes.clientesConVentas.map((cliente) => (
                      <Bar
                        key={cliente.shortName}
                        dataKey={cliente.shortName}
                        stackId="ventas"
                        fill={cliente.color || '#8884d8'}
                        name={cliente.shortName}
                        yAxisId="left"
                      />
                    ))}
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
            <div className="flex justify-between items-center mt-1">
              <p className="text-[10px] text-[var(--text-tertiary)]">Gramos vendidos (cerrados) por mes, agrupados por cliente</p>
              {hoveredBarTotal !== null && (
                <p className="text-sm font-semibold text-[var(--accent)]">Total: {formatNum(hoveredBarTotal, 0)}g</p>
              )}
            </div>
          </Card>
        )}

        {/* Gráfico Volumen Anual + €/g */}
        {canViewStats && statsVolumenAnual.chartData.length > 0 && (
          <Card>
            <h2 className="text-lg font-bold text-[var(--text-primary)] mb-4">📊 Volumen Anual y €/gramo</h2>
            <div style={{ width: '100%', height: 320 }}>
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart
                  data={statsVolumenAnual.chartData}
                  margin={{ top: 20, right: 60, left: 10, bottom: 20 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e5e5" />
                  <XAxis
                    dataKey="year"
                    tick={{ fontSize: 12, fill: '#78716c', fontWeight: 600 }}
                  />
                  <YAxis
                    yAxisId="left"
                    tick={{ fontSize: 10, fill: '#78716c' }}
                    tickFormatter={(v) => `${formatNum(v, 0)}g`}
                    width={55}
                  />
                  <YAxis
                    yAxisId="right"
                    orientation="right"
                    tick={{ fontSize: 10, fill: '#0891b2' }}
                    tickFormatter={(v) => `${formatNum(v, 2)}€`}
                    width={50}
                    domain={['auto', 'auto']}
                  />
                  <Tooltip
                    content={({ active, payload, label }) => {
                      if (!active || !payload || payload.length === 0) return null;
                      const data = payload[0]?.payload;
                      if (!data) return null;

                      return (
                        <div className="bg-white border border-black/[0.06] rounded-[var(--radius-md)] shadow-lg p-3 text-xs">
                          <p className="font-bold text-[var(--text-primary)] mb-2 text-sm">{label}</p>
                          <div className="space-y-1">
                            {statsVolumenAnual.clientesConDatos.map(c => {
                              const shortName = c.nombre.substring(0, 6);
                              const peso = data[shortName] || 0;
                              if (peso === 0) return null;
                              return (
                                <div key={c.id} className="flex items-center gap-2">
                                  <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: c.color }} />
                                  <span className="text-[var(--text-secondary)]">{c.nombre}:</span>
                                  <span className="font-mono font-semibold text-[var(--text-primary)]">{formatNum(peso, 0)}g</span>
                                </div>
                              );
                            })}
                          </div>
                          <div className="border-t border-black/[0.06] mt-2 pt-2 space-y-1">
                            <div className="flex justify-between">
                              <span className="text-[var(--text-secondary)]">Total:</span>
                              <span className="font-mono font-bold text-[var(--text-primary)]">{formatNum(data.totalPeso, 0)}g</span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-[var(--text-secondary)]">Margen:</span>
                              <span className="font-mono font-semibold text-emerald-700">{formatNum(data.totalMgn, 0)}€</span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-cyan-700 font-medium">€/gramo:</span>
                              <span className="font-mono font-bold text-cyan-700">{formatNum(data.euroGramo, 2)}€</span>
                            </div>
                          </div>
                        </div>
                      );
                    }}
                  />
                  <Legend
                    formatter={(value) => {
                      if (value === 'euroGramo') return '€/gramo';
                      const cliente = statsVolumenAnual.clientesConDatos.find(c => c.nombre.substring(0, 6) === value);
                      return cliente?.nombre || value;
                    }}
                    wrapperStyle={{ fontSize: 10, paddingTop: 10 }}
                  />
                  {statsVolumenAnual.clientesConDatos.map((cliente) => {
                    const shortName = cliente.nombre.substring(0, 6);
                    return (
                      <Bar
                        key={shortName}
                        dataKey={shortName}
                        stackId="volumen"
                        fill={cliente.color || '#8884d8'}
                        name={shortName}
                        yAxisId="left"
                      />
                    );
                  })}
                  <Line
                    type="monotone"
                    dataKey="euroGramo"
                    stroke="#0891b2"
                    strokeWidth={3}
                    dot={{ fill: '#0891b2', strokeWidth: 2, r: 5 }}
                    yAxisId="right"
                    name="euroGramo"
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
            <p className="text-[10px] text-[var(--text-tertiary)] mt-1">Volumen total vendido por año (barras) y precio medio €/gramo (línea)</p>
          </Card>
        )}

        {/* Stats por Año */}
        {canViewStats && (
        <Card>
          <h2 className="text-lg font-bold text-[var(--text-primary)] mb-4">📊 Entregas por Año</h2>

          {statsPorAnyo.sortedYears.length === 0 ? (
            <p className="text-[var(--text-tertiary)] text-center py-6">No hay datos todavía.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="border-b-2 border-black/[0.08]">
                    <th rowSpan={2} className="text-left py-2 px-2 font-semibold text-[var(--text-secondary)] sticky left-0 bg-white border-r border-black/[0.06] min-w-[90px] z-10">Cliente</th>
                    {statsPorAnyo.sortedYears.map(year => (
                      <th key={year} colSpan={3} className="text-center py-1 px-1 font-bold text-[var(--text-primary)] border-r border-black/[0.06] bg-black/[0.02]">{year}</th>
                    ))}
                    <th colSpan={3} className="text-center py-1 px-1 font-bold text-[var(--text-primary)] bg-[var(--accent-soft)] border-l-2 border-[var(--accent-border)]">Suma total</th>
                  </tr>
                  <tr className="border-b border-black/[0.06] text-[10px]">
                    <th className="sticky left-0 bg-white z-10"></th>
                    {statsPorAnyo.sortedYears.map(year => (
                      <React.Fragment key={year}>
                        <th className="py-1 px-1 text-[var(--text-tertiary)] font-medium">Peso</th>
                        <th className="py-1 px-1 text-[var(--text-tertiary)] font-medium">MGN</th>
                        <th className="py-1 px-1 text-[var(--text-tertiary)] font-medium border-r border-black/[0.06]">%</th>
                      </React.Fragment>
                    ))}
                    <th className="py-1 px-1 text-[var(--accent-text)] font-semibold">Peso</th>
                    <th className="py-1 px-1 text-[var(--accent-text)] font-semibold">MGN</th>
                    <th className="py-1 px-1 text-[var(--accent-text)] font-semibold">%</th>
                  </tr>
                </thead>
                <tbody>
                  {statsPorAnyo.clientesConDatos.map(cliente => {
                    let clienteTotal = { peso: 0, mgn: 0 };
                    // Calcular totales primero para el %
                    statsPorAnyo.sortedYears.forEach(year => {
                      const data = statsPorAnyo.byYear[year]?.[cliente.id] || { peso: 0, mgn: 0 };
                      clienteTotal.peso += data.peso || 0;
                      clienteTotal.mgn += data.mgn || 0;
                    });
                    const grandTotalMgn = Object.values(statsPorAnyo.totalesPorAnyo).reduce((sum, t) => sum + (t.mgn || 0), 0);
                    // Color suave del cliente (20% opacidad)
                    const rowBgColor = cliente.color ? `${cliente.color}20` : 'transparent';

                    return (
                      <tr key={cliente.id} className="border-b border-stone-100" style={{ backgroundColor: rowBgColor }}>
                        <td className="py-2 px-2 sticky left-0 border-r border-black/[0.06] min-w-[90px] z-10 bg-white">
                          <div className="flex items-center gap-1.5 -mx-2 -my-2 px-2 py-2" style={{ backgroundColor: cliente.color ? `${cliente.color}30` : 'transparent' }}>
                            <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: cliente.color }} />
                            <span className="font-medium text-[var(--text-primary)] whitespace-nowrap text-xs">{cliente.nombre}</span>
                          </div>
                        </td>
                        {statsPorAnyo.sortedYears.map(year => {
                          const data = statsPorAnyo.byYear[year]?.[cliente.id] || { peso: 0, mgn: 0 };
                          const yearTotal = statsPorAnyo.totalesPorAnyo[year];
                          const pct = yearTotal.mgn > 0 ? ((data.mgn || 0) / yearTotal.mgn * 100) : 0;
                          return (
                            <React.Fragment key={year}>
                              <td className="text-center py-2 px-1 font-mono text-[var(--text-primary)]">
                                {data.peso > 0 ? formatNum(data.peso, 0) : <span className="text-stone-300">-</span>}
                              </td>
                              <td className="text-center py-2 px-1 font-mono text-emerald-700">
                                {data.mgn > 0 ? formatNum(data.mgn, 0) : <span className="text-stone-300">-</span>}
                              </td>
                              <td className="text-center py-2 px-1 font-mono text-[var(--text-tertiary)] border-r border-black/[0.06]">
                                {data.mgn > 0 ? `${formatNum(pct, 0)}%` : <span className="text-stone-300">-</span>}
                              </td>
                            </React.Fragment>
                          );
                        })}
                        <td className="text-center py-2 px-1 font-mono font-semibold text-[var(--text-primary)] bg-[var(--accent-soft)]">
                          {formatNum(clienteTotal.peso, 0)}
                        </td>
                        <td className="text-center py-2 px-1 font-mono font-semibold text-emerald-700 bg-[var(--accent-soft)]">
                          {formatNum(clienteTotal.mgn, 0)}
                        </td>
                        <td className="text-center py-2 px-1 font-mono font-semibold text-[var(--text-secondary)] bg-[var(--accent-soft)]">
                          {grandTotalMgn > 0 ? `${formatNum(clienteTotal.mgn / grandTotalMgn * 100, 0)}%` : '-'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="bg-[var(--accent-soft)] font-bold border-t-2 border-[var(--accent-border)]">
                    <td className="py-2 px-2 text-[var(--text-primary)] sticky left-0 bg-[var(--accent-soft)] border-r border-black/[0.06]">Suma total</td>
                    {statsPorAnyo.sortedYears.map(year => {
                      const t = statsPorAnyo.totalesPorAnyo[year];
                      return (
                        <React.Fragment key={year}>
                          <td className="text-center py-2 px-1 font-mono text-[var(--text-primary)]">{formatNum(t.peso, 0)}</td>
                          <td className="text-center py-2 px-1 font-mono text-emerald-800">{formatNum(t.mgn, 0)}</td>
                          <td className="text-center py-2 px-1 font-mono text-[var(--text-secondary)] border-r border-black/[0.06]">100%</td>
                        </React.Fragment>
                      );
                    })}
                    {(() => {
                      const grandTotal = Object.values(statsPorAnyo.totalesPorAnyo).reduce(
                        (acc, t) => ({ peso: acc.peso + (t.peso || 0), mgn: acc.mgn + (t.mgn || 0) }),
                        { peso: 0, mgn: 0 }
                      );
                      return (
                        <>
                          <td className="text-center py-2 px-1 font-mono text-stone-900 bg-[var(--accent-border)]">{formatNum(grandTotal.peso, 0)}</td>
                          <td className="text-center py-2 px-1 font-mono text-emerald-900 bg-[var(--accent-border)]">{formatNum(grandTotal.mgn, 0)}</td>
                          <td className="text-center py-2 px-1 font-mono text-[var(--text-primary)] bg-[var(--accent-border)]">100%</td>
                        </>
                      );
                    })()}
                  </tr>
                </tfoot>
              </table>
              <p className="text-[10px] text-[var(--text-tertiary)] mt-2">Peso en gramos, MGN = Margen en €, % = Porcentaje sobre total del año</p>
            </div>
          )}
        </Card>
        )}

      </div>
    );
  };

  // Log General Section - Solo para Alex
  const LogGeneralSection = ({ logsGenerales, loadLogsGenerales }) => {
    const [showLogs, setShowLogs] = useState(false);
    const [logsLoaded, setLogsLoaded] = useState(false);

    const handleToggle = () => {
      if (!logsLoaded) {
        loadLogsGenerales();
        setLogsLoaded(true);
      }
      setShowLogs(!showLogs);
    };

    // Agrupar logs por día y luego por usuario
    const logsAgrupados = useMemo(() => {
      if (!logsGenerales || logsGenerales.length === 0) return [];

      // Agrupar por día
      const porDia = {};
      logsGenerales.forEach(log => {
        const fecha = log.fecha?.split('T')[0] || 'Sin fecha';
        if (!porDia[fecha]) porDia[fecha] = [];
        porDia[fecha].push(log);
      });

      // Para cada día, agrupar por usuario
      return Object.entries(porDia)
        .sort((a, b) => b[0].localeCompare(a[0])) // Más reciente primero
        .map(([fecha, logs]) => {
          const porUsuario = {};
          logs.forEach(log => {
            const usuario = log.usuario || 'Sistema';
            if (!porUsuario[usuario]) porUsuario[usuario] = [];
            porUsuario[usuario].push(log);
          });

          // Ordenar cada usuario por hora
          Object.values(porUsuario).forEach(userLogs => {
            userLogs.sort((a, b) => (b.fecha || '').localeCompare(a.fecha || ''));
          });

          return { fecha, porUsuario };
        });
    }, [logsGenerales]);

    const formatFecha = (fecha) => {
      if (!fecha) return '-';
      const d = new Date(fecha);
      return d.toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric', month: 'short' });
    };

    const formatHora = (fecha) => {
      if (!fecha) return '-';
      const d = new Date(fecha);
      return d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
    };

    const getAccionEmoji = (accion) => {
      const emojis = {
        crear_exportacion: '📦',
        editar_exportacion: '✏️',
        eliminar_exportacion: '🗑️',
        crear_entrega: '📤',
        crear_futura: '🔮',
        asignar_futura: '🔗',
        cerrar_lingotes: '💰',
        cerrar_futura: '💰',
        devolucion: '↩️',
        marcar_pagado: '✅',
        desmarcar_pagado: '❌',
        subir_factura_cliente: '📄',
        crear_expedicion: '🚚',
        editar_expedicion: '✏️',
        eliminar_expedicion: '🗑️',
        crear_paquete: '📋',
        eliminar_paquete: '🗑️',
        cerrar_paquete: '🔒',
        crear_cliente: '👤',
        editar_cliente: '✏️',
        eliminar_cliente: '🗑️',
      };
      return emojis[accion] || '📝';
    };

    return (
      <div>
        <Button onClick={handleToggle} variant="secondary" className="w-full mb-4">
          {showLogs ? '🔼 Ocultar Logs' : '🔽 Ver Logs de Actividad'}
        </Button>

        {showLogs && (
          <div className="space-y-4 max-h-[500px] overflow-y-auto">
            {logsAgrupados.length === 0 ? (
              <p className="text-center text-[var(--text-tertiary)] py-4">No hay logs registrados</p>
            ) : (
              logsAgrupados.map(({ fecha, porUsuario }) => (
                <div key={fecha} className="border border-black/[0.06] rounded-[var(--radius-lg)] overflow-hidden">
                  <div className="bg-black/[0.04] px-3 py-2 font-bold text-[var(--text-primary)] text-sm">
                    📅 {formatFecha(fecha)}
                  </div>
                  <div className="divide-y divide-stone-100">
                    {Object.entries(porUsuario).map(([usuario, logs]) => (
                      <div key={usuario} className="p-3">
                        <div className="font-medium text-[var(--accent-text)] text-sm mb-2">
                          👤 {usuario}
                        </div>
                        <div className="space-y-1 pl-4">
                          {logs.map((log, idx) => (
                            <div key={log.id || idx} className="flex items-start gap-2 text-xs">
                              <span className="text-[var(--text-tertiary)] font-mono whitespace-nowrap">
                                {formatHora(log.fecha)}
                              </span>
                              <span>{getAccionEmoji(log.accion)}</span>
                              <span className="text-[var(--text-secondary)]">{log.descripcion}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    );
  };

  // Parametros View
  const ParametrosView = () => {
    const [tempUmbrales, setTempUmbrales] = useState({
      rojo: umbralStock.rojo.toString(),
      naranja: umbralStock.naranja.toString(),
      amarillo: umbralStock.amarillo.toString(),
    });

    const umbralesChanged =
      tempUmbrales.rojo !== umbralStock.rojo.toString() ||
      tempUmbrales.naranja !== umbralStock.naranja.toString() ||
      tempUmbrales.amarillo !== umbralStock.amarillo.toString();

    const guardarUmbrales = async () => {
      const nuevos = {
        umbralRojo: parseFloat(tempUmbrales.rojo) || 0,
        umbralNaranja: parseFloat(tempUmbrales.naranja) || 0,
        umbralAmarillo: parseFloat(tempUmbrales.amarillo) || 0,
      };
      await onUpdateConfig(nuevos);
    };

    return (
      <div className="space-y-6">
        <h2 className="text-xl font-bold text-[var(--text-primary)]">Ajustes</h2>

        <Card>
          <h3 className="font-bold text-[var(--text-primary)] mb-4">Umbrales de Color del Stock</h3>
          <div className="space-y-4">
            <div className="flex items-center gap-3 p-3 rounded-[var(--radius-lg)] bg-red-50 border border-red-200">
              <div className="w-4 h-4 rounded-full bg-red-500"></div>
              <div className="flex-1">
                <label className="text-sm font-medium text-red-800">Critico (Rojo)</label>
              </div>
              <input type="text" inputMode="numeric" value={tempUmbrales.rojo} onChange={(e) => setTempUmbrales({ ...tempUmbrales, rojo: e.target.value })} className="w-24 border border-red-300 rounded-[var(--radius-md)] px-3 py-2 text-center font-mono focus:outline-none focus:ring-2 focus:ring-red-400" />
              <span className="text-sm text-[var(--text-tertiary)]">g</span>
            </div>
            <div className="flex items-center gap-3 p-3 rounded-[var(--radius-lg)] bg-orange-50 border border-orange-200">
              <div className="w-4 h-4 rounded-full bg-orange-500"></div>
              <div className="flex-1">
                <label className="text-sm font-medium text-orange-800">Bajo (Naranja)</label>
              </div>
              <input type="text" inputMode="numeric" value={tempUmbrales.naranja} onChange={(e) => setTempUmbrales({ ...tempUmbrales, naranja: e.target.value })} className="w-24 border border-orange-300 rounded-[var(--radius-md)] px-3 py-2 text-center font-mono focus:outline-none focus:ring-2 focus:ring-orange-400" />
              <span className="text-sm text-[var(--text-tertiary)]">g</span>
            </div>
            <div className="flex items-center gap-3 p-3 rounded-[var(--radius-lg)] bg-[var(--accent-soft)] border border-[var(--accent-border)]">
              <div className="w-4 h-4 rounded-full bg-[var(--accent)]"></div>
              <div className="flex-1">
                <label className="text-sm font-medium text-[var(--accent-text)]">Medio (Amarillo)</label>
              </div>
              <input type="text" inputMode="numeric" value={tempUmbrales.amarillo} onChange={(e) => setTempUmbrales({ ...tempUmbrales, amarillo: e.target.value })} className="w-24 border border-[var(--accent-border)] rounded-[var(--radius-md)] px-3 py-2 text-center font-mono focus:outline-none focus:ring-2 focus:ring-[var(--accent)]" />
              <span className="text-sm text-[var(--text-tertiary)]">g</span>
            </div>
            <div className="flex items-center gap-3 p-3 rounded-[var(--radius-lg)] bg-emerald-50 border border-emerald-200">
              <div className="w-4 h-4 rounded-full bg-emerald-500"></div>
              <div className="flex-1">
                <label className="text-sm font-medium text-emerald-800">OK (Verde)</label>
              </div>
              <div className="w-24 text-center font-mono text-emerald-700">≥ {tempUmbrales.amarillo || '0'}</div>
              <span className="text-sm text-[var(--text-tertiary)]">g</span>
            </div>
          </div>
          <div className="mt-4">
            <Button onClick={guardarUmbrales} disabled={!umbralesChanged} variant={umbralesChanged ? 'primary' : 'secondary'} className="w-full">
              {umbralesChanged ? 'Guardar Umbrales' : 'Sin cambios'}
            </Button>
          </div>
        </Card>

        {/* Importar datos TODOS CLIENTES - TEMPORAL */}
        <Card>
          <h3 className="font-bold text-blue-700 mb-4">📥 Importar Datos Históricos (Temporal)</h3>
          <p className="text-sm text-[var(--text-secondary)] mb-4">
            Importar lingotes para: NJ (37+13 FUTURA), Milla (3), Orcash (12), Gaudia (25+30 FUTURA), Gemma (3)
          </p>

          {/* Selector de exportación */}
          <div className="mb-4">
            <label className="block text-sm font-medium text-[var(--text-primary)] mb-1">Asignar a Importación:</label>
            <select
              value={importExportacionId}
              onChange={(e) => setImportExportacionId(e.target.value)}
              className="w-full p-2 border border-black/[0.08] rounded-[var(--radius-md)]"
            >
              <option value="">-- Selecciona exportación --</option>
              {exportaciones.map(exp => (
                <option key={exp.id} value={exp.id}>
                  {exp.nombre} ({exp.lingotes?.reduce((a, l) => a + l.cantidad * l.peso, 0) || 0}g total)
                </option>
              ))}
            </select>
          </div>

          <Button
            variant="primary"
            disabled={!importExportacionId}
            onClick={async () => {
              const selectedExp = exportaciones.find(e => e.id === importExportacionId);
              if (!selectedExp) {
                alert('Selecciona una exportación primero');
                return;
              }
              if (!confirm(`¿Importar TODOS los datos históricos asignados a "${selectedExp.nombre}"?\n\nSe crearán entregas y FUTURA para: NJ, Milla, Orcash, Gaudia, Gemma`)) return;

              // IDs de clientes
              const clienteIds = {
                NJ: 'i4s6s7L68w9ErFKxQ3qQ',
                Milla: 'N6nDJCoBzFxhshm5dB6A',
                Orcash: 'yZTyXNSpM0jJvJRYj0Y7',
                Gaudia: 'Uu5XbiExWFB0d5AiugIi',
                Gemma: 'LYn5VsQMazDk4qjT6r6M',
              };

              const calcMargen = (precio, pJofisa, peso) => Math.round((precio - pJofisa) * peso * 100) / 100;

              // ========== NJ ==========
              const njEntregas = {
                '2025-11-05': [
                  { peso: 50, precio: 124.29, importe: 6214.5, nFactura: '2025-167.pdf', fechaCierre: '2025-10-20', pJofisa: 117.5 },
                  { peso: 50, precio: 124.29, importe: 6214.5, nFactura: '2025-168.pdf', fechaCierre: '2025-10-20', pJofisa: 117.5 },
                  { peso: 50, precio: 125.16, importe: 6258, nFactura: '2025-170.pdf', fechaCierre: '2025-10-20', pJofisa: 118.32 },
                  { peso: 50, precio: 127.13, importe: 6356.5, nFactura: '2025-171.pdf', fechaCierre: '2025-10-20', pJofisa: 120.18 },
                  { peso: 50, precio: 121.3, importe: 6065, nFactura: '2025-172.pdf', fechaCierre: '2025-10-21', pJofisa: 114.68 },
                  { peso: 50, precio: 121.3, importe: 6065, nFactura: '2025-173.pdf', fechaCierre: '2025-10-21', pJofisa: 114.68 },
                  { peso: 50, precio: 118.31, importe: 5915.5, nFactura: '2025-174.pdf', fechaCierre: '2025-10-22', pJofisa: 111.86 },
                  { peso: 50, precio: 118.31, importe: 5915.5, nFactura: '2025-175.pdf', fechaCierre: '2025-10-22', pJofisa: 111.86 },
                  { peso: 50, precio: 121.07, importe: 6053.5, nFactura: '2025-176.pdf', fechaCierre: '2025-10-23', pJofisa: 114.46 },
                  { peso: 50, precio: 121.07, importe: 6053.5, nFactura: '2025-177.pdf', fechaCierre: '2025-10-23', pJofisa: 114.46 },
                  { peso: 50, precio: 121.22, importe: 6061, nFactura: '2025-178.pdf', fechaCierre: '2025-10-24', pJofisa: 114.6 },
                  { peso: 50, precio: 121.22, importe: 6061, nFactura: '2025-179.pdf', fechaCierre: '2025-10-24', pJofisa: 114.6 },
                  { peso: 50, precio: 121.22, importe: 6061, nFactura: '2025-180.pdf', fechaCierre: '2025-10-24', pJofisa: 114.6 },
                  { peso: 50, precio: 121.22, importe: 6061, nFactura: '2025-181.pdf', fechaCierre: '2025-10-24', pJofisa: 114.6 },
                  { peso: 50, precio: 121.22, importe: 6061, nFactura: '2025-182.pdf', fechaCierre: '2025-10-24', pJofisa: 114.6 },
                  { peso: 50, precio: 114.69, importe: 5734.5, nFactura: '2025-185.pdf', fechaCierre: '2025-10-28', pJofisa: 108.44 },
                  { peso: 50, precio: 114.69, importe: 5734.5, nFactura: '2025-186.pdf', fechaCierre: '2025-10-28', pJofisa: 108.44 },
                  { peso: 50, precio: 114.69, importe: 5734.5, nFactura: '2025-184.pdf', fechaCierre: '2025-10-28', pJofisa: 108.44 },
                  { peso: 50, precio: 118.28, importe: 5914, nFactura: '2025-192.pdf', fechaCierre: '2025-04-11', pJofisa: 111.83 },
                  { peso: 50, precio: 118.28, importe: 5914, nFactura: '2025-193.pdf', fechaCierre: '2025-04-11', pJofisa: 111.83 },
                  { peso: 50, precio: 121.25, importe: 6062.5, nFactura: '2025-198.pdf', fechaCierre: '2025-10-11', pJofisa: 114.63 },
                  { peso: 50, precio: 121.25, importe: 6062.5, nFactura: '2025-199.pdf', fechaCierre: '2025-10-11', pJofisa: 114.63 },
                  { peso: 50, precio: 119.86, importe: 5993, nFactura: '2025-206.pdf', fechaCierre: '2025-11-17', pJofisa: 113.32 },
                  { peso: 50, precio: 120.35, importe: 6017.5, nFactura: '2025-210.pdf', fechaCierre: '2025-11-20', pJofisa: 113.78 },
                  { peso: 50, precio: 122.27, importe: 6113.5, nFactura: '2025-211.pdf', fechaCierre: '2025-11-27', pJofisa: 115.59 },
                  { peso: 50, precio: 128.11, importe: 6405.5, nFactura: '2025-226.pdf', fechaCierre: '2025-12-22', pJofisa: 121.1 },
                ],
                '2025-11-11': [
                  { peso: 50, precio: 128.11, importe: 6405.5, nFactura: '2025-227.pdf', fechaCierre: '2025-12-22', pJofisa: 121.1 },
                  { peso: 50, precio: 129.39, importe: 6469.5, nFactura: '2025-230.pdf', fechaCierre: '2025-12-29', pJofisa: 122.31 },
                  { peso: 50, precio: 129.39, importe: 6469.5, nFactura: '2025-231.pdf', fechaCierre: '2025-12-29', pJofisa: 122.31 },
                  { peso: 50, precio: 126.83, importe: 6341.5, nFactura: '2025-232.pdf', fechaCierre: '2025-12-30', pJofisa: 119.9 },
                  { peso: 50, precio: 126.83, importe: 6341.5, nFactura: '2025-233.pdf', fechaCierre: '2025-12-30', pJofisa: 119.9 },
                  { peso: 50, precio: 126.83, importe: 6341.5, nFactura: '2025-234.pdf', fechaCierre: '2025-12-30', pJofisa: 119.9 },
                ],
                '2025-12-23': [
                  { peso: 50, precio: 129.46, importe: 6473, nFactura: '2026-1.pdf', fechaCierre: '2026-01-07', pJofisa: 122.38 },
                  { peso: 50, precio: 129.46, importe: 6473, nFactura: '2026-2.pdf', fechaCierre: '2026-01-07', pJofisa: 122.38 },
                  { peso: 50, precio: 129.46, importe: 6473, nFactura: '2026-3.pdf', fechaCierre: '2026-01-07', pJofisa: 122.38 },
                  { peso: 50, precio: 134.02, importe: 6701, nFactura: '2026-9.pdf', fechaCierre: '2026-01-12', pJofisa: 126.68 },
                  { peso: 50, precio: 134.02, importe: 6701, nFactura: '2026-10.pdf', fechaCierre: '2026-01-12', pJofisa: 126.68 },
                ],
              };
              const njFutura = [
                { peso: 50, precio: 136.63, importe: 6831.5, nFactura: '2026-15.pdf', fechaCierre: '2026-01-19', pJofisa: 129.14, pagado: true },
                { peso: 50, precio: 136.63, importe: 6831.5, nFactura: '2026-16.pdf', fechaCierre: '2026-01-19', pJofisa: 129.14, pagado: true },
                { peso: 50, precio: 136.63, importe: 6831.5, nFactura: '2026-17.pdf', fechaCierre: '2026-01-19', pJofisa: 129.14, pagado: true },
                { peso: 50, precio: 136.63, importe: 6831.5, nFactura: '2026-18.pdf', fechaCierre: '2026-01-19', pJofisa: 129.14, pagado: true },
                { peso: 50, precio: 152.51, importe: 7625.5, nFactura: '2026-24.pdf', fechaCierre: '2026-01-29', pJofisa: 144.12, pagado: false },
                { peso: 50, precio: 145.38, importe: 7269, nFactura: null, fechaCierre: '2026-01-30', pJofisa: 136.68, pagado: false },
                { peso: 50, precio: 145.38, importe: 7269, nFactura: null, fechaCierre: '2026-01-30', pJofisa: 136.68, pagado: false },
                { peso: 50, precio: 145.38, importe: 7269, nFactura: null, fechaCierre: '2026-01-30', pJofisa: 136.68, pagado: false },
                { peso: 50, precio: 145.38, importe: 7269, nFactura: null, fechaCierre: '2026-01-30', pJofisa: 136.68, pagado: false },
                { peso: 50, precio: 145.38, importe: 7269, nFactura: null, fechaCierre: '2026-01-30', pJofisa: 136.68, pagado: false },
                { peso: 50, precio: 145.38, importe: 7269, nFactura: null, fechaCierre: '2026-01-30', pJofisa: 136.68, pagado: false },
                { peso: 50, precio: 145.38, importe: 7269, nFactura: null, fechaCierre: '2026-01-30', pJofisa: 136.68, pagado: false },
                { peso: 50, precio: 145.38, importe: 7269, nFactura: null, fechaCierre: '2026-01-30', pJofisa: 136.68, pagado: false },
              ];

              // ========== MILLA ==========
              const millaEntregas = {
                '2025-12-02': [
                  { peso: 55, precio: 123.01, importe: 6765.55, nFactura: '2025-225.pdf', fechaCierre: '2025-12-19', pJofisa: 116.29, estado: 'finalizado', pagado: true },
                ],
                '2025-12-23': [
                  { peso: 50, precio: null, importe: 0, nFactura: null, fechaCierre: null, pJofisa: 0.25, estado: 'en_curso', pagado: false },
                  { peso: 50, precio: null, importe: 0, nFactura: null, fechaCierre: null, pJofisa: 0.25, estado: 'en_curso', pagado: false },
                ],
              };

              // ========== ORCASH ==========
              const orcashEntregas = {
                '2025-11-05': [
                  { peso: 50, precio: 124.54, importe: 6227, nFactura: '2025-169.pdf', fechaCierre: '2025-10-20', pJofisa: 117.74 },
                  { peso: 50, precio: 124.54, importe: 6227, nFactura: '2025-169.pdf', fechaCierre: '2025-10-20', pJofisa: 117.74 },
                  { peso: 50, precio: 124.54, importe: 6227, nFactura: '2025-169.pdf', fechaCierre: '2025-10-20', pJofisa: 117.74 },
                  { peso: 50, precio: 124.54, importe: 6227, nFactura: '2025-169.pdf', fechaCierre: '2025-10-20', pJofisa: 117.74 },
                  { peso: 200, precio: 117.74, importe: 23548, nFactura: '2025-191.pdf', fechaCierre: '2025-05-11', pJofisa: 111.32 },
                  { peso: 50, precio: 117.97, importe: 5898.5, nFactura: '2025-194.pdf', fechaCierre: '2025-06-11', pJofisa: 111.54 },
                  { peso: 50, precio: 117.97, importe: 5898.5, nFactura: '2025-194.pdf', fechaCierre: '2025-06-11', pJofisa: 111.54 },
                  { peso: 50, precio: 117.97, importe: 5898.5, nFactura: '2025-194.pdf', fechaCierre: '2025-06-11', pJofisa: 111.54 },
                  { peso: 50, precio: 117.97, importe: 5898.5, nFactura: '2025-194.pdf', fechaCierre: '2025-06-11', pJofisa: 111.54 },
                ],
              };

              // ========== GAUDIA ==========
              const gaudiaEntregas = {
                '2025-11-05': [
                  { peso: 50, precio: 115.79, importe: 5789.5, nFactura: '2025-151.pdf', fechaCierre: '2025-07-10', pJofisa: 109.48 },
                  { peso: 50, precio: 115.79, importe: 5789.5, nFactura: '2025-151.pdf', fechaCierre: '2025-07-10', pJofisa: 109.48 },
                  { peso: 50, precio: 115.79, importe: 5789.5, nFactura: '2025-151.pdf', fechaCierre: '2025-07-10', pJofisa: 109.48 },
                  { peso: 50, precio: 115.79, importe: 5789.5, nFactura: '2025-151.pdf', fechaCierre: '2025-07-10', pJofisa: 109.48 },
                  { peso: 50, precio: 115.79, importe: 5789.5, nFactura: '2025-151.pdf', fechaCierre: '2025-07-10', pJofisa: 109.48 },
                  { peso: 50, precio: 115.79, importe: 5789.5, nFactura: '2025-151.pdf', fechaCierre: '2025-07-10', pJofisa: 109.48 },
                  { peso: 50, precio: 115.79, importe: 5789.5, nFactura: '2025-151.pdf', fechaCierre: '2025-07-10', pJofisa: 109.48 },
                  { peso: 50, precio: 115.79, importe: 5789.5, nFactura: '2025-151.pdf', fechaCierre: '2025-07-10', pJofisa: 109.48 },
                  { peso: 50, precio: 115.79, importe: 5789.5, nFactura: '2025-151.pdf', fechaCierre: '2025-07-10', pJofisa: 109.48 },
                  { peso: 50, precio: 115.79, importe: 5789.5, nFactura: '2025-151.pdf', fechaCierre: '2025-07-10', pJofisa: 109.48 },
                  { peso: 50, precio: 115.79, importe: 5789.5, nFactura: '2025-151.pdf', fechaCierre: '2025-07-10', pJofisa: 109.48 },
                  { peso: 50, precio: 115.79, importe: 5789.5, nFactura: '2025-151.pdf', fechaCierre: '2025-07-10', pJofisa: 109.48 },
                  { peso: 50, precio: 115.79, importe: 5789.5, nFactura: '2025-151.pdf', fechaCierre: '2025-07-10', pJofisa: 109.48 },
                  { peso: 50, precio: 115.79, importe: 5789.5, nFactura: '2025-151.pdf', fechaCierre: '2025-07-10', pJofisa: 109.48 },
                  { peso: 50, precio: 115.79, importe: 5789.5, nFactura: '2025-151.pdf', fechaCierre: '2025-07-10', pJofisa: 109.48 },
                  { peso: 50, precio: 115.79, importe: 5789.5, nFactura: '2025-151.pdf', fechaCierre: '2025-07-10', pJofisa: 109.48 },
                  { peso: 50, precio: 115.79, importe: 5789.5, nFactura: '2025-151.pdf', fechaCierre: '2025-07-10', pJofisa: 109.48 },
                  { peso: 50, precio: 115.79, importe: 5789.5, nFactura: '2025-151.pdf', fechaCierre: '2025-07-10', pJofisa: 109.48 },
                  { peso: 50, precio: 115.79, importe: 5789.5, nFactura: '2025-151.pdf', fechaCierre: '2025-07-10', pJofisa: 109.48 },
                  { peso: 50, precio: 119.37, importe: 5968.5, nFactura: '2025-201.pdf', fechaCierre: '2025-11-17', pJofisa: 112.86 },
                  { peso: 50, precio: 119.37, importe: 5968.5, nFactura: '2025-201.pdf', fechaCierre: '2025-11-17', pJofisa: 112.86 },
                  { peso: 50, precio: 119.37, importe: 5968.5, nFactura: '2025-201.pdf', fechaCierre: '2025-11-17', pJofisa: 112.86 },
                  { peso: 50, precio: 119.37, importe: 5968.5, nFactura: '2025-201.pdf', fechaCierre: '2025-11-17', pJofisa: 112.86 },
                ],
                '2025-11-18': [
                  { peso: 50, precio: 123.23, importe: 6161.5, nFactura: '2025-213.pdf', fechaCierre: '2025-04-12', pJofisa: 116.5 },
                  { peso: 50, precio: 123.08, importe: 6154, nFactura: '2025-214.pdf', fechaCierre: '2025-08-12', pJofisa: 116.36 },
                  { peso: 50, precio: 129.66, importe: 6483, nFactura: '2025-229.pdf', fechaCierre: '2025-12-29', pJofisa: 122.57 },
                  { peso: 50, precio: 129.66, importe: 6483, nFactura: '2025-229.pdf', fechaCierre: '2025-12-29', pJofisa: 122.57 },
                ],
                '2025-12-23': [
                  { peso: 50, precio: 129.66, importe: 6483, nFactura: '2025-229.pdf', fechaCierre: '2025-12-29', pJofisa: 122.57 },
                ],
              };
              const gaudiaFutura = [
                { peso: 50, precio: 150.5, importe: 7525, nFactura: null, fechaCierre: '2026-01-28', pJofisa: 142.23, pagado: false },
                { peso: 50, precio: 150.5, importe: 7525, nFactura: null, fechaCierre: '2026-01-28', pJofisa: 142.23, pagado: false },
                { peso: 50, precio: 150.5, importe: 7525, nFactura: null, fechaCierre: '2026-01-28', pJofisa: 142.23, pagado: false },
                { peso: 50, precio: 150.5, importe: 7525, nFactura: null, fechaCierre: '2026-01-28', pJofisa: 142.23, pagado: false },
                { peso: 50, precio: 150.5, importe: 7525, nFactura: null, fechaCierre: '2026-01-28', pJofisa: 142.23, pagado: false },
                { peso: 50, precio: 150.5, importe: 7525, nFactura: null, fechaCierre: '2026-01-28', pJofisa: 142.23, pagado: false },
                { peso: 50, precio: 150.5, importe: 7525, nFactura: null, fechaCierre: '2026-01-28', pJofisa: 142.23, pagado: false },
                { peso: 50, precio: 150.5, importe: 7525, nFactura: null, fechaCierre: '2026-01-28', pJofisa: 142.23, pagado: false },
                { peso: 50, precio: 150.5, importe: 7525, nFactura: null, fechaCierre: '2026-01-28', pJofisa: 142.23, pagado: false },
                { peso: 50, precio: 150.5, importe: 7525, nFactura: null, fechaCierre: '2026-01-28', pJofisa: 142.23, pagado: false },
                { peso: 50, precio: 150.5, importe: 7525, nFactura: null, fechaCierre: '2026-01-28', pJofisa: 142.23, pagado: false },
                { peso: 50, precio: 150.5, importe: 7525, nFactura: null, fechaCierre: '2026-01-28', pJofisa: 142.23, pagado: false },
                { peso: 50, precio: 150.5, importe: 7525, nFactura: null, fechaCierre: '2026-01-28', pJofisa: 142.23, pagado: false },
                { peso: 50, precio: 150.5, importe: 7525, nFactura: null, fechaCierre: '2026-01-28', pJofisa: 142.23, pagado: false },
                { peso: 50, precio: 150.5, importe: 7525, nFactura: null, fechaCierre: '2026-01-28', pJofisa: 142.23, pagado: false },
                { peso: 50, precio: 150.5, importe: 7525, nFactura: null, fechaCierre: '2026-01-28', pJofisa: 142.23, pagado: false },
                { peso: 50, precio: 150.5, importe: 7525, nFactura: null, fechaCierre: '2026-01-28', pJofisa: 142.23, pagado: false },
                { peso: 50, precio: 150.5, importe: 7525, nFactura: null, fechaCierre: '2026-01-28', pJofisa: 142.23, pagado: false },
                { peso: 50, precio: 150.5, importe: 7525, nFactura: null, fechaCierre: '2026-01-28', pJofisa: 142.23, pagado: false },
                { peso: 50, precio: 150.5, importe: 7525, nFactura: null, fechaCierre: '2026-01-28', pJofisa: 142.23, pagado: false },
                { peso: 50, precio: 150.5, importe: 7525, nFactura: null, fechaCierre: '2026-01-28', pJofisa: 142.23, pagado: false },
                { peso: 50, precio: 150.5, importe: 7525, nFactura: null, fechaCierre: '2026-01-28', pJofisa: 142.23, pagado: false },
                { peso: 50, precio: 150.5, importe: 7525, nFactura: null, fechaCierre: '2026-01-28', pJofisa: 142.23, pagado: false },
                { peso: 50, precio: 150.5, importe: 7525, nFactura: null, fechaCierre: '2026-01-28', pJofisa: 142.23, pagado: false },
                { peso: 50, precio: 150.5, importe: 7525, nFactura: null, fechaCierre: '2026-01-28', pJofisa: 142.23, pagado: false },
                { peso: 50, precio: 150.5, importe: 7525, nFactura: null, fechaCierre: '2026-01-28', pJofisa: 142.23, pagado: false },
                { peso: 50, precio: 150.5, importe: 7525, nFactura: null, fechaCierre: '2026-01-28', pJofisa: 142.23, pagado: false },
                { peso: 50, precio: 150.5, importe: 7525, nFactura: null, fechaCierre: '2026-01-28', pJofisa: 142.23, pagado: false },
                { peso: 50, precio: 150.5, importe: 7525, nFactura: null, fechaCierre: '2026-01-28', pJofisa: 142.23, pagado: false },
                { peso: 50, precio: 150.5, importe: 7525, nFactura: null, fechaCierre: '2026-01-28', pJofisa: 142.23, pagado: false },
              ];

              // ========== GEMMA ==========
              const gemmaEntregas = {
                '2025-11-05': [
                  { peso: 50, precio: 123.01, importe: 6150.5, nFactura: '2025-215.pdf', fechaCierre: '2025-09-12', pJofisa: 116.29 },
                  { peso: 50, precio: 137.22, importe: 6861, nFactura: '2026-19.pdf', fechaCierre: '2026-01-20', pJofisa: 129.7 },
                  { peso: 50, precio: 140.59, importe: 7029.5, nFactura: '2026-20.pdf', fechaCierre: '2026-01-22', pJofisa: 132.88 },
                ],
              };

              // Acumulador para descontar del stock
              const stockADescontar = {}; // { peso: cantidad }

              // Función para crear entregas
              const crearEntregas = async (clienteId, clienteNombre, entregasData) => {
                for (const [fechaEntrega, lingotesEntrega] of Object.entries(entregasData)) {
                  const existe = entregas.find(e => e.clienteId === clienteId && e.fechaEntrega === fechaEntrega);
                  if (existe) {
                    console.log(`${clienteNombre}: Entrega ${fechaEntrega} ya existe, saltando...`);
                    continue;
                  }

                  const lingotes = lingotesEntrega.map(l => ({
                    peso: l.peso,
                    estado: l.estado || 'finalizado',
                    precio: l.precio,
                    importe: l.importe,
                    precioJofisa: l.pJofisa,
                    margenCierre: l.precio ? calcMargen(l.precio, l.pJofisa, l.peso) : 0,
                    fechaCierre: l.fechaCierre,
                    nFactura: l.nFactura,
                    pagado: l.pagado !== undefined ? l.pagado : true,
                    pesoDevuelto: 0,
                  }));

                  // Acumular para descontar del stock
                  for (const l of lingotesEntrega) {
                    stockADescontar[l.peso] = (stockADescontar[l.peso] || 0) + 1;
                  }

                  await onSaveEntrega({
                    clienteId: clienteId,
                    fechaEntrega: fechaEntrega,
                    exportacionNombre: selectedExp.nombre,
                    exportacionId: selectedExp.id,
                    lingotes: lingotes,
                    logs: [{ fecha: new Date().toISOString(), usuario: 'import', accion: `Importación CSV - ${clienteNombre}` }],
                  });
                  console.log(`✅ ${clienteNombre}: Creada entrega ${fechaEntrega} con ${lingotes.length} lingotes`);
                }
              };

              // Función para crear FUTURA
              const crearFutura = async (clienteId, clienteNombre, futuraData) => {
                for (const f of futuraData) {
                  await onSaveFutura({
                    clienteId: clienteId,
                    peso: f.peso,
                    precio: f.precio,
                    importe: f.importe,
                    precioJofisa: f.pJofisa,
                    margenCierre: calcMargen(f.precio, f.pJofisa, f.peso),
                    fechaCierre: f.fechaCierre,
                    nFactura: f.nFactura,
                    pagado: f.pagado,
                    fechaCreacion: new Date().toISOString(),
                  });
                }
                console.log(`✅ ${clienteNombre}: Creados ${futuraData.length} FUTURA`);
              };

              try {
                // NJ
                await crearEntregas(clienteIds.NJ, 'NJ', njEntregas);
                await crearFutura(clienteIds.NJ, 'NJ', njFutura);

                // Milla
                await crearEntregas(clienteIds.Milla, 'Milla', millaEntregas);

                // Orcash
                await crearEntregas(clienteIds.Orcash, 'Orcash', orcashEntregas);

                // Gaudia
                await crearEntregas(clienteIds.Gaudia, 'Gaudia', gaudiaEntregas);
                await crearFutura(clienteIds.Gaudia, 'Gaudia', gaudiaFutura);

                // Gemma
                await crearEntregas(clienteIds.Gemma, 'Gemma', gemmaEntregas);

                alert(`✅ Importación completada!\n\nNJ: 3 entregas + 13 FUTURA\nMilla: 2 entregas\nOrcash: 1 entrega\nGaudia: 3 entregas + 30 FUTURA\nGemma: 1 entrega\n\n📦 Stock se recalcula automáticamente`);
              } catch (err) {
                console.error('Error:', err);
                alert('Error: ' + err.message);
              }
            }}
          >
            📥 Importar TODOS los datos históricos
          </Button>
        </Card>

        {/* Log General - Solo Alex */}
        {currentUser === 'Alex' && (
          <Card>
            <h3 className="font-bold text-[var(--text-primary)] mb-4">📋 Log General de Actividad</h3>
            <LogGeneralSection logsGenerales={logsGenerales} loadLogsGenerales={loadLogsGenerales} />
          </Card>
        )}

        {/* Reset data */}
        <Card>
          <h3 className="font-bold text-red-700 mb-4">⚠️ Zona Peligrosa</h3>
          <p className="text-sm text-[var(--text-secondary)] mb-4">
            Borrar todos los datos de lingotes: exportaciones ({exportaciones.length}), entregas ({entregas.length}) y FUTURA ({(futuraLingotes || []).length}).
          </p>
          <Button
            variant="danger"
            onClick={async () => {
              if (!confirm('¿Estás seguro? Esto borrará TODAS las exportaciones, entregas y datos FUTURA. Esta acción no se puede deshacer.')) return;
              if (!confirm('¿SEGURO SEGURO? Última oportunidad para cancelar.')) return;
              // Delete all
              for (const exp of exportaciones) {
                await onDeleteExportacion(exp.id);
              }
              for (const ent of entregas) {
                await onDeleteEntrega(ent.id);
              }
              for (const f of (futuraLingotes || [])) {
                await onDeleteFutura(f.id);
              }
              alert('Datos borrados correctamente');
            }}
          >
            🗑️ Borrar todos los datos
          </Button>
        </Card>
      </div>
    );
  };

  // Entrega Modal - creates multiple lingotes at once, deducting from stock
  const EntregaModal = () => {
    const defaultClienteId = editingEntregaClienteId || clientes[0]?.id || '';
    // Find first exportacion with stock
    const exportacionesConStock = exportaciones.filter(e => getStockDisponible(e.id).some(l => l.cantidad > 0));
    const defaultExportacionId = exportacionesConStock[0]?.id || exportaciones[0]?.id || '';
    const defaultFecha = new Date().toISOString().split('T')[0];

    const [formData, setFormData] = useState({
      clienteId: defaultClienteId,
      exportacionId: defaultExportacionId,
      fechaEntrega: defaultFecha,
      items: [], // Will be populated based on selected exportacion
    });

    // Get stock for selected exportacion
    const selectedExportacion = exportaciones.find(e => e.id === formData.exportacionId);
    const stockExportacion = selectedExportacion ? getStockDisponible(selectedExportacion.id) : [];

    // FUTURA detection: find client's pending FUTURA, sorted oldest first
    const clienteFuturaForModal = (futuraLingotes || [])
      .filter(f => f.clienteId === formData.clienteId)
      .sort((a, b) => new Date(a.fechaCreacion || 0) - new Date(b.fechaCreacion || 0));

    // Group FUTURA by peso
    const futuraByPeso = {};
    clienteFuturaForModal.forEach(f => {
      if (!futuraByPeso[f.peso]) futuraByPeso[f.peso] = [];
      futuraByPeso[f.peso].push(f);
    });

    // Build items list based on selected exportacion's stock
    const itemsWithStock = stockExportacion.map(l => {
      const existingItem = formData.items.find(i => i.peso === l.peso);
      const futuraForPeso = futuraByPeso[l.peso] || [];
      const cantidad = existingItem?.cantidad || 0;
      const futuraAutoAssign = Math.min(cantidad, futuraForPeso.length);
      return {
        peso: l.peso,
        cantidad,
        disponible: l.cantidad,
        futuraCount: futuraForPeso.length,
        futuraAutoAssign,
        freshCount: cantidad - futuraAutoAssign,
      };
    });

    // Check if all items have sufficient stock
    const allStockSuficiente = itemsWithStock.every(item => item.cantidad <= item.disponible);
    const hasAnyItems = itemsWithStock.some(item => item.cantidad > 0);

    // Totals
    const totalLingotes = itemsWithStock.reduce((sum, i) => sum + i.cantidad, 0);
    const totalGramos = itemsWithStock.reduce((sum, i) => sum + (i.cantidad * i.peso), 0);
    const totalFuturaAssigned = itemsWithStock.reduce((sum, i) => sum + i.futuraAutoAssign, 0);

    // Check if form has meaningful changes from defaults
    const hasChanges = hasAnyItems ||
      formData.clienteId !== defaultClienteId ||
      formData.fechaEntrega !== defaultFecha;

    const updateItemCantidad = (peso, cantidad) => {
      const existingItems = [...formData.items];
      const idx = existingItems.findIndex(i => i.peso === peso);
      if (idx >= 0) {
        existingItems[idx] = { ...existingItems[idx], cantidad: Math.max(0, cantidad) };
      } else {
        existingItems.push({ peso, cantidad: Math.max(0, cantidad) });
      }
      setFormData({ ...formData, items: existingItems });
    };

    const handleExportacionChange = (newExpId) => {
      // Reset items when changing exportacion
      setFormData({ ...formData, exportacionId: newExpId, items: [] });
    };

    const handleClose = () => {
      if (hasChanges && !confirm('¿Descartar los cambios?')) return;
      setShowEntregaModal(false);
      setEditingEntregaClienteId(null);
    };

    const handleSubmit = () => {
      const activeItems = formData.items.filter(i => i.cantidad > 0);

      // Compute which FUTURA IDs to assign, per peso, oldest first
      const futuraToAssign = [];
      for (const item of activeItems) {
        const futuraForPeso = (futuraByPeso[item.peso] || []);
        const assignCount = Math.min(item.cantidad, futuraForPeso.length);
        for (let i = 0; i < assignCount; i++) {
          futuraToAssign.push(futuraForPeso[i].id);
        }
      }

      addEntrega({
        clienteId: formData.clienteId,
        exportacionId: formData.exportacionId,
        fechaEntrega: formData.fechaEntrega,
        items: activeItems,
        futuraIdsToAssign: futuraToAssign,
      });
    };

    return (
      <div className="fixed inset-0 glass-overlay overlay-animate flex items-center justify-center z-50 p-4" onClick={handleClose}>
        <div className="glass-modal modal-animate rounded-[var(--radius-2xl)] p-6 w-full max-w-md shadow-2xl max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
          <h3 className="text-xl font-bold text-[var(--text-primary)] mb-4">Nueva Entrega</h3>

          {exportacionesConStock.length === 0 ? (
            <div className="bg-[var(--accent-soft)] rounded-[var(--radius-lg)] p-4 mb-4">
              <p className="text-[var(--accent)] text-sm text-center">No hay stock en ninguna exportación. Crea una exportación primero.</p>
            </div>
          ) : (
            <>
              {/* Exportación, Cliente y Fecha */}
              <div className="space-y-4 mb-4">
                <div>
                  <label className="block text-sm font-medium text-[var(--text-primary)] mb-1">📦 Importación</label>
                  <select
                    value={formData.exportacionId}
                    onChange={(e) => handleExportacionChange(e.target.value)}
                    className="w-full border border-[var(--accent)] bg-[var(--accent-soft)] rounded-[var(--radius-lg)] px-4 py-3 font-semibold focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
                  >
                    {exportacionesConStock.map(exp => {
                      const expStock = getStockDisponible(exp.id);
                      const stockTotal = expStock.reduce((sum, l) => sum + (l.cantidad * l.peso), 0);
                      return (
                        <option key={exp.id} value={exp.id}>
                          {exp.nombre} — {formatNum(stockTotal, 0)}g disponibles
                        </option>
                      );
                    })}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-[var(--text-primary)] mb-1">Cliente</label>
                  <select value={formData.clienteId} onChange={(e) => setFormData({ ...formData, clienteId: e.target.value })} className="w-full border border-black/[0.08] rounded-[var(--radius-lg)] px-4 py-3 focus:outline-none focus:ring-2 focus:ring-[var(--accent)]">
                    {clientes.map(c => (
                      <option key={c.id} value={c.id}>{c.nombre}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-[var(--text-primary)] mb-1">Fecha Entrega</label>
                  <input type="date" value={formData.fechaEntrega} onChange={(e) => setFormData({ ...formData, fechaEntrega: e.target.value })} className="w-full border border-black/[0.08] rounded-[var(--radius-lg)] px-4 py-3 focus:outline-none focus:ring-2 focus:ring-[var(--accent)]" />
                </div>
              </div>

              {/* FUTURA banner */}
              {clienteFuturaForModal.length > 0 && (
                <div className="bg-purple-50 border border-purple-200 rounded-[var(--radius-lg)] p-3 mb-4">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-sm font-bold text-purple-800">⏳ FUTURA pendientes</span>
                  </div>
                  <p className="text-xs text-purple-600 mb-2">
                    Se incluirán automáticamente al crear la entrega.
                  </p>
                  {Object.entries(futuraByPeso).map(([peso, futuras]) => {
                    const conPrecio = futuras.filter(f => f.precio);
                    return (
                      <div key={peso} className="flex justify-between text-sm py-0.5">
                        <span className="font-mono text-purple-700">{peso}g × {futuras.length}</span>
                        <span className="text-purple-500 text-xs">
                          {conPrecio.length > 0 ? `${conPrecio.length} cerrados` : 'sin cerrar'}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Lingotes por tipo de la exportación seleccionada */}
              <div className="bg-[var(--accent-soft)] rounded-[var(--radius-lg)] p-3 mb-4">
                <p className="text-xs text-[var(--accent-text)] font-medium mb-3">
                  Stock de "{selectedExportacion?.nombre || '?'}"
                </p>
                <div className="space-y-3">
                  {itemsWithStock.map((item, idx) => {
                    const stockInsuficiente = item.cantidad > item.disponible;
                    return (
                      <div key={idx} className={`bg-white rounded-[var(--radius-lg)] p-3 border ${stockInsuficiente ? 'border-red-300' : 'border-[var(--accent-border)]'}`}>
                        <div className="flex items-center justify-between mb-2">
                          <span className="font-semibold text-[var(--text-primary)]">{item.peso}g</span>
                          <span className={`text-xs ${stockInsuficiente ? 'text-red-600' : 'text-green-600'}`}>
                            disponibles: {item.disponible}
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => updateItemCantidad(item.peso, item.cantidad - 1)}
                            className="w-10 h-10 rounded-[var(--radius-lg)] bg-black/[0.04] hover:bg-black/[0.06] text-[var(--text-secondary)] font-bold text-xl"
                            disabled={item.cantidad === 0}
                          >
                            −
                          </button>
                          <input
                            type="number"
                            inputMode="numeric"
                            value={item.cantidad}
                            onChange={(e) => updateItemCantidad(item.peso, parseInt(e.target.value) || 0)}
                            className={`flex-1 border rounded-[var(--radius-lg)] px-3 py-2 text-center font-bold text-lg focus:outline-none focus:ring-2 ${
                              stockInsuficiente
                                ? 'border-red-300 text-red-600 focus:ring-red-400'
                                : item.cantidad > 0
                                  ? 'border-[var(--accent)] text-[var(--accent-text)] bg-[var(--accent-soft)] focus:ring-[var(--accent)]'
                                  : 'border-black/[0.08] text-[var(--text-tertiary)] focus:ring-[var(--accent)]'
                            }`}
                            min="0"
                            max={item.disponible}
                          />
                          <button
                            onClick={() => updateItemCantidad(item.peso, item.cantidad + 1)}
                            className="w-10 h-10 rounded-[var(--radius-lg)] bg-[var(--accent-soft)] hover:bg-[var(--accent-border)] text-[var(--accent-text)] font-bold text-xl"
                            disabled={item.cantidad >= item.disponible}
                          >
                            +
                          </button>
                          {item.disponible > 0 && (
                            <button
                              onClick={() => updateItemCantidad(item.peso, item.disponible)}
                              className="px-2 py-1 rounded-[var(--radius-md)] bg-black/[0.04] hover:bg-black/[0.06] text-[var(--text-tertiary)] text-xs"
                            >
                              Max
                            </button>
                          )}
                        </div>
                        {item.cantidad > 0 && (
                          <div className="mt-2 flex justify-between items-center text-sm">
                            {item.futuraCount > 0 && item.futuraAutoAssign > 0 ? (
                              <span className="text-purple-600 text-xs font-medium">
                                {item.futuraAutoAssign} FUTURA + {item.freshCount} nuevos
                              </span>
                            ) : <span />}
                            <span className="text-[var(--text-tertiary)]">= {item.cantidad * item.peso}g</span>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Summary - altura fija para evitar que se muevan los botones */}
              <div className={`rounded-[var(--radius-lg)] p-4 text-center min-h-[80px] flex flex-col justify-center ${allStockSuficiente && hasAnyItems ? 'bg-emerald-50' : hasAnyItems ? 'bg-red-50' : 'bg-black/[0.02]'}`}>
                {hasAnyItems ? (
                  <>
                    <div className="text-sm text-[var(--text-tertiary)] mb-1">Total entrega:</div>
                    <div className={`font-bold text-xl ${allStockSuficiente ? 'text-emerald-700' : 'text-red-700'}`}>
                      {totalLingotes} lingotes = {formatNum(totalGramos, 0)}g
                    </div>
                    <div className="text-xs text-[var(--text-tertiary)] mt-1">
                      {itemsWithStock.filter(i => i.cantidad > 0).map(i => `${i.cantidad}×${i.peso}g`).join(' + ')}
                    </div>
                    {totalFuturaAssigned > 0 && (
                      <div className="text-xs text-purple-600 font-medium mt-1">
                        ⏳ {totalFuturaAssigned} FUTURA + {totalLingotes - totalFuturaAssigned} nuevos
                      </div>
                    )}
                    {!allStockSuficiente && (
                      <p className="text-red-600 text-xs mt-2">⚠️ Stock insuficiente en algún tipo</p>
                    )}
                  </>
                ) : (
                  <p className="text-[var(--text-tertiary)] text-sm">Selecciona al menos un lingote</p>
                )}
              </div>
            </>
          )}

          <div className="flex gap-3 mt-6">
            <Button variant="secondary" className="flex-1" onClick={handleClose}>Cancelar</Button>
            <Button
              className="flex-1"
              onClick={handleSubmit}
              disabled={!allStockSuficiente || !hasAnyItems || stockGlobal.length === 0}
            >
              Registrar
            </Button>
          </div>
        </div>
      </div>
    );
  };

  // Cierre Modal - close one or multiple lingotes (entrega or futura standalone)
  const CierreModal = () => {
    const isFuturaCierre = !!selectedFuturaId;
    const isMultiEntregaCierre = selectedEntrega?._allEntregasIndices?.length > 1;
    const isBulkCierre = selectedLingoteIndices.length > 1 || isMultiEntregaCierre;
    const isBulkFuturaCierre = isFuturaCierre && selectedFuturaIds.length > 1;
    const futuraDoc = isFuturaCierre ? (futuraLingotes || []).find(f => f.id === selectedFuturaId) : null;
    const lingote = isFuturaCierre ? futuraDoc : selectedEntrega?.lingotes?.[selectedLingoteIdx];

    // Calcular cantidad y peso total para multi-entrega
    let cantidadLingotes = 1;
    let pesoTotalMulti = 0;
    let resumenMulti = '';
    if (isBulkFuturaCierre) {
      // Múltiples FUTURA
      cantidadLingotes = selectedFuturaIds.length;
    } else if (isMultiEntregaCierre) {
      const allIndices = selectedEntrega._allEntregasIndices;
      const todosLingotes = allIndices.flatMap(({ entregaId, indices }) => {
        const e = entregas.find(x => x.id === entregaId);
        return indices.map(idx => e?.lingotes?.[idx]).filter(Boolean);
      });
      cantidadLingotes = todosLingotes.length;
      pesoTotalMulti = todosLingotes.reduce((s, l) => s + (l.peso || 0), 0);
      // Agrupar por peso
      const porPeso = {};
      todosLingotes.forEach(l => {
        if (!porPeso[l.peso]) porPeso[l.peso] = 0;
        porPeso[l.peso]++;
      });
      resumenMulti = Object.entries(porPeso).map(([p, c]) => `${c} x ${p}g`).join(' + ');
    } else if (isBulkCierre) {
      cantidadLingotes = selectedLingoteIndices.length;
    }

    const defaultEuroOnza = lingote?.euroOnza || '';
    const defaultPrecioJofisa = lingote?.precioJofisa || '';
    const defaultBaseCliente = lingote?.baseCliente || '';
    const defaultNFactura = lingote?.nFactura || '';
    const [euroOnzaConfirmado, setEuroOnzaConfirmado] = useState(!!defaultEuroOnza);
    const [formData, setFormData] = useState({
      euroOnza: defaultEuroOnza,
      baseCliente: defaultBaseCliente,
      precioJofisa: defaultPrecioJofisa,
      margen: 6,
      fechaCierre: new Date().toISOString().split('T')[0],
      nFactura: defaultNFactura,
      devolucion: 0,
    });

    // Check if form has meaningful changes
    const hasChanges = formData.euroOnza !== defaultEuroOnza ||
      formData.precioJofisa !== defaultPrecioJofisa ||
      formData.baseCliente !== defaultBaseCliente ||
      formData.nFactura !== defaultNFactura ||
      formData.devolucion !== 0 ||
      formData.margen !== 6;

    const closeCierreModal = () => {
      if (hasChanges && !confirm('¿Descartar los cambios del cierre?')) return;
      setShowCierreModal(false);
      setSelectedEntrega(null);
      setSelectedLingoteIdx(null);
      setSelectedLingoteIndices([]);
      setSelectedFuturaId(null);
    };

    if (!lingote) return null;
    if (!isFuturaCierre && (!selectedEntrega || selectedLingoteIdx === null)) return null;

    const clienteId = isFuturaCierre ? futuraDoc.clienteId : selectedEntrega.clienteId;
    const cliente = getCliente(clienteId);
    const pesoUnitario = lingote.peso || 0;
    const pesoNetoUnitario = pesoUnitario - formData.devolucion;
    // Para multi-entrega, usar el peso total calculado
    const pesoTotalNeto = isMultiEntregaCierre ? pesoTotalMulti : (pesoNetoUnitario * cantidadLingotes);

    // Calculations
    const euroOnzaNum = parseFloat(formData.euroOnza) || 0;
    // Base solo se calcula si euroOnza está confirmado
    const base = (euroOnzaConfirmado && euroOnzaNum) ? Math.ceil((euroOnzaNum / 31.10349) * 100) / 100 : 0;
    const baseClienteNum = parseFloat(formData.baseCliente) || 0;
    const precioJofisaNum = parseFloat(formData.precioJofisa) || 0;
    const importeJofisaTotal = precioJofisaNum * pesoTotalNeto;
    const margenNum = parseFloat(formData.margen) || 0;
    const precioCliente = baseClienteNum ? Math.round((baseClienteNum * (1 + margenNum / 100)) * 100) / 100 : 0;
    const importeClienteTotal = precioCliente * pesoTotalNeto;

    // Auto-fill baseCliente y precioJofisa cuando se confirma euroOnza
    const confirmarEuroOnza = () => {
      if (!euroOnzaNum) return;
      const baseCalc = Math.ceil((euroOnzaNum / 31.10349) * 100) / 100;
      const precioJofisaCalc = Math.round((baseCalc + 0.25) * 100) / 100;
      setFormData(prev => ({
        ...prev,
        baseCliente: prev.baseCliente || baseCalc.toFixed(2),
        precioJofisa: prev.precioJofisa || precioJofisaCalc.toFixed(2),
      }));
      setEuroOnzaConfirmado(true);
    };

    const handleConfirm = () => {
      // Margen cierre = diferencia base cliente vs base calculada × peso
      const margenCierre = (baseClienteNum - base) * pesoTotalNeto;
      // Margen total = importe cliente - importe jofisa
      const margenTotal = importeClienteTotal - importeJofisaTotal;
      const cierreData = {
        euroOnza: euroOnzaNum,
        base,
        baseCliente: baseClienteNum,
        precioJofisa: precioJofisaNum,
        margen: margenNum,
        precio: precioCliente,
        fechaCierre: formData.fechaCierre,
        nFactura: formData.nFactura,
        devolucion: formData.devolucion,
        margenCierre: Math.round(margenCierre * 100) / 100,
        margenTotal: Math.round(margenTotal * 100) / 100,
      };
      if (isFuturaCierre) {
        if (selectedFuturaIds.length > 1) {
          cerrarFuturaMultiple(selectedFuturaIds, cierreData);
        } else {
          cerrarFutura(selectedFuturaId, cierreData);
        }
      } else if (isBulkCierre) {
        cerrarLingotes(selectedEntrega.id, selectedLingoteIndices, cierreData);
      } else {
        cerrarLingotes(selectedEntrega.id, [selectedLingoteIdx], cierreData);
      }
    };

    return (
      <div className="fixed inset-0 glass-overlay overlay-animate flex items-center justify-center z-50 p-4" onClick={closeCierreModal}>
        <div className="glass-modal modal-animate rounded-[var(--radius-2xl)] p-6 w-full max-w-md shadow-2xl max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
          <h3 className="text-xl font-bold text-[var(--text-primary)] mb-2">
            Cerrar {cantidadLingotes > 1 ? `${cantidadLingotes} Lingotes` : 'Lingote'}
          </h3>
          <p className="text-[var(--text-tertiary)] text-sm mb-6">
            {cliente?.nombre} • {isMultiEntregaCierre
              ? `${resumenMulti} = ${pesoTotalMulti}g`
              : `${cantidadLingotes > 1 ? `${cantidadLingotes} x ` : ''}${pesoUnitario}g${cantidadLingotes > 1 ? ` = ${pesoUnitario * cantidadLingotes}g` : ''}`
            }
            {isFuturaCierre ? ' (FUTURA)' : ''}
          </p>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-[var(--text-primary)] mb-1">€/Onza</label>
              <div className="flex gap-2">
                <input
                  type="number"
                  inputMode="decimal"
                  step="0.01"
                  value={formData.euroOnza}
                  onChange={(e) => {
                    setFormData({ ...formData, euroOnza: e.target.value });
                    setEuroOnzaConfirmado(false);
                  }}
                  className={`flex-1 border rounded-[var(--radius-lg)] px-4 py-3 text-lg font-mono focus:outline-none focus:ring-2 focus:ring-[var(--accent)] ${euroOnzaConfirmado ? 'border-emerald-400 bg-emerald-50' : 'border-black/[0.08]'}`}
                  placeholder="Ej: 3693,42"
                  autoFocus
                />
                <button
                  type="button"
                  onClick={confirmarEuroOnza}
                  disabled={!euroOnzaNum || euroOnzaConfirmado}
                  className={`px-4 py-2 rounded-[var(--radius-lg)] font-semibold transition-all ${
                    euroOnzaConfirmado
                      ? 'bg-emerald-100 text-emerald-600 cursor-default'
                      : euroOnzaNum
                        ? 'bg-[var(--accent)] text-white hover:bg-[var(--accent-hover)]'
                        : 'bg-black/[0.06] text-[var(--text-tertiary)] cursor-not-allowed'
                  }`}
                >
                  {euroOnzaConfirmado ? '✓' : 'OK'}
                </button>
              </div>
            </div>
            {base > 0 && (
              <div className="bg-black/[0.02] rounded-[var(--radius-lg)] p-3">
                <div className="flex justify-between text-sm">
                  <span className="text-[var(--text-tertiary)]">Base (€/Onza ÷ 31,10349):</span>
                  <span className="font-mono font-semibold text-[var(--text-primary)]">{formatNum(base)} €/g</span>
                </div>
              </div>
            )}
            <div>
              <label className="block text-sm font-medium text-[var(--text-primary)] mb-1">Base Cliente (€/g)</label>
              <input type="number" inputMode="decimal" step="0.01" value={formData.baseCliente} onChange={(e) => setFormData({ ...formData, baseCliente: e.target.value })} onClick={e => e.stopPropagation()} className="w-full border border-black/[0.08] rounded-[var(--radius-lg)] px-4 py-3 font-mono focus:outline-none focus:ring-2 focus:ring-[var(--accent)]" placeholder="Se rellena con OK" />
              {base > 0 && baseClienteNum > 0 && Math.abs(baseClienteNum - base) > 0.001 && (() => {
                const diff = baseClienteNum - base;
                const diffTotal = diff * pesoTotalNeto;
                const isPositive = diff > 0;
                return (
                  <div className={`mt-2 px-3 py-2 rounded-[var(--radius-md)] text-sm ${isPositive ? 'bg-emerald-50 border border-emerald-200' : 'bg-red-50 border border-red-200'}`}>
                    <div className="flex justify-between items-center">
                      <span className={isPositive ? 'text-emerald-700' : 'text-red-700'}>
                        {isPositive ? '+' : ''}{formatNum(diff)} €/g vs base
                      </span>
                      <span className={`font-bold ${isPositive ? 'text-emerald-700' : 'text-red-700'}`}>
                        {isPositive ? '+' : ''}{formatEur(diffTotal)}
                      </span>
                    </div>
                  </div>
                );
              })()}
            </div>
            <div>
              <label className="block text-sm font-medium text-[var(--text-primary)] mb-1">Precio Jofisa (€/g)</label>
              <input type="number" inputMode="decimal" step="0.01" value={formData.precioJofisa} onChange={(e) => setFormData({ ...formData, precioJofisa: e.target.value })} className="w-full border border-black/[0.08] rounded-[var(--radius-lg)] px-4 py-3 font-mono focus:outline-none focus:ring-2 focus:ring-[var(--accent)]" placeholder="Base cliente + 0,25" />
            </div>
            {precioJofisaNum > 0 && (
              <div className="bg-blue-50 border border-blue-200 rounded-[var(--radius-lg)] p-3">
                <div className="flex justify-between text-sm">
                  <span className="text-blue-600">Importe Jofisa{cantidadLingotes > 1 ? ' total' : ''}:</span>
                  <span className="font-mono font-semibold text-blue-800">{formatEur(importeJofisaTotal)}</span>
                </div>
                <div className="text-xs text-blue-400 mt-0.5">
                  {cantidadLingotes > 1 ? `${cantidadLingotes} x ` : ''}{pesoNetoUnitario}g x {formatNum(precioJofisaNum)} €/g
                </div>
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-[var(--text-primary)] mb-1">Margen %</label>
                <input type="number" inputMode="decimal" step="0.1" value={formData.margen} onChange={(e) => setFormData({ ...formData, margen: e.target.value })} className="w-full border border-black/[0.08] rounded-[var(--radius-lg)] px-4 py-3 font-mono focus:outline-none focus:ring-2 focus:ring-[var(--accent)]" />
              </div>
              <div>
                <label className="block text-sm font-medium text-[var(--text-primary)] mb-1">Precio Cliente</label>
                <div className="w-full border border-black/[0.06] bg-black/[0.02] rounded-[var(--radius-lg)] px-4 py-3 font-mono text-[var(--text-primary)]">
                  {precioCliente ? formatNum(precioCliente) : '-'}
                </div>
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-[var(--text-primary)] mb-1">Fecha Cierre</label>
              <input type="date" value={formData.fechaCierre} onChange={(e) => setFormData({ ...formData, fechaCierre: e.target.value })} className="w-full border border-black/[0.08] rounded-[var(--radius-lg)] px-4 py-3 focus:outline-none focus:ring-2 focus:ring-[var(--accent)]" />
            </div>
            {precioCliente > 0 && (
              <div className="bg-gradient-to-br from-emerald-50 to-green-50 border border-emerald-200 rounded-[var(--radius-xl)] p-4">
                <h4 className="font-semibold text-emerald-800 mb-3">Resumen Cliente</h4>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-[var(--text-secondary)]">Peso neto{cantidadLingotes > 1 ? ' total' : ''}:</span>
                    <span className="font-mono">{cantidadLingotes > 1 ? `${cantidadLingotes} x ${pesoNetoUnitario}g = ` : ''}{pesoTotalNeto}g</span>
                  </div>
                  <div className="flex justify-between"><span className="text-[var(--text-secondary)]">Precio cliente:</span><span className="font-mono">{formatNum(precioCliente)} €/g</span></div>
                  <div className="flex justify-between pt-2 border-t border-emerald-200">
                    <span className="font-semibold text-emerald-800">IMPORTE CLIENTE{cantidadLingotes > 1 ? ' TOTAL' : ''}:</span>
                    <span className="font-bold text-emerald-700 text-lg">{formatEur(importeClienteTotal)}</span>
                  </div>
                </div>
              </div>
            )}
          </div>
          <div className="flex gap-3 mt-6">
            <Button variant="secondary" className="flex-1" onClick={closeCierreModal}>Cancelar</Button>
            <Button variant="success" className="flex-1" disabled={!precioCliente} onClick={handleConfirm}>
              Confirmar Cierre
            </Button>
          </div>
        </div>
      </div>
    );
  };

  // Futura Modal - añadir lingotes sin stock físico
  const FuturaModal = () => {
    const defaultClienteId = editingEntregaClienteId || clientes[0]?.id || '';
    const [formData, setFormData] = useState({
      clienteId: defaultClienteId,
      cantidad: 1,
      pesoUnitario: 50,
    });

    const hasChanges = formData.cantidad !== 1 || formData.pesoUnitario !== 50 ||
      formData.clienteId !== defaultClienteId;

    const handleClose = () => {
      if (hasChanges && !confirm('¿Descartar los cambios?')) return;
      setShowFuturaModal(false);
      setEditingEntregaClienteId(null);
    };

    const pesoTotal = formData.cantidad * formData.pesoUnitario;

    const handleSave = async () => {
      for (let i = 0; i < formData.cantidad; i++) {
        await addFuturaLingote({
          clienteId: formData.clienteId,
          peso: formData.pesoUnitario,
          precio: null,
          nFactura: null,
          fechaCierre: null,
          pagado: false,
        });
      }
    };

    return (
      <div className="fixed inset-0 glass-overlay overlay-animate flex items-center justify-center z-50 p-4" onClick={handleClose}>
        <div className="glass-modal modal-animate rounded-[var(--radius-2xl)] p-6 w-full max-w-md shadow-2xl" onClick={e => e.stopPropagation()}>
          <h3 className="text-xl font-bold text-red-800 mb-2">Nueva FUTURA</h3>
          <p className="text-sm text-[var(--text-tertiary)] mb-6">Añadir lingotes sin stock físico. Ciérralos después con el selector.</p>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-[var(--text-primary)] mb-1">Cantidad</label>
              <div className="flex gap-2">
                {[1, 2, 4, 6, 10].map(q => (
                  <button key={q} onClick={() => setFormData({ ...formData, cantidad: q })} className={`flex-1 py-2 rounded-[var(--radius-lg)] border-2 font-semibold transition-colors ${formData.cantidad === q ? 'border-red-500 bg-red-50 text-red-700' : 'border-black/[0.06] text-[var(--text-secondary)] hover:border-black/[0.08]'}`}>
                    {q}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-[var(--text-primary)] mb-1">Peso por lingote</label>
              <div className="flex gap-2">
                {[50, 100].map(p => (
                  <button key={p} onClick={() => setFormData({ ...formData, pesoUnitario: p })} className={`flex-1 py-2 rounded-[var(--radius-lg)] border-2 font-semibold transition-colors ${formData.pesoUnitario === p ? 'border-red-500 bg-red-50 text-red-700' : 'border-black/[0.06] text-[var(--text-secondary)] hover:border-black/[0.08]'}`}>
                    {p}g
                  </button>
                ))}
              </div>
            </div>
            <div className="bg-red-50 rounded-[var(--radius-lg)] p-3 text-center">
              <span className="font-bold text-red-800">{formData.cantidad} x {formData.pesoUnitario}g = {pesoTotal}g</span>
            </div>
          </div>
          <div className="flex gap-3 mt-6">
            <Button variant="secondary" className="flex-1" onClick={handleClose}>Cancelar</Button>
            <Button variant="danger" className="flex-1" onClick={handleSave}>
              Añadir
            </Button>
          </div>
        </div>
      </div>
    );
  };

  // New Futura Modal - crear FUTURA directamente con precio (ya cerrados)
  const NewFuturaModal = () => {
    if (!newFuturaData) return null;
    const { clienteId, cantidad, peso } = newFuturaData;
    const cliente = getCliente(clienteId);
    const pesoTotal = cantidad * peso;

    const [formData, setFormData] = useState({
      euroOnza: '',
      baseCliente: '',
      precioJofisa: '',
      margen: 6,
      fechaCierre: new Date().toISOString().split('T')[0],
      nFactura: '',
    });
    const [euroOnzaConfirmado, setEuroOnzaConfirmado] = useState(false);

    const hasChanges = formData.euroOnza !== '' || formData.baseCliente !== '' || formData.nFactura !== '';

    const handleClose = () => {
      if (hasChanges && !confirm('¿Descartar los cambios?')) return;
      setShowNewFuturaModal(false);
      setNewFuturaData(null);
    };

    // Calculations
    const euroOnzaNum = parseFloat(formData.euroOnza) || 0;
    const base = (euroOnzaConfirmado && euroOnzaNum) ? Math.ceil((euroOnzaNum / 31.10349) * 100) / 100 : 0;
    const baseClienteNum = parseFloat(formData.baseCliente) || 0;
    const precioJofisaNum = parseFloat(formData.precioJofisa) || 0;
    const margenNum = parseFloat(formData.margen) || 0;
    const precioCliente = baseClienteNum ? Math.round((baseClienteNum * (1 + margenNum / 100)) * 100) / 100 : 0;
    const importeTotal = precioCliente * pesoTotal;

    const confirmarEuroOnza = () => {
      if (!euroOnzaNum) return;
      const baseCalc = Math.ceil((euroOnzaNum / 31.10349) * 100) / 100;
      const precioJofisaCalc = Math.round((baseCalc + 0.25) * 100) / 100;
      setFormData(prev => ({
        ...prev,
        baseCliente: prev.baseCliente || baseCalc.toFixed(2),
        precioJofisa: prev.precioJofisa || precioJofisaCalc.toFixed(2),
      }));
      setEuroOnzaConfirmado(true);
    };

    const handleSave = async () => {
      if (!precioCliente) {
        alert('Debes introducir un precio válido');
        return;
      }

      const margenCierre = (baseClienteNum - base) * pesoTotal;
      const importeJofisaTotal = precioJofisaNum * pesoTotal;
      const margenTotal = importeTotal - importeJofisaTotal;

      // Crear los FUTURA ya con precio (cerrados)
      for (let i = 0; i < cantidad; i++) {
        await onSaveFutura({
          clienteId,
          peso,
          euroOnza: euroOnzaNum,
          base,
          baseCliente: baseClienteNum,
          precioJofisa: precioJofisaNum,
          margen: margenNum,
          precio: precioCliente,
          importe: precioCliente * peso,
          nFactura: formData.nFactura || null,
          fechaCierre: formData.fechaCierre,
          pagado: false,
          estado: 'futura',
          fechaCreacion: new Date().toISOString(),
          margenCierre: Math.round((margenCierre / cantidad) * 100) / 100,
          margenTotal: Math.round((margenTotal / cantidad) * 100) / 100,
        });
      }

      onAddLogGeneral('crear_futura', `FUTURA cerrado: ${cantidad} x ${peso}g a ${formatNum(precioCliente)}€/g para ${cliente?.nombre}`, {
        clienteId,
        cantidad,
        peso,
        precioCliente,
        importeTotal,
      });

      setShowNewFuturaModal(false);
      setNewFuturaData(null);
    };

    return (
      <div className="fixed inset-0 glass-overlay overlay-animate flex items-center justify-center z-50 p-4" onClick={handleClose}>
        <div className="glass-modal modal-animate rounded-[var(--radius-2xl)] p-6 w-full max-w-md shadow-2xl max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
          <h3 className="text-xl font-bold text-red-800 mb-2">Cerrar FUTURA</h3>
          <p className="text-sm text-[var(--text-tertiary)] mb-4">
            {cliente?.nombre} • {cantidad} x {peso}g = {pesoTotal}g
          </p>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-[var(--text-primary)] mb-1">€/Onza</label>
              <div className="flex gap-2">
                <input
                  type="number"
                  inputMode="decimal"
                  step="0.01"
                  value={formData.euroOnza}
                  onChange={(e) => {
                    setFormData({ ...formData, euroOnza: e.target.value });
                    setEuroOnzaConfirmado(false);
                  }}
                  className={`flex-1 border rounded-[var(--radius-lg)] px-4 py-3 text-lg font-mono focus:outline-none focus:ring-2 focus:ring-red-400 ${euroOnzaConfirmado ? 'border-emerald-400 bg-emerald-50' : 'border-black/[0.08]'}`}
                  placeholder="Ej: 3693,42"
                  autoFocus
                />
                <button
                  type="button"
                  onClick={confirmarEuroOnza}
                  disabled={!euroOnzaNum || euroOnzaConfirmado}
                  className={`px-4 py-2 rounded-[var(--radius-lg)] font-semibold transition-all ${
                    euroOnzaConfirmado
                      ? 'bg-emerald-100 text-emerald-600 cursor-default'
                      : euroOnzaNum
                        ? 'bg-red-500 text-white hover:bg-red-600'
                        : 'bg-black/[0.06] text-[var(--text-tertiary)] cursor-not-allowed'
                  }`}
                >
                  {euroOnzaConfirmado ? '✓' : 'OK'}
                </button>
              </div>
            </div>

            {base > 0 && (
              <div className="bg-black/[0.02] rounded-[var(--radius-lg)] p-3">
                <div className="flex justify-between text-sm">
                  <span className="text-[var(--text-tertiary)]">Base (€/Onza ÷ 31,10349):</span>
                  <span className="font-mono font-semibold text-[var(--text-primary)]">{formatNum(base)} €/g</span>
                </div>
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-[var(--text-primary)] mb-1">Base Cliente (€/g)</label>
              <input
                type="number"
                inputMode="decimal"
                step="0.01"
                value={formData.baseCliente}
                onChange={(e) => setFormData({ ...formData, baseCliente: e.target.value })}
                className="w-full border border-black/[0.08] rounded-[var(--radius-lg)] px-4 py-3 font-mono focus:outline-none focus:ring-2 focus:ring-red-400"
                placeholder="Se rellena con OK"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-[var(--text-primary)] mb-1">Precio Jofisa (€/g)</label>
                <input
                  type="number"
                  inputMode="decimal"
                  step="0.01"
                  value={formData.precioJofisa}
                  onChange={(e) => setFormData({ ...formData, precioJofisa: e.target.value })}
                  className="w-full border border-black/[0.08] rounded-[var(--radius-lg)] px-4 py-3 font-mono focus:outline-none focus:ring-2 focus:ring-red-400"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-[var(--text-primary)] mb-1">Margen (%)</label>
                <input
                  type="number"
                  inputMode="decimal"
                  step="0.1"
                  value={formData.margen}
                  onChange={(e) => setFormData({ ...formData, margen: e.target.value })}
                  className="w-full border border-black/[0.08] rounded-[var(--radius-lg)] px-4 py-3 font-mono focus:outline-none focus:ring-2 focus:ring-red-400"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-[var(--text-primary)] mb-1">Fecha cierre</label>
              <input
                type="date"
                value={formData.fechaCierre}
                onChange={(e) => setFormData({ ...formData, fechaCierre: e.target.value })}
                className="w-full border border-black/[0.08] rounded-[var(--radius-lg)] px-4 py-3 focus:outline-none focus:ring-2 focus:ring-red-400"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-[var(--text-primary)] mb-1">Nº Factura (opcional)</label>
              <input
                type="text"
                value={formData.nFactura}
                onChange={(e) => setFormData({ ...formData, nFactura: e.target.value })}
                className="w-full border border-black/[0.08] rounded-[var(--radius-lg)] px-4 py-3 focus:outline-none focus:ring-2 focus:ring-red-400"
                placeholder="2026-XX"
              />
            </div>

            {precioCliente > 0 && (
              <div className="bg-red-50 border border-red-200 rounded-[var(--radius-lg)] p-4">
                <div className="flex justify-between text-sm mb-2">
                  <span className="text-[var(--text-secondary)]">Precio cliente:</span>
                  <span className="font-mono font-semibold">{formatNum(precioCliente)} €/g</span>
                </div>
                <div className="flex justify-between">
                  <span className="font-semibold text-red-800">Total:</span>
                  <span className="font-mono font-bold text-red-800 text-lg">{formatEur(importeTotal)}</span>
                </div>
              </div>
            )}
          </div>

          <div className="flex gap-3 mt-6">
            <Button variant="secondary" className="flex-1" onClick={handleClose}>Cancelar</Button>
            <Button
              variant="danger"
              className="flex-1"
              onClick={handleSave}
              disabled={!precioCliente}
            >
              Cerrar FUTURA
            </Button>
          </div>
        </div>
      </div>
    );
  };

  // AssignFuturaModal removed — FUTURA now auto-merged during entrega creation in EntregaModal

  // Modal para selección múltiple de lingotes de diferentes entregas
  const MultiCierreModal = () => {
    const cliente = getCliente(selectedCliente);
    if (!cliente) return null;

    const allEntregasCliente = entregas.filter(e => e.clienteId === cliente.id);
    const entregasActivas = allEntregasCliente.filter(e => lingotesEnCurso(e).length > 0);

    // Recopilar todos los lingotes en curso
    const todosLingotes = entregasActivas.flatMap(e =>
      e.lingotes.map((l, idx) => ({
        ...l,
        entregaId: e.id,
        lingoteIdx: idx,
        fechaEntrega: e.fechaEntrega,
        exportacionNombre: getExportacion(e.exportacionId)?.nombre || '?'
      }))
    ).filter(l => l.estado === 'en_curso');

    // Calcular seleccionados
    const selectedCount = Object.values(multiCierreSelection).filter(Boolean).length;
    const selectedLingotes = todosLingotes.filter(l => multiCierreSelection[`${l.entregaId}_${l.lingoteIdx}`]);
    const selectedPeso = selectedLingotes.reduce((s, l) => s + (l.peso || 0), 0);

    // Agrupar por entrega para mostrar
    const porEntrega = {};
    todosLingotes.forEach(l => {
      if (!porEntrega[l.entregaId]) {
        porEntrega[l.entregaId] = {
          entregaId: l.entregaId,
          fechaEntrega: l.fechaEntrega,
          exportacionNombre: l.exportacionNombre,
          lingotes: []
        };
      }
      porEntrega[l.entregaId].lingotes.push(l);
    });

    const toggleLingote = (entregaId, idx) => {
      const key = `${entregaId}_${idx}`;
      setMultiCierreSelection(prev => ({ ...prev, [key]: !prev[key] }));
    };

    const toggleEntrega = (entregaId, lingotes) => {
      const allSelected = lingotes.every(l => multiCierreSelection[`${l.entregaId}_${l.lingoteIdx}`]);
      const newSelection = { ...multiCierreSelection };
      lingotes.forEach(l => {
        newSelection[`${l.entregaId}_${l.lingoteIdx}`] = !allSelected;
      });
      setMultiCierreSelection(newSelection);
    };

    const selectAll = () => {
      const newSelection = {};
      todosLingotes.forEach(l => {
        newSelection[`${l.entregaId}_${l.lingoteIdx}`] = true;
      });
      setMultiCierreSelection(newSelection);
    };

    const handleCerrarSeleccionados = () => {
      if (selectedCount === 0) return;

      // Agrupar por entrega
      const porEntregaIndices = {};
      selectedLingotes.forEach(l => {
        if (!porEntregaIndices[l.entregaId]) {
          porEntregaIndices[l.entregaId] = [];
        }
        porEntregaIndices[l.entregaId].push(l.lingoteIdx);
      });

      const allIndices = Object.entries(porEntregaIndices).map(([entregaId, indices]) => ({
        entregaId,
        indices
      }));

      // Configurar para cierre múltiple
      const firstEntrega = entregas.find(e => e.id === allIndices[0].entregaId);
      setSelectedEntrega({ ...firstEntrega, _allEntregasIndices: allIndices });
      setSelectedLingoteIndices(allIndices[0].indices);
      setSelectedLingoteIdx(allIndices[0].indices[0]);
      setShowMultiCierreModal(false);
      setShowCierreModal(true);
    };

    return (
      <div className="fixed inset-0 glass-overlay overlay-animate flex items-center justify-center z-50 p-4" onClick={() => setShowMultiCierreModal(false)}>
        <div className="glass-modal modal-animate rounded-[var(--radius-2xl)] p-6 w-full max-w-md shadow-2xl max-h-[85vh] overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
          <div className="flex justify-between items-center mb-4">
            <h3 className="text-lg font-bold text-[var(--text-primary)]">Seleccionar lingotes</h3>
            <button onClick={selectAll} className="text-xs text-[var(--accent)] hover:text-[var(--accent-text)] font-semibold">
              Seleccionar todos
            </button>
          </div>

          <div className="flex-1 overflow-y-auto space-y-3 mb-4">
            {Object.values(porEntrega).map(grupo => {
              const allSelected = grupo.lingotes.every(l => multiCierreSelection[`${l.entregaId}_${l.lingoteIdx}`]);
              const someSelected = grupo.lingotes.some(l => multiCierreSelection[`${l.entregaId}_${l.lingoteIdx}`]);

              return (
                <div key={grupo.entregaId} className="border border-black/[0.06] rounded-[var(--radius-lg)] p-3">
                  <div
                    className="flex items-center gap-2 mb-2 cursor-pointer"
                    onClick={() => toggleEntrega(grupo.entregaId, grupo.lingotes)}
                  >
                    <div className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-colors ${
                      allSelected ? 'bg-[var(--accent)] border-[var(--accent)] text-white' :
                      someSelected ? 'bg-[var(--accent-border)] border-[var(--accent)]' : 'border-black/[0.08]'
                    }`}>
                      {allSelected && '✓'}
                      {someSelected && !allSelected && '–'}
                    </div>
                    <span
                      className="px-2 py-0.5 rounded font-bold text-sm"
                      style={{ backgroundColor: getEntregaColor(grupo.fechaEntrega) + '20', color: getEntregaColor(grupo.fechaEntrega) }}
                    >{formatEntregaShort(grupo.fechaEntrega)}</span>
                    <span className="text-xs text-[var(--text-tertiary)]">• Exp: {grupo.exportacionNombre}</span>
                  </div>
                  <div className="grid grid-cols-4 gap-1">
                    {grupo.lingotes.map(l => {
                      const key = `${l.entregaId}_${l.lingoteIdx}`;
                      const isSelected = multiCierreSelection[key];
                      return (
                        <button
                          key={key}
                          onClick={() => toggleLingote(l.entregaId, l.lingoteIdx)}
                          className={`py-1.5 px-2 rounded-[var(--radius-md)] text-xs font-mono font-semibold transition-colors ${
                            isSelected
                              ? 'bg-[var(--accent)] text-white'
                              : 'bg-black/[0.04] text-[var(--text-secondary)] hover:bg-black/[0.06]'
                          }`}
                        >
                          {l.peso}g
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Resumen y botones */}
          <div className="border-t border-black/[0.06] pt-4">
            {selectedCount > 0 && (
              <div className="text-sm text-[var(--text-secondary)] mb-3 text-center">
                <span className="font-bold text-[var(--accent)]">{selectedCount}</span> lingotes seleccionados = <span className="font-bold">{selectedPeso}g</span>
              </div>
            )}
            <div className="flex gap-3">
              <Button variant="secondary" className="flex-1" onClick={() => setShowMultiCierreModal(false)}>
                Cancelar
              </Button>
              <Button
                variant="success"
                className="flex-1"
                disabled={selectedCount === 0}
                onClick={handleCerrarSeleccionados}
              >
                Cerrar ({selectedCount})
              </Button>
            </div>
          </div>
        </div>
      </div>
    );
  };

  // Modal para subir factura y asignar a lingotes
  const FacturaModal = () => {
    const cliente = getCliente(selectedCliente);
    if (!cliente) return null;

    const allEntregasCliente = entregas.filter(e => e.clienteId === cliente.id);

    // Lingotes cerrados sin factura (entregas normales)
    const lingotesEntregasSinFactura = allEntregasCliente
      .flatMap(e => e.lingotes.map((l, idx) => ({
        ...l,
        entregaId: e.id,
        lingoteIdx: idx,
        fechaEntrega: e.fechaEntrega,
        isFutura: false,
      })))
      .filter(l => (l.estado === 'pendiente_pago' || l.estado === 'finalizado') && !l.nFactura);

    // FUTURA cerrados sin factura
    const clienteFuturaModal = (futuraLingotes || []).filter(f => f.clienteId === cliente.id);
    const lingotesFuturaSinFactura = clienteFuturaModal
      .filter(f => f.precio && !f.nFactura)
      .map(f => ({
        ...f,
        futuraId: f.id,
        isFutura: true,
        importe: f.importe || (f.precio * f.peso),
      }));

    // Combinar ambos
    const lingotesSinFactura = [...lingotesEntregasSinFactura, ...lingotesFuturaSinFactura];

    const selectedCount = Object.values(facturaSelection).filter(Boolean).length;
    const selectedLingotes = lingotesSinFactura.filter(l => {
      const key = l.isFutura ? `futura_${l.futuraId}` : `${l.entregaId}_${l.lingoteIdx}`;
      return facturaSelection[key];
    });

    const selectAll = () => {
      const newSelection = {};
      lingotesSinFactura.forEach(l => {
        const key = l.isFutura ? `futura_${l.futuraId}` : `${l.entregaId}_${l.lingoteIdx}`;
        newSelection[key] = true;
      });
      setFacturaSelection(newSelection);
    };

    const handleFileChange = async (e) => {
      const file = e.target.files?.[0];
      if (file) {
        // Comprimir imagen si es necesario (máx 500KB para Firestore)
        const comprimido = await comprimirImagen(file, 500);
        setFacturaFile(comprimido);
      }
    };

    const handleSubir = async () => {
      if (!facturaFile || selectedCount === 0) return;

      try {
        // Guardar factura en Firestore
        const facturaId = await onSaveFactura({
          clienteId: cliente.id,
          nombre: facturaFile.name,
          tipo: facturaFile.type,
          data: facturaFile.data,
          lingotesCount: selectedCount,
          createdAt: new Date().toISOString(),
        });

        if (!facturaId) {
          alert('Error al guardar factura');
          return;
        }

        // Separar entregas normales y FUTURA
        const selectedEntregas = selectedLingotes.filter(l => !l.isFutura);
        const selectedFutura = selectedLingotes.filter(l => l.isFutura);

        // Agrupar lingotes de entregas por entregaId
        const porEntrega = {};
        for (const l of selectedEntregas) {
          if (!porEntrega[l.entregaId]) porEntrega[l.entregaId] = [];
          porEntrega[l.entregaId].push(l.lingoteIdx);
        }

        // Actualizar cada entrega una sola vez
        for (const [entregaId, lingoteIdxs] of Object.entries(porEntrega)) {
          const entrega = entregas.find(e => e.id === entregaId);
          if (!entrega) continue;
          const lingotes = [...entrega.lingotes];
          for (const idx of lingoteIdxs) {
            lingotes[idx] = { ...lingotes[idx], nFactura: facturaId };
          }
          await onUpdateEntrega(entregaId, { lingotes });
        }

        // Actualizar FUTURA con la factura
        for (const f of selectedFutura) {
          await onUpdateFutura(f.futuraId, { nFactura: facturaId });
        }

        // Log general
        const totalImporte = selectedLingotes.reduce((s, l) => s + (l.importe || 0), 0);
        onAddLogGeneral('subir_factura_cliente', `Factura subida para ${cliente.nombre}: ${selectedCount} lingotes (${formatEur(totalImporte)})`, {
          clienteId: cliente.id,
          facturaId,
          lingotesCount: selectedCount,
          totalImporte,
          nombre: facturaFile.name,
        });

        setShowFacturaModal(false);
        setFacturaFile(null);
        setFacturaSelection({});
      } catch (error) {
        console.error('Error subiendo factura:', error);
        alert('Error: ' + error.message);
      }
    };

    return (
      <div className="fixed inset-0 glass-overlay overlay-animate flex items-center justify-center z-50 p-4" onClick={() => setShowFacturaModal(false)}>
        <div className="glass-modal modal-animate rounded-[var(--radius-2xl)] p-6 w-full max-w-md shadow-2xl max-h-[85vh] overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
          <h3 className="text-lg font-bold text-[var(--text-primary)] mb-4">Subir Factura</h3>

          {/* File input */}
          <div className="mb-4">
            <label className="block text-sm font-medium text-[var(--text-primary)] mb-2">Archivo (PDF o imagen)</label>
            <input
              type="file"
              accept=".pdf,image/*"
              onChange={handleFileChange}
              className="w-full border border-black/[0.08] rounded-[var(--radius-lg)] px-3 py-2 text-sm"
            />
            {facturaFile && (
              <div className="mt-2 p-2 bg-emerald-50 rounded-[var(--radius-md)] text-sm text-emerald-700">
                ✓ {facturaFile.name}
              </div>
            )}
          </div>

          {/* Selección de lingotes */}
          <div className="flex justify-between items-center mb-2">
            <span className="text-sm font-medium text-[var(--text-primary)]">Asignar a lingotes:</span>
            <button onClick={selectAll} className="text-xs text-[var(--accent)] hover:text-[var(--accent-text)] font-semibold">
              Seleccionar todos
            </button>
          </div>

          <div className="flex-1 overflow-y-auto border border-black/[0.06] rounded-[var(--radius-lg)] p-2 mb-4 max-h-48">
            {lingotesSinFactura.length === 0 ? (
              <p className="text-[var(--text-tertiary)] text-sm text-center py-4">No hay lingotes sin factura</p>
            ) : (
              <div className="space-y-1">
                {lingotesSinFactura.map(l => {
                  const key = l.isFutura ? `futura_${l.futuraId}` : `${l.entregaId}_${l.lingoteIdx}`;
                  const isSelected = facturaSelection[key];
                  return (
                    <div
                      key={key}
                      onClick={() => setFacturaSelection(prev => ({ ...prev, [key]: !prev[key] }))}
                      className={`flex items-center gap-2 p-2 rounded-[var(--radius-md)] cursor-pointer transition-colors ${
                        isSelected ? 'bg-[var(--accent-soft)] border border-[var(--accent-border)]' : 'bg-black/[0.02] hover:bg-black/[0.04]'
                      }`}
                    >
                      <div className={`w-5 h-5 rounded border-2 flex items-center justify-center flex-shrink-0 ${
                        isSelected ? 'bg-[var(--accent)] border-[var(--accent)] text-white' : 'border-black/[0.08]'
                      }`}>
                        {isSelected && '✓'}
                      </div>
                      {l.isFutura ? (
                        <span className="px-1.5 py-0.5 rounded text-xs font-bold bg-red-100 text-red-700">FUT</span>
                      ) : (
                        <span
                          className="px-1.5 py-0.5 rounded text-xs font-bold"
                          style={{ backgroundColor: getEntregaColor(l.fechaEntrega) + '20', color: getEntregaColor(l.fechaEntrega) }}
                        >{formatEntregaShort(l.fechaEntrega)}</span>
                      )}
                      <span className="font-mono text-sm">{l.peso}g</span>
                      <span className="text-xs text-[var(--text-tertiary)]">{formatNum(l.precio || 0)}€/g</span>
                      <span className="text-xs text-[var(--text-tertiary)]">{l.fechaCierre ? new Date(l.fechaCierre).toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit' }) : '—'}</span>
                      <span className="text-xs text-emerald-600 font-medium ml-auto">{formatEur(l.importe || 0)}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {selectedCount > 0 && (
            <div className="text-sm text-center text-[var(--text-secondary)] mb-3">
              <span className="font-bold text-[var(--accent)]">{selectedCount}</span> lingotes seleccionados
            </div>
          )}

          <div className="flex gap-3">
            <Button variant="secondary" className="flex-1" onClick={() => setShowFacturaModal(false)}>
              Cancelar
            </Button>
            <Button
              className="flex-1"
              disabled={!facturaFile || selectedCount === 0}
              onClick={handleSubir}
            >
              Subir y asignar
            </Button>
          </div>
        </div>
      </div>
    );
  };

  // Modal para ver factura
  const ViewFacturaModal = () => {
    if (!viewingFactura) return null;

    const isPdf = viewingFactura.tipo?.includes('pdf');

    return (
      <div className="fixed inset-0 glass-overlay overlay-animate flex items-center justify-center z-50 p-4" onClick={() => setViewingFactura(null)}>
        <div className="glass-modal modal-animate rounded-[var(--radius-2xl)] w-full max-w-3xl max-h-[90vh] overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
          <div className="flex justify-between items-center p-4 border-b border-black/[0.06]">
            <h3 className="font-bold text-[var(--text-primary)]">{viewingFactura.nombre}</h3>
            <button
              onClick={() => setViewingFactura(null)}
              className="w-8 h-8 rounded-full bg-black/[0.04] hover:bg-black/[0.06] flex items-center justify-center"
            >
              ✕
            </button>
          </div>
          <div className="flex-1 overflow-auto p-4">
            {isPdf ? (
              <iframe
                src={viewingFactura.data}
                className="w-full h-[70vh] rounded-[var(--radius-lg)]"
                title={viewingFactura.nombre}
              />
            ) : (
              <img
                src={viewingFactura.data}
                alt={viewingFactura.nombre}
                className="max-w-full h-auto rounded-[var(--radius-lg)] mx-auto"
              />
            )}
          </div>
          <div className="p-4 border-t border-black/[0.06] flex gap-3">
            <Button
              variant="danger"
              className="flex-1"
              onClick={async () => {
                if (!confirm('¿Eliminar esta factura?')) return;
                await onDeleteFactura(viewingFactura.id);
                setViewingFactura(null);
              }}
            >
              Eliminar
            </Button>
            <Button variant="secondary" className="flex-1" onClick={() => setViewingFactura(null)}>
              Cerrar
            </Button>
          </div>
        </div>
      </div>
    );
  };

  // Modal para ver factura de exportación
  const ViewExportFacturaModal = () => {
    if (!viewingExportFactura) return null;

    const { exp, factura } = viewingExportFactura;
    const isPdf = factura.tipo?.includes('pdf');

    return (
      <div className="fixed inset-0 glass-overlay overlay-animate flex items-center justify-center z-50 p-4" onClick={() => setViewingExportFactura(null)}>
        <div className="glass-modal modal-animate rounded-[var(--radius-2xl)] w-full max-w-3xl max-h-[90vh] overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
          <div className="flex justify-between items-center p-4 border-b border-black/[0.06]">
            <div>
              <h3 className="font-bold text-[var(--text-primary)]">{factura.nombre}</h3>
              <p className="text-xs text-[var(--text-tertiary)]">Importación: {exp.nombre}</p>
            </div>
            <button
              onClick={() => setViewingExportFactura(null)}
              className="w-8 h-8 rounded-full bg-black/[0.04] hover:bg-black/[0.06] flex items-center justify-center"
            >
              ✕
            </button>
          </div>
          <div className="flex-1 overflow-auto p-4">
            {isPdf ? (
              <iframe
                src={factura.data}
                className="w-full h-[70vh] rounded-[var(--radius-lg)]"
                title={factura.nombre}
              />
            ) : (
              <img
                src={factura.data}
                alt={factura.nombre}
                className="max-w-full h-auto rounded-[var(--radius-lg)] mx-auto"
              />
            )}
          </div>
          <div className="p-4 border-t border-black/[0.06] flex gap-3">
            <a
              href={factura.data}
              download={factura.nombre}
              className="flex-1 py-2 px-4 bg-blue-500 hover:bg-blue-600 text-white rounded-[var(--radius-lg)] text-center font-medium"
            >
              📥 Descargar
            </a>
            <Button variant="secondary" className="flex-1" onClick={() => setViewingExportFactura(null)}>
              Cerrar
            </Button>
          </div>
        </div>
      </div>
    );
  };

  // Tab button
  const TabBtn = ({ id, label, icon }) => (
    <button
      onClick={() => { setActiveTab(id); setSelectedCliente(null); }}
      className={`flex-1 py-2 px-1.5 sm:px-3 text-[11px] sm:text-sm font-medium transition-all duration-300 relative btn-press whitespace-nowrap ${
        activeTab === id
          ? 'tab-pill-active'
          : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-black/[0.03]'
      }`}
      style={{ borderRadius: '100px', margin: '4px 1px' }}
    >
      <span className="relative inline-flex items-center gap-1">
        <span className="hidden sm:inline text-sm">{icon}</span>
        <span>{label}</span>
      </span>
    </button>
  );

  return (
    <div className="page-bg">
      {/* Header + Nav sticky */}
      <div className="sticky top-0 z-40">
        <header className="glass-dark p-3">
          <div className="flex items-center justify-between max-w-3xl mx-auto">
            <div className="flex items-center gap-2.5 cursor-pointer" onClick={onBack}>
              <span className="text-2xl">🥇</span>
              <h1 className="text-xl font-semibold text-white tracking-tight">Lingotes</h1>
              <span className="text-[10px] text-white/30 font-mono ml-1">v2.7</span>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-white/60 text-sm">{currentUser}</span>
              <Button size="sm" onClick={() => setShowEntregaModal(true)}>+ Entrega</Button>
            </div>
          </div>
        </header>

        {/* Navigation — pill style */}
        <nav className="glass border-b border-white/10 flex px-2 py-1">
          <TabBtn id="stock" label="Stock" icon="📊" />
          <TabBtn id="exportaciones" label="Importaciones" icon="📦" />
          {canViewStats && <TabBtn id="estadisticas" label="Stats" icon="💰" />}
          <TabBtn id="parametros" label="Ajustes" icon="⚙️" />
        </nav>
      </div>

      {/* Content */}
      <main className="max-w-3xl mx-auto p-5 pb-24">
        {activeTab === 'stock' && <StockOverview />}
        {activeTab === 'exportaciones' && <ExportacionesView />}
        {activeTab === 'estadisticas' && canViewStats && <EstadisticasView />}
        {activeTab === 'parametros' && <ParametrosView />}
      </main>

      {/* Modals */}
      {showEntregaModal && <EntregaModal />}
      {showCierreModal && <CierreModal />}
      {showFuturaModal && <FuturaModal />}
      {showNewFuturaModal && <NewFuturaModal />}
      {showMultiCierreModal && <MultiCierreModal />}
      {showFacturaModal && <FacturaModal />}
      {viewingFactura && <ViewFacturaModal />}
      {viewingExportFactura && <ViewExportFacturaModal />}
    </div>
  );
}
