import React, { useState, useMemo } from 'react';

const formatNum = (num, decimals = 2) => {
  if (num === null || num === undefined || isNaN(num)) return '-';
  return num.toLocaleString('de-DE', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
};

const formatEur = (num) => formatNum(num, 2) + ' €';

// Entrega date as short label: "2025-01-19" → "25-1"
const formatEntregaShort = (fecha) => {
  if (!fecha || fecha === '-') return '-';
  const m = fecha.match(/^(\d{4})-(\d{2})/);
  if (!m) return fecha;
  return `${m[1].slice(2)}-${parseInt(m[2])}`;
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
const pesoDevuelto = (entrega) => (entrega.lingotes || []).reduce((s, l) => s + (l.pesoDevuelto || 0), 0);
const importeEntrega = (entrega) => (entrega.lingotes || []).filter(l => isCerrado(l)).reduce((s, l) => s + (l.importe || 0), 0);
const numLingotes = (entrega) => (entrega.lingotes || []).length;
const lingotesEnCurso = (entrega) => (entrega.lingotes || []).filter(l => l.estado === 'en_curso');
const lingotesPendientePago = (entrega) => (entrega.lingotes || []).filter(l => l.estado === 'pendiente_pago');
const lingotesFinalizados = (entrega) => (entrega.lingotes || []).filter(l => l.estado === 'finalizado');
const lingotesCerrados = (entrega) => (entrega.lingotes || []).filter(l => isCerrado(l));
// An entrega is "finalizada" when ALL lingotes are cerrados (pendiente_pago or finalizado)
const isEntregaFinalizada = (entrega) => {
  const all = entrega.lingotes || [];
  return all.length > 0 && all.every(l => isCerrado(l));
};
const isEntregaEnCurso = (entrega) => !isEntregaFinalizada(entrega);

export default function LingotesTracker({
  clientes,
  exportaciones,
  entregas,
  futuraLingotes,
  config,
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
}) {
  const [activeTab, setActiveTab] = useState('stock');
  const [selectedCliente, setSelectedCliente] = useState(null);
  const [showEntregaModal, setShowEntregaModal] = useState(false);
  const [showCierreModal, setShowCierreModal] = useState(false);
  const [selectedEntrega, setSelectedEntrega] = useState(null);
  const [selectedLingoteIdx, setSelectedLingoteIdx] = useState(null);
  const [editingEntregaClienteId, setEditingEntregaClienteId] = useState(null);
  const [entregaFilter, setEntregaFilter] = useState('en_curso');
  const [showFuturaModal, setShowFuturaModal] = useState(false);
  const [showAssignFuturaModal, setShowAssignFuturaModal] = useState(false);
  const [selectedFuturaId, setSelectedFuturaId] = useState(null);

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
  // Calculate global stock from all exportaciones
  // Calculate global stock from all exportaciones
  const stockGlobal = useMemo(() => {
    const stockByPeso = {};
    exportaciones.forEach(exp => {
      (exp.lingotes || []).forEach(l => {
        const peso = l.peso;
        if (!stockByPeso[peso]) stockByPeso[peso] = 0;
        stockByPeso[peso] += l.cantidad || 0;
      });
    });
    // Convert to array sorted by peso
    return Object.entries(stockByPeso)
      .map(([peso, cantidad]) => ({ peso: parseFloat(peso), cantidad }))
      .sort((a, b) => a.peso - b.peso);
  }, [exportaciones]);

  // Total stock real in grams
  const stockRealTotal = useMemo(() => {
    return stockGlobal.reduce((sum, s) => sum + (s.cantidad * s.peso), 0);
  }, [stockGlobal]);

  const stockRealLingotes = useMemo(() => {
    return stockGlobal.reduce((sum, s) => sum + s.cantidad, 0);
  }, [stockGlobal]);

  const addEntrega = async (data) => {
    // First, check if we have enough stock
    const pesoRequerido = data.pesoUnitario;
    const cantidadRequerida = data.cantidad;
    const stockDisponible = stockGlobal.find(s => s.peso === pesoRequerido)?.cantidad || 0;

    if (stockDisponible < cantidadRequerida) {
      alert(`No hay suficiente stock de lingotes de ${pesoRequerido}g. Disponibles: ${stockDisponible}, Requeridos: ${cantidadRequerida}`);
      return;
    }

    // Deduct from exportaciones stock (FIFO - first exportacion first)
    let remaining = cantidadRequerida;
    for (const exp of exportaciones) {
      if (remaining <= 0) break;
      const expLingotes = exp.lingotes || [];
      const idx = expLingotes.findIndex(l => l.peso === pesoRequerido && l.cantidad > 0);
      if (idx !== -1) {
        const available = expLingotes[idx].cantidad;
        const toDeduct = Math.min(available, remaining);
        const newLingotes = [...expLingotes];
        newLingotes[idx] = { ...newLingotes[idx], cantidad: newLingotes[idx].cantidad - toDeduct };
        // Remove if empty
        const filtered = newLingotes.filter(l => l.cantidad > 0);
        await onSaveExportacion({ ...exp, lingotes: filtered }, exp.id);
        remaining -= toDeduct;
      }
    }

    // Create the entrega with lingotes
    const lingotes = [];
    for (let i = 0; i < data.cantidad; i++) {
      lingotes.push({
        peso: data.pesoUnitario,
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
    await onSaveEntrega({
      clienteId: data.clienteId,
      exportacionId: data.exportacionId,
      fechaEntrega: data.fechaEntrega,
      lingotes,
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
    const importe = data.precio ? data.peso * data.precio : 0;
    await onSaveFutura({
      clienteId: data.clienteId,
      peso: data.peso,
      precio: data.precio || null,
      importe,
      nFactura: data.nFactura || null,
      fechaCierre: data.fechaCierre || null,
      pagado: data.pagado || false,
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

  const cerrarLingote = async (entregaId, lingoteIdx, data) => {
    const entrega = entregas.find(e => e.id === entregaId);
    if (!entrega) return;
    const lingotes = [...entrega.lingotes];
    const pesoNeto = (lingotes[lingoteIdx].peso || 0) - (data.devolucion || 0);
    lingotes[lingoteIdx] = {
      ...lingotes[lingoteIdx],
      euroOnza: data.euroOnza || null,
      base: data.base || null,
      precioJofisa: data.precioJofisa || null,
      importeJofisa: data.importeJofisa || 0,
      margen: data.margen || 0,
      precio: data.precio,
      importe: data.precio * pesoNeto,
      nFactura: data.nFactura,
      fechaCierre: data.fechaCierre,
      pesoCerrado: lingotes[lingoteIdx].peso,
      pesoDevuelto: data.devolucion || 0,
      estado: 'pendiente_pago',
      pagado: false,
    };
    await onUpdateEntrega(entregaId, { lingotes });
    setShowCierreModal(false);
    setSelectedEntrega(null);
    setSelectedLingoteIdx(null);
    setSelectedFuturaId(null);
  };

  const cerrarFutura = async (futuraId, data) => {
    const f = (futuraLingotes || []).find(fl => fl.id === futuraId);
    if (!f) return;
    const pesoNeto = (f.peso || 0) - (data.devolucion || 0);
    await onUpdateFutura(futuraId, {
      euroOnza: data.euroOnza || null,
      base: data.base || null,
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

  const marcarPagado = async (entregaId, lingoteIdx) => {
    const entrega = entregas.find(e => e.id === entregaId);
    if (!entrega) return;
    const lingotes = [...entrega.lingotes];
    const l = lingotes[lingoteIdx];
    if (l.estado === 'pendiente_pago') {
      // Mark as paid → finalizado
      lingotes[lingoteIdx] = { ...l, pagado: true, estado: 'finalizado' };
    } else if (l.estado === 'finalizado') {
      // Unmark paid → back to pendiente_pago
      lingotes[lingoteIdx] = { ...l, pagado: false, estado: 'pendiente_pago' };
    }
    await onUpdateEntrega(entregaId, { lingotes });
  };

  const deleteEntrega = async (entregaId) => {
    if (confirm('Eliminar esta entrega?')) {
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

    if (selectedCliente) {
      return <ClienteDetalle />;
    }

    return (
      <div className="space-y-6">
        {/* Stock Ma d'Or - card grande */}
        <div className={`bg-gradient-to-br ${stockColor.bg} rounded-2xl p-5 text-white shadow-lg`}>
          <div className="text-center mb-3">
            <p className={`text-xs ${stockColor.text} mb-1`}>📦 Stock Ma d'Or</p>
            <div className={`text-5xl font-black ${stockColor.accent}`}>{formatNum(stockRealTotal, 0)}</div>
            <div className={`text-sm ${stockColor.text}`}>gramos</div>
          </div>
          {stockGlobal.length > 0 && (
            <div className="flex flex-wrap justify-center gap-2 pt-3 border-t border-white/20">
              {stockGlobal.map((s, idx) => (
                <div key={idx} className="bg-white/20 rounded-lg px-3 py-1 text-sm">
                  <span className="font-bold">{s.cantidad}</span>
                  <span className="text-white/70 ml-1">× {s.peso}g</span>
                </div>
              ))}
            </div>
          )}
          {stockGlobal.length === 0 && (
            <p className={`text-center text-sm ${stockColor.text}`}>Sin stock. Crea una exportación.</p>
          )}
        </div>

        <div className={`grid ${stockTotal.totalFutura > 0 ? 'grid-cols-2' : 'grid-cols-1'} gap-4`}>
          <div className="bg-gradient-to-br from-stone-700 via-stone-600 to-stone-700 rounded-2xl p-4 text-white shadow-lg">
            <div className="text-center">
              <p className="text-xs text-stone-400 mb-1">En Clientes</p>
              <div className="text-3xl font-black text-amber-400">{formatNum(stockTotal.stockClientes, 0)}</div>
              <div className="text-xs text-stone-400">gramos</div>
            </div>
          </div>
          {stockTotal.totalFutura > 0 && (
            <div className="bg-gradient-to-br from-red-700 via-red-600 to-red-700 rounded-2xl p-4 text-white shadow-lg">
              <div className="text-center">
                <p className="text-xs text-red-200 mb-1">FUTURA</p>
                <div className="text-3xl font-black text-white">-{formatNum(stockTotal.totalFutura, 0)}</div>
                <div className="text-xs text-red-200">gramos</div>
              </div>
            </div>
          )}
        </div>

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

    // Entregas with en_curso lingotes
    const entregasConEnCurso = entregasFiltered.filter(e => lingotesEnCurso(e).length > 0);

    // All cerrados (pendiente_pago + finalizado) as flat list with entrega info, sorted by entrega date desc
    const allLingotesCerrados = [...entregasFiltered]
      .sort((a, b) => (b.fechaEntrega || '').localeCompare(a.fechaEntrega || ''))
      .flatMap(e =>
        (e.lingotes || []).map((l, idx) => ({ ...l, entregaId: e.id, lingoteIdx: idx, fechaEntrega: e.fechaEntrega }))
      ).filter(l => l.estado === 'pendiente_pago' || l.estado === 'finalizado');

    // FUTURA orphan lingotes for this client
    const clienteFutura = (futuraLingotes || []).filter(f => f.clienteId === cliente.id);
    const futuraWeight = clienteFutura.reduce((sum, f) => sum + (f.peso || 0), 0);

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

    return (
      <div className="space-y-5">
        <div className="rounded-2xl p-5 text-white shadow-lg relative overflow-hidden" style={{ background: `linear-gradient(135deg, ${cliente.color}, ${cliente.color}dd)` }}>
          <button onClick={() => setSelectedCliente(null)} className="absolute top-3 left-3 text-white/80 hover:text-white text-sm flex items-center gap-1 bg-white/20 rounded-lg px-2 py-1">
            ← Volver
          </button>
          <div className="text-center pt-6">
            <h2 className="text-xl font-bold mb-1">{cliente.nombre}</h2>
            <div className="grid grid-cols-4 gap-3 mt-4">
              <div className="bg-white/20 rounded-xl p-2">
                <div className="text-lg font-bold">{formatNum(filteredEntregado, 0)}</div>
                <div className="text-xs text-white/70">Entregado</div>
              </div>
              <div className="bg-white/20 rounded-xl p-2">
                <div className="text-lg font-bold">{formatNum(filteredCerrado, 0)}</div>
                <div className="text-xs text-white/70">Cerrado</div>
              </div>
              <div className="bg-white/20 rounded-xl p-2">
                <div className="text-lg font-bold">{formatNum(filteredDevuelto, 0)}</div>
                <div className="text-xs text-white/70">Devuelto</div>
              </div>
              <div className="bg-white/20 rounded-xl p-2">
                <div className="text-lg font-bold">{formatNum(filteredPendiente, 0)}</div>
                <div className="text-xs text-white/70">Pendiente</div>
              </div>
            </div>
          </div>
        </div>

        {/* Filter buttons */}
        <div className="flex gap-2">
          <FilterBtn id="en_curso" label="En Curso" count={countEnCurso} />
          <FilterBtn id="finalizada" label="Finalizadas" count={countFinalizadas} />
          <FilterBtn id="todas" label="Todas" count={allEntregasCliente.length} />
        </div>

        {/* FUTURA orphan lingotes */}
        {clienteFutura.length > 0 && (
          <div className="bg-red-50 border border-red-200 rounded-2xl p-4">
            <div className="flex justify-between items-center mb-3">
              <h3 className="font-bold text-red-800">FUTURA</h3>
              <div className="text-sm text-red-600 font-semibold">
                {clienteFutura.length} lingotes &bull; -{formatNum(futuraWeight, 0)}g
              </div>
            </div>
            <div className="space-y-1">
              {clienteFutura.map((f) => (
                <div key={f.id} className="flex items-center justify-between text-sm py-1.5 px-2 rounded bg-white/60">
                  <span className="font-mono text-red-700">{f.peso}g</span>
                  <div className="flex items-center gap-2">
                    {f.precio ? (
                      <span className="text-xs text-stone-500">{formatNum(f.precio)} €/g &bull; {f.nFactura || '-'}</span>
                    ) : (
                      <>
                        <span className="text-xs text-red-400">sin precio</span>
                        <Button size="sm" variant="success" onClick={() => { setSelectedFuturaId(f.id); setShowCierreModal(true); }}>
                          Cerrar
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
            {allEntregasCliente.length > 0 && (
              <div className="mt-3">
                <Button size="sm" onClick={() => setShowAssignFuturaModal(true)}>
                  Asignar a entrega
                </Button>
              </div>
            )}
          </div>
        )}

        {/* En Curso */}
        {entregasConEnCurso.length > 0 && (
          <Card>
            <div className="flex justify-between items-center mb-4">
              <h3 className="font-bold text-stone-800">En Curso</h3>
              <div className="text-sm text-stone-500">
                {entregasConEnCurso.reduce((s, e) => s + lingotesEnCurso(e).length, 0)} lingotes
              </div>
            </div>
            <div className="space-y-3">
              {entregasConEnCurso.map(entrega => {
                const exportacion = getExportacion(entrega.exportacionId);
                const enCursoList = lingotesEnCurso(entrega);
                const totalPeso = enCursoList.reduce((s, l) => s + (l.peso || 0), 0);
                return (
                  <div key={entrega.id} className="p-3 rounded-xl bg-amber-50 border border-amber-200">
                    <div className="flex items-center justify-between mb-2">
                      <div>
                        <div className="font-semibold text-stone-800">{enCursoList.length} x {enCursoList[0]?.peso || '?'}g = {totalPeso}g</div>
                        <div className="text-xs text-stone-500">{entrega.fechaEntrega} {exportacion ? `• Exp: ${exportacion.nombre}` : ''}</div>
                      </div>
                      <div className="flex gap-2">
                        <Button size="sm" variant="danger" onClick={() => deleteEntrega(entrega.id)}>x</Button>
                      </div>
                    </div>
                    <div className="space-y-1">
                      {entrega.lingotes.map((l, idx) => {
                        if (l.estado !== 'en_curso') return null;
                        return (
                          <div key={idx} className="flex items-center justify-between text-sm py-1 px-2 rounded bg-white/60">
                            <span className="font-mono text-stone-700">{l.peso}g</span>
                            <Button size="sm" variant="success" onClick={() => { setSelectedEntrega(entrega); setSelectedLingoteIdx(idx); setShowCierreModal(true); }}>
                              Cerrar
                            </Button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>
        )}

        {/* Finalizados table with Entrega column */}
        {allLingotesCerrados.length > 0 && (
          <Card>
            <div className="flex justify-between items-center mb-4">
              <h3 className="font-bold text-stone-800">Cerrados ({allLingotesCerrados.length})</h3>
              <div className="text-sm text-stone-500">
                Importe: <span className="font-semibold text-emerald-600">{formatEur(filteredImporte)}</span>
              </div>
            </div>
            <div className="overflow-x-auto -mx-5 px-5">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-stone-200">
                    <th className="text-left py-2 px-1 text-stone-500 font-medium text-xs">Entrega</th>
                    <th className="text-left py-2 px-1 text-stone-500 font-medium text-xs">Cierre</th>
                    <th className="text-right py-2 px-1 text-stone-500 font-medium text-xs">Peso</th>
                    <th className="text-right py-2 px-1 text-stone-500 font-medium text-xs">€/g</th>
                    <th className="text-right py-2 px-1 text-stone-500 font-medium text-xs">Importe</th>
                    <th className="text-center py-2 px-1 text-stone-500 font-medium text-xs">Pagado</th>
                  </tr>
                </thead>
                <tbody>
                  {allLingotesCerrados.map((l, i) => (
                    <tr key={i} className={`border-b border-stone-100 ${l.estado === 'pendiente_pago' ? 'bg-amber-50/50' : 'hover:bg-stone-50'}`}>
                      <td className="py-2 px-1">
                        {l.fechaEntrega ? (
                          <span
                            className="text-xs px-1.5 py-0.5 rounded font-bold"
                            style={{ backgroundColor: getEntregaColor(l.fechaEntrega) + '20', color: getEntregaColor(l.fechaEntrega) }}
                          >{formatEntregaShort(l.fechaEntrega)}</span>
                        ) : '-'}
                      </td>
                      <td className="py-2 px-1 text-xs">{l.fechaCierre || '-'}</td>
                      <td className="py-2 px-1 text-right font-mono text-xs">{l.peso}g</td>
                      <td className="py-2 px-1 text-right font-mono text-xs">{formatNum(l.precio)}</td>
                      <td className="py-2 px-1 text-right font-mono font-semibold text-xs">{formatEur(l.importe || 0)}</td>
                      <td className="py-2 px-1 text-center">
                        <button
                          onClick={() => marcarPagado(l.entregaId, l.lingoteIdx)}
                          className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition-colors text-xs ${
                            l.pagado ? 'bg-emerald-500 border-emerald-500 text-white' : 'border-stone-300 hover:border-emerald-400'
                          }`}
                        >
                          {l.pagado && '✓'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}

        {entregasFiltered.length === 0 && clienteFutura.length === 0 && (
          <Card>
            <p className="text-stone-400 text-center py-6 text-sm">
              {entregaFilter === 'en_curso' ? 'No hay entregas en curso' : entregaFilter === 'finalizada' ? 'No hay entregas finalizadas' : 'No hay entregas'}
            </p>
          </Card>
        )}

        <div className="flex gap-3">
          <Button className="flex-1" size="lg" onClick={() => { setEditingEntregaClienteId(cliente.id); setShowEntregaModal(true); }}>
            + Nueva Entrega
          </Button>
          <Button className="flex-1" size="lg" variant="danger" onClick={() => { setEditingEntregaClienteId(cliente.id); setShowFuturaModal(true); }}>
            + FUTURA
          </Button>
        </div>
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

    const openEdit = (exp) => {
      setFormData({
        nombre: exp.nombre || '',
        fecha: exp.fecha || defaultFecha,
        lingotes: exp.lingotes && exp.lingotes.length > 0 ? [...exp.lingotes] : [{ cantidad: 1, peso: 50 }],
        precioGramo: exp.precioGramo || '',
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
        precioGramo: editingExp.precioGramo || '',
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

        return { ...exp, totalEntregado, totalCerrado, totalDevuelto, totalPendiente, totalImporte, totalLingotes, porCliente, stockTotal, stockCount, facturaTotal };
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
        // Convert to base64 for storage (simple approach)
        const reader = new FileReader();
        reader.onload = async (e) => {
          const base64 = e.target.result;
          const exp = exportaciones.find(ex => ex.id === expId);
          if (exp) {
            await onSaveExportacion({
              ...exp,
              factura: {
                nombre: file.name,
                tipo: file.type,
                data: base64,
                fecha: new Date().toISOString(),
              }
            }, expId);
          }
          setUploadingFactura(null);
        };
        reader.readAsDataURL(file);
      } catch (err) {
        console.error('Error uploading factura:', err);
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

        {showNew && (
          <Card className="border-amber-400 bg-amber-50">
            <h3 className="font-bold text-stone-800 mb-4">{editingExp ? 'Editar Exportación' : 'Nueva Exportación'}</h3>
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
                <div className="space-y-2">
                  {formData.lingotes.map((l, idx) => (
                    <div key={idx} className="flex items-center gap-2 flex-wrap">
                      <input
                        type="number"
                        value={l.cantidad}
                        onChange={(e) => updateLingoteTipo(idx, 'cantidad', parseInt(e.target.value) || 0)}
                        className="w-16 border border-stone-300 rounded-xl px-2 py-2 text-center focus:outline-none focus:ring-2 focus:ring-amber-400"
                        min="1"
                      />
                      <span className="text-stone-500">×</span>
                      <div className="flex gap-1 items-center">
                        {[50, 100].map(peso => (
                          <button
                            key={peso}
                            type="button"
                            onClick={() => updateLingoteTipo(idx, 'peso', peso)}
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
                      {formData.lingotes.length > 1 && (
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
                <button
                  type="button"
                  onClick={addLingoteTipo}
                  className="mt-2 text-amber-600 hover:text-amber-700 text-sm font-medium"
                >
                  + Añadir tipo
                </button>
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
                  {editingExp ? 'Guardar cambios' : 'Crear'}
                </Button>
              </div>
            </div>
          </Card>
        )}

        <div className="space-y-4">
          {exportacionesStats.map(exp => (
            <Card key={exp.id}>
              <div className="flex justify-between items-start mb-3">
                <div>
                  <h3 className="text-lg font-bold text-stone-800">{exp.nombre}</h3>
                  <p className="text-xs text-stone-500">{exp.fecha || 'Sin fecha'}</p>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => openEdit(exp)}
                    className="text-amber-600 hover:text-amber-700 text-sm font-medium"
                  >
                    ✏️ Editar
                  </button>
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

              {/* Stock de lingotes en esta exportación */}
              {exp.lingotes && exp.lingotes.length > 0 && (
                <div className="bg-amber-50 rounded-xl p-3 mb-4">
                  <p className="text-xs text-amber-700 font-medium mb-2">📦 Stock en Ma d'Or</p>
                  <div className="flex flex-wrap gap-2">
                    {exp.lingotes.map((l, idx) => (
                      <div key={idx} className="bg-white border border-amber-200 rounded-lg px-2 py-1 text-sm">
                        <span className="font-bold text-amber-700">{l.cantidad}</span>
                        <span className="text-stone-500"> × </span>
                        <span className="text-stone-700">{l.peso}g</span>
                      </div>
                    ))}
                  </div>
                  <p className="text-amber-800 font-bold mt-2 text-sm">
                    Total: {exp.stockCount} lingotes = {formatNum(exp.stockTotal, 0)}g
                  </p>
                </div>
              )}

              {exp.totalEntregado > 0 && (
                <div className="mb-4">
                  <div className="flex justify-between text-xs text-stone-500 mb-1">
                    <span>Cerrado: {formatNum(exp.totalCerrado, 0)}g</span>
                    <span>Pendiente: {formatNum(exp.totalPendiente, 0)}g</span>
                  </div>
                  <div className="h-2 bg-stone-200 rounded-full overflow-hidden">
                    <div className="h-full bg-gradient-to-r from-emerald-500 to-green-400 rounded-full" style={{ width: `${exp.totalEntregado > 0 ? (exp.totalCerrado / exp.totalEntregado) * 100 : 0}%` }} />
                  </div>
                </div>
              )}

              {exp.porCliente.length > 0 && (
                <div className="space-y-2">
                  {exp.porCliente.map(c => (
                    <div key={c.id} className="flex items-center justify-between text-sm py-1 border-b border-stone-100 last:border-0">
                      <div className="flex items-center gap-2">
                        <div className="w-2 h-2 rounded-full" style={{ backgroundColor: c.color }} />
                        <span className="text-stone-700">{c.nombre}</span>
                      </div>
                      <div className="flex gap-4 text-xs">
                        <span className="text-stone-500">Ent: {formatNum(c.entregado, 0)}g</span>
                        <span className="text-emerald-600">Cer: {formatNum(c.cerrado, 0)}g</span>
                        {c.pendiente > 0 && <span className="text-amber-600">Pend: {formatNum(c.pendiente, 0)}g</span>}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          ))}
          {exportaciones.length === 0 && (
            <Card><p className="text-stone-400 text-center py-6">No hay exportaciones. Crea una para empezar.</p></Card>
          )}
        </div>
      </div>
    );
  };

  // Parametros View
  const ParametrosView = () => {
    const [tempStock, setTempStock] = useState(stockMador.toString());
    const [tempUmbrales, setTempUmbrales] = useState({
      rojo: umbralStock.rojo.toString(),
      naranja: umbralStock.naranja.toString(),
      amarillo: umbralStock.amarillo.toString(),
    });

    const stockChanged = tempStock !== stockMador.toString();
    const umbralesChanged =
      tempUmbrales.rojo !== umbralStock.rojo.toString() ||
      tempUmbrales.naranja !== umbralStock.naranja.toString() ||
      tempUmbrales.amarillo !== umbralStock.amarillo.toString();

    const guardarStock = async () => {
      const valor = parseFloat(tempStock) || 0;
      await onUpdateConfig({ stockMador: valor });
      setTempStock(valor.toString());
    };

    const guardarUmbrales = async () => {
      const nuevos = {
        umbralRojo: parseFloat(tempUmbrales.rojo) || 0,
        umbralNaranja: parseFloat(tempUmbrales.naranja) || 0,
        umbralAmarillo: parseFloat(tempUmbrales.amarillo) || 0,
      };
      await onUpdateConfig(nuevos);
    };

    const previewStock = parseFloat(tempStock) || 0;
    const previewUmbrales = {
      rojo: parseFloat(tempUmbrales.rojo) || 0,
      naranja: parseFloat(tempUmbrales.naranja) || 0,
      amarillo: parseFloat(tempUmbrales.amarillo) || 0,
    };
    const getPreviewColor = (stock) => {
      if (stock < previewUmbrales.rojo) return { bg: 'from-red-600 via-red-500 to-red-600', label: 'CRITICO' };
      if (stock < previewUmbrales.naranja) return { bg: 'from-orange-600 via-orange-500 to-orange-600', label: 'BAJO' };
      if (stock < previewUmbrales.amarillo) return { bg: 'from-amber-500 via-yellow-500 to-amber-500', label: 'MEDIO' };
      return { bg: 'from-emerald-600 via-green-500 to-emerald-600', label: 'OK' };
    };
    const previewColor = getPreviewColor(previewStock);

    return (
      <div className="space-y-6">
        <h2 className="text-xl font-bold text-stone-800">Ajustes</h2>

        <Card>
          <h3 className="font-bold text-stone-800 mb-4">Stock Ma d'Or Actual</h3>
          <div className="flex items-center gap-3">
            <input type="text" inputMode="numeric" value={tempStock} onChange={(e) => setTempStock(e.target.value)} className="flex-1 border border-stone-300 rounded-xl px-4 py-3 text-2xl font-bold text-center focus:outline-none focus:ring-2 focus:ring-amber-400" />
            <span className="text-stone-500">g</span>
            <Button onClick={guardarStock} disabled={!stockChanged} variant={stockChanged ? 'primary' : 'secondary'}>Guardar</Button>
          </div>
        </Card>

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
          <div className="mt-6 pt-4 border-t border-stone-200">
            <p className="text-sm text-stone-500 mb-3">Vista previa:</p>
            <div className={`bg-gradient-to-br ${previewColor.bg} rounded-xl p-4 text-white text-center`}>
              <div className="text-2xl font-black">{formatNum(previewStock, 0)} g</div>
              <div className="text-sm opacity-80">{previewColor.label}</div>
            </div>
          </div>
        </Card>
      </div>
    );
  };

  // Entrega Modal - creates N lingotes at once, deducting from stock
  const EntregaModal = () => {
    const defaultClienteId = editingEntregaClienteId || clientes[0]?.id || '';
    const defaultExportacionId = exportaciones[0]?.id || '';
    const defaultFecha = new Date().toISOString().split('T')[0];
    // Default peso to first available in stock, or 50
    const defaultPeso = stockGlobal.length > 0 ? stockGlobal[0].peso : 50;
    const [formData, setFormData] = useState({
      clienteId: defaultClienteId,
      exportacionId: defaultExportacionId,
      fechaEntrega: defaultFecha,
      cantidad: 1,
      pesoUnitario: defaultPeso,
    });

    // Check stock availability for selected peso
    const stockDelPeso = stockGlobal.find(s => s.peso === formData.pesoUnitario)?.cantidad || 0;
    const stockSuficiente = stockDelPeso >= formData.cantidad;

    // Check if form has meaningful changes from defaults
    const hasChanges = formData.cantidad !== 1 || formData.pesoUnitario !== defaultPeso ||
      formData.clienteId !== defaultClienteId || formData.exportacionId !== defaultExportacionId ||
      formData.fechaEntrega !== defaultFecha;

    const handleClose = () => {
      if (hasChanges && !confirm('¿Descartar los cambios?')) return;
      setShowEntregaModal(false);
      setEditingEntregaClienteId(null);
    };

    return (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={handleClose}>
        <div className="bg-white rounded-3xl p-6 w-full max-w-md shadow-2xl max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
          <h3 className="text-xl font-bold text-stone-800 mb-4">Nueva Entrega</h3>

          {/* Stock disponible */}
          <div className="bg-amber-50 rounded-xl p-3 mb-4">
            <p className="text-xs text-amber-700 font-medium mb-2">📦 Stock disponible</p>
            {stockGlobal.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {stockGlobal.map((s, idx) => (
                  <div
                    key={idx}
                    className={`rounded-lg px-3 py-1 text-sm cursor-pointer transition-colors ${
                      formData.pesoUnitario === s.peso
                        ? 'bg-amber-500 text-white'
                        : 'bg-white border border-amber-200 hover:border-amber-400'
                    }`}
                    onClick={() => setFormData({ ...formData, pesoUnitario: s.peso })}
                  >
                    <span className="font-bold">{s.cantidad}</span>
                    <span className="text-xs ml-1">× {s.peso}g</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-amber-600 text-sm">No hay stock. Crea una exportación primero.</p>
            )}
          </div>

          <div className="space-y-4">
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
            <div>
              <label className="block text-sm font-medium text-stone-700 mb-1">
                Cantidad de lingotes de {formData.pesoUnitario}g
                <span className={`ml-2 text-xs ${stockSuficiente ? 'text-green-600' : 'text-red-600'}`}>
                  (disponibles: {stockDelPeso})
                </span>
              </label>
              <div className="flex gap-2">
                {[1, 2, 4, 6, 10].filter(q => q <= stockDelPeso || stockDelPeso === 0).map(q => (
                  <button key={q} onClick={() => setFormData({ ...formData, cantidad: q })} className={`flex-1 py-2 rounded-xl border-2 font-semibold transition-colors ${formData.cantidad === q ? 'border-amber-500 bg-amber-50 text-amber-700' : 'border-stone-200 text-stone-600 hover:border-stone-300'}`}>
                    {q}
                  </button>
                ))}
              </div>
              <input type="number" value={formData.cantidad} onChange={(e) => setFormData({ ...formData, cantidad: parseInt(e.target.value) || 1 })} className="w-full border border-stone-300 rounded-xl px-4 py-3 mt-2 focus:outline-none focus:ring-2 focus:ring-amber-400" placeholder="Otra cantidad..." min="1" max={stockDelPeso} />
            </div>

            {/* Summary */}
            <div className={`rounded-xl p-3 text-center ${stockSuficiente ? 'bg-stone-50' : 'bg-red-50'}`}>
              <span className={`text-sm ${stockSuficiente ? 'text-stone-500' : 'text-red-500'}`}>Total: </span>
              <span className={`font-bold ${stockSuficiente ? 'text-stone-800' : 'text-red-700'}`}>
                {formData.cantidad} × {formData.pesoUnitario}g = {formData.cantidad * formData.pesoUnitario}g
              </span>
              {!stockSuficiente && (
                <p className="text-red-600 text-xs mt-1">⚠️ Stock insuficiente</p>
              )}
            </div>
          </div>
          <div className="flex gap-3 mt-6">
            <Button variant="secondary" className="flex-1" onClick={handleClose}>Cancelar</Button>
            <Button
              className="flex-1"
              onClick={() => addEntrega(formData)}
              disabled={!stockSuficiente || stockGlobal.length === 0}
            >
              Registrar
            </Button>
          </div>
        </div>
      </div>
    );
  };

  // Cierre Modal - close a single lingote (entrega or futura standalone)
  const CierreModal = () => {
    const isFuturaCierre = !!selectedFuturaId;
    const futuraDoc = isFuturaCierre ? (futuraLingotes || []).find(f => f.id === selectedFuturaId) : null;
    const lingote = isFuturaCierre ? futuraDoc : selectedEntrega?.lingotes?.[selectedLingoteIdx];
    const defaultEuroOnza = lingote?.euroOnza || '';
    const defaultPrecioJofisa = lingote?.precioJofisa || '';
    const defaultNFactura = lingote?.nFactura || '';
    const [jofisaAutoFilled, setJofisaAutoFilled] = useState(false);
    const [formData, setFormData] = useState({
      euroOnza: defaultEuroOnza,
      precioJofisa: defaultPrecioJofisa,
      margen: 6,
      fechaCierre: new Date().toISOString().split('T')[0],
      nFactura: defaultNFactura,
      devolucion: 0,
    });

    // Check if form has meaningful changes
    const hasChanges = formData.euroOnza !== defaultEuroOnza ||
      formData.precioJofisa !== defaultPrecioJofisa ||
      formData.nFactura !== defaultNFactura ||
      formData.devolucion !== 0 ||
      formData.margen !== 6;

    const closeCierreModal = () => {
      if (hasChanges && !confirm('¿Descartar los cambios del cierre?')) return;
      setShowCierreModal(false);
      setSelectedEntrega(null);
      setSelectedLingoteIdx(null);
      setSelectedFuturaId(null);
    };

    if (!lingote) return null;
    if (!isFuturaCierre && (!selectedEntrega || selectedLingoteIdx === null)) return null;

    const clienteId = isFuturaCierre ? futuraDoc.clienteId : selectedEntrega.clienteId;
    const cliente = getCliente(clienteId);
    const pesoNeto = (lingote.peso || 0) - formData.devolucion;

    // Calculations
    const euroOnzaNum = parseFloat(formData.euroOnza) || 0;
    const base = euroOnzaNum ? Math.ceil((euroOnzaNum / 31.10349) * 100) / 100 : 0;
    const precioJofisaNum = parseFloat(formData.precioJofisa) || 0;
    const importeJofisa = precioJofisaNum * pesoNeto;
    const margenNum = parseFloat(formData.margen) || 0;
    const precioCliente = base ? Math.round((base * (1 + margenNum / 100)) * 100) / 100 : 0;
    const importeCliente = precioCliente * pesoNeto;

    // Auto-fill precioJofisa from base (one time only)
    if (base > 0 && !jofisaAutoFilled && !formData.precioJofisa) {
      setFormData(prev => ({ ...prev, precioJofisa: base.toFixed(2) }));
      setJofisaAutoFilled(true);
    }

    const handleConfirm = () => {
      const cierreData = {
        euroOnza: euroOnzaNum,
        base,
        precioJofisa: precioJofisaNum,
        importeJofisa,
        margen: margenNum,
        precio: precioCliente,
        fechaCierre: formData.fechaCierre,
        nFactura: formData.nFactura,
        devolucion: formData.devolucion,
      };
      if (isFuturaCierre) {
        cerrarFutura(selectedFuturaId, cierreData);
      } else {
        cerrarLingote(selectedEntrega.id, selectedLingoteIdx, cierreData);
      }
    };

    return (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={closeCierreModal}>
        <div className="bg-white rounded-3xl p-6 w-full max-w-md shadow-2xl max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
          <h3 className="text-xl font-bold text-stone-800 mb-2">Cerrar Lingote</h3>
          <p className="text-stone-500 text-sm mb-6">{cliente?.nombre} • {lingote.peso}g{isFuturaCierre ? ' (FUTURA)' : ''}</p>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-stone-700 mb-1">€/Onza</label>
              <input type="number" step="0.01" value={formData.euroOnza} onChange={(e) => setFormData({ ...formData, euroOnza: e.target.value })} className="w-full border border-stone-300 rounded-xl px-4 py-3 text-lg font-mono focus:outline-none focus:ring-2 focus:ring-amber-400" placeholder="Ej: 3693,42" autoFocus />
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
              <label className="block text-sm font-medium text-stone-700 mb-1">Precio Jofisa (€/g)</label>
              <input type="number" step="0.01" value={formData.precioJofisa} onChange={(e) => { setFormData({ ...formData, precioJofisa: e.target.value }); setJofisaAutoFilled(true); }} className="w-full border border-stone-300 rounded-xl px-4 py-3 font-mono focus:outline-none focus:ring-2 focus:ring-amber-400" placeholder="Auto desde base" />
            </div>
            {precioJofisaNum > 0 && (
              <div className="bg-blue-50 border border-blue-200 rounded-xl p-3">
                <div className="flex justify-between text-sm">
                  <span className="text-blue-600">Importe Jofisa:</span>
                  <span className="font-mono font-semibold text-blue-800">{formatEur(importeJofisa)}</span>
                </div>
                <div className="text-xs text-blue-400 mt-0.5">{pesoNeto}g x {formatNum(precioJofisaNum)} €/g</div>
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
            <div>
              <label className="block text-sm font-medium text-stone-700 mb-1">N Factura</label>
              <input type="text" value={formData.nFactura} onChange={(e) => setFormData({ ...formData, nFactura: e.target.value })} className="w-full border border-stone-300 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-amber-400" placeholder="Ej: 2026-1.pdf" />
            </div>
            {!isFuturaCierre && (
              <div>
                <label className="block text-sm font-medium text-stone-700 mb-1">Devolucion (gramos)</label>
                <input type="number" value={formData.devolucion} onChange={(e) => setFormData({ ...formData, devolucion: parseFloat(e.target.value) || 0 })} className="w-full border border-stone-300 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-amber-400" placeholder="0" />
              </div>
            )}
            {precioCliente > 0 && (
              <div className="bg-gradient-to-br from-emerald-50 to-green-50 border border-emerald-200 rounded-2xl p-4">
                <h4 className="font-semibold text-emerald-800 mb-3">Resumen Cliente</h4>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between"><span className="text-stone-600">Peso neto:</span><span className="font-mono">{pesoNeto}g</span></div>
                  <div className="flex justify-between"><span className="text-stone-600">Precio cliente:</span><span className="font-mono">{formatNum(precioCliente)} €/g</span></div>
                  <div className="flex justify-between pt-2 border-t border-emerald-200">
                    <span className="font-semibold text-emerald-800">IMPORTE CLIENTE:</span>
                    <span className="font-bold text-emerald-700 text-lg">{formatEur(importeCliente)}</span>
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

  // Futura Modal - record an orphan sale (lingote sold without physical stock)
  const FuturaModal = () => {
    const defaultClienteId = editingEntregaClienteId || clientes[0]?.id || '';
    const [formData, setFormData] = useState({
      clienteId: defaultClienteId,
      cantidad: 1,
      pesoUnitario: 50,
      precio: '',
      nFactura: '',
      fechaCierre: new Date().toISOString().split('T')[0],
    });

    // Check if form has meaningful changes
    const hasChanges = formData.cantidad !== 1 || formData.pesoUnitario !== 50 ||
      formData.precio !== '' || formData.nFactura !== '' ||
      formData.clienteId !== defaultClienteId;

    const handleClose = () => {
      if (hasChanges && !confirm('¿Descartar los cambios?')) return;
      setShowFuturaModal(false);
      setEditingEntregaClienteId(null);
    };

    const pesoTotal = formData.cantidad * formData.pesoUnitario;
    const importeTotal = formData.precio ? pesoTotal * parseFloat(formData.precio) : 0;

    const handleSave = async () => {
      for (let i = 0; i < formData.cantidad; i++) {
        await addFuturaLingote({
          clienteId: formData.clienteId,
          peso: formData.pesoUnitario,
          precio: formData.precio ? parseFloat(formData.precio) : null,
          nFactura: formData.nFactura || null,
          fechaCierre: formData.precio ? formData.fechaCierre : null,
          pagado: false,
        });
      }
    };

    return (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={handleClose}>
        <div className="bg-white rounded-3xl p-6 w-full max-w-md shadow-2xl max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
          <h3 className="text-xl font-bold text-red-800 mb-2">FUTURA</h3>
          <p className="text-sm text-stone-500 mb-6">Registrar lingotes vendidos sin entrega fisica.</p>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-stone-700 mb-1">Cliente</label>
              <select value={formData.clienteId} onChange={e => setFormData({ ...formData, clienteId: e.target.value })} className="w-full border border-stone-300 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-red-400">
                {clientes.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-stone-700 mb-1">Cantidad de lingotes</label>
              <div className="flex gap-2">
                {[1, 2, 4, 6, 10].map(q => (
                  <button key={q} onClick={() => setFormData({ ...formData, cantidad: q })} className={`flex-1 py-2 rounded-xl border-2 font-semibold transition-colors ${formData.cantidad === q ? 'border-red-500 bg-red-50 text-red-700' : 'border-stone-200 text-stone-600 hover:border-stone-300'}`}>
                    {q}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-stone-700 mb-1">Peso por lingote (gramos)</label>
              <div className="flex gap-2">
                {[50, 100].map(p => (
                  <button key={p} onClick={() => setFormData({ ...formData, pesoUnitario: p })} className={`flex-1 py-2 rounded-xl border-2 font-semibold transition-colors ${formData.pesoUnitario === p ? 'border-red-500 bg-red-50 text-red-700' : 'border-stone-200 text-stone-600 hover:border-stone-300'}`}>
                    {p}g
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-stone-700 mb-1">Precio €/g <span className="text-stone-400">(opcional)</span></label>
              <input type="number" step="0.01" value={formData.precio} onChange={(e) => setFormData({ ...formData, precio: e.target.value })} className="w-full border border-stone-300 rounded-xl px-4 py-3 font-mono focus:outline-none focus:ring-2 focus:ring-red-400" placeholder="Ej: 136.63" />
            </div>
            {formData.precio && (
              <>
                <div>
                  <label className="block text-sm font-medium text-stone-700 mb-1">N Factura</label>
                  <input type="text" value={formData.nFactura} onChange={(e) => setFormData({ ...formData, nFactura: e.target.value })} className="w-full border border-stone-300 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-red-400" placeholder="Ej: 2026-15.pdf" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-stone-700 mb-1">Fecha Cierre</label>
                  <input type="date" value={formData.fechaCierre} onChange={(e) => setFormData({ ...formData, fechaCierre: e.target.value })} className="w-full border border-stone-300 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-red-400" />
                </div>
              </>
            )}
            <div className="bg-red-50 rounded-xl p-3 text-center">
              <span className="text-red-500 text-sm">FUTURA: </span>
              <span className="font-bold text-red-800">{formData.cantidad} x {formData.pesoUnitario}g = {pesoTotal}g</span>
              {formData.precio && (
                <div className="text-sm text-red-600 mt-1">Importe: {formatEur(importeTotal)}</div>
              )}
            </div>
          </div>
          <div className="flex gap-3 mt-6">
            <Button variant="secondary" className="flex-1" onClick={handleClose}>Cancelar</Button>
            <Button variant="danger" className="flex-1" onClick={handleSave}>
              Registrar
            </Button>
          </div>
        </div>
      </div>
    );
  };

  // Assign Futura Modal - select orphan FUTURA lingotes and assign to a real entrega
  const AssignFuturaModal = () => {
    const clienteId = selectedCliente || editingEntregaClienteId;
    const cliente = getCliente(clienteId);
    const clienteFutura = (futuraLingotes || []).filter(f => f.clienteId === clienteId);
    const targetEntregasList = entregas.filter(e => e.clienteId === clienteId);

    const [selectedIds, setSelectedIds] = useState([]);
    const [selectedTarget, setSelectedTarget] = useState(targetEntregasList[0]?.id || '');

    if (clienteFutura.length === 0) return null;

    const toggleId = (id) => {
      setSelectedIds(prev => prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]);
    };

    const selectAll = () => {
      setSelectedIds(clienteFutura.map(f => f.id));
    };

    const handleAssign = async () => {
      if (selectedIds.length === 0 || !selectedTarget) return;
      await assignFuturaToEntrega(selectedIds, selectedTarget);
    };

    return (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => setShowAssignFuturaModal(false)}>
        <div className="bg-white rounded-3xl p-6 w-full max-w-md shadow-2xl max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
          <h3 className="text-xl font-bold text-stone-800 mb-2">Asignar FUTURA</h3>
          <p className="text-sm text-stone-500 mb-4">{cliente?.nombre} tiene {clienteFutura.length} lingotes FUTURA</p>

          {targetEntregasList.length > 0 ? (
            <>
              <div className="mb-4">
                <label className="block text-sm font-medium text-stone-700 mb-1">Asignar a entrega</label>
                <select value={selectedTarget} onChange={e => setSelectedTarget(e.target.value)} className="w-full border border-stone-300 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-amber-400">
                  {targetEntregasList.map(e => {
                    const exp = getExportacion(e.exportacionId);
                    return <option key={e.id} value={e.id}>{e.fechaEntrega} {exp ? `(${exp.nombre})` : ''} - {numLingotes(e)} lingotes</option>;
                  })}
                </select>
              </div>

              <div className="mb-4">
                <div className="flex justify-between items-center mb-2">
                  <label className="text-sm font-medium text-stone-700">Seleccionar lingotes</label>
                  <button onClick={selectAll} className="text-xs text-amber-600 font-semibold hover:text-amber-700">
                    Seleccionar todos
                  </button>
                </div>
                <div className="space-y-1 max-h-60 overflow-y-auto">
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

              {selectedIds.length > 0 && (
                <div className="bg-amber-50 rounded-xl p-3 text-center mb-4">
                  <span className="text-amber-600 text-sm">Asignar: </span>
                  <span className="font-bold text-amber-800">
                    {selectedIds.length} lingotes ({clienteFutura.filter(f => selectedIds.includes(f.id)).reduce((s, f) => s + (f.peso || 0), 0)}g)
                  </span>
                </div>
              )}

              <div className="flex gap-3">
                <Button variant="secondary" className="flex-1" onClick={() => setShowAssignFuturaModal(false)}>Omitir</Button>
                <Button className="flex-1" disabled={selectedIds.length === 0 || !selectedTarget} onClick={handleAssign}>
                  Asignar{selectedIds.length > 0 ? ` (${selectedIds.length})` : ''}
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
              <span className="text-xs text-stone-400 ml-1">v1.2</span>
            </div>
            <Button size="sm" onClick={() => setShowEntregaModal(true)}>+ Entrega</Button>
          </div>
        </header>

        {/* Navigation */}
        <nav className="bg-white border-b border-amber-200 flex shadow-sm">
          <TabBtn id="stock" label="Stock" icon="📊" />
          <TabBtn id="exportaciones" label="Exportaciones" icon="📦" />
          <TabBtn id="parametros" label="Ajustes" icon="⚙️" />
        </nav>
      </div>

      {/* Content */}
      <main className="max-w-2xl mx-auto p-4 pb-24">
        {activeTab === 'stock' && <StockOverview />}
        {activeTab === 'exportaciones' && <ExportacionesView />}
        {activeTab === 'parametros' && <ParametrosView />}
      </main>

      {/* Modals */}
      {showEntregaModal && <EntregaModal />}
      {showCierreModal && <CierreModal />}
      {showFuturaModal && <FuturaModal />}
      {showAssignFuturaModal && <AssignFuturaModal />}
    </div>
  );
}
