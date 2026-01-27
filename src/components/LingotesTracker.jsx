import React, { useState, useMemo } from 'react';

const formatNum = (num, decimals = 2) => {
  if (num === null || num === undefined || isNaN(num)) return '-';
  return num.toLocaleString('de-DE', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
};

const formatEur = (num) => formatNum(num, 2) + ' €';

// Helper: sum all lingotes peso in an entrega (excludes futura - not physically delivered)
const pesoEntrega = (entrega) => (entrega.lingotes || []).filter(l => l.estado !== 'futura').reduce((s, l) => s + (l.peso || 0), 0);
const pesoCerrado = (entrega) => (entrega.lingotes || []).filter(l => l.estado === 'finalizado').reduce((s, l) => s + (l.peso || 0) - (l.pesoDevuelto || 0), 0);
const pesoDevuelto = (entrega) => (entrega.lingotes || []).reduce((s, l) => s + (l.pesoDevuelto || 0), 0);
const importeEntrega = (entrega) => (entrega.lingotes || []).filter(l => l.estado === 'finalizado').reduce((s, l) => s + (l.importe || 0), 0);
const numLingotes = (entrega) => (entrega.lingotes || []).length;
const lingotesEnCurso = (entrega) => (entrega.lingotes || []).filter(l => l.estado === 'en_curso');
const lingotesFinalizados = (entrega) => (entrega.lingotes || []).filter(l => l.estado === 'finalizado');
const lingotesFutura = (entrega) => (entrega.lingotes || []).filter(l => l.estado === 'futura');
const pesoFutura = (entrega) => lingotesFutura(entrega).reduce((s, l) => s + (l.peso || 0), 0);
const isFuturaEntrega = (entrega) => entrega.fechaEntrega === 'FUTURA';
// An entrega is "finalizada" when ALL non-futura lingotes are finalizados
const isEntregaFinalizada = (entrega) => {
  const nonFutura = (entrega.lingotes || []).filter(l => l.estado !== 'futura');
  return nonFutura.length > 0 && nonFutura.every(l => l.estado === 'finalizado');
};
const isEntregaEnCurso = (entrega) => !isFuturaEntrega(entrega) && !isEntregaFinalizada(entrega);

export default function LingotesTracker({
  clientes,
  exportaciones,
  entregas,
  config,
  onBack,
  onSaveExportacion,
  onDeleteExportacion,
  onSaveEntrega,
  onDeleteEntrega,
  onUpdateEntrega,
  onUpdateConfig,
}) {
  const [activeTab, setActiveTab] = useState('stock');
  const [selectedCliente, setSelectedCliente] = useState(null);
  const [showEntregaModal, setShowEntregaModal] = useState(false);
  const [showCierreModal, setShowCierreModal] = useState(false);
  const [selectedEntrega, setSelectedEntrega] = useState(null);
  const [selectedLingoteIdx, setSelectedLingoteIdx] = useState(null);
  const [editingEntregaClienteId, setEditingEntregaClienteId] = useState(null);
  const [entregaFilter, setEntregaFilter] = useState('en_curso'); // 'en_curso' | 'finalizada' | 'todas'
  const [showFuturaModal, setShowFuturaModal] = useState(false);
  const [showAssignFuturaModal, setShowAssignFuturaModal] = useState(false);
  const [assignFuturaTarget, setAssignFuturaTarget] = useState(null);

  const stockMador = config.stockMador || 0;
  const umbralStock = {
    rojo: config.umbralRojo || 200,
    naranja: config.umbralNaranja || 500,
    amarillo: config.umbralAmarillo || 1000,
  };

  const getCliente = (id) => clientes.find(c => c.id === id);
  const getExportacion = (id) => exportaciones.find(e => e.id === id);

  // Stats por cliente
  const statsClientes = useMemo(() => {
    return clientes.map(cliente => {
      const entregasCliente = entregas.filter(e => e.clienteId === cliente.id);
      const entregado = entregasCliente.reduce((sum, e) => sum + pesoEntrega(e), 0);
      const cerrado = entregasCliente.reduce((sum, e) => sum + pesoCerrado(e), 0);
      const devuelto = entregasCliente.reduce((sum, e) => sum + pesoDevuelto(e), 0);
      const pendiente = entregado - cerrado - devuelto;
      const enCurso = entregasCliente.reduce((sum, e) => sum + lingotesEnCurso(e).length, 0);
      const importeTotal = entregasCliente.reduce((sum, e) => sum + importeEntrega(e), 0);
      const futuraWeight = entregasCliente.reduce((sum, e) => sum + pesoFutura(e), 0);
      const futuraCount = entregasCliente.reduce((sum, e) => sum + lingotesFutura(e).length, 0);
      return { ...cliente, entregado, cerrado, devuelto, pendiente, enCurso, importeTotal, futuraWeight, futuraCount };
    }).filter(c => c.entregado > 0 || c.enCurso > 0 || c.futuraCount > 0);
  }, [clientes, entregas]);

  const stockTotal = useMemo(() => {
    const totalEntregado = entregas.reduce((sum, e) => sum + pesoEntrega(e), 0);
    const totalCerrado = entregas.reduce((sum, e) => sum + pesoCerrado(e), 0);
    const totalDevuelto = entregas.reduce((sum, e) => sum + pesoDevuelto(e), 0);
    const stockClientes = totalEntregado - totalCerrado - totalDevuelto;
    const totalFutura = entregas.reduce((sum, e) => sum + pesoFutura(e), 0);
    return { totalEntregado, totalCerrado, totalDevuelto, stockClientes, totalFutura };
  }, [entregas]);

  // CRUD
  const addEntrega = async (data) => {
    // data: { clienteId, exportacionId, fechaEntrega, cantidad, pesoUnitario }
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

    // Check if client has FUTURA lingotes → prompt to assign
    const clientFutura = entregas.find(e => e.clienteId === data.clienteId && isFuturaEntrega(e));
    if (clientFutura && lingotesFutura(clientFutura).length > 0) {
      setAssignFuturaTarget({ clienteId: data.clienteId });
      setShowAssignFuturaModal(true);
    }
  };

  const addFutura = async (data) => {
    // data: { clienteId, cantidad, pesoUnitario }
    const futuraExp = exportaciones.find(e => e.nombre === 'FUTURA');
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
        estado: 'futura',
        pagado: false,
        esDevolucion: false,
      });
    }
    // Consolidate: append to existing FUTURA entrega for this client, or create new
    const existingFutura = entregas.find(e => e.clienteId === data.clienteId && isFuturaEntrega(e));
    if (existingFutura) {
      await onUpdateEntrega(existingFutura.id, {
        lingotes: [...existingFutura.lingotes, ...lingotes],
      });
    } else {
      await onSaveEntrega({
        clienteId: data.clienteId,
        exportacionId: futuraExp?.id || '',
        fechaEntrega: 'FUTURA',
        lingotes,
      });
    }
    setShowFuturaModal(false);
  };

  const assignFuturaLingotes = async (futuraEntregaId, selectedIndices, targetEntregaId) => {
    const futuraEntrega = entregas.find(e => e.id === futuraEntregaId);
    const targetEntrega = entregas.find(e => e.id === targetEntregaId);
    if (!futuraEntrega || !targetEntrega) return;

    // Move selected lingotes: change estado to en_curso
    const movedLingotes = selectedIndices.map(idx => ({
      ...futuraEntrega.lingotes[idx],
      estado: 'en_curso',
    }));

    // Remove from FUTURA entrega
    const remaining = futuraEntrega.lingotes.filter((_, idx) => !selectedIndices.includes(idx));

    // Add to target entrega
    const updatedTarget = [...targetEntrega.lingotes, ...movedLingotes];

    if (remaining.length === 0) {
      await onDeleteEntrega(futuraEntregaId);
    } else {
      await onUpdateEntrega(futuraEntregaId, { lingotes: remaining });
    }
    await onUpdateEntrega(targetEntregaId, { lingotes: updatedTarget });
    setShowAssignFuturaModal(false);
    setAssignFuturaTarget(null);
  };

  const cerrarLingote = async (entregaId, lingoteIdx, data) => {
    const entrega = entregas.find(e => e.id === entregaId);
    if (!entrega) return;
    const lingotes = [...entrega.lingotes];
    lingotes[lingoteIdx] = {
      ...lingotes[lingoteIdx],
      precio: data.precio,
      importe: data.precio * ((lingotes[lingoteIdx].peso || 0) - (data.devolucion || 0)),
      nFactura: data.nFactura,
      fechaCierre: data.fechaCierre,
      pesoCerrado: lingotes[lingoteIdx].peso,
      pesoDevuelto: data.devolucion || 0,
      estado: 'finalizado',
      pagado: data.pagado || false,
    };
    await onUpdateEntrega(entregaId, { lingotes });
    setShowCierreModal(false);
    setSelectedEntrega(null);
    setSelectedLingoteIdx(null);
  };

  const marcarPagado = async (entregaId, lingoteIdx) => {
    const entrega = entregas.find(e => e.id === entregaId);
    if (!entrega) return;
    const lingotes = [...entrega.lingotes];
    lingotes[lingoteIdx] = { ...lingotes[lingoteIdx], pagado: !lingotes[lingoteIdx].pagado };
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
    const stockColor = getStockColor(stockMador);

    if (selectedCliente) {
      return <ClienteDetalle />;
    }

    return (
      <div className="space-y-6">
        <div className={`grid ${stockTotal.totalFutura > 0 ? 'grid-cols-3' : 'grid-cols-2'} gap-4`}>
          <div className={`bg-gradient-to-br ${stockColor.bg} rounded-2xl p-4 text-white shadow-lg`}>
            <div className="text-center">
              <p className={`text-xs ${stockColor.text} mb-1`}>Stock Ma d'Or</p>
              <div className={`text-3xl font-black ${stockColor.accent}`}>{formatNum(stockMador, 0)}</div>
              <div className={`text-xs ${stockColor.text}`}>gramos</div>
            </div>
          </div>
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
                <p className="text-xs text-red-200 mb-1">Sin Stock</p>
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
                      <div className="text-red-500 font-semibold">-{formatNum(cliente.futuraWeight, 0)}g sin stock</div>
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
    const allEntregasCliente = entregas.filter(e => e.clienteId === cliente.id && !isFuturaEntrega(e));

    // Count entregas by status (for filter badges)
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

    // Entregas with en_curso lingotes (for the "En Curso" section)
    const entregasConEnCurso = entregasFiltered.filter(e => lingotesEnCurso(e).length > 0);
    // All finalizados lingotes from filtered entregas
    const allLingotesFinalizados = entregasFiltered.flatMap(e =>
      (e.lingotes || []).map((l, idx) => ({ ...l, entregaId: e.id, lingoteIdx: idx, fechaEntrega: e.fechaEntrega }))
    ).filter(l => l.estado === 'finalizado');

    // FUTURA lingotes (always shown, not affected by filter)
    const futuraEntregasCliente = entregas.filter(e => e.clienteId === cliente.id && isFuturaEntrega(e));
    const allFuturaLingotes = futuraEntregasCliente.flatMap(e =>
      (e.lingotes || []).map((l, idx) => ({ ...l, entregaId: e.id, lingoteIdx: idx }))
    ).filter(l => l.estado === 'futura');
    const futuraWeight = futuraEntregasCliente.reduce((sum, e) => sum + pesoFutura(e), 0);
    // Potential targets for assigning futura
    const targetEntregasForAssign = entregas.filter(e => e.clienteId === cliente.id && !isFuturaEntrega(e) && lingotesEnCurso(e).length > 0);

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

        {allFuturaLingotes.length > 0 && (
          <div className="bg-red-50 border border-red-200 rounded-2xl p-4">
            <div className="flex justify-between items-center mb-3">
              <h3 className="font-bold text-red-800">Vendido sin Stock</h3>
              <div className="text-sm text-red-600 font-semibold">
                {allFuturaLingotes.length} lingotes &bull; -{formatNum(futuraWeight, 0)}g
              </div>
            </div>
            <div className="space-y-1">
              {allFuturaLingotes.map((l, i) => (
                <div key={i} className="flex items-center justify-between text-sm py-1 px-2 rounded bg-white/60">
                  <span className="font-mono text-red-700">{l.peso}g</span>
                  <span className="text-xs text-red-400">FUTURA</span>
                </div>
              ))}
            </div>
            {targetEntregasForAssign.length > 0 && (
              <div className="mt-3">
                <Button size="sm" onClick={() => { setAssignFuturaTarget({ clienteId: cliente.id }); setShowAssignFuturaModal(true); }}>
                  Asignar a entrega
                </Button>
              </div>
            )}
          </div>
        )}

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

        {allLingotesFinalizados.length > 0 && (
          <Card>
            <div className="flex justify-between items-center mb-4">
              <h3 className="font-bold text-stone-800">Finalizados ({allLingotesFinalizados.length})</h3>
              <div className="text-sm text-stone-500">
                Importe: <span className="font-semibold text-emerald-600">{formatEur(filteredImporte)}</span>
              </div>
            </div>
            <div className="overflow-x-auto -mx-5 px-5">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-stone-200">
                    <th className="text-left py-2 px-1 text-stone-500 font-medium text-xs">Cierre</th>
                    <th className="text-right py-2 px-1 text-stone-500 font-medium text-xs">Peso</th>
                    <th className="text-right py-2 px-1 text-stone-500 font-medium text-xs">€/g</th>
                    <th className="text-right py-2 px-1 text-stone-500 font-medium text-xs">Importe</th>
                    <th className="text-center py-2 px-1 text-stone-500 font-medium text-xs">Pagado</th>
                  </tr>
                </thead>
                <tbody>
                  {allLingotesFinalizados.map((l, i) => (
                    <tr key={i} className="border-b border-stone-100 hover:bg-stone-50">
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

        {entregasFiltered.length === 0 && (
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
            + Venta sin Stock
          </Button>
        </div>
      </div>
    );
  };

  // Exportaciones View
  const ExportacionesView = () => {
    const [showNew, setShowNew] = useState(false);
    const [newData, setNewData] = useState({ nombre: '', grExport: '', fecha: new Date().toISOString().split('T')[0] });

    const exportacionesStats = useMemo(() => {
      return exportaciones.map(exp => {
        const entregasExp = entregas.filter(e => e.exportacionId === exp.id);
        const totalEntregado = entregasExp.reduce((sum, e) => sum + pesoEntrega(e), 0);
        const totalCerrado = entregasExp.reduce((sum, e) => sum + pesoCerrado(e), 0);
        const totalDevuelto = entregasExp.reduce((sum, e) => sum + pesoDevuelto(e), 0);
        const totalPendiente = totalEntregado - totalCerrado - totalDevuelto;
        const totalImporte = entregasExp.reduce((sum, e) => sum + importeEntrega(e), 0);
        const totalLingotes = entregasExp.reduce((sum, e) => sum + numLingotes(e), 0);

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

        return { ...exp, totalEntregado, totalCerrado, totalDevuelto, totalPendiente, totalImporte, totalLingotes, porCliente };
      });
    }, [exportaciones, entregas, clientes]);

    const addExportacion = async () => {
      if (newData.nombre && newData.grExport) {
        await onSaveExportacion({ nombre: newData.nombre, grExport: parseFloat(newData.grExport), fecha: newData.fecha });
        setNewData({ nombre: '', grExport: '', fecha: new Date().toISOString().split('T')[0] });
        setShowNew(false);
      }
    };

    return (
      <div className="space-y-6">
        <div className="flex justify-between items-center">
          <h2 className="text-xl font-bold text-stone-800">Exportaciones</h2>
          <Button size="sm" onClick={() => setShowNew(true)}>+ Nueva</Button>
        </div>

        {showNew && (
          <Card className="border-amber-400 bg-amber-50">
            <h3 className="font-bold text-stone-800 mb-4">Nueva Exportacion</h3>
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-stone-700 mb-1">Nombre</label>
                <input type="text" value={newData.nombre} onChange={(e) => setNewData({ ...newData, nombre: e.target.value })} placeholder="Ej: 5-11" className="w-full border border-stone-300 rounded-xl px-4 py-2 focus:outline-none focus:ring-2 focus:ring-amber-400" />
              </div>
              <div>
                <label className="block text-sm font-medium text-stone-700 mb-1">Gramos Exportados</label>
                <input type="number" value={newData.grExport} onChange={(e) => setNewData({ ...newData, grExport: e.target.value })} placeholder="Ej: 4155" className="w-full border border-stone-300 rounded-xl px-4 py-2 focus:outline-none focus:ring-2 focus:ring-amber-400" />
              </div>
              <div>
                <label className="block text-sm font-medium text-stone-700 mb-1">Fecha</label>
                <input type="date" value={newData.fecha} onChange={(e) => setNewData({ ...newData, fecha: e.target.value })} className="w-full border border-stone-300 rounded-xl px-4 py-2 focus:outline-none focus:ring-2 focus:ring-amber-400" />
              </div>
              <div className="flex gap-2 pt-2">
                <Button variant="secondary" className="flex-1" onClick={() => setShowNew(false)}>Cancelar</Button>
                <Button className="flex-1" onClick={addExportacion}>Guardar</Button>
              </div>
            </div>
          </Card>
        )}

        <div className="space-y-4">
          {exportacionesStats.map(exp => (
            <Card key={exp.id}>
              <div className="flex justify-between items-start mb-4">
                <div>
                  <h3 className="text-lg font-bold text-stone-800">{exp.nombre}</h3>
                  <p className="text-xs text-stone-500">{exp.fecha || 'Sin fecha'} • {formatNum(exp.grExport, 0)}g exportados</p>
                </div>
                <div className="text-right">
                  <div className="text-lg font-bold text-emerald-600">{formatEur(exp.totalImporte)}</div>
                  <div className="text-xs text-stone-500">{exp.totalLingotes} lingotes</div>
                </div>
              </div>

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

  // Entrega Modal - creates N lingotes at once
  const EntregaModal = () => {
    const [formData, setFormData] = useState({
      clienteId: editingEntregaClienteId || clientes[0]?.id || '',
      exportacionId: exportaciones[0]?.id || '',
      fechaEntrega: new Date().toISOString().split('T')[0],
      cantidad: 1,
      pesoUnitario: 50,
    });

    return (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => { setShowEntregaModal(false); setEditingEntregaClienteId(null); }}>
        <div className="bg-white rounded-3xl p-6 w-full max-w-md shadow-2xl" onClick={e => e.stopPropagation()}>
          <h3 className="text-xl font-bold text-stone-800 mb-6">Nueva Entrega</h3>
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
              <label className="block text-sm font-medium text-stone-700 mb-1">Exportacion</label>
              <select value={formData.exportacionId} onChange={(e) => setFormData({ ...formData, exportacionId: e.target.value })} className="w-full border border-stone-300 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-amber-400">
                {exportaciones.length === 0 && <option value="">Sin exportaciones</option>}
                {exportaciones.map(e => (
                  <option key={e.id} value={e.id}>{e.nombre}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-stone-700 mb-1">Fecha Entrega</label>
              <input type="date" value={formData.fechaEntrega} onChange={(e) => setFormData({ ...formData, fechaEntrega: e.target.value })} className="w-full border border-stone-300 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-amber-400" />
            </div>
            <div>
              <label className="block text-sm font-medium text-stone-700 mb-1">Cantidad de lingotes</label>
              <div className="flex gap-2">
                {[1, 2, 4, 6, 10].map(q => (
                  <button key={q} onClick={() => setFormData({ ...formData, cantidad: q })} className={`flex-1 py-2 rounded-xl border-2 font-semibold transition-colors ${formData.cantidad === q ? 'border-amber-500 bg-amber-50 text-amber-700' : 'border-stone-200 text-stone-600 hover:border-stone-300'}`}>
                    {q}
                  </button>
                ))}
              </div>
              <input type="number" value={formData.cantidad} onChange={(e) => setFormData({ ...formData, cantidad: parseInt(e.target.value) || 1 })} className="w-full border border-stone-300 rounded-xl px-4 py-3 mt-2 focus:outline-none focus:ring-2 focus:ring-amber-400" placeholder="Otra cantidad..." />
            </div>
            <div>
              <label className="block text-sm font-medium text-stone-700 mb-1">Peso por lingote (gramos)</label>
              <div className="flex gap-2">
                {[50, 100].map(p => (
                  <button key={p} onClick={() => setFormData({ ...formData, pesoUnitario: p })} className={`flex-1 py-2 rounded-xl border-2 font-semibold transition-colors ${formData.pesoUnitario === p ? 'border-amber-500 bg-amber-50 text-amber-700' : 'border-stone-200 text-stone-600 hover:border-stone-300'}`}>
                    {p}g
                  </button>
                ))}
              </div>
              <input type="number" value={formData.pesoUnitario} onChange={(e) => setFormData({ ...formData, pesoUnitario: parseFloat(e.target.value) || 50 })} className="w-full border border-stone-300 rounded-xl px-4 py-3 mt-2 focus:outline-none focus:ring-2 focus:ring-amber-400" placeholder="Otro peso..." />
            </div>
            <div className="bg-stone-50 rounded-xl p-3 text-center">
              <span className="text-stone-500 text-sm">Total: </span>
              <span className="font-bold text-stone-800">{formData.cantidad} x {formData.pesoUnitario}g = {formData.cantidad * formData.pesoUnitario}g</span>
            </div>
          </div>
          <div className="flex gap-3 mt-6">
            <Button variant="secondary" className="flex-1" onClick={() => { setShowEntregaModal(false); setEditingEntregaClienteId(null); }}>Cancelar</Button>
            <Button className="flex-1" onClick={() => addEntrega(formData)}>
              Registrar
            </Button>
          </div>
        </div>
      </div>
    );
  };

  // Cierre Modal - close a single lingote
  const CierreModal = () => {
    const lingote = selectedEntrega?.lingotes?.[selectedLingoteIdx];
    const [formData, setFormData] = useState({
      precio: lingote?.precio || '',
      fechaCierre: new Date().toISOString().split('T')[0],
      nFactura: '',
      devolucion: 0,
    });

    if (!selectedEntrega || selectedLingoteIdx === null || !lingote) return null;
    const cliente = getCliente(selectedEntrega.clienteId);
    const pesoNeto = (lingote.peso || 0) - formData.devolucion;
    const importe = formData.precio ? pesoNeto * parseFloat(formData.precio) : 0;

    return (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => { setShowCierreModal(false); setSelectedEntrega(null); setSelectedLingoteIdx(null); }}>
        <div className="bg-white rounded-3xl p-6 w-full max-w-md shadow-2xl max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
          <h3 className="text-xl font-bold text-stone-800 mb-2">Cerrar Lingote</h3>
          <p className="text-stone-500 text-sm mb-6">{cliente?.nombre} • {lingote.peso}g</p>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-stone-700 mb-1">Precio €/g</label>
              <input type="number" step="0.01" value={formData.precio} onChange={(e) => setFormData({ ...formData, precio: e.target.value })} className="w-full border border-stone-300 rounded-xl px-4 py-3 text-lg font-mono focus:outline-none focus:ring-2 focus:ring-amber-400" placeholder="Ej: 126.83" />
            </div>
            <div>
              <label className="block text-sm font-medium text-stone-700 mb-1">Fecha Cierre</label>
              <input type="date" value={formData.fechaCierre} onChange={(e) => setFormData({ ...formData, fechaCierre: e.target.value })} className="w-full border border-stone-300 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-amber-400" />
            </div>
            <div>
              <label className="block text-sm font-medium text-stone-700 mb-1">N Factura</label>
              <input type="text" value={formData.nFactura} onChange={(e) => setFormData({ ...formData, nFactura: e.target.value })} className="w-full border border-stone-300 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-amber-400" placeholder="Ej: 2026-1.pdf" />
            </div>
            <div>
              <label className="block text-sm font-medium text-stone-700 mb-1">Devolucion (gramos)</label>
              <input type="number" value={formData.devolucion} onChange={(e) => setFormData({ ...formData, devolucion: parseFloat(e.target.value) || 0 })} className="w-full border border-stone-300 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-amber-400" placeholder="0" />
            </div>
            {formData.precio && (
              <div className="bg-gradient-to-br from-emerald-50 to-green-50 border border-emerald-200 rounded-2xl p-4">
                <h4 className="font-semibold text-emerald-800 mb-3">Resumen</h4>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between"><span className="text-stone-600">Peso neto:</span><span className="font-mono">{pesoNeto}g</span></div>
                  <div className="flex justify-between"><span className="text-stone-600">Precio:</span><span className="font-mono">{formatNum(parseFloat(formData.precio))} €/g</span></div>
                  <div className="flex justify-between pt-2 border-t border-emerald-200">
                    <span className="font-semibold text-emerald-800">IMPORTE:</span>
                    <span className="font-bold text-emerald-700 text-lg">{formatEur(importe)}</span>
                  </div>
                </div>
              </div>
            )}
          </div>
          <div className="flex gap-3 mt-6">
            <Button variant="secondary" className="flex-1" onClick={() => { setShowCierreModal(false); setSelectedEntrega(null); setSelectedLingoteIdx(null); }}>Cancelar</Button>
            <Button variant="success" className="flex-1" disabled={!formData.precio} onClick={() => cerrarLingote(selectedEntrega.id, selectedLingoteIdx, { precio: parseFloat(formData.precio), fechaCierre: formData.fechaCierre, nFactura: formData.nFactura, devolucion: formData.devolucion })}>
              Confirmar Cierre
            </Button>
          </div>
        </div>
      </div>
    );
  };

  // Futura Modal - register lingotes sold without stock
  const FuturaModal = () => {
    const [formData, setFormData] = useState({
      clienteId: editingEntregaClienteId || clientes[0]?.id || '',
      cantidad: 1,
      pesoUnitario: 50,
    });

    return (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => { setShowFuturaModal(false); setEditingEntregaClienteId(null); }}>
        <div className="bg-white rounded-3xl p-6 w-full max-w-md shadow-2xl" onClick={e => e.stopPropagation()}>
          <h3 className="text-xl font-bold text-red-800 mb-2">Venta sin Stock</h3>
          <p className="text-sm text-stone-500 mb-6">Registrar lingotes vendidos sin stock fisico.</p>
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
              <input type="number" value={formData.cantidad} onChange={(e) => setFormData({ ...formData, cantidad: parseInt(e.target.value) || 1 })} className="w-full border border-stone-300 rounded-xl px-4 py-3 mt-2 focus:outline-none focus:ring-2 focus:ring-red-400" placeholder="Otra cantidad..." />
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
              <input type="number" value={formData.pesoUnitario} onChange={(e) => setFormData({ ...formData, pesoUnitario: parseFloat(e.target.value) || 50 })} className="w-full border border-stone-300 rounded-xl px-4 py-3 mt-2 focus:outline-none focus:ring-2 focus:ring-red-400" placeholder="Otro peso..." />
            </div>
            <div className="bg-red-50 rounded-xl p-3 text-center">
              <span className="text-red-500 text-sm">Total vendido sin stock: </span>
              <span className="font-bold text-red-800">{formData.cantidad} x {formData.pesoUnitario}g = {formData.cantidad * formData.pesoUnitario}g</span>
            </div>
          </div>
          <div className="flex gap-3 mt-6">
            <Button variant="secondary" className="flex-1" onClick={() => { setShowFuturaModal(false); setEditingEntregaClienteId(null); }}>Cancelar</Button>
            <Button variant="danger" className="flex-1" onClick={() => addFutura(formData)}>
              Registrar
            </Button>
          </div>
        </div>
      </div>
    );
  };

  // Assign Futura Modal - select FUTURA lingotes to move to a real entrega
  const AssignFuturaModal = () => {
    const clienteId = assignFuturaTarget?.clienteId;
    const cliente = getCliente(clienteId);
    const futuraEntrega = entregas.find(e => e.clienteId === clienteId && isFuturaEntrega(e));
    const futuraList = futuraEntrega ? futuraEntrega.lingotes.map((l, idx) => ({ ...l, idx })).filter(l => l.estado === 'futura') : [];
    const targetEntregasList = entregas.filter(e => e.clienteId === clienteId && !isFuturaEntrega(e) && lingotesEnCurso(e).length > 0);

    const [selectedFutura, setSelectedFutura] = useState([]);
    const [selectedTarget, setSelectedTarget] = useState(targetEntregasList[0]?.id || '');

    if (!futuraEntrega || futuraList.length === 0) return null;

    const toggleFutura = (idx) => {
      setSelectedFutura(prev => prev.includes(idx) ? prev.filter(i => i !== idx) : [...prev, idx]);
    };

    const selectAll = () => {
      setSelectedFutura(futuraList.map(l => l.idx));
    };

    const handleAssign = async () => {
      if (selectedFutura.length === 0 || !selectedTarget) return;
      await assignFuturaLingotes(futuraEntrega.id, selectedFutura, selectedTarget);
    };

    return (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => { setShowAssignFuturaModal(false); setAssignFuturaTarget(null); }}>
        <div className="bg-white rounded-3xl p-6 w-full max-w-md shadow-2xl max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
          <h3 className="text-xl font-bold text-stone-800 mb-2">Asignar Lingotes FUTURA</h3>
          <p className="text-sm text-stone-500 mb-4">{cliente?.nombre} tiene {futuraList.length} lingotes vendidos sin stock</p>

          {targetEntregasList.length > 0 ? (
            <>
              <div className="mb-4">
                <label className="block text-sm font-medium text-stone-700 mb-1">Asignar a entrega</label>
                <select value={selectedTarget} onChange={e => setSelectedTarget(e.target.value)} className="w-full border border-stone-300 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-amber-400">
                  {targetEntregasList.map(e => {
                    const exp = getExportacion(e.exportacionId);
                    return <option key={e.id} value={e.id}>{e.fechaEntrega} {exp ? `(${exp.nombre})` : ''} - {lingotesEnCurso(e).length} lingotes</option>;
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
                  {futuraList.map((l) => {
                    const isSelected = selectedFutura.includes(l.idx);
                    return (
                      <div key={l.idx} onClick={() => toggleFutura(l.idx)} className={`flex items-center justify-between p-2 rounded-lg cursor-pointer transition-colors ${isSelected ? 'bg-amber-100 border border-amber-300' : 'bg-stone-50 border border-stone-200 hover:bg-stone-100'}`}>
                        <div className="flex items-center gap-2">
                          <div className={`w-5 h-5 rounded border-2 flex items-center justify-center text-xs ${isSelected ? 'bg-amber-500 border-amber-500 text-white' : 'border-stone-300'}`}>
                            {isSelected && '✓'}
                          </div>
                          <span className="font-mono text-sm">{l.peso}g</span>
                        </div>
                        <span className="text-xs text-red-400">FUTURA</span>
                      </div>
                    );
                  })}
                </div>
              </div>

              {selectedFutura.length > 0 && (
                <div className="bg-amber-50 rounded-xl p-3 text-center mb-4">
                  <span className="text-amber-600 text-sm">Asignar: </span>
                  <span className="font-bold text-amber-800">{selectedFutura.length} lingotes ({selectedFutura.reduce((s, idx) => s + (futuraEntrega.lingotes[idx]?.peso || 0), 0)}g)</span>
                </div>
              )}

              <div className="flex gap-3">
                <Button variant="secondary" className="flex-1" onClick={() => { setShowAssignFuturaModal(false); setAssignFuturaTarget(null); }}>Omitir</Button>
                <Button className="flex-1" disabled={selectedFutura.length === 0 || !selectedTarget} onClick={handleAssign}>
                  Asignar{selectedFutura.length > 0 ? ` (${selectedFutura.length})` : ''}
                </Button>
              </div>
            </>
          ) : (
            <>
              <p className="text-stone-500 text-sm mb-4">No hay entregas en curso a las que asignar. Crea una nueva entrega primero.</p>
              <Button variant="secondary" className="w-full" onClick={() => { setShowAssignFuturaModal(false); setAssignFuturaTarget(null); }}>Cerrar</Button>
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
