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
  const [showAssignFuturaModal, setShowAssignFuturaModal] = useState(false);
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
      // Futura: standalone orphan lingotes (sold but not in any entrega)
      const clienteFutura = (futuraLingotes || []).filter(f => f.clienteId === cliente.id);
      const futuraCount = clienteFutura.length;
      const futuraWeight = clienteFutura.reduce((sum, f) => sum + (f.peso || 0), 0);
      const futuraCerradoWeight = clienteFutura.filter(f => f.precio).reduce((sum, f) => sum + (f.peso || 0), 0);
      return { ...cliente, entregado, cerrado, devuelto, pendiente, enCurso, importeTotal, futuraCount, futuraWeight, futuraCerradoWeight };
    }).filter(c => c.entregado > 0 || c.enCurso > 0 || c.futuraCount > 0);
  }, [clientes, entregas, futuraLingotes]);

  const stockTotal = useMemo(() => {
    const totalEntregado = entregas.reduce((sum, e) => sum + pesoEntrega(e), 0);
    const totalCerrado = entregas.reduce((sum, e) => sum + pesoCerrado(e), 0);
    const totalDevuelto = entregas.reduce((sum, e) => sum + pesoDevuelto(e), 0);
    const stockClientes = totalEntregado - totalCerrado - totalDevuelto;
    // Futura: total weight of orphan lingotes (negative stock)
    const totalFutura = (futuraLingotes || []).reduce((sum, f) => sum + (f.peso || 0), 0);
    return { totalEntregado, totalCerrado, totalDevuelto, stockClientes, totalFutura };
  }, [entregas, futuraLingotes]);

  // CRUD
  // Calculate global stock from all exportaciones (with exportacion names)
  const stockGlobal = useMemo(() => {
    const stockByPeso = {};
    exportaciones.forEach(exp => {
      (exp.lingotes || []).forEach(l => {
        const peso = l.peso;
        if (!stockByPeso[peso]) stockByPeso[peso] = { cantidad: 0, exportaciones: [] };
        if (l.cantidad > 0) {
          stockByPeso[peso].cantidad += l.cantidad;
          // Track which exportaciones contribute to this peso
          const existing = stockByPeso[peso].exportaciones.find(e => e.nombre === exp.nombre);
          if (existing) {
            existing.cantidad += l.cantidad;
          } else {
            stockByPeso[peso].exportaciones.push({ nombre: exp.nombre, cantidad: l.cantidad });
          }
        }
      });
    });
    // Convert to array sorted by peso
    return Object.entries(stockByPeso)
      .map(([peso, data]) => ({ peso: parseFloat(peso), cantidad: data.cantidad, exportaciones: data.exportaciones }))
      .filter(s => s.cantidad > 0)
      .sort((a, b) => a.peso - b.peso);
  }, [exportaciones]);

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
    const items = data.items || [];
    const exportacion = exportaciones.find(e => e.id === data.exportacionId);

    if (!exportacion) {
      alert('Selecciona una exportación válida');
      return;
    }

    // Validate all items have sufficient stock IN THIS EXPORTACION
    for (const item of items) {
      const expLingote = (exportacion.lingotes || []).find(l => l.peso === item.peso);
      const stockDisponible = expLingote?.cantidad || 0;
      if (stockDisponible < item.cantidad) {
        alert(`No hay suficiente stock de lingotes de ${item.peso}g en ${exportacion.nombre}. Disponibles: ${stockDisponible}, Requeridos: ${item.cantidad}`);
        return;
      }
    }

    // Deduct ONLY from selected exportacion
    const newLingotes = [...(exportacion.lingotes || [])];
    for (const item of items) {
      const idx = newLingotes.findIndex(l => l.peso === item.peso && l.cantidad > 0);
      if (idx !== -1) {
        newLingotes[idx] = { ...newLingotes[idx], cantidad: newLingotes[idx].cantidad - item.cantidad };
      }
    }
    // Remove empty entries
    const filtered = newLingotes.filter(l => l.cantidad > 0);
    await onSaveExportacion({ ...exportacion, lingotes: filtered }, exportacion.id);

    // Create the entrega with all lingotes
    const lingotes = [];
    for (const item of items) {
      for (let i = 0; i < item.cantidad; i++) {
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

    // Crear log inicial
    const totalPeso = items.reduce((s, item) => s + (item.peso * item.cantidad), 0);
    const totalLingotes = items.reduce((s, item) => s + item.cantidad, 0);
    const initialLog = createLog('entrega', `Entrega creada: ${totalLingotes} lingote${totalLingotes > 1 ? 's' : ''} (${totalPeso}g)`);

    await onSaveEntrega({
      clienteId: data.clienteId,
      exportacionId: data.exportacionId,
      fechaEntrega: data.fechaEntrega,
      lingotes,
      logs: [initialLog],
    });

    setShowEntregaModal(false);
    setEditingEntregaClienteId(null);

    // Check if client has FUTURA orphan lingotes → prompt to assign
    const clientFutura = (futuraLingotes || []).filter(f => f.clienteId === data.clienteId);
    if (clientFutura.length > 0) {
      setShowAssignFuturaModal(true);
    }
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

    setShowFuturaModal(false);
  };

  const assignFuturaToEntrega = async (futuraIds, targetEntregaId) => {
    const targetEntrega = entregas.find(e => e.id === targetEntregaId);
    if (!targetEntrega) return;

    // Build new lingotes from futura docs
    const newLingotes = [];
    for (const fId of futuraIds) {
      const f = (futuraLingotes || []).find(fl => fl.id === fId);
      if (!f) continue;
      const hasPrecio = !!f.precio;
      newLingotes.push({
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
      });
    }

    // Add to target entrega
    await onUpdateEntrega(targetEntregaId, {
      lingotes: [...targetEntrega.lingotes, ...newLingotes],
    });

    // Delete futura docs
    for (const fId of futuraIds) {
      await onDeleteFutura(fId);
    }

    setShowAssignFuturaModal(false);
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

    setShowCierreModal(false);
    setSelectedFuturaId(null);
    setSelectedEntrega(null);
    setSelectedLingoteIdx(null);
  };

  // Cerrar múltiples lingotes FUTURA a la vez
  const cerrarFuturaMultiple = async (futuraIds, data) => {
    for (const futuraId of futuraIds) {
      const f = (futuraLingotes || []).find(fl => fl.id === futuraId);
      if (!f) continue;
      const pesoNeto = (f.peso || 0) - (data.devolucion || 0);
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

    // Devolver lingotes al stock de la exportación de origen
    const exportacion = exportaciones.find(e => e.id === entrega.exportacionId);
    if (exportacion) {
      const newLingotes = [...(exportacion.lingotes || [])];
      const existingIdx = newLingotes.findIndex(l => l.peso === peso);
      if (existingIdx !== -1) {
        newLingotes[existingIdx] = { ...newLingotes[existingIdx], cantidad: newLingotes[existingIdx].cantidad + lingoteIndices.length };
      } else {
        newLingotes.push({ peso, cantidad: lingoteIndices.length });
      }
      await onSaveExportacion({ ...exportacion, lingotes: newLingotes }, exportacion.id);
    }
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

    // Quitar del stock de la exportación (el lingote vuelve a estar en el cliente)
    const exportacion = exportaciones.find(e => e.id === entrega.exportacionId);
    if (exportacion) {
      const newLingotes = [...(exportacion.lingotes || [])];
      const existingIdx = newLingotes.findIndex(l => l.peso === peso);
      if (existingIdx !== -1 && newLingotes[existingIdx].cantidad > 0) {
        newLingotes[existingIdx] = { ...newLingotes[existingIdx], cantidad: newLingotes[existingIdx].cantidad - 1 };
        // Eliminar si cantidad = 0
        const filtered = newLingotes.filter(l => l.cantidad > 0);
        await onSaveExportacion({ ...exportacion, lingotes: filtered }, exportacion.id);
      }
    }
  };

  const marcarPagado = async (entregaId, lingoteIdx) => {
    const entrega = entregas.find(e => e.id === entregaId);
    if (!entrega) return;
    const lingotes = [...entrega.lingotes];
    const l = lingotes[lingoteIdx];
    let log;
    if (l.estado === 'pendiente_pago') {
      // Mark as paid → finalizado
      lingotes[lingoteIdx] = { ...l, pagado: true, estado: 'finalizado' };
      log = createLog('pago', `Pagado: 1 x ${l.peso}g (${formatEur(l.importe || 0)})`);
    } else if (l.estado === 'finalizado') {
      // Unmark paid → back to pendiente_pago
      lingotes[lingoteIdx] = { ...l, pagado: false, estado: 'pendiente_pago' };
      log = createLog('pago', `Desmarcado pago: 1 x ${l.peso}g`);
    }
    const logs = [...(entrega.logs || []), log];
    await onUpdateEntrega(entregaId, { lingotes, logs });
  };

  const marcarPagadoFutura = async (futuraId) => {
    const f = (futuraLingotes || []).find(fl => fl.id === futuraId);
    if (!f) return;
    const newPagado = !f.pagado;
    await onUpdateFutura(futuraId, { pagado: newPagado });
  };

  const deleteEntrega = async (entregaId) => {
    if (confirm('Eliminar esta entrega? Los lingotes volverán al stock de la exportación.')) {
      const entrega = entregas.find(e => e.id === entregaId);
      if (!entrega) return;

      // Devolver lingotes al stock de la exportación
      const exportacion = exportaciones.find(e => e.id === entrega.exportacionId);
      if (exportacion) {
        // Contar lingotes por peso de la entrega (solo los que no están cerrados/finalizados)
        const lingotesPorPeso = {};
        (entrega.lingotes || []).forEach(l => {
          // Solo devolver lingotes en_curso o devueltos (no los cerrados/finalizados que ya se vendieron)
          if (l.estado === 'en_curso' || l.estado === 'devuelto') {
            lingotesPorPeso[l.peso] = (lingotesPorPeso[l.peso] || 0) + 1;
          }
        });

        // Añadir de vuelta a la exportación
        const newLingotes = [...(exportacion.lingotes || [])];
        Object.entries(lingotesPorPeso).forEach(([peso, cantidad]) => {
          const pesoNum = Number(peso);
          const idx = newLingotes.findIndex(l => l.peso === pesoNum);
          if (idx !== -1) {
            newLingotes[idx] = { ...newLingotes[idx], cantidad: newLingotes[idx].cantidad + cantidad };
          } else {
            newLingotes.push({ peso: pesoNum, cantidad });
          }
        });

        await onSaveExportacion({ ...exportacion, lingotes: newLingotes }, exportacion.id);
      }

      await onDeleteEntrega(entregaId);
    }
  };


  // UI Components
  const getStockColor = (stock) => {
    if (stock < umbralStock.rojo) return { bg: 'from-red-600 via-red-500 to-red-600', text: 'text-red-100', accent: 'text-white' };
    if (stock < umbralStock.naranja) return { bg: 'from-orange-600 via-orange-500 to-orange-600', text: 'text-orange-100', accent: 'text-white' };
    if (stock < umbralStock.amarillo) return { bg: 'from-amber-500 via-yellow-500 to-amber-500', text: 'text-amber-100', accent: 'text-white' };
    return { bg: 'from-emerald-600 via-green-500 to-emerald-600', text: 'text-emerald-100', accent: 'text-white' };
  };

  const Card = ({ children, className = '', onClick }) => (
    <div
      onClick={onClick}
      className={`bg-white rounded-2xl p-5 shadow-sm border border-stone-200 transition-all duration-200 ${onClick ? 'cursor-pointer hover:shadow-md hover:border-amber-300' : ''} ${className}`}
    >
      {children}
    </div>
  );

  const Button = ({ children, onClick, variant = 'primary', size = 'md', className = '', disabled }) => {
    const variants = {
      primary: 'bg-gradient-to-r from-amber-500 to-yellow-500 text-white hover:from-amber-600 hover:to-yellow-600 shadow-sm',
      secondary: 'bg-stone-100 text-stone-700 hover:bg-stone-200 border border-stone-200',
      success: 'bg-gradient-to-r from-emerald-500 to-green-500 text-white hover:from-emerald-600 hover:to-green-600',
      danger: 'bg-red-50 text-red-600 hover:bg-red-100 border border-red-200',
      ghost: 'text-stone-600 hover:bg-stone-100',
    };
    const sizes = { sm: 'px-3 py-1.5 text-xs', md: 'px-4 py-2 text-sm', lg: 'px-6 py-3 text-base' };
    return (
      <button onClick={onClick} disabled={disabled} className={`${variants[variant]} ${sizes[size]} rounded-xl font-semibold transition-all duration-200 disabled:opacity-50 ${className}`}>
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
            className={`bg-gradient-to-br ${stockColor.bg} rounded-2xl p-4 text-white shadow-lg cursor-pointer transition-transform active:scale-95`}
            onClick={() => stockGlobal.length > 0 && setShowComposicion(!showComposicion)}
          >
            <div className="text-center">
              <p className={`text-xs ${stockColor.text} mb-1`}>📦 Stock Ma d'Or</p>
              <div className={`text-4xl font-black ${stockColor.accent}`}>{formatNum(stockRealTotal, 0)}</div>
              <div className={`text-xs ${stockColor.text}`}>gramos</div>
              {stockGlobal.length > 0 && (
                <div className={`text-xs ${stockColor.text} mt-2`}>
                  {showComposicion ? '▲ ocultar' : '▼ ver desglose'}
                </div>
              )}
            </div>
          </div>

          {/* En Clientes */}
          <div className="bg-gradient-to-br from-stone-700 via-stone-600 to-stone-700 rounded-2xl p-4 text-white shadow-lg">
            <div className="text-center">
              <p className="text-xs text-stone-400 mb-1">👥 En Clientes</p>
              <div className="text-4xl font-black text-amber-400">{formatNum(stockTotal.stockClientes, 0)}</div>
              <div className="text-xs text-stone-400">gramos</div>
            </div>
          </div>
        </div>

        {/* Desglose de stock por tipo con exportaciones - desplegable */}
        {showComposicion && stockGlobal.length > 0 && (
          <div className="bg-white rounded-2xl p-4 shadow-sm border border-stone-200 animate-in slide-in-from-top-2">
            <p className="text-xs text-stone-500 mb-3 font-medium">📦 Composición del stock</p>
            <div className="space-y-2">
              {stockGlobal.map((s, idx) => (
                <div key={idx} className="flex items-center justify-between bg-stone-50 rounded-xl px-3 py-2">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-amber-600 text-lg">{s.cantidad}</span>
                    <span className="text-stone-500">×</span>
                    <span className="font-semibold text-stone-700">{s.peso}g</span>
                  </div>
                  <div className="flex gap-1 flex-wrap justify-end">
                    {s.exportaciones.map((exp, i) => (
                      <span key={i} className="bg-amber-100 text-amber-700 px-2 py-0.5 rounded text-xs font-medium">
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
          <div className="bg-stone-100 rounded-2xl p-4 text-center">
            <p className="text-stone-500 text-sm">Sin stock. Crea una exportación.</p>
          </div>
        )}

        {/* FUTURA si existe */}
        {stockTotal.totalFutura > 0 && (
          <div className="bg-gradient-to-br from-red-700 via-red-600 to-red-700 rounded-2xl p-4 text-white shadow-lg">
            <div className="text-center">
              <p className="text-xs text-red-200 mb-1">⚠️ FUTURA (vendido sin stock)</p>
              <div className="text-3xl font-black text-white">-{formatNum(stockTotal.totalFutura, 0)}g</div>
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 gap-4">
          {statsClientes.map(cliente => (
            <Card key={cliente.id} onClick={() => setSelectedCliente(cliente.id)} className="relative overflow-hidden">
              <div className="absolute top-0 left-0 w-1.5 h-full" style={{ backgroundColor: cliente.color }} />
              <div className="pl-3">
                <h3 className="font-bold text-stone-800 mb-2">{cliente.nombre}</h3>
                <div className="flex items-end justify-between">
                  <div>
                    <div className="text-3xl font-black" style={{ color: cliente.color }}>
                      {formatNum(cliente.pendiente, 0)}
                      <span className="text-lg font-normal text-stone-400 ml-1">g</span>
                    </div>
                  </div>
                  <div className="text-right text-xs text-stone-500">
                    <div>Entregado: {formatNum(cliente.entregado, 0)}g</div>
                    <div>Cerrado: {formatNum(cliente.cerrado, 0)}g</div>
                    {cliente.futuraWeight > 0 && (
                      <div className="text-red-500 font-semibold">-{formatNum(cliente.futuraWeight, 0)}g FUTURA</div>
                    )}
                  </div>
                </div>
              </div>
            </Card>
          ))}
        </div>

        {statsClientes.length === 0 && (
          <Card>
            <p className="text-stone-400 text-center py-6">No hay entregas registradas.</p>
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
        className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
          entregaFilter === id
            ? 'bg-gradient-to-r from-amber-500 to-yellow-500 text-white shadow-sm'
            : 'bg-stone-100 text-stone-600 hover:bg-stone-200'
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
      // Añadir FUTURA pendientes si hay
      const futuraPendientes = clienteFutura.filter(f => !f.precio);
      if (futuraPendientes.length > 0) {
        const futuraPeso = futuraPendientes.reduce((sum, f) => sum + (f.peso || 0), 0);
        resumenData.push(['FUTURA', futuraPeso, 0, futuraPeso]);
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
      // Añadir FUTURA pendientes
      futuraPendientes.forEach(f => {
        lingotesData.push([
          'FUTURA',
          `${f.peso}g`,
          '',
          '',
          '',
          '',
          '',
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
        <div className="rounded-2xl p-5 text-white shadow-lg relative overflow-hidden" style={{ background: `linear-gradient(135deg, ${cliente.color}, ${cliente.color}dd)` }}>
          <button onClick={() => setSelectedCliente(null)} className="absolute top-3 left-3 text-white/80 hover:text-white text-sm flex items-center gap-1 bg-white/20 rounded-lg px-2 py-1">
            ← Volver
          </button>
          <div className="text-center pt-6">
            <h2 className="text-xl font-bold mb-1">{cliente.nombre}</h2>
            {/* Cuadrados grandes: stats de entregas EN CURSO + FUTURA pendientes */}
            {(() => {
              // FUTURA sin cerrar (pendientes)
              const futuraPendientes = clienteFutura.filter(f => !f.precio);
              const futuraPendienteWeight = futuraPendientes.reduce((sum, f) => sum + (f.peso || 0), 0);
              const futuraCerradosWeight = clienteFutura.filter(f => f.precio).reduce((sum, f) => sum + (f.peso || 0), 0);

              // Nombres para mostrar
              const nombresEnCurso = entregasEnCursoList.map(e => {
                return formatEntregaShort(e.fechaEntrega);
              });
              const hasFuturaPendiente = futuraPendientes.length > 0;
              const todosNombres = [...nombresEnCurso, ...(hasFuturaPendiente ? ['FUTURA'] : [])].join(' · ');

              // Stats combinadas
              const totalEntregado = enCursoEntregado + futuraPendienteWeight;
              const totalCerrado = enCursoCerrado + futuraCerradosWeight;
              const totalPendiente = enCursoPendiente + futuraPendienteWeight;

              return (
                <div className="grid grid-cols-5 gap-2 mt-4">
                  {/* Primera columna: nombres de entregas en curso + FUTURA */}
                  <div className="flex items-center justify-center">
                    <span
                      className="px-1.5 py-0.5 rounded font-bold text-xs"
                      style={{ backgroundColor: entregasEnCursoList[0] ? getEntregaColor(entregasEnCursoList[0].fechaEntrega) + '40' : hasFuturaPendiente ? 'rgba(239,68,68,0.3)' : 'transparent' }}
                    >
                      {todosNombres || '-'}
                    </span>
                  </div>
                  <div className="bg-white/20 rounded-xl p-2 text-center">
                    <div className="text-lg">📦</div>
                    <div className="text-lg font-bold">{formatNum(totalEntregado, 0)}</div>
                    <div className="text-xs text-white/70">Entregado</div>
                  </div>
                  <div className="bg-white/20 rounded-xl p-2 text-center">
                    <div className="text-lg">✅</div>
                    <div className="text-lg font-bold">{formatNum(enCursoCerrado, 0)}</div>
                    <div className="text-xs text-white/70">Cerrado</div>
                  </div>
                  <div className="bg-white/20 rounded-xl p-2 text-center">
                    <div className="text-lg">↩️</div>
                    <div className="text-lg font-bold">{formatNum(enCursoDevuelto, 0)}</div>
                    <div className="text-xs text-white/70">Devuelto</div>
                  </div>
                  <div className="bg-white/20 rounded-xl p-2 text-center">
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
                <div className="grid grid-cols-5 gap-2 px-2 py-1 text-xs text-white/50 mb-1">
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
                        <div key={entrega.id} className="grid grid-cols-5 gap-2 bg-white/10 rounded-lg px-2 py-2 items-center">
                          <div className="flex items-center gap-1">
                            <span className="text-green-300 text-xs">✓</span>
                            <span
                              className="px-1.5 py-0.5 rounded font-bold text-xs truncate"
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
            className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-stone-700 text-white hover:bg-stone-800 flex items-center gap-1"
          >
            🪪 Resum Cli.
          </button>
        </div>

        {/* FUTURA pendientes de asignar - solo si hay stock (ya llegó exportación) */}
        {clienteFutura.length > 0 && stockRealTotal > 0 && (
          <div className="bg-amber-50 border border-amber-300 rounded-2xl p-4">
            <div className="flex justify-between items-center mb-3">
              <div className="flex items-center gap-2">
                <span className="text-lg">📦</span>
                <h3 className="font-bold text-amber-800">FUTURA pendientes de asignar</h3>
              </div>
              <div className="text-sm text-amber-600 font-semibold">
                {clienteFutura.length} lingotes &bull; {formatNum(futuraWeight, 0)}g
              </div>
            </div>
            <p className="text-xs text-amber-700 mb-3">Hay stock disponible. Asigna estos lingotes a una entrega o ciérralos.</p>

            {/* Lingotes FUTURA - agrupados por peso con selector de cantidad */}
            {(() => {
              const futuraSinCerrar = clienteFutura.filter(f => !f.precio);
              const futuraCerrados = clienteFutura.filter(f => f.precio);

              // Agrupar sin cerrar por peso
              const porPeso = {};
              futuraSinCerrar.forEach(f => {
                if (!porPeso[f.peso]) porPeso[f.peso] = { peso: f.peso, ids: [] };
                porPeso[f.peso].ids.push(f.id);
              });
              const grupos = Object.values(porPeso);

              return (
                <>
                  {/* Sección Cerrar - con selectores de cantidad */}
                  {grupos.length > 0 && (
                    <div className="mb-3">
                      <div className="text-xs font-semibold text-stone-500 mb-2">Cerrar</div>
                      {grupos.map(grupo => {
                        const key = `futura_${cliente.id}_${grupo.peso}`;
                        const cantidad = futuraCierreCantidad[key] || 1;
                        const maxCantidad = grupo.ids.length;
                        const quickOptions = [1, 2, 4].filter(n => n <= maxCantidad);

                        const handleCerrar = () => {
                          const idsToClose = grupo.ids.slice(0, cantidad);
                          setSelectedFuturaIds(idsToClose);
                          setSelectedFuturaId(idsToClose[0]);
                          setShowCierreModal(true);
                        };

                        return (
                          <div key={grupo.peso} className="flex items-center justify-between bg-white/60 rounded-lg p-2 mb-1">
                            <span className="font-mono font-semibold text-amber-700">{maxCantidad} x {grupo.peso}g</span>
                            <div className="flex items-center gap-2">
                              <div className="flex items-center gap-1">
                                {quickOptions.map(n => (
                                  <button
                                    key={n}
                                    onClick={() => setFuturaCierreCantidad({ ...futuraCierreCantidad, [key]: n })}
                                    className={`w-7 h-7 rounded-lg text-xs font-bold transition-colors ${
                                      cantidad === n
                                        ? 'bg-amber-500 text-white'
                                        : 'bg-stone-100 text-stone-600 hover:bg-stone-200'
                                    }`}
                                  >
                                    {n}
                                  </button>
                                ))}
                                {maxCantidad > 1 && (
                                  <input
                                    type="number"
                                    min="1"
                                    max={maxCantidad}
                                    value={cantidad}
                                    onChange={(e) => setFuturaCierreCantidad({ ...futuraCierreCantidad, [key]: Math.min(maxCantidad, Math.max(1, parseInt(e.target.value) || 1)) })}
                                    className={`w-12 h-7 rounded-lg border text-center text-xs font-bold focus:outline-none focus:ring-2 focus:ring-amber-400 ${
                                      !quickOptions.includes(cantidad) ? 'border-amber-400 bg-amber-50' : 'border-stone-300'
                                    }`}
                                  />
                                )}
                              </div>
                              <button
                                onClick={handleCerrar}
                                className="px-3 py-1.5 text-xs rounded-xl font-semibold bg-emerald-500 text-white hover:bg-emerald-600 transition-colors"
                              >
                                Cerrar {cantidad > 1 ? `(${cantidad})` : ''}
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* Sección Cerrados */}
                  {futuraCerrados.length > 0 && (
                    <div className="mb-3 p-2 bg-emerald-50/50 rounded-lg border border-emerald-200">
                      <div className="text-xs font-semibold text-emerald-700 mb-1">
                        Cerrados ({futuraCerrados.length})
                      </div>
                      {futuraCerrados.map(f => (
                        <div key={f.id} className="flex items-center justify-between text-sm py-1 px-2">
                          <span className="font-mono text-emerald-700">{f.peso}g</span>
                          <span className="text-xs text-emerald-600 font-semibold">{formatNum(f.precio)} €/g</span>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              );
            })()}

            <Button className="w-full" onClick={() => setShowAssignFuturaModal(true)}>
              Asignar a nueva entrega
            </Button>
          </div>
        )}

        {/* En Curso */}
        {(() => {
          // FUTURA sin cerrar (solo mostrar cuando no hay stock)
          const futuraSinCerrar = stockRealTotal === 0 ? clienteFutura.filter(f => !f.precio) : [];
          // Mostrar sección si: hay entregas en curso, hay FUTURA sin cerrar, o no hay stock (para poder añadir)
          const showEnCurso = entregasConEnCurso.length > 0 || futuraSinCerrar.length > 0 || stockRealTotal === 0;

          if (!showEnCurso) return null;

          // Agrupar FUTURA sin cerrar por peso
          const futuraPorPeso = {};
          futuraSinCerrar.forEach(f => {
            if (!futuraPorPeso[f.peso]) futuraPorPeso[f.peso] = { peso: f.peso, ids: [] };
            futuraPorPeso[f.peso].ids.push(f.id);
          });
          const futuraGrupos = Object.values(futuraPorPeso);

          const totalLingotesEnCurso = entregasConEnCurso.reduce((s, e) => s + lingotesEnCurso(e).length, 0) + futuraSinCerrar.length;

          return (
          <Card>
            <div className="flex justify-between items-center mb-4">
              <h3 className="font-bold text-stone-800">En Curso</h3>
              <div className="flex items-center gap-2">
                <span className="text-sm text-stone-500">
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
                  <div key={entrega.id} className="p-3 rounded-xl bg-amber-50 border border-amber-200">
                    {/* Header: Fecha grande a la izquierda, summary + X a la derecha */}
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <span
                          className="px-2 py-1 rounded-lg font-bold text-base"
                          style={{ backgroundColor: getEntregaColor(entrega.fechaEntrega) + '20', color: getEntregaColor(entrega.fechaEntrega) }}
                        >{formatEntregaShort(entrega.fechaEntrega)}</span>
                        {exportacion && <span className="text-sm text-stone-500">• Exp: {exportacion.nombre}</span>}
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-sm text-stone-600">{enCursoList.length} x {enCursoList[0]?.peso || '?'}g = {totalPeso}g</span>
                        {!hasCerrados && (
                          <Button size="sm" variant="danger" onClick={() => deleteEntrega(entrega.id)}>x</Button>
                        )}
                      </div>
                    </div>

                    {/* Sección CERRAR */}
                    <div className="mb-2">
                      <div className="text-xs font-semibold text-stone-500 mb-1">Cerrar</div>
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
                          <div key={grupo.peso} className="flex items-center justify-between bg-white/60 rounded-lg p-2 mb-1">
                            <span className="font-mono font-semibold text-stone-700">{maxCantidad} x {grupo.peso}g</span>
                            <div className="flex items-center gap-2">
                              <div className="flex items-center gap-1">
                                {quickOptions.map(n => (
                                  <button
                                    key={n}
                                    onClick={() => setCierreCantidad({ ...cierreCantidad, [key]: n })}
                                    className={`w-7 h-7 rounded-lg text-xs font-bold transition-colors ${
                                      cantidad === n
                                        ? 'bg-amber-500 text-white'
                                        : 'bg-stone-100 text-stone-600 hover:bg-stone-200'
                                    }`}
                                  >
                                    {n}
                                  </button>
                                ))}
                                {maxCantidad > 1 && (
                                  <input
                                    type="number"
                                    min="1"
                                    max={maxCantidad}
                                    value={cantidad}
                                    onChange={(e) => setCierreCantidad({ ...cierreCantidad, [key]: Math.min(maxCantidad, Math.max(1, parseInt(e.target.value) || 1)) })}
                                    className={`w-12 h-7 rounded-lg border text-center text-xs font-bold focus:outline-none focus:ring-2 focus:ring-amber-400 ${
                                      !quickOptions.includes(cantidad) ? 'border-amber-400 bg-amber-50' : 'border-stone-300'
                                    }`}
                                  />
                                )}
                              </div>
                              <button
                                onClick={handleCerrar}
                                className="px-3 py-1.5 text-xs rounded-xl font-semibold bg-emerald-500 text-white hover:bg-emerald-600 transition-colors"
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
                      <div className="text-xs font-semibold text-stone-500 mb-1">Devolver</div>
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
                          <div key={grupo.peso} className="flex items-center justify-between bg-red-50/50 rounded-lg p-2 mb-1">
                            <span className="font-mono font-semibold text-stone-700">{maxCantidad} x {grupo.peso}g</span>
                            <div className="flex items-center gap-2">
                              <div className="flex items-center gap-1">
                                {quickOptions.map(n => (
                                  <button
                                    key={n}
                                    onClick={() => setDevolucionCantidad({ ...devolucionCantidad, [key]: n })}
                                    className={`w-7 h-7 rounded-lg text-xs font-bold transition-colors ${
                                      cantidad === n
                                        ? 'bg-red-500 text-white'
                                        : 'bg-stone-100 text-stone-600 hover:bg-stone-200'
                                    }`}
                                  >
                                    {n}
                                  </button>
                                ))}
                                {maxCantidad > 1 && (
                                  <input
                                    type="number"
                                    min="1"
                                    max={maxCantidad}
                                    value={cantidad}
                                    onChange={(e) => setDevolucionCantidad({ ...devolucionCantidad, [key]: Math.min(maxCantidad, Math.max(1, parseInt(e.target.value) || 1)) })}
                                    className={`w-12 h-7 rounded-lg border text-center text-xs font-bold focus:outline-none focus:ring-2 focus:ring-red-400 ${
                                      !quickOptions.includes(cantidad) ? 'border-red-400 bg-red-50' : 'border-stone-300'
                                    }`}
                                  />
                                )}
                              </div>
                              <button
                                onClick={handleDevolver}
                                className="px-3 py-1.5 text-xs rounded-xl font-semibold bg-red-500 text-white hover:bg-red-600 transition-colors"
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
                        <div className="mt-3 pt-3 border-t border-amber-200">
                          <div className="text-xs font-semibold text-stone-500 mb-2">Devueltos ({devueltos.length})</div>
                          <div className="space-y-1">
                            {entrega.lingotes.map((l, idx) => {
                              if (l.estado !== 'devuelto') return null;
                              const log = (entrega.logs || []).find(log =>
                                log.tipo === 'devolucion' &&
                                log.descripcion.includes(`${l.peso}g`)
                              );
                              return (
                                <div key={idx} className="flex items-center justify-between bg-red-50 rounded-lg p-2 text-xs">
                                  <div>
                                    <span className="font-mono font-semibold text-red-700">{l.peso}g</span>
                                    <span className="text-stone-400 ml-2">
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
              <div className="p-3 rounded-xl bg-red-50 border-2 border-red-300 mt-3">
                {/* Header: Etiqueta FUTURA */}
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <span className="px-2 py-1 rounded-lg font-bold text-base bg-red-100 text-red-700">FUTURA</span>
                    <span className="text-xs text-red-600">Sin stock físico</span>
                  </div>
                </div>

                {/* Selector directo: cantidad + peso + Cerrar */}
                <div className="flex items-center justify-between bg-white/60 rounded-lg p-2">
                  <div className="flex items-center gap-2">
                    <div className="flex items-center gap-1">
                      {[1, 2, 4].map(n => (
                        <button
                          key={n}
                          onClick={() => setFuturaCierreCantidad({ ...futuraCierreCantidad, [`new_${cliente.id}`]: n })}
                          className={`w-7 h-7 rounded-lg text-xs font-bold transition-colors ${
                            (futuraCierreCantidad[`new_${cliente.id}`] || 1) === n
                              ? 'bg-red-500 text-white'
                              : 'bg-stone-100 text-stone-600 hover:bg-stone-200'
                          }`}
                        >
                          {n}
                        </button>
                      ))}
                      <input
                        type="number"
                        min="1"
                        max={99}
                        value={futuraCierreCantidad[`new_${cliente.id}`] || 1}
                        onChange={(e) => setFuturaCierreCantidad({ ...futuraCierreCantidad, [`new_${cliente.id}`]: Math.min(99, Math.max(1, parseInt(e.target.value) || 1)) })}
                        className={`w-12 h-7 rounded-lg border text-center text-xs font-bold focus:outline-none focus:ring-2 focus:ring-red-400 ${
                          ![1, 2, 4].includes(futuraCierreCantidad[`new_${cliente.id}`] || 1) ? 'border-red-400 bg-red-50' : 'border-stone-300'
                        }`}
                      />
                    </div>
                    <span className="text-xs text-stone-500">x</span>
                    <select
                      value={futuraCierreCantidad[`newPeso_${cliente.id}`] || 50}
                      onChange={(e) => setFuturaCierreCantidad({ ...futuraCierreCantidad, [`newPeso_${cliente.id}`]: parseInt(e.target.value) })}
                      className="h-7 rounded-lg border border-stone-300 text-xs font-bold px-2 focus:outline-none focus:ring-2 focus:ring-red-400"
                    >
                      <option value={50}>50g</option>
                      <option value={100}>100g</option>
                    </select>
                  </div>
                  <Button
                    size="sm"
                    variant="success"
                    onClick={async () => {
                      const cant = futuraCierreCantidad[`new_${cliente.id}`] || 1;
                      const peso = futuraCierreCantidad[`newPeso_${cliente.id}`] || 50;
                      // Crear los FUTURA
                      const newIds = [];
                      for (let i = 0; i < cant; i++) {
                        const newId = await onSaveFutura({
                          clienteId: cliente.id,
                          peso,
                          precio: null,
                          importe: 0,
                          nFactura: null,
                          fechaCierre: null,
                          pagado: false,
                          estado: 'futura',
                          fechaCreacion: new Date().toISOString(),
                        });
                        if (newId) newIds.push(newId);
                      }
                      // Abrir modal de cierre con los nuevos IDs
                      if (newIds.length > 0) {
                        setSelectedFuturaIds(newIds);
                        setSelectedFuturaId(newIds[0]);
                        setShowCierreModal(true);
                      }
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
              <h3 className="font-bold text-stone-800">Cerrados ({allLingotesCerrados.length})</h3>
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
                <div className="text-sm text-stone-500">
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
                      <tr className="border-b border-stone-200">
                        <th className="text-left py-1.5 px-1 text-stone-500 font-medium text-xs">Cierre</th>
                        <th className="text-right py-1.5 px-1 text-stone-500 font-medium text-xs">Peso</th>
                        <th className="text-right py-1.5 px-1 text-stone-500 font-medium text-xs">€/g</th>
                        <th className="text-right py-1.5 px-1 text-stone-500 font-medium text-xs">Importe</th>
                        <th className="text-center py-1.5 px-1 text-stone-500 font-medium text-xs w-10">Pag</th>
                        <th className="text-left py-1.5 px-1 text-stone-500 font-medium text-xs">Fra</th>
                      </tr>
                    </thead>
                    <tbody>
                      {lingotes.map((l, i) => (
                        <tr key={i} className={`border-b border-stone-100 ${l.estado === 'pendiente_pago' ? 'bg-amber-50/50' : 'hover:bg-stone-50'}`}>
                          <td className="py-1.5 px-1 text-xs">{l.fechaCierre || '-'}</td>
                          <td className="py-1.5 px-1 text-right font-mono text-xs">{l.peso}g</td>
                          <td className="py-1.5 px-1 text-right font-mono text-xs">{formatNum(l.precio)}</td>
                          <td className="py-1.5 px-1 text-right font-mono font-semibold text-xs">{formatEur(l.importe || 0)}</td>
                          <td className="py-1.5 px-1 text-center">
                            <button
                              onClick={() => isFutura ? marcarPagadoFutura(l.futuraId) : marcarPagado(l.entregaId, l.lingoteIdx)}
                              className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition-colors text-xs ${
                                l.pagado ? 'bg-emerald-500 border-emerald-500 text-white' : 'border-stone-300 hover:border-emerald-400'
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
                          className="px-2 py-1 rounded-lg font-bold text-sm"
                          style={{ backgroundColor: getEntregaColor(grupo.fechaEntrega) + '20', color: getEntregaColor(grupo.fechaEntrega) }}
                        >{formatEntregaShort(grupo.fechaEntrega)}</span>
                        <span className="text-xs text-stone-400">{grupo.lingotes.length} lingotes</span>
                      </div>
                      {renderTabla(grupo.lingotes, false)}
                    </div>
                  ))}

                  {/* FUTURA cerrados */}
                  {lingotesFutura.length > 0 && (
                    <div className="mb-4 last:mb-0">
                      <div className="flex items-center gap-2 mb-2">
                        <span className="px-2 py-1 rounded-lg font-bold text-sm bg-red-100 text-red-700">
                          FUTURA
                        </span>
                        <span className="text-xs text-stone-400">{lingotesFutura.length} lingotes</span>
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
            <p className="text-stone-400 text-center py-6 text-sm">
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
              default: return 'bg-stone-50 border-stone-200';
            }
          };

          return (
            <Card className="mt-4">
              <button
                onClick={() => setShowHistorial(!showHistorial)}
                className="w-full flex items-center justify-between"
              >
                <h3 className="font-bold text-stone-800">Historial ({allLogs.length})</h3>
                <span className="text-stone-400 text-sm">{showHistorial ? '▲' : '▼'}</span>
              </button>
              {showHistorial && (
                <div className="space-y-2 max-h-64 overflow-y-auto mt-3">
                  {allLogs.map((log, i) => (
                    <div key={log.id || i} className={`flex items-start gap-2 p-2 rounded-lg border ${getLogColor(log.tipo)}`}>
                      <span className="text-sm">{getLogIcon(log.tipo)}</span>
                      <div className="flex-1 min-w-0">
                        <div className="text-xs text-stone-800">{log.descripcion}</div>
                        <div className="text-[10px] text-stone-400 flex items-center gap-2 flex-wrap">
                          <span>{formatLogTime(log.timestamp)}</span>
                          <span>•</span>
                          <span className="font-semibold text-stone-600">{log.usuario}</span>
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
    const defaultLingotes = [{ cantidad: 1, peso: 50 }];
    const [formData, setFormData] = useState({ nombre: '', fecha: defaultFecha, lingotes: defaultLingotes, precioGramo: '' });

    const resetForm = () => {
      setFormData({ nombre: '', fecha: defaultFecha, lingotes: [{ cantidad: 1, peso: 50 }], precioGramo: '' });
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
        lingotes: editingExp.lingotes || [{ cantidad: 1, peso: 50 }],
        precioGramo: editingExp.precioGramo ? String(editingExp.precioGramo) : '',
      } : { nombre: '', fecha: defaultFecha, lingotes: defaultLingotes, precioGramo: '' };

      const hasChanges = formData.nombre !== original.nombre ||
        formData.fecha !== original.fecha ||
        formData.precioGramo !== original.precioGramo ||
        JSON.stringify(formData.lingotes) !== JSON.stringify(original.lingotes);

      if (hasChanges && !confirm('¿Descartar los cambios?')) return;
      setShowNew(false);
      setEditingExp(null);
      resetForm();
    };

    // Check if exportacion has been used (lingotes consumed from stock)
    // Compare current stock with original grExport - if less, some were used
    const editingExpHasBeenUsed = editingExp
      ? (() => {
          const currentStock = (editingExp.lingotes || []).reduce((sum, l) => sum + ((l.cantidad || 0) * (l.peso || 0)), 0);
          const originalStock = editingExp.grExport || 0;
          return currentStock < originalStock;
        })()
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
      return exportaciones.map(exp => {
        const entregasExp = entregas.filter(e => e.exportacionId === exp.id);
        const totalEntregado = entregasExp.reduce((sum, e) => sum + pesoEntrega(e), 0);
        const totalCerrado = entregasExp.reduce((sum, e) => sum + pesoCerrado(e), 0);
        const totalDevuelto = entregasExp.reduce((sum, e) => sum + pesoDevuelto(e), 0);
        const totalPendiente = totalEntregado - totalCerrado - totalDevuelto;
        const totalImporte = entregasExp.reduce((sum, e) => sum + importeEntrega(e), 0);
        const totalLingotes = entregasExp.reduce((sum, e) => sum + numLingotes(e), 0);

        // Calculate stock disponible from exp.lingotes array
        const stockLingotes = exp.lingotes || [];
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
    }, [exportaciones, entregas, clientes]);

    const saveExportacion = async () => {
      if (formData.nombre && formTotalLingotes > 0) {
        const validLingotes = formData.lingotes.filter(l => l.cantidad > 0 && l.peso > 0);
        const grExport = validLingotes.reduce((sum, l) => sum + (l.cantidad * l.peso), 0);
        const data = {
          nombre: formData.nombre,
          grExport,
          fecha: formData.fecha,
          lingotes: validLingotes,
          precioGramo: formData.precioGramo ? parseFloat(formData.precioGramo) : null,
        };

        if (editingExp) {
          // Keep existing factura if editing
          if (editingExp.factura) {
            data.factura = editingExp.factura;
          }
          await onSaveExportacion(data, editingExp.id);
        } else {
          await onSaveExportacion(data);

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
          <h2 className="text-xl font-bold text-stone-800">Exportaciones</h2>
          <Button size="sm" onClick={openNew}>+ Nueva</Button>
        </div>

        {showNew && !editingExp && (
          <Card className="border-amber-400 bg-amber-50">
            <h3 className="font-bold text-stone-800 mb-4">Nueva Exportación</h3>
            <div className="space-y-4">
              <div className="flex gap-3">
                <div className="flex-1">
                  <label className="block text-sm font-medium text-stone-700 mb-1">Nombre</label>
                  <input type="text" value={formData.nombre} onChange={(e) => setFormData({ ...formData, nombre: e.target.value })} placeholder="Ej: 28-1" className="w-full border border-stone-300 rounded-xl px-4 py-2 focus:outline-none focus:ring-2 focus:ring-amber-400" />
                </div>
                <div className="w-40">
                  <label className="block text-sm font-medium text-stone-700 mb-1">Fecha</label>
                  <input type="date" value={formData.fecha} onChange={(e) => setFormData({ ...formData, fecha: e.target.value })} className="w-full border border-stone-300 rounded-xl px-4 py-2 focus:outline-none focus:ring-2 focus:ring-amber-400" />
                </div>
              </div>

              {/* Lingotes breakdown */}
              <div>
                <label className="block text-sm font-medium text-stone-700 mb-2">Lingotes comprados</label>
                {editingExpHasBeenUsed && (
                  <div className="bg-orange-100 border border-orange-300 rounded-xl p-2 mb-2 text-xs text-orange-700">
                    ⚠️ No se pueden modificar los lingotes porque ya se han usado de esta exportación.
                  </div>
                )}
                <div className={`space-y-2 ${editingExpHasBeenUsed ? 'opacity-50 pointer-events-none' : ''}`}>
                  {formData.lingotes.map((l, idx) => (
                    <div key={idx} className="flex items-center gap-2 flex-wrap">
                      <input
                        type="number"
                        value={l.cantidad}
                        onChange={(e) => updateLingoteTipo(idx, 'cantidad', parseInt(e.target.value) || 0)}
                        className="w-16 border border-stone-300 rounded-xl px-2 py-2 text-center focus:outline-none focus:ring-2 focus:ring-amber-400"
                        min="1"
                        disabled={editingExpHasBeenUsed}
                      />
                      <span className="text-stone-500">×</span>
                      <div className="flex gap-1 items-center">
                        {[50, 100].map(peso => (
                          <button
                            key={peso}
                            type="button"
                            onClick={() => updateLingoteTipo(idx, 'peso', peso)}
                            disabled={editingExpHasBeenUsed}
                            className={`px-3 py-1 rounded-lg text-sm font-medium transition-colors ${
                              l.peso === peso
                                ? 'bg-amber-500 text-white'
                                : 'bg-stone-200 text-stone-600 hover:bg-stone-300'
                            }`}
                          >
                            {peso}g
                          </button>
                        ))}
                        <div className="flex items-center gap-1 ml-1">
                          <input
                            type="number"
                            value={l.peso !== 50 && l.peso !== 100 ? l.peso : ''}
                            onChange={(e) => updateLingoteTipo(idx, 'peso', parseFloat(e.target.value) || 0)}
                            disabled={editingExpHasBeenUsed}
                            className={`w-16 border rounded-lg px-2 py-1 text-center text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 ${
                              l.peso !== 50 && l.peso !== 100 && l.peso > 0
                                ? 'border-amber-500 bg-amber-50'
                                : 'border-stone-300'
                            }`}
                            placeholder="otro"
                          />
                          <span className="text-stone-400 text-sm">g</span>
                        </div>
                      </div>
                      <span className="text-stone-600 font-medium">= {(l.cantidad || 0) * (l.peso || 0)}g</span>
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
                    className="mt-2 text-amber-600 hover:text-amber-700 text-sm font-medium"
                  >
                    + Añadir tipo
                  </button>
                )}
              </div>

              {/* Precio por gramo */}
              <div>
                <label className="block text-sm font-medium text-stone-700 mb-1">Precio por gramo (€/g)</label>
                <input
                  type="number"
                  step="0.01"
                  value={formData.precioGramo}
                  onChange={(e) => setFormData({ ...formData, precioGramo: e.target.value })}
                  placeholder="Ej: 95.50"
                  className="w-full border border-stone-300 rounded-xl px-4 py-2 focus:outline-none focus:ring-2 focus:ring-amber-400"
                />
              </div>

              {/* Total summary */}
              <div className="bg-amber-100 rounded-xl p-3">
                <div className="text-center">
                  <span className="text-amber-700 font-bold text-lg">
                    {formTotalLingotes} lingotes = {formatNum(formTotalGramos, 0)}g
                  </span>
                </div>
                {formData.precioGramo && (
                  <div className="text-center mt-1 pt-1 border-t border-amber-200">
                    <span className="text-amber-800 font-bold">
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
              <Card key={exp.id} className="border-amber-400 bg-amber-50">
                <h3 className="font-bold text-stone-800 mb-4">Editar: {exp.nombre}</h3>
                <div className="space-y-4">
                  <div className="flex gap-3">
                    <div className="flex-1">
                      <label className="block text-sm font-medium text-stone-700 mb-1">Nombre</label>
                      <input type="text" value={formData.nombre} onChange={(e) => setFormData({ ...formData, nombre: e.target.value })} placeholder="Ej: 28-1" className="w-full border border-stone-300 rounded-xl px-4 py-2 focus:outline-none focus:ring-2 focus:ring-amber-400" />
                    </div>
                    <div className="w-40">
                      <label className="block text-sm font-medium text-stone-700 mb-1">Fecha</label>
                      <input type="date" value={formData.fecha} onChange={(e) => setFormData({ ...formData, fecha: e.target.value })} className="w-full border border-stone-300 rounded-xl px-4 py-2 focus:outline-none focus:ring-2 focus:ring-amber-400" />
                    </div>
                  </div>

                  {/* Lingotes breakdown */}
                  <div>
                    <label className="block text-sm font-medium text-stone-700 mb-2">Lingotes comprados</label>
                    {editingExpHasBeenUsed && (
                      <div className="bg-orange-100 border border-orange-300 rounded-xl p-2 mb-2 text-xs text-orange-700">
                        ⚠️ No se pueden modificar los lingotes porque ya se han usado de esta exportación.
                      </div>
                    )}
                    <div className={`space-y-2 ${editingExpHasBeenUsed ? 'opacity-50 pointer-events-none' : ''}`}>
                      {formData.lingotes.map((l, idx) => (
                        <div key={idx} className="flex items-center gap-2 flex-wrap">
                          <input
                            type="number"
                            value={l.cantidad}
                            onChange={(e) => updateLingoteTipo(idx, 'cantidad', parseInt(e.target.value) || 0)}
                            className="w-16 border border-stone-300 rounded-xl px-2 py-2 text-center focus:outline-none focus:ring-2 focus:ring-amber-400"
                            min="1"
                            disabled={editingExpHasBeenUsed}
                          />
                          <span className="text-stone-500">×</span>
                          <div className="flex gap-1 items-center">
                            {[50, 100].map(peso => (
                              <button
                                key={peso}
                                type="button"
                                onClick={() => updateLingoteTipo(idx, 'peso', peso)}
                                disabled={editingExpHasBeenUsed}
                                className={`px-3 py-1 rounded-lg text-sm font-medium transition-colors ${
                                  l.peso === peso
                                    ? 'bg-amber-500 text-white'
                                    : 'bg-stone-200 text-stone-600 hover:bg-stone-300'
                                }`}
                              >
                                {peso}g
                              </button>
                            ))}
                            <div className="flex items-center gap-1 ml-1">
                              <input
                                type="number"
                                value={l.peso !== 50 && l.peso !== 100 ? l.peso : ''}
                                onChange={(e) => updateLingoteTipo(idx, 'peso', parseFloat(e.target.value) || 0)}
                                disabled={editingExpHasBeenUsed}
                                className={`w-16 border rounded-lg px-2 py-1 text-center text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 ${
                                  l.peso !== 50 && l.peso !== 100 && l.peso > 0
                                    ? 'border-amber-500 bg-amber-50'
                                    : 'border-stone-300'
                                }`}
                                placeholder="otro"
                              />
                              <span className="text-stone-400 text-sm">g</span>
                            </div>
                          </div>
                          <span className="text-stone-600 font-medium">= {(l.cantidad || 0) * (l.peso || 0)}g</span>
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
                        className="mt-2 text-amber-600 hover:text-amber-700 text-sm font-medium"
                      >
                        + Añadir tipo
                      </button>
                    )}
                  </div>

                  {/* Precio por gramo */}
                  <div>
                    <label className="block text-sm font-medium text-stone-700 mb-1">Precio por gramo (€/g)</label>
                    <input
                      type="number"
                      step="0.01"
                      value={formData.precioGramo}
                      onChange={(e) => setFormData({ ...formData, precioGramo: e.target.value })}
                      placeholder="Ej: 95.50"
                      className="w-full border border-stone-300 rounded-xl px-4 py-2 focus:outline-none focus:ring-2 focus:ring-amber-400"
                    />
                  </div>

                  {/* Total summary */}
                  <div className="bg-amber-100 rounded-xl p-3">
                    <div className="text-center">
                      <span className="text-amber-700 font-bold text-lg">
                        {formTotalLingotes} lingotes = {formatNum(formTotalGramos, 0)}g
                      </span>
                    </div>
                    {formData.precioGramo && (
                      <div className="text-center mt-1 pt-1 border-t border-amber-200">
                        <span className="text-amber-800 font-bold">
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
                <div>
                  <h3 className="text-lg font-bold text-stone-800">{exp.nombre}</h3>
                  <p className="text-xs text-stone-500">{exp.fecha || 'Sin fecha'}</p>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => openEdit(exp.id)}
                    className="text-amber-600 hover:text-amber-700 text-sm font-medium"
                  >
                    ✏️ Editar
                  </button>
                  {!exp.hasBeenUsed && (
                    <button
                      onClick={() => {
                        if (confirm(`¿Eliminar la exportación "${exp.nombre}"?\n\nEsto no se puede deshacer.`)) {
                          onDeleteExportacion(exp.id);
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
              <div className="bg-stone-50 rounded-xl p-3 mb-4 space-y-2">
                <div className="flex justify-between items-center">
                  <span className="text-sm text-stone-600">Precio:</span>
                  <span className="font-mono font-bold text-stone-800">
                    {exp.precioGramo ? `${formatNum(exp.precioGramo)} €/g` : '— sin definir'}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm text-stone-600">Total compra:</span>
                  <span className="font-mono font-bold text-emerald-600">
                    {exp.facturaTotal > 0 ? formatEur(exp.facturaTotal) : '—'}
                  </span>
                </div>
                <div className="flex justify-between items-center pt-2 border-t border-stone-200">
                  <span className="text-sm text-stone-600">Factura PDF:</span>
                  {exp.factura ? (
                    <div className="flex items-center gap-2">
                      <a
                        href={exp.factura.data}
                        download={exp.factura.nombre}
                        className="text-blue-600 hover:text-blue-700 text-sm font-medium"
                      >
                        📄 {exp.factura.nombre}
                      </a>
                      <button
                        onClick={() => removeFactura(exp)}
                        className="text-red-400 hover:text-red-600 text-sm"
                      >
                        ×
                      </button>
                    </div>
                  ) : (
                    <label className="cursor-pointer text-amber-600 hover:text-amber-700 text-sm font-medium">
                      {uploadingFactura === exp.id ? '⏳ Subiendo...' : '📤 Subir PDF'}
                      <input
                        type="file"
                        accept=".pdf"
                        className="hidden"
                        onChange={(e) => handleFacturaUpload(exp.id, e.target.files[0])}
                        disabled={uploadingFactura === exp.id}
                      />
                    </label>
                  )}
                </div>
              </div>

              {/* Resumen exportación: original vs disponible */}
              <div className="bg-amber-50 rounded-xl p-3 mb-4">
                <div className="flex justify-between items-start mb-2">
                  <div>
                    <p className="text-xs text-amber-600 font-medium">📦 Exportación</p>
                    <p className="text-amber-800 font-bold">{formatNum(exp.grExport || 0, 0)}g</p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-emerald-600 font-medium">✓ Disponible</p>
                    <p className="text-emerald-700 font-bold">{formatNum(exp.stockTotal, 0)}g</p>
                  </div>
                </div>
                {exp.lingotes && exp.lingotes.length > 0 && (
                  <div className="flex flex-wrap gap-2 pt-2 border-t border-amber-200">
                    {exp.lingotes.map((l, idx) => (
                      <div key={idx} className="bg-white border border-amber-200 rounded-lg px-2 py-1 text-sm">
                        <span className="font-bold text-amber-700">{l.cantidad}</span>
                        <span className="text-stone-500"> × </span>
                        <span className="text-stone-700">{l.peso}g</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Barra de progreso: 100% = grExport original */}
              {exp.grExport > 0 && (
                <div className="mb-4">
                  {/* Barra: clientes (entregados) + stock (gris) */}
                  <div className="relative h-8 bg-stone-100 rounded-full overflow-hidden border border-stone-200">
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
                            <span className="text-white text-xs font-bold drop-shadow-sm whitespace-nowrap">
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
                        <span className="text-stone-600 text-xs font-medium whitespace-nowrap">
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
                        <span className="text-stone-600">{c.nombre}</span>
                        <span className="text-stone-400">({formatNum(c.cerrado, 0)}/{formatNum(c.entregado, 0)}g)</span>
                      </div>
                    ))}
                    {exp.stockTotal > 0 && (
                      <div className="flex items-center gap-1 text-xs">
                        <div className="w-2 h-2 rounded-full bg-stone-300" />
                        <span className="text-stone-400">Stock: {formatNum(exp.stockTotal, 0)}g</span>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </Card>
            )
          ))}
          {exportaciones.length === 0 && (
            <Card><p className="text-stone-400 text-center py-6">No hay exportaciones. Crea una para empezar.</p></Card>
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
        {statsPorMes.chartData.length > 0 && (
          <Card>
            <h2 className="text-lg font-bold text-stone-800 mb-4">📈 Volumen Vendido por Mes</h2>
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
              <p className="text-[10px] text-stone-400">Gramos vendidos (cerrados) por mes, agrupados por cliente</p>
              {hoveredBarTotal !== null && (
                <p className="text-sm font-semibold text-amber-600">Total: {formatNum(hoveredBarTotal, 0)}g</p>
              )}
            </div>
          </Card>
        )}

        {/* Gráfico Volumen Anual + €/g */}
        {statsVolumenAnual.chartData.length > 0 && (
          <Card>
            <h2 className="text-lg font-bold text-stone-800 mb-4">📊 Volumen Anual y €/gramo</h2>
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
                        <div className="bg-white border border-stone-200 rounded-lg shadow-lg p-3 text-xs">
                          <p className="font-bold text-stone-800 mb-2 text-sm">{label}</p>
                          <div className="space-y-1">
                            {statsVolumenAnual.clientesConDatos.map(c => {
                              const shortName = c.nombre.substring(0, 6);
                              const peso = data[shortName] || 0;
                              if (peso === 0) return null;
                              return (
                                <div key={c.id} className="flex items-center gap-2">
                                  <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: c.color }} />
                                  <span className="text-stone-600">{c.nombre}:</span>
                                  <span className="font-mono font-semibold text-stone-800">{formatNum(peso, 0)}g</span>
                                </div>
                              );
                            })}
                          </div>
                          <div className="border-t border-stone-200 mt-2 pt-2 space-y-1">
                            <div className="flex justify-between">
                              <span className="text-stone-600">Total:</span>
                              <span className="font-mono font-bold text-stone-800">{formatNum(data.totalPeso, 0)}g</span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-stone-600">Margen:</span>
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
            <p className="text-[10px] text-stone-400 mt-1">Volumen total vendido por año (barras) y precio medio €/gramo (línea)</p>
          </Card>
        )}

        {/* Stats por Año */}
        <Card>
          <h2 className="text-lg font-bold text-stone-800 mb-4">📊 Entregas por Año</h2>

          {statsPorAnyo.sortedYears.length === 0 ? (
            <p className="text-stone-400 text-center py-6">No hay datos todavía.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="border-b-2 border-stone-300">
                    <th rowSpan={2} className="text-left py-2 px-2 font-semibold text-stone-600 sticky left-0 bg-white border-r border-stone-200 min-w-[90px] z-10">Cliente</th>
                    {statsPorAnyo.sortedYears.map(year => (
                      <th key={year} colSpan={3} className="text-center py-1 px-1 font-bold text-stone-700 border-r border-stone-200 bg-stone-50">{year}</th>
                    ))}
                    <th colSpan={3} className="text-center py-1 px-1 font-bold text-stone-800 bg-amber-50 border-l-2 border-amber-300">Suma total</th>
                  </tr>
                  <tr className="border-b border-stone-200 text-[10px]">
                    <th className="sticky left-0 bg-white z-10"></th>
                    {statsPorAnyo.sortedYears.map(year => (
                      <React.Fragment key={year}>
                        <th className="py-1 px-1 text-stone-500 font-medium">Peso</th>
                        <th className="py-1 px-1 text-stone-500 font-medium">MGN</th>
                        <th className="py-1 px-1 text-stone-500 font-medium border-r border-stone-200">%</th>
                      </React.Fragment>
                    ))}
                    <th className="py-1 px-1 text-amber-700 font-semibold">Peso</th>
                    <th className="py-1 px-1 text-amber-700 font-semibold">MGN</th>
                    <th className="py-1 px-1 text-amber-700 font-semibold">%</th>
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
                    // Color sólido para sticky (mezcla con blanco)
                    const stickyBgColor = cliente.color ? `${cliente.color}30` : '#ffffff';

                    return (
                      <tr key={cliente.id} className="border-b border-stone-100" style={{ backgroundColor: rowBgColor }}>
                        <td className="py-2 px-2 sticky left-0 border-r border-stone-200 min-w-[90px] z-10" style={{ backgroundColor: stickyBgColor }}>
                          <div className="flex items-center gap-1.5">
                            <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: cliente.color }} />
                            <span className="font-medium text-stone-800 whitespace-nowrap text-xs">{cliente.nombre}</span>
                          </div>
                        </td>
                        {statsPorAnyo.sortedYears.map(year => {
                          const data = statsPorAnyo.byYear[year]?.[cliente.id] || { peso: 0, mgn: 0 };
                          const yearTotal = statsPorAnyo.totalesPorAnyo[year];
                          const pct = yearTotal.mgn > 0 ? ((data.mgn || 0) / yearTotal.mgn * 100) : 0;
                          return (
                            <React.Fragment key={year}>
                              <td className="text-center py-2 px-1 font-mono text-stone-700">
                                {data.peso > 0 ? formatNum(data.peso, 0) : <span className="text-stone-300">-</span>}
                              </td>
                              <td className="text-center py-2 px-1 font-mono text-emerald-700">
                                {data.mgn > 0 ? formatNum(data.mgn, 0) : <span className="text-stone-300">-</span>}
                              </td>
                              <td className="text-center py-2 px-1 font-mono text-stone-500 border-r border-stone-200">
                                {data.mgn > 0 ? `${formatNum(pct, 0)}%` : <span className="text-stone-300">-</span>}
                              </td>
                            </React.Fragment>
                          );
                        })}
                        <td className="text-center py-2 px-1 font-mono font-semibold text-stone-800 bg-amber-50">
                          {formatNum(clienteTotal.peso, 0)}
                        </td>
                        <td className="text-center py-2 px-1 font-mono font-semibold text-emerald-700 bg-amber-50">
                          {formatNum(clienteTotal.mgn, 0)}
                        </td>
                        <td className="text-center py-2 px-1 font-mono font-semibold text-stone-600 bg-amber-50">
                          {grandTotalMgn > 0 ? `${formatNum(clienteTotal.mgn / grandTotalMgn * 100, 0)}%` : '-'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="bg-amber-100 font-bold border-t-2 border-amber-300">
                    <td className="py-2 px-2 text-stone-800 sticky left-0 bg-amber-100 border-r border-stone-200">Suma total</td>
                    {statsPorAnyo.sortedYears.map(year => {
                      const t = statsPorAnyo.totalesPorAnyo[year];
                      return (
                        <React.Fragment key={year}>
                          <td className="text-center py-2 px-1 font-mono text-stone-800">{formatNum(t.peso, 0)}</td>
                          <td className="text-center py-2 px-1 font-mono text-emerald-800">{formatNum(t.mgn, 0)}</td>
                          <td className="text-center py-2 px-1 font-mono text-stone-600 border-r border-stone-200">100%</td>
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
                          <td className="text-center py-2 px-1 font-mono text-stone-900 bg-amber-200">{formatNum(grandTotal.peso, 0)}</td>
                          <td className="text-center py-2 px-1 font-mono text-emerald-900 bg-amber-200">{formatNum(grandTotal.mgn, 0)}</td>
                          <td className="text-center py-2 px-1 font-mono text-stone-700 bg-amber-200">100%</td>
                        </>
                      );
                    })()}
                  </tr>
                </tfoot>
              </table>
              <p className="text-[10px] text-stone-400 mt-2">Peso en gramos, MGN = Margen en €, % = Porcentaje sobre total del año</p>
            </div>
          )}
        </Card>

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
        <h2 className="text-xl font-bold text-stone-800">Ajustes</h2>

        <Card>
          <h3 className="font-bold text-stone-800 mb-4">Umbrales de Color del Stock</h3>
          <div className="space-y-4">
            <div className="flex items-center gap-3 p-3 rounded-xl bg-red-50 border border-red-200">
              <div className="w-4 h-4 rounded-full bg-red-500"></div>
              <div className="flex-1">
                <label className="text-sm font-medium text-red-800">Critico (Rojo)</label>
              </div>
              <input type="text" inputMode="numeric" value={tempUmbrales.rojo} onChange={(e) => setTempUmbrales({ ...tempUmbrales, rojo: e.target.value })} className="w-24 border border-red-300 rounded-lg px-3 py-2 text-center font-mono focus:outline-none focus:ring-2 focus:ring-red-400" />
              <span className="text-sm text-stone-500">g</span>
            </div>
            <div className="flex items-center gap-3 p-3 rounded-xl bg-orange-50 border border-orange-200">
              <div className="w-4 h-4 rounded-full bg-orange-500"></div>
              <div className="flex-1">
                <label className="text-sm font-medium text-orange-800">Bajo (Naranja)</label>
              </div>
              <input type="text" inputMode="numeric" value={tempUmbrales.naranja} onChange={(e) => setTempUmbrales({ ...tempUmbrales, naranja: e.target.value })} className="w-24 border border-orange-300 rounded-lg px-3 py-2 text-center font-mono focus:outline-none focus:ring-2 focus:ring-orange-400" />
              <span className="text-sm text-stone-500">g</span>
            </div>
            <div className="flex items-center gap-3 p-3 rounded-xl bg-amber-50 border border-amber-200">
              <div className="w-4 h-4 rounded-full bg-amber-500"></div>
              <div className="flex-1">
                <label className="text-sm font-medium text-amber-800">Medio (Amarillo)</label>
              </div>
              <input type="text" inputMode="numeric" value={tempUmbrales.amarillo} onChange={(e) => setTempUmbrales({ ...tempUmbrales, amarillo: e.target.value })} className="w-24 border border-amber-300 rounded-lg px-3 py-2 text-center font-mono focus:outline-none focus:ring-2 focus:ring-amber-400" />
              <span className="text-sm text-stone-500">g</span>
            </div>
            <div className="flex items-center gap-3 p-3 rounded-xl bg-emerald-50 border border-emerald-200">
              <div className="w-4 h-4 rounded-full bg-emerald-500"></div>
              <div className="flex-1">
                <label className="text-sm font-medium text-emerald-800">OK (Verde)</label>
              </div>
              <div className="w-24 text-center font-mono text-emerald-700">≥ {tempUmbrales.amarillo || '0'}</div>
              <span className="text-sm text-stone-500">g</span>
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
          <p className="text-sm text-stone-600 mb-4">
            Importar lingotes para: NJ (37+13 FUTURA), Milla (3), Orcash (12), Gaudia (25+30 FUTURA), Gemma (3)
          </p>

          {/* Selector de exportación */}
          <div className="mb-4">
            <label className="block text-sm font-medium text-stone-700 mb-1">Asignar a Exportación:</label>
            <select
              value={importExportacionId}
              onChange={(e) => setImportExportacionId(e.target.value)}
              className="w-full p-2 border border-stone-300 rounded-lg"
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

                // Descontar del stock de la exportación
                const newLingotes = [...(selectedExp.lingotes || [])];
                for (const [pesoStr, cantidad] of Object.entries(stockADescontar)) {
                  const peso = parseInt(pesoStr);
                  const idx = newLingotes.findIndex(l => l.peso === peso);
                  if (idx !== -1) {
                    newLingotes[idx] = { ...newLingotes[idx], cantidad: newLingotes[idx].cantidad - cantidad };
                  }
                }
                // Filtrar los que quedan con cantidad > 0
                const filteredLingotes = newLingotes.filter(l => l.cantidad > 0);
                await onSaveExportacion({ ...selectedExp, lingotes: filteredLingotes }, selectedExp.id);

                const totalDescontado = Object.entries(stockADescontar).reduce((sum, [peso, cant]) => sum + (parseInt(peso) * cant), 0);
                console.log(`✅ Descontados ${totalDescontado}g del stock de ${selectedExp.nombre}`);

                alert(`✅ Importación completada!\n\nNJ: 3 entregas + 13 FUTURA\nMilla: 2 entregas\nOrcash: 1 entrega\nGaudia: 3 entregas + 30 FUTURA\nGemma: 1 entrega\n\n📦 Descontados ${totalDescontado}g de ${selectedExp.nombre}`);
              } catch (err) {
                console.error('Error:', err);
                alert('Error: ' + err.message);
              }
            }}
          >
            📥 Importar TODOS los datos históricos
          </Button>
        </Card>

        {/* Reset data */}
        <Card>
          <h3 className="font-bold text-red-700 mb-4">⚠️ Zona Peligrosa</h3>
          <p className="text-sm text-stone-600 mb-4">
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
    const exportacionesConStock = exportaciones.filter(e => (e.lingotes || []).some(l => l.cantidad > 0));
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
    const stockExportacion = (selectedExportacion?.lingotes || []).filter(l => l.cantidad > 0);

    // Build items list based on selected exportacion's stock
    const itemsWithStock = stockExportacion.map(l => {
      const existingItem = formData.items.find(i => i.peso === l.peso);
      return {
        peso: l.peso,
        cantidad: existingItem?.cantidad || 0,
        disponible: l.cantidad,
      };
    });

    // Check if all items have sufficient stock
    const allStockSuficiente = itemsWithStock.every(item => item.cantidad <= item.disponible);
    const hasAnyItems = itemsWithStock.some(item => item.cantidad > 0);

    // Totals
    const totalLingotes = itemsWithStock.reduce((sum, i) => sum + i.cantidad, 0);
    const totalGramos = itemsWithStock.reduce((sum, i) => sum + (i.cantidad * i.peso), 0);

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
      addEntrega({
        clienteId: formData.clienteId,
        exportacionId: formData.exportacionId,
        fechaEntrega: formData.fechaEntrega,
        items: activeItems,
      });
    };

    return (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={handleClose}>
        <div className="bg-white rounded-3xl p-6 w-full max-w-md shadow-2xl max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
          <h3 className="text-xl font-bold text-stone-800 mb-4">Nueva Entrega</h3>

          {exportacionesConStock.length === 0 ? (
            <div className="bg-amber-50 rounded-xl p-4 mb-4">
              <p className="text-amber-600 text-sm text-center">No hay stock en ninguna exportación. Crea una exportación primero.</p>
            </div>
          ) : (
            <>
              {/* Exportación, Cliente y Fecha */}
              <div className="space-y-4 mb-4">
                <div>
                  <label className="block text-sm font-medium text-stone-700 mb-1">📦 Exportación</label>
                  <select
                    value={formData.exportacionId}
                    onChange={(e) => handleExportacionChange(e.target.value)}
                    className="w-full border border-amber-400 bg-amber-50 rounded-xl px-4 py-3 font-semibold focus:outline-none focus:ring-2 focus:ring-amber-400"
                  >
                    {exportacionesConStock.map(exp => {
                      const stockTotal = (exp.lingotes || []).reduce((sum, l) => sum + (l.cantidad * l.peso), 0);
                      return (
                        <option key={exp.id} value={exp.id}>
                          {exp.nombre} — {formatNum(stockTotal, 0)}g disponibles
                        </option>
                      );
                    })}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-stone-700 mb-1">Cliente</label>
                  <select value={formData.clienteId} onChange={(e) => setFormData({ ...formData, clienteId: e.target.value })} className="w-full border border-stone-300 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-amber-400">
                    {clientes.map(c => (
                      <option key={c.id} value={c.id}>{c.nombre}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-stone-700 mb-1">Fecha Entrega</label>
                  <input type="date" value={formData.fechaEntrega} onChange={(e) => setFormData({ ...formData, fechaEntrega: e.target.value })} className="w-full border border-stone-300 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-amber-400" />
                </div>
              </div>

              {/* Lingotes por tipo de la exportación seleccionada */}
              <div className="bg-amber-50 rounded-xl p-3 mb-4">
                <p className="text-xs text-amber-700 font-medium mb-3">
                  Stock de "{selectedExportacion?.nombre || '?'}"
                </p>
                <div className="space-y-3">
                  {itemsWithStock.map((item, idx) => {
                    const stockInsuficiente = item.cantidad > item.disponible;
                    return (
                      <div key={idx} className={`bg-white rounded-xl p-3 border ${stockInsuficiente ? 'border-red-300' : 'border-amber-200'}`}>
                        <div className="flex items-center justify-between mb-2">
                          <span className="font-semibold text-stone-700">{item.peso}g</span>
                          <span className={`text-xs ${stockInsuficiente ? 'text-red-600' : 'text-green-600'}`}>
                            disponibles: {item.disponible}
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => updateItemCantidad(item.peso, item.cantidad - 1)}
                            className="w-10 h-10 rounded-xl bg-stone-100 hover:bg-stone-200 text-stone-600 font-bold text-xl"
                            disabled={item.cantidad === 0}
                          >
                            −
                          </button>
                          <input
                            type="number"
                            value={item.cantidad}
                            onChange={(e) => updateItemCantidad(item.peso, parseInt(e.target.value) || 0)}
                            className={`flex-1 border rounded-xl px-3 py-2 text-center font-bold text-lg focus:outline-none focus:ring-2 ${
                              stockInsuficiente
                                ? 'border-red-300 text-red-600 focus:ring-red-400'
                                : item.cantidad > 0
                                  ? 'border-amber-400 text-amber-700 bg-amber-50 focus:ring-amber-400'
                                  : 'border-stone-300 text-stone-400 focus:ring-amber-400'
                            }`}
                            min="0"
                            max={item.disponible}
                          />
                          <button
                            onClick={() => updateItemCantidad(item.peso, item.cantidad + 1)}
                            className="w-10 h-10 rounded-xl bg-amber-100 hover:bg-amber-200 text-amber-700 font-bold text-xl"
                            disabled={item.cantidad >= item.disponible}
                          >
                            +
                          </button>
                          {item.disponible > 0 && (
                            <button
                              onClick={() => updateItemCantidad(item.peso, item.disponible)}
                              className="px-2 py-1 rounded-lg bg-stone-100 hover:bg-stone-200 text-stone-500 text-xs"
                            >
                              Max
                            </button>
                          )}
                        </div>
                        {item.cantidad > 0 && (
                          <div className="mt-2 text-right text-sm text-stone-500">
                            = {item.cantidad * item.peso}g
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Summary - altura fija para evitar que se muevan los botones */}
              <div className={`rounded-xl p-4 text-center min-h-[80px] flex flex-col justify-center ${allStockSuficiente && hasAnyItems ? 'bg-emerald-50' : hasAnyItems ? 'bg-red-50' : 'bg-stone-50'}`}>
                {hasAnyItems ? (
                  <>
                    <div className="text-sm text-stone-500 mb-1">Total entrega:</div>
                    <div className={`font-bold text-xl ${allStockSuficiente ? 'text-emerald-700' : 'text-red-700'}`}>
                      {totalLingotes} lingotes = {formatNum(totalGramos, 0)}g
                    </div>
                    <div className="text-xs text-stone-400 mt-1">
                      {itemsWithStock.filter(i => i.cantidad > 0).map(i => `${i.cantidad}×${i.peso}g`).join(' + ')}
                    </div>
                    {!allStockSuficiente && (
                      <p className="text-red-600 text-xs mt-2">⚠️ Stock insuficiente en algún tipo</p>
                    )}
                  </>
                ) : (
                  <p className="text-stone-400 text-sm">Selecciona al menos un lingote</p>
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
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={closeCierreModal}>
        <div className="bg-white rounded-3xl p-6 w-full max-w-md shadow-2xl max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
          <h3 className="text-xl font-bold text-stone-800 mb-2">
            Cerrar {cantidadLingotes > 1 ? `${cantidadLingotes} Lingotes` : 'Lingote'}
          </h3>
          <p className="text-stone-500 text-sm mb-6">
            {cliente?.nombre} • {isMultiEntregaCierre
              ? `${resumenMulti} = ${pesoTotalMulti}g`
              : `${cantidadLingotes > 1 ? `${cantidadLingotes} x ` : ''}${pesoUnitario}g${cantidadLingotes > 1 ? ` = ${pesoUnitario * cantidadLingotes}g` : ''}`
            }
            {isFuturaCierre ? ' (FUTURA)' : ''}
          </p>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-stone-700 mb-1">€/Onza</label>
              <div className="flex gap-2">
                <input
                  type="number"
                  step="0.01"
                  value={formData.euroOnza}
                  onChange={(e) => {
                    setFormData({ ...formData, euroOnza: e.target.value });
                    setEuroOnzaConfirmado(false);
                  }}
                  className={`flex-1 border rounded-xl px-4 py-3 text-lg font-mono focus:outline-none focus:ring-2 focus:ring-amber-400 ${euroOnzaConfirmado ? 'border-emerald-400 bg-emerald-50' : 'border-stone-300'}`}
                  placeholder="Ej: 3693,42"
                  autoFocus
                />
                <button
                  type="button"
                  onClick={confirmarEuroOnza}
                  disabled={!euroOnzaNum || euroOnzaConfirmado}
                  className={`px-4 py-2 rounded-xl font-semibold transition-all ${
                    euroOnzaConfirmado
                      ? 'bg-emerald-100 text-emerald-600 cursor-default'
                      : euroOnzaNum
                        ? 'bg-amber-500 text-white hover:bg-amber-600'
                        : 'bg-stone-200 text-stone-400 cursor-not-allowed'
                  }`}
                >
                  {euroOnzaConfirmado ? '✓' : 'OK'}
                </button>
              </div>
            </div>
            {base > 0 && (
              <div className="bg-stone-50 rounded-xl p-3">
                <div className="flex justify-between text-sm">
                  <span className="text-stone-500">Base (€/Onza ÷ 31,10349):</span>
                  <span className="font-mono font-semibold text-stone-800">{formatNum(base)} €/g</span>
                </div>
              </div>
            )}
            <div>
              <label className="block text-sm font-medium text-stone-700 mb-1">Base Cliente (€/g)</label>
              <input type="number" step="0.01" value={formData.baseCliente} onChange={(e) => setFormData({ ...formData, baseCliente: e.target.value })} onClick={e => e.stopPropagation()} className="w-full border border-stone-300 rounded-xl px-4 py-3 font-mono focus:outline-none focus:ring-2 focus:ring-amber-400" placeholder="Se rellena con OK" />
              {base > 0 && baseClienteNum > 0 && Math.abs(baseClienteNum - base) > 0.001 && (() => {
                const diff = baseClienteNum - base;
                const diffTotal = diff * pesoTotalNeto;
                const isPositive = diff > 0;
                return (
                  <div className={`mt-2 px-3 py-2 rounded-lg text-sm ${isPositive ? 'bg-emerald-50 border border-emerald-200' : 'bg-red-50 border border-red-200'}`}>
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
              <label className="block text-sm font-medium text-stone-700 mb-1">Precio Jofisa (€/g)</label>
              <input type="number" step="0.01" value={formData.precioJofisa} onChange={(e) => setFormData({ ...formData, precioJofisa: e.target.value })} className="w-full border border-stone-300 rounded-xl px-4 py-3 font-mono focus:outline-none focus:ring-2 focus:ring-amber-400" placeholder="Base cliente + 0,25" />
            </div>
            {precioJofisaNum > 0 && (
              <div className="bg-blue-50 border border-blue-200 rounded-xl p-3">
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
                <label className="block text-sm font-medium text-stone-700 mb-1">Margen %</label>
                <input type="number" step="0.1" value={formData.margen} onChange={(e) => setFormData({ ...formData, margen: e.target.value })} className="w-full border border-stone-300 rounded-xl px-4 py-3 font-mono focus:outline-none focus:ring-2 focus:ring-amber-400" />
              </div>
              <div>
                <label className="block text-sm font-medium text-stone-700 mb-1">Precio Cliente</label>
                <div className="w-full border border-stone-200 bg-stone-50 rounded-xl px-4 py-3 font-mono text-stone-800">
                  {precioCliente ? formatNum(precioCliente) : '-'}
                </div>
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-stone-700 mb-1">Fecha Cierre</label>
              <input type="date" value={formData.fechaCierre} onChange={(e) => setFormData({ ...formData, fechaCierre: e.target.value })} className="w-full border border-stone-300 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-amber-400" />
            </div>
            {precioCliente > 0 && (
              <div className="bg-gradient-to-br from-emerald-50 to-green-50 border border-emerald-200 rounded-2xl p-4">
                <h4 className="font-semibold text-emerald-800 mb-3">Resumen Cliente</h4>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-stone-600">Peso neto{cantidadLingotes > 1 ? ' total' : ''}:</span>
                    <span className="font-mono">{cantidadLingotes > 1 ? `${cantidadLingotes} x ${pesoNetoUnitario}g = ` : ''}{pesoTotalNeto}g</span>
                  </div>
                  <div className="flex justify-between"><span className="text-stone-600">Precio cliente:</span><span className="font-mono">{formatNum(precioCliente)} €/g</span></div>
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
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={handleClose}>
        <div className="bg-white rounded-3xl p-6 w-full max-w-md shadow-2xl" onClick={e => e.stopPropagation()}>
          <h3 className="text-xl font-bold text-red-800 mb-2">Nueva FUTURA</h3>
          <p className="text-sm text-stone-500 mb-6">Añadir lingotes sin stock físico. Ciérralos después con el selector.</p>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-stone-700 mb-1">Cantidad</label>
              <div className="flex gap-2">
                {[1, 2, 4, 6, 10].map(q => (
                  <button key={q} onClick={() => setFormData({ ...formData, cantidad: q })} className={`flex-1 py-2 rounded-xl border-2 font-semibold transition-colors ${formData.cantidad === q ? 'border-red-500 bg-red-50 text-red-700' : 'border-stone-200 text-stone-600 hover:border-stone-300'}`}>
                    {q}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-stone-700 mb-1">Peso por lingote</label>
              <div className="flex gap-2">
                {[50, 100].map(p => (
                  <button key={p} onClick={() => setFormData({ ...formData, pesoUnitario: p })} className={`flex-1 py-2 rounded-xl border-2 font-semibold transition-colors ${formData.pesoUnitario === p ? 'border-red-500 bg-red-50 text-red-700' : 'border-stone-200 text-stone-600 hover:border-stone-300'}`}>
                    {p}g
                  </button>
                ))}
              </div>
            </div>
            <div className="bg-red-50 rounded-xl p-3 text-center">
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

  // Assign Futura Modal - select orphan FUTURA lingotes and assign to a real entrega
  // Also allows adding extra lingotes from stock
  const AssignFuturaModal = () => {
    const clienteId = selectedCliente || editingEntregaClienteId;
    const cliente = getCliente(clienteId);
    const clienteFutura = (futuraLingotes || []).filter(f => f.clienteId === clienteId);
    const targetEntregasList = entregas.filter(e => e.clienteId === clienteId);

    const [selectedIds, setSelectedIds] = useState([]);
    const [selectedTarget, setSelectedTarget] = useState(targetEntregasList[0]?.id || '');
    // State para lingotes adicionales del stock: { peso: cantidad }
    const [extraLingotes, setExtraLingotes] = useState({});

    if (clienteFutura.length === 0) return null;

    const toggleId = (id) => {
      setSelectedIds(prev => prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]);
    };

    const selectAll = () => {
      setSelectedIds(clienteFutura.map(f => f.id));
    };

    // Obtener stock disponible de la exportación de la entrega seleccionada
    const selectedEntrega = entregas.find(e => e.id === selectedTarget);
    const selectedExp = selectedEntrega ? exportaciones.find(ex => ex.id === selectedEntrega.exportacionId) : null;
    const stockDisponible = selectedExp?.lingotes?.filter(l => l.cantidad > 0) || [];

    const updateExtraCantidad = (peso, delta) => {
      const stockItem = stockDisponible.find(s => s.peso === peso);
      const maxCantidad = stockItem?.cantidad || 0;
      setExtraLingotes(prev => {
        const current = prev[peso] || 0;
        const newVal = Math.max(0, Math.min(maxCantidad, current + delta));
        if (newVal === 0) {
          const { [peso]: _, ...rest } = prev;
          return rest;
        }
        return { ...prev, [peso]: newVal };
      });
    };

    const totalExtraLingotes = Object.entries(extraLingotes).reduce((sum, [peso, cant]) => sum + cant, 0);
    const totalExtraPeso = Object.entries(extraLingotes).reduce((sum, [peso, cant]) => sum + (parseFloat(peso) * cant), 0);

    const handleAssign = async () => {
      if ((selectedIds.length === 0 && totalExtraLingotes === 0) || !selectedTarget) return;

      const targetEntrega = entregas.find(e => e.id === selectedTarget);
      if (!targetEntrega) return;

      // 1. Build new lingotes from futura docs
      const newLingotes = [];
      for (const fId of selectedIds) {
        const f = clienteFutura.find(fl => fl.id === fId);
        if (!f) continue;
        const hasPrecio = !!f.precio;
        newLingotes.push({
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
          esFutura: true, // Marcar que viene de FUTURA
        });
      }

      // 2. Add extra lingotes from stock
      for (const [peso, cantidad] of Object.entries(extraLingotes)) {
        for (let i = 0; i < cantidad; i++) {
          newLingotes.push({
            peso: parseFloat(peso),
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

      // 3. Update entrega with new lingotes
      await onUpdateEntrega(selectedTarget, {
        lingotes: [...targetEntrega.lingotes, ...newLingotes],
      });

      // 4. Descontar stock de la exportación si hay extra lingotes
      if (totalExtraLingotes > 0 && selectedExp) {
        const updatedExpLingotes = selectedExp.lingotes.map(l => {
          const usedCantidad = extraLingotes[l.peso] || 0;
          return usedCantidad > 0 ? { ...l, cantidad: l.cantidad - usedCantidad } : l;
        }).filter(l => l.cantidad > 0);

        await onSaveExportacion({
          ...selectedExp,
          lingotes: updatedExpLingotes,
        });
      }

      // 5. Delete futura docs
      for (const fId of selectedIds) {
        await onDeleteFutura(fId);
      }

      setShowAssignFuturaModal(false);
    };

    const totalFuturaSelected = clienteFutura.filter(f => selectedIds.includes(f.id)).reduce((s, f) => s + (f.peso || 0), 0);

    return (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => setShowAssignFuturaModal(false)}>
        <div className="bg-white rounded-3xl p-6 w-full max-w-md shadow-2xl max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
          <h3 className="text-xl font-bold text-stone-800 mb-2">Asignar FUTURA</h3>
          <p className="text-sm text-stone-500 mb-4">{cliente?.nombre} tiene {clienteFutura.length} lingotes FUTURA</p>

          {targetEntregasList.length > 0 ? (
            <>
              <div className="mb-4">
                <label className="block text-sm font-medium text-stone-700 mb-1">Asignar a entrega</label>
                <select value={selectedTarget} onChange={e => { setSelectedTarget(e.target.value); setExtraLingotes({}); }} className="w-full border border-stone-300 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-amber-400">
                  {targetEntregasList.map(e => {
                    const exp = getExportacion(e.exportacionId);
                    return <option key={e.id} value={e.id}>{e.fechaEntrega} {exp ? `(${exp.nombre})` : ''} - {numLingotes(e)} lingotes</option>;
                  })}
                </select>
              </div>

              {/* Lingotes FUTURA */}
              <div className="mb-4">
                <div className="flex justify-between items-center mb-2">
                  <label className="text-sm font-medium text-stone-700">Lingotes FUTURA</label>
                  <button onClick={selectAll} className="text-xs text-amber-600 font-semibold hover:text-amber-700">
                    Seleccionar todos
                  </button>
                </div>
                <div className="space-y-1 max-h-40 overflow-y-auto">
                  {clienteFutura.map((f) => {
                    const isSelected = selectedIds.includes(f.id);
                    return (
                      <div key={f.id} onClick={() => toggleId(f.id)} className={`flex items-center justify-between p-2 rounded-lg cursor-pointer transition-colors ${isSelected ? 'bg-amber-100 border border-amber-300' : 'bg-stone-50 border border-stone-200 hover:bg-stone-100'}`}>
                        <div className="flex items-center gap-2">
                          <div className={`w-5 h-5 rounded border-2 flex items-center justify-center text-xs ${isSelected ? 'bg-amber-500 border-amber-500 text-white' : 'border-stone-300'}`}>
                            {isSelected && '✓'}
                          </div>
                          <span className="font-mono text-sm">{f.peso}g</span>
                        </div>
                        <div className="text-xs text-stone-500">
                          {f.precio ? `${formatNum(f.precio)} €/g` : 'sin precio'}
                          {f.nFactura ? ` • ${f.nFactura}` : ''}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Lingotes adicionales del stock */}
              {stockDisponible.length > 0 && (
                <div className="mb-4 p-3 bg-emerald-50 rounded-xl border border-emerald-200">
                  <label className="text-sm font-medium text-emerald-800 mb-2 block">+ Añadir del stock ({selectedExp?.nombre})</label>
                  <div className="space-y-2">
                    {stockDisponible.map(s => (
                      <div key={s.peso} className="flex items-center justify-between">
                        <span className="font-mono text-sm text-emerald-700">{s.peso}g</span>
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-emerald-600">disp: {s.cantidad}</span>
                          <div className="flex items-center bg-white rounded-lg border border-emerald-300">
                            <button
                              onClick={() => updateExtraCantidad(s.peso, -1)}
                              className="w-8 h-8 flex items-center justify-center text-emerald-600 hover:bg-emerald-100 rounded-l-lg"
                              disabled={!extraLingotes[s.peso]}
                            >
                              −
                            </button>
                            <span className="w-8 text-center font-mono text-sm">{extraLingotes[s.peso] || 0}</span>
                            <button
                              onClick={() => updateExtraCantidad(s.peso, 1)}
                              className="w-8 h-8 flex items-center justify-center text-emerald-600 hover:bg-emerald-100 rounded-r-lg"
                              disabled={(extraLingotes[s.peso] || 0) >= s.cantidad}
                            >
                              +
                            </button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Resumen */}
              {(selectedIds.length > 0 || totalExtraLingotes > 0) && (
                <div className="bg-amber-50 rounded-xl p-3 mb-4 space-y-1">
                  {selectedIds.length > 0 && (
                    <div className="flex justify-between text-sm">
                      <span className="text-amber-600">FUTURA:</span>
                      <span className="font-bold text-amber-800">{selectedIds.length} lingotes ({totalFuturaSelected}g)</span>
                    </div>
                  )}
                  {totalExtraLingotes > 0 && (
                    <div className="flex justify-between text-sm">
                      <span className="text-emerald-600">Stock:</span>
                      <span className="font-bold text-emerald-800">{totalExtraLingotes} lingotes ({totalExtraPeso}g)</span>
                    </div>
                  )}
                  <div className="flex justify-between text-sm pt-1 border-t border-amber-200">
                    <span className="font-semibold text-stone-700">Total:</span>
                    <span className="font-bold text-stone-800">{selectedIds.length + totalExtraLingotes} lingotes ({totalFuturaSelected + totalExtraPeso}g)</span>
                  </div>
                </div>
              )}

              <div className="flex gap-3">
                <Button variant="secondary" className="flex-1" onClick={() => setShowAssignFuturaModal(false)}>Omitir</Button>
                <Button className="flex-1" disabled={(selectedIds.length === 0 && totalExtraLingotes === 0) || !selectedTarget} onClick={handleAssign}>
                  Asignar ({selectedIds.length + totalExtraLingotes})
                </Button>
              </div>
            </>
          ) : (
            <>
              <p className="text-stone-500 text-sm mb-4">No hay entregas a las que asignar. Crea una nueva entrega primero.</p>
              <Button variant="secondary" className="w-full" onClick={() => setShowAssignFuturaModal(false)}>Cerrar</Button>
            </>
          )}
        </div>
      </div>
    );
  };

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
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => setShowMultiCierreModal(false)}>
        <div className="bg-white rounded-3xl p-6 w-full max-w-md shadow-2xl max-h-[85vh] overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
          <div className="flex justify-between items-center mb-4">
            <h3 className="text-lg font-bold text-stone-800">Seleccionar lingotes</h3>
            <button onClick={selectAll} className="text-xs text-amber-600 hover:text-amber-700 font-semibold">
              Seleccionar todos
            </button>
          </div>

          <div className="flex-1 overflow-y-auto space-y-3 mb-4">
            {Object.values(porEntrega).map(grupo => {
              const allSelected = grupo.lingotes.every(l => multiCierreSelection[`${l.entregaId}_${l.lingoteIdx}`]);
              const someSelected = grupo.lingotes.some(l => multiCierreSelection[`${l.entregaId}_${l.lingoteIdx}`]);

              return (
                <div key={grupo.entregaId} className="border border-stone-200 rounded-xl p-3">
                  <div
                    className="flex items-center gap-2 mb-2 cursor-pointer"
                    onClick={() => toggleEntrega(grupo.entregaId, grupo.lingotes)}
                  >
                    <div className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-colors ${
                      allSelected ? 'bg-amber-500 border-amber-500 text-white' :
                      someSelected ? 'bg-amber-200 border-amber-400' : 'border-stone-300'
                    }`}>
                      {allSelected && '✓'}
                      {someSelected && !allSelected && '–'}
                    </div>
                    <span
                      className="px-2 py-0.5 rounded font-bold text-sm"
                      style={{ backgroundColor: getEntregaColor(grupo.fechaEntrega) + '20', color: getEntregaColor(grupo.fechaEntrega) }}
                    >{formatEntregaShort(grupo.fechaEntrega)}</span>
                    <span className="text-xs text-stone-500">• Exp: {grupo.exportacionNombre}</span>
                  </div>
                  <div className="grid grid-cols-4 gap-1">
                    {grupo.lingotes.map(l => {
                      const key = `${l.entregaId}_${l.lingoteIdx}`;
                      const isSelected = multiCierreSelection[key];
                      return (
                        <button
                          key={key}
                          onClick={() => toggleLingote(l.entregaId, l.lingoteIdx)}
                          className={`py-1.5 px-2 rounded-lg text-xs font-mono font-semibold transition-colors ${
                            isSelected
                              ? 'bg-amber-500 text-white'
                              : 'bg-stone-100 text-stone-600 hover:bg-stone-200'
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
          <div className="border-t border-stone-200 pt-4">
            {selectedCount > 0 && (
              <div className="text-sm text-stone-600 mb-3 text-center">
                <span className="font-bold text-amber-600">{selectedCount}</span> lingotes seleccionados = <span className="font-bold">{selectedPeso}g</span>
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

        setShowFacturaModal(false);
        setFacturaFile(null);
        setFacturaSelection({});
      } catch (error) {
        console.error('Error subiendo factura:', error);
        alert('Error: ' + error.message);
      }
    };

    return (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => setShowFacturaModal(false)}>
        <div className="bg-white rounded-3xl p-6 w-full max-w-md shadow-2xl max-h-[85vh] overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
          <h3 className="text-lg font-bold text-stone-800 mb-4">Subir Factura</h3>

          {/* File input */}
          <div className="mb-4">
            <label className="block text-sm font-medium text-stone-700 mb-2">Archivo (PDF o imagen)</label>
            <input
              type="file"
              accept=".pdf,image/*"
              onChange={handleFileChange}
              className="w-full border border-stone-300 rounded-xl px-3 py-2 text-sm"
            />
            {facturaFile && (
              <div className="mt-2 p-2 bg-emerald-50 rounded-lg text-sm text-emerald-700">
                ✓ {facturaFile.name}
              </div>
            )}
          </div>

          {/* Selección de lingotes */}
          <div className="flex justify-between items-center mb-2">
            <span className="text-sm font-medium text-stone-700">Asignar a lingotes:</span>
            <button onClick={selectAll} className="text-xs text-amber-600 hover:text-amber-700 font-semibold">
              Seleccionar todos
            </button>
          </div>

          <div className="flex-1 overflow-y-auto border border-stone-200 rounded-xl p-2 mb-4 max-h-48">
            {lingotesSinFactura.length === 0 ? (
              <p className="text-stone-400 text-sm text-center py-4">No hay lingotes sin factura</p>
            ) : (
              <div className="space-y-1">
                {lingotesSinFactura.map(l => {
                  const key = l.isFutura ? `futura_${l.futuraId}` : `${l.entregaId}_${l.lingoteIdx}`;
                  const isSelected = facturaSelection[key];
                  return (
                    <div
                      key={key}
                      onClick={() => setFacturaSelection(prev => ({ ...prev, [key]: !prev[key] }))}
                      className={`flex items-center gap-2 p-2 rounded-lg cursor-pointer transition-colors ${
                        isSelected ? 'bg-amber-100 border border-amber-300' : 'bg-stone-50 hover:bg-stone-100'
                      }`}
                    >
                      <div className={`w-5 h-5 rounded border-2 flex items-center justify-center ${
                        isSelected ? 'bg-amber-500 border-amber-500 text-white' : 'border-stone-300'
                      }`}>
                        {isSelected && '✓'}
                      </div>
                      {l.isFutura ? (
                        <span className="px-1.5 py-0.5 rounded text-xs font-bold bg-red-100 text-red-700">FUTURA</span>
                      ) : (
                        <span
                          className="px-1.5 py-0.5 rounded text-xs font-bold"
                          style={{ backgroundColor: getEntregaColor(l.fechaEntrega) + '20', color: getEntregaColor(l.fechaEntrega) }}
                        >{formatEntregaShort(l.fechaEntrega)}</span>
                      )}
                      <span className="font-mono text-sm">{l.peso}g</span>
                      <span className="text-xs text-stone-400">{formatEur(l.importe || 0)}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {selectedCount > 0 && (
            <div className="text-sm text-center text-stone-600 mb-3">
              <span className="font-bold text-amber-600">{selectedCount}</span> lingotes seleccionados
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
      <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4" onClick={() => setViewingFactura(null)}>
        <div className="bg-white rounded-3xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
          <div className="flex justify-between items-center p-4 border-b border-stone-200">
            <h3 className="font-bold text-stone-800">{viewingFactura.nombre}</h3>
            <button
              onClick={() => setViewingFactura(null)}
              className="w-8 h-8 rounded-full bg-stone-100 hover:bg-stone-200 flex items-center justify-center"
            >
              ✕
            </button>
          </div>
          <div className="flex-1 overflow-auto p-4">
            {isPdf ? (
              <iframe
                src={viewingFactura.data}
                className="w-full h-[70vh] rounded-xl"
                title={viewingFactura.nombre}
              />
            ) : (
              <img
                src={viewingFactura.data}
                alt={viewingFactura.nombre}
                className="max-w-full h-auto rounded-xl mx-auto"
              />
            )}
          </div>
          <div className="p-4 border-t border-stone-200 flex gap-3">
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

  // Tab button
  const TabBtn = ({ id, label, icon }) => (
    <button
      onClick={() => { setActiveTab(id); setSelectedCliente(null); }}
      className={`flex-1 py-3 px-2 text-xs sm:text-sm font-medium transition-all duration-300 relative ${
        activeTab === id
          ? 'bg-gradient-to-r from-amber-500 to-yellow-500 text-white shadow-md'
          : 'text-amber-700 hover:text-amber-900 hover:bg-amber-100'
      }`}
      style={{ borderRadius: activeTab === id ? '8px' : '0' }}
    >
      <span className="block">{icon}</span>
      <span className="block mt-1">{label}</span>
    </button>
  );

  return (
    <div className="min-h-screen bg-gradient-to-br from-stone-100 via-amber-50/30 to-orange-50/20">
      {/* Header + Nav sticky */}
      <div className="sticky top-0 z-40">
        <header className="bg-gradient-to-r from-stone-700 to-stone-600 border-b border-stone-500 p-3 shadow-md">
          <div className="flex items-center justify-between max-w-2xl mx-auto">
            <div className="flex items-center gap-2 cursor-pointer" onClick={onBack}>
              <span className="text-2xl">🥇</span>
              <h1 className="text-xl font-bold text-white drop-shadow-sm">Lingotes</h1>
              <span className="text-xs text-stone-400 ml-1">v2.7</span>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-white/80 text-sm">{currentUser}</span>
              <Button size="sm" onClick={() => setShowEntregaModal(true)}>+ Entrega</Button>
            </div>
          </div>
        </header>

        {/* Navigation */}
        <nav className="bg-white border-b border-amber-200 flex shadow-sm">
          <TabBtn id="stock" label="Stock" icon="📊" />
          <TabBtn id="exportaciones" label="Exportaciones" icon="📦" />
          <TabBtn id="estadisticas" label="Stats" icon="💰" />
          <TabBtn id="parametros" label="Ajustes" icon="⚙️" />
        </nav>
      </div>

      {/* Content */}
      <main className="max-w-2xl mx-auto p-4 pb-24">
        {activeTab === 'stock' && <StockOverview />}
        {activeTab === 'exportaciones' && <ExportacionesView />}
        {activeTab === 'estadisticas' && <EstadisticasView />}
        {activeTab === 'parametros' && <ParametrosView />}
      </main>

      {/* Modals */}
      {showEntregaModal && <EntregaModal />}
      {showCierreModal && <CierreModal />}
      {showFuturaModal && <FuturaModal />}
      {showAssignFuturaModal && <AssignFuturaModal />}
      {showMultiCierreModal && <MultiCierreModal />}
      {showFacturaModal && <FacturaModal />}
      {viewingFactura && <ViewFacturaModal />}
    </div>
  );
}
