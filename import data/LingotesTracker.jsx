// ============================================
// LINGOTES TRACKER - Componente para Ma d'Or
// ============================================
// 
// INSTALACIÓN:
// 1. Copia este archivo a tu proyecto (ej: components/LingotesTracker.jsx)
// 2. Importa donde lo necesites:
//    import LingotesTracker from './components/LingotesTracker';
// 3. Úsalo en tu App:
//    <LingotesTracker />
//
// DATOS INICIALES:
// Los datos de ejemplo están al principio del archivo.
// Puedes vaciarlos o modificarlos según necesites.
// En el futuro se puede conectar a una base de datos.
// ============================================

import React, { useState, useMemo } from 'react';

// Formateo numérico europeo
const formatNum = (num, decimals = 2) => {
  if (num === null || num === undefined || isNaN(num)) return '-';
  return num.toLocaleString('de-DE', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
};

const formatEur = (num) => formatNum(num, 2) + ' €';
const formatGr = (num) => formatNum(num, 1) + ' g';

// =====================
// DATOS INICIALES
// =====================

// Clientes con colores distintivos
const initialClientes = [
  { id: 1, nombre: 'Nova Joia', color: '#F59E0B', colorLight: '#FEF3C7' },
  { id: 2, nombre: 'La Milla d\'Or', color: '#EF4444', colorLight: '#FEE2E2' },
  { id: 3, nombre: 'OrCash', color: '#10B981', colorLight: '#D1FAE5' },
  { id: 4, nombre: 'Gaudia/Raco', color: '#8B5CF6', colorLight: '#EDE9FE' },
  { id: 5, nombre: 'La Suissa', color: '#06B6D4', colorLight: '#CFFAFE' },
  { id: 6, nombre: 'Gemma', color: '#3B82F6', colorLight: '#DBEAFE' },
];

// Exportaciones (lotes)
const initialExportaciones = [
  { id: 1, nombre: '5-11', grExport: 4155, fecha: '2025-11-01' },
  { id: 2, nombre: '16-9', grExport: 3058.5, fecha: '2025-09-16' },
  { id: 3, nombre: '7-5', grExport: 2500, fecha: '2025-05-07' },
  { id: 4, nombre: '26-9', grExport: 3000, fecha: '2024-09-26' },
  { id: 5, nombre: 'FUTURA', grExport: 0, fecha: null },
];

// Entregas de lingotes - datos de ejemplo (vaciar para empezar limpio)
const initialEntregas = [
  // Nova Joia
  { id: 1, clienteId: 1, exportacionId: 1, fechaEntrega: '2025-11-11', peso: 50, precioOnza: 126.83, fechaCierre: '2025-12-30', estado: 'finalizado', pagado: true, nFactura: '2025-234', devolucion: 0 },
  { id: 2, clienteId: 1, exportacionId: 1, fechaEntrega: '2025-12-23', peso: 50, precioOnza: 129.46, fechaCierre: '2026-01-07', estado: 'finalizado', pagado: true, nFactura: '2026-1.pdf', devolucion: 0 },
  { id: 3, clienteId: 1, exportacionId: 1, fechaEntrega: '2025-12-23', peso: 50, precioOnza: 129.46, fechaCierre: '2026-01-07', estado: 'finalizado', pagado: false, nFactura: '2026-2.pdf', devolucion: 0 },
  { id: 4, clienteId: 1, exportacionId: 1, fechaEntrega: '2025-12-23', peso: 50, precioOnza: 129.46, fechaCierre: '2026-01-07', estado: 'finalizado', pagado: false, nFactura: '2026-3.pdf', devolucion: 0 },
  { id: 5, clienteId: 1, exportacionId: 1, fechaEntrega: '2025-12-23', peso: 50, precioOnza: 134.02, fechaCierre: '2026-01-12', estado: 'finalizado', pagado: false, nFactura: '2026-9.pdf', devolucion: 0 },
  { id: 6, clienteId: 1, exportacionId: 1, fechaEntrega: '2025-12-23', peso: 50, precioOnza: 134.02, fechaCierre: '2026-01-12', estado: 'finalizado', pagado: false, nFactura: '2026-10.pdf', devolucion: 0 },
  { id: 7, clienteId: 1, exportacionId: 5, fechaEntrega: '2026-01-19', peso: 50, precioOnza: 136.63, fechaCierre: null, estado: 'en_curso', pagado: false, nFactura: null, devolucion: 0 },
  { id: 8, clienteId: 1, exportacionId: 5, fechaEntrega: '2026-01-19', peso: 50, precioOnza: 136.63, fechaCierre: null, estado: 'en_curso', pagado: false, nFactura: null, devolucion: 0 },
  { id: 9, clienteId: 1, exportacionId: 5, fechaEntrega: '2026-01-19', peso: 50, precioOnza: 136.63, fechaCierre: null, estado: 'en_curso', pagado: false, nFactura: null, devolucion: 0 },
  { id: 10, clienteId: 1, exportacionId: 5, fechaEntrega: '2026-01-19', peso: 50, precioOnza: 136.63, fechaCierre: null, estado: 'en_curso', pagado: false, nFactura: null, devolucion: 0 },
  // Gemma d'Or (Gemador)
  { id: 11, clienteId: 6, exportacionId: 1, fechaEntrega: '2025-11-05', peso: 50, precioOnza: 123.01, fechaCierre: '2025-12-09', estado: 'finalizado', pagado: true, nFactura: '2025-215', devolucion: 0 },
  { id: 12, clienteId: 6, exportacionId: 1, fechaEntrega: '2025-11-05', peso: 50, precioOnza: 137.22, fechaCierre: '2026-01-20', estado: 'finalizado', pagado: false, nFactura: '2026-19.pdf', devolucion: 0 },
  { id: 13, clienteId: 6, exportacionId: 1, fechaEntrega: '2025-11-05', peso: 50, precioOnza: 140.59, fechaCierre: '2026-01-22', estado: 'finalizado', pagado: false, nFactura: '2026-20.pdf', devolucion: 0 },
  // La Milla d'Or
  { id: 14, clienteId: 2, exportacionId: 5, fechaEntrega: '2026-01-15', peso: 50, precioOnza: null, fechaCierre: null, estado: 'en_curso', pagado: false, nFactura: null, devolucion: 0 },
  { id: 15, clienteId: 2, exportacionId: 5, fechaEntrega: '2026-01-15', peso: 50, precioOnza: null, fechaCierre: null, estado: 'en_curso', pagado: false, nFactura: null, devolucion: 0 },
  // OrCash
  { id: 16, clienteId: 3, exportacionId: 2, fechaEntrega: '2025-09-16', peso: 50, precioOnza: 118.50, fechaCierre: '2025-10-01', estado: 'finalizado', pagado: true, nFactura: '2025-180', devolucion: 0 },
  { id: 17, clienteId: 3, exportacionId: 5, fechaEntrega: '2026-01-10', peso: 50, precioOnza: null, fechaCierre: null, estado: 'en_curso', pagado: false, nFactura: null, devolucion: 0 },
  // Gaudia/Raco
  { id: 18, clienteId: 4, exportacionId: 3, fechaEntrega: '2025-05-10', peso: 100, precioOnza: 112.30, fechaCierre: '2025-06-15', estado: 'finalizado', pagado: true, nFactura: '2025-120', devolucion: 0 },
];

// =====================
// COMPONENTE PRINCIPAL
// =====================

export default function LingotesTracker() {
  const [activeTab, setActiveTab] = useState('stock');
  const [clientes, setClientes] = useState(initialClientes);
  const [exportaciones, setExportaciones] = useState(initialExportaciones);
  const [entregas, setEntregas] = useState(initialEntregas);
  const [selectedCliente, setSelectedCliente] = useState(null);
  const [selectedEntrega, setSelectedEntrega] = useState(null);
  
  // Modales
  const [showEntregaModal, setShowEntregaModal] = useState(false);
  const [showCierreModal, setShowCierreModal] = useState(false);
  const [editingEntrega, setEditingEntrega] = useState(null);

  // Helpers
  const getCliente = (id) => clientes.find(c => c.id === id);
  const getExportacion = (id) => exportaciones.find(e => e.id === id);

  // Cálculos
  const calcularImporte = (peso, precioOnza) => {
    if (!precioOnza) return 0;
    // Precio por gramo = precioOnza (que ya viene en €/g según los datos)
    return peso * precioOnza;
  };

  const calcularPrecioCliente = (precioBase) => {
    if (!precioBase) return 0;
    return precioBase * 1.06; // +6%
  };

  const calcularBaseGrs = (precioOnza) => {
    if (!precioOnza) return 0;
    // El precio base en €/g (antes del 6%)
    return precioOnza / 1.06;
  };

  // Estadísticas por cliente
  const statsClientes = useMemo(() => {
    return clientes.map(cliente => {
      const entregasCliente = entregas.filter(e => e.clienteId === cliente.id);
      const entregado = entregasCliente.reduce((sum, e) => sum + e.peso, 0);
      const cerrado = entregasCliente.filter(e => e.estado === 'finalizado').reduce((sum, e) => sum + e.peso - e.devolucion, 0);
      const devuelto = entregasCliente.reduce((sum, e) => sum + e.devolucion, 0);
      const pendiente = entregado - cerrado - devuelto;
      const enCurso = entregasCliente.filter(e => e.estado === 'en_curso').length;
      const importeTotal = entregasCliente.filter(e => e.estado === 'finalizado').reduce((sum, e) => sum + calcularImporte(e.peso - e.devolucion, e.precioOnza), 0);
      
      return {
        ...cliente,
        entregado,
        cerrado,
        devuelto,
        pendiente,
        enCurso,
        importeTotal
      };
    });
  }, [clientes, entregas]);

  // Stock total
  const stockTotal = useMemo(() => {
    const totalEntregado = entregas.reduce((sum, e) => sum + e.peso, 0);
    const totalCerrado = entregas.filter(e => e.estado === 'finalizado').reduce((sum, e) => sum + e.peso - e.devolucion, 0);
    const totalDevuelto = entregas.reduce((sum, e) => sum + e.devolucion, 0);
    const totalPendiente = totalEntregado - totalCerrado - totalDevuelto;
    const stockClientes = statsClientes.reduce((sum, c) => sum + c.pendiente, 0);
    
    return {
      totalEntregado,
      totalCerrado,
      totalDevuelto,
      totalPendiente,
      stockClientes
    };
  }, [entregas, statsClientes]);

  // CRUD Entregas
  const addEntrega = (data) => {
    const newEntrega = {
      id: Date.now(),
      ...data,
      estado: 'en_curso',
      pagado: false,
      fechaCierre: null,
      nFactura: null,
      devolucion: 0
    };
    setEntregas([...entregas, newEntrega]);
    setShowEntregaModal(false);
  };

  const cerrarEntrega = (entregaId, data) => {
    setEntregas(entregas.map(e => {
      if (e.id === entregaId) {
        return {
          ...e,
          ...data,
          estado: 'finalizado'
        };
      }
      return e;
    }));
    setShowCierreModal(false);
    setSelectedEntrega(null);
  };

  const marcarPagado = (entregaId) => {
    setEntregas(entregas.map(e => {
      if (e.id === entregaId) {
        return { ...e, pagado: !e.pagado };
      }
      return e;
    }));
  };

  const deleteEntrega = (entregaId) => {
    if (confirm('¿Eliminar esta entrega?')) {
      setEntregas(entregas.filter(e => e.id !== entregaId));
    }
  };

  // Componentes UI
  const TabButton = ({ id, label, icon, count }) => (
    <button
      onClick={() => { setActiveTab(id); setSelectedCliente(null); }}
      className={`flex-1 py-4 px-3 text-sm font-semibold transition-all duration-300 relative ${
        activeTab === id 
          ? 'text-amber-900 bg-gradient-to-b from-amber-100 to-amber-50' 
          : 'text-stone-500 hover:text-amber-700 hover:bg-amber-50/50'
      }`}
    >
      <span className="text-xl block mb-1">{icon}</span>
      <span className="block text-xs">{label}</span>
      {count > 0 && (
        <span className="absolute top-2 right-2 bg-red-500 text-white text-xs w-5 h-5 rounded-full flex items-center justify-center font-bold">
          {count}
        </span>
      )}
      {activeTab === id && (
        <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-gradient-to-r from-amber-400 to-yellow-500" />
      )}
    </button>
  );

  const Card = ({ children, className = '', onClick, highlight }) => (
    <div 
      onClick={onClick}
      className={`
        bg-white rounded-2xl p-5 shadow-sm border transition-all duration-200
        ${highlight ? 'border-amber-400 shadow-amber-100' : 'border-stone-200'}
        ${onClick ? 'cursor-pointer hover:shadow-md hover:border-amber-300 hover:-translate-y-0.5' : ''}
        ${className}
      `}
    >
      {children}
    </div>
  );

  const Button = ({ children, onClick, variant = 'primary', size = 'md', className = '', disabled }) => {
    const variants = {
      primary: 'bg-gradient-to-r from-amber-500 to-yellow-500 text-white hover:from-amber-600 hover:to-yellow-600 shadow-sm shadow-amber-200',
      secondary: 'bg-stone-100 text-stone-700 hover:bg-stone-200 border border-stone-200',
      success: 'bg-gradient-to-r from-emerald-500 to-green-500 text-white hover:from-emerald-600 hover:to-green-600',
      danger: 'bg-red-50 text-red-600 hover:bg-red-100 border border-red-200',
      ghost: 'text-stone-600 hover:bg-stone-100',
    };
    const sizes = {
      sm: 'px-3 py-1.5 text-xs',
      md: 'px-4 py-2 text-sm',
      lg: 'px-6 py-3 text-base',
    };
    return (
      <button 
        onClick={onClick} 
        disabled={disabled}
        className={`${variants[variant]} ${sizes[size]} rounded-xl font-semibold transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed ${className}`}
      >
        {children}
      </button>
    );
  };

  const Badge = ({ children, color = 'amber' }) => {
    const colors = {
      amber: 'bg-amber-100 text-amber-800 border-amber-200',
      green: 'bg-emerald-100 text-emerald-800 border-emerald-200',
      red: 'bg-red-100 text-red-800 border-red-200',
      blue: 'bg-blue-100 text-blue-800 border-blue-200',
      gray: 'bg-stone-100 text-stone-600 border-stone-200',
    };
    return (
      <span className={`${colors[color]} text-xs font-semibold px-2.5 py-1 rounded-full border`}>
        {children}
      </span>
    );
  };

  const StatBox = ({ label, value, suffix = '', color = 'stone', icon }) => (
    <div className="text-center">
      <div className="flex items-center justify-center gap-1 mb-1">
        {icon && <span className="text-lg">{icon}</span>}
        <span className={`text-2xl font-bold text-${color}-700`}>{value}</span>
        <span className="text-sm text-stone-400">{suffix}</span>
      </div>
      <p className="text-xs text-stone-500 uppercase tracking-wide">{label}</p>
    </div>
  );

  // Stock de la última exportación (Mador)
  const [stockMador, setStockMador] = useState(700); // Stock propio de lingotes
  
  // Umbrales de color para stock Mador
  const [umbralStock, setUmbralStock] = useState({
    rojo: 200,      // < 200 = rojo (crítico)
    naranja: 500,   // < 500 = naranja (bajo)
    amarillo: 1000, // < 1000 = amarillo (medio)
    // >= 1000 = verde (ok)
  });

  // Calcular color del stock según umbrales (reactivo)
  const getStockColor = useMemo(() => {
    return (stock) => {
      if (stock < umbralStock.rojo) return { bg: 'from-red-600 via-red-500 to-red-600', text: 'text-red-100', accent: 'text-white' };
      if (stock < umbralStock.naranja) return { bg: 'from-orange-600 via-orange-500 to-orange-600', text: 'text-orange-100', accent: 'text-white' };
      if (stock < umbralStock.amarillo) return { bg: 'from-amber-500 via-yellow-500 to-amber-500', text: 'text-amber-100', accent: 'text-white' };
      return { bg: 'from-emerald-600 via-green-500 to-emerald-600', text: 'text-emerald-100', accent: 'text-white' };
    };
  }, [umbralStock]);

  // Vista Overview Stock
  const StockOverview = () => {
    const stockColor = getStockColor(stockMador);
    
    // Si hay cliente seleccionado, mostrar su detalle
    if (selectedCliente) {
      return <ClienteDetalle />;
    }
    
    return (
      <div className="space-y-6">
        {/* Stocks lado a lado */}
        <div className="grid grid-cols-2 gap-4">
          {/* Stock Mador (última exportación) */}
          <div className={`bg-gradient-to-br ${stockColor.bg} rounded-2xl p-4 text-white shadow-lg`}>
            <div className="text-center">
              <p className={`text-xs ${stockColor.text} mb-1`}>Stock Ma d'Or</p>
              <div className={`text-3xl font-black ${stockColor.accent}`}>{formatNum(stockMador, 0)}</div>
              <div className={`text-xs ${stockColor.text}`}>gramos</div>
            </div>
          </div>

          {/* Stock en Clientes */}
          <div className="bg-gradient-to-br from-stone-700 via-stone-600 to-stone-700 rounded-2xl p-4 text-white shadow-lg">
            <div className="text-center">
              <p className="text-xs text-stone-400 mb-1">En Clientes</p>
              <div className="text-3xl font-black text-amber-400">{formatNum(stockTotal.stockClientes, 0)}</div>
              <div className="text-xs text-stone-400">gramos</div>
            </div>
          </div>
        </div>

        {/* Grid de clientes */}
        <div className="grid grid-cols-2 gap-4">
          {statsClientes.map(cliente => (
            <Card 
              key={cliente.id} 
              onClick={() => setSelectedCliente(cliente.id)}
              className="relative overflow-hidden"
            >
              <div 
                className="absolute top-0 left-0 w-1.5 h-full"
                style={{ backgroundColor: cliente.color }}
              />
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
                  </div>
                </div>
              </div>
            </Card>
          ))}
        </div>
      </div>
    );
  };

  // Vista Cliente Detalle (se muestra dentro de Stock)
  const ClienteDetalle = () => {
    const cliente = getCliente(selectedCliente);
    const entregasCliente = entregas.filter(e => e.clienteId === cliente.id);
    const stats = statsClientes.find(s => s.id === cliente.id);
    
    const entregasEnCurso = entregasCliente.filter(e => e.estado === 'en_curso');
    const entregasFinalizadas = entregasCliente.filter(e => e.estado === 'finalizado');

    return (
      <div className="space-y-5">
        {/* Header del cliente */}
        <div 
          className="rounded-2xl p-5 text-white shadow-lg relative overflow-hidden"
          style={{ background: `linear-gradient(135deg, ${cliente.color}, ${cliente.color}dd)` }}
        >
          <button 
            onClick={() => setSelectedCliente(null)}
            className="absolute top-3 left-3 text-white/80 hover:text-white text-sm flex items-center gap-1 bg-white/20 rounded-lg px-2 py-1"
          >
            ← Volver
          </button>
          
          <div className="text-center pt-6">
            <h2 className="text-xl font-bold mb-1">{cliente.nombre}</h2>
            
            <div className="grid grid-cols-4 gap-3 mt-4">
              <div className="bg-white/20 rounded-xl p-2">
                <div className="text-lg font-bold">{formatNum(stats?.entregado || 0, 0)}</div>
                <div className="text-xs text-white/70">Entregado</div>
              </div>
              <div className="bg-white/20 rounded-xl p-2">
                <div className="text-lg font-bold">{formatNum(stats?.cerrado || 0, 0)}</div>
                <div className="text-xs text-white/70">Cerrado</div>
              </div>
              <div className="bg-white/20 rounded-xl p-2">
                <div className="text-lg font-bold">{formatNum(stats?.devuelto || 0, 0)}</div>
                <div className="text-xs text-white/70">Devuelto</div>
              </div>
              <div className="bg-white/20 rounded-xl p-2">
                <div className="text-lg font-bold">{formatNum(stats?.pendiente || 0, 0)}</div>
                <div className="text-xs text-white/70">Pendiente</div>
              </div>
            </div>
          </div>
        </div>

        {/* Entregas en curso */}
        {entregasEnCurso.length > 0 && (
          <Card>
            <div className="flex justify-between items-center mb-4">
              <h3 className="font-bold text-stone-800">⏳ En Curso ({entregasEnCurso.length})</h3>
              <div className="text-sm text-stone-500">
                Total: <span className="font-semibold text-amber-600">{formatNum(entregasEnCurso.reduce((s, e) => s + e.peso, 0), 0)}g</span>
              </div>
            </div>
            
            <div className="space-y-2">
              {entregasEnCurso.map(entrega => {
                const exportacion = getExportacion(entrega.exportacionId);
                return (
                  <div 
                    key={entrega.id}
                    className="flex items-center justify-between p-3 rounded-xl bg-amber-50 border border-amber-200"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-amber-100 flex items-center justify-center">
                        <span className="text-lg">📦</span>
                      </div>
                      <div>
                        <div className="font-semibold text-stone-800">{entrega.peso}g</div>
                        <div className="text-xs text-stone-500">
                          {entrega.fechaEntrega} • Exp: {exportacion?.nombre}
                        </div>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <Button 
                        size="sm" 
                        variant="success"
                        onClick={() => { setSelectedEntrega(entrega); setShowCierreModal(true); }}
                      >
                        Cerrar
                      </Button>
                      <Button 
                        size="sm" 
                        variant="danger"
                        onClick={() => deleteEntrega(entrega.id)}
                      >
                        ×
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>
        )}

        {/* Entregas finalizadas */}
        <Card>
          <div className="flex justify-between items-center mb-4">
            <h3 className="font-bold text-stone-800">✅ Finalizadas ({entregasFinalizadas.length})</h3>
            <div className="text-sm text-stone-500">
              Importe: <span className="font-semibold text-emerald-600">{formatEur(stats?.importeTotal || 0)}</span>
            </div>
          </div>
          
          <div className="overflow-x-auto -mx-5 px-5">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-stone-200">
                  <th className="text-left py-2 px-1 text-stone-500 font-medium text-xs">Fecha</th>
                  <th className="text-right py-2 px-1 text-stone-500 font-medium text-xs">Peso</th>
                  <th className="text-right py-2 px-1 text-stone-500 font-medium text-xs">€/g</th>
                  <th className="text-right py-2 px-1 text-stone-500 font-medium text-xs">Importe</th>
                  <th className="text-center py-2 px-1 text-stone-500 font-medium text-xs">Pagado</th>
                </tr>
              </thead>
              <tbody>
                {entregasFinalizadas.map(entrega => {
                  const importe = calcularImporte(entrega.peso - entrega.devolucion, entrega.precioOnza);
                  return (
                    <tr key={entrega.id} className="border-b border-stone-100 hover:bg-stone-50">
                      <td className="py-2 px-1">
                        <div className="text-stone-800 text-xs">{entrega.fechaCierre}</div>
                      </td>
                      <td className="py-2 px-1 text-right font-mono text-xs">{entrega.peso}g</td>
                      <td className="py-2 px-1 text-right font-mono text-xs">{formatNum(entrega.precioOnza)}</td>
                      <td className="py-2 px-1 text-right font-mono font-semibold text-xs">{formatEur(importe)}</td>
                      <td className="py-2 px-1 text-center">
                        <button
                          onClick={() => marcarPagado(entrega.id)}
                          className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition-colors text-xs ${
                            entrega.pagado 
                              ? 'bg-emerald-500 border-emerald-500 text-white' 
                              : 'border-stone-300 hover:border-emerald-400'
                          }`}
                        >
                          {entrega.pagado && '✓'}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          
          {entregasFinalizadas.length === 0 && (
            <p className="text-stone-400 text-center py-6 text-sm">No hay entregas finalizadas</p>
          )}
        </Card>

        {/* Botón nueva entrega */}
        <Button 
          className="w-full" 
          size="lg"
          onClick={() => { setEditingEntrega({ clienteId: cliente.id }); setShowEntregaModal(true); }}
        >
          + Nueva Entrega
        </Button>
      </div>
    );
  };

  // Vista Exportaciones
  const ExportacionesView = () => {
    const [showNewExportacion, setShowNewExportacion] = useState(false);
    const [newExpData, setNewExpData] = useState({ nombre: '', grExport: '', fecha: new Date().toISOString().split('T')[0] });

    // Calcular stats por exportación
    const exportacionesStats = useMemo(() => {
      return exportaciones.map(exp => {
        const entregasExp = entregas.filter(e => e.exportacionId === exp.id);
        const totalEntregado = entregasExp.reduce((sum, e) => sum + e.peso, 0);
        const totalCerrado = entregasExp.filter(e => e.estado === 'finalizado').reduce((sum, e) => sum + e.peso - e.devolucion, 0);
        const totalDevuelto = entregasExp.reduce((sum, e) => sum + e.devolucion, 0);
        const totalPendiente = totalEntregado - totalCerrado - totalDevuelto;
        const importeTotal = entregasExp.filter(e => e.estado === 'finalizado').reduce((sum, e) => sum + calcularImporte(e.peso - e.devolucion, e.precioOnza), 0);
        
        // Stats por cliente
        const porCliente = clientes.map(c => {
          const entregasCliente = entregasExp.filter(e => e.clienteId === c.id);
          return {
            ...c,
            entregado: entregasCliente.reduce((sum, e) => sum + e.peso, 0),
            cerrado: entregasCliente.filter(e => e.estado === 'finalizado').reduce((sum, e) => sum + e.peso - e.devolucion, 0),
            pendiente: entregasCliente.filter(e => e.estado === 'en_curso').reduce((sum, e) => sum + e.peso, 0),
          };
        }).filter(c => c.entregado > 0);

        return {
          ...exp,
          totalEntregado,
          totalCerrado,
          totalDevuelto,
          totalPendiente,
          importeTotal,
          porCliente,
          numEntregas: entregasExp.length
        };
      });
    }, [exportaciones, entregas, clientes]);

    const addExportacion = () => {
      if (newExpData.nombre && newExpData.grExport) {
        setExportaciones([...exportaciones, {
          id: Date.now(),
          nombre: newExpData.nombre,
          grExport: parseFloat(newExpData.grExport),
          fecha: newExpData.fecha
        }]);
        setNewExpData({ nombre: '', grExport: '', fecha: new Date().toISOString().split('T')[0] });
        setShowNewExportacion(false);
      }
    };

    return (
      <div className="space-y-6">
        <div className="flex justify-between items-center">
          <h2 className="text-xl font-bold text-stone-800">Exportaciones</h2>
          <Button size="sm" onClick={() => setShowNewExportacion(true)}>+ Nueva</Button>
        </div>

        {/* Modal nueva exportación */}
        {showNewExportacion && (
          <Card className="border-amber-400 bg-amber-50">
            <h3 className="font-bold text-stone-800 mb-4">Nueva Exportación</h3>
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-stone-700 mb-1">Nombre</label>
                <input
                  type="text"
                  value={newExpData.nombre}
                  onChange={(e) => setNewExpData({ ...newExpData, nombre: e.target.value })}
                  placeholder="Ej: 5-11"
                  className="w-full border border-stone-300 rounded-xl px-4 py-2 focus:outline-none focus:ring-2 focus:ring-amber-400"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-stone-700 mb-1">Gramos Exportados</label>
                <input
                  type="number"
                  value={newExpData.grExport}
                  onChange={(e) => setNewExpData({ ...newExpData, grExport: e.target.value })}
                  placeholder="Ej: 4155"
                  className="w-full border border-stone-300 rounded-xl px-4 py-2 focus:outline-none focus:ring-2 focus:ring-amber-400"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-stone-700 mb-1">Fecha</label>
                <input
                  type="date"
                  value={newExpData.fecha}
                  onChange={(e) => setNewExpData({ ...newExpData, fecha: e.target.value })}
                  className="w-full border border-stone-300 rounded-xl px-4 py-2 focus:outline-none focus:ring-2 focus:ring-amber-400"
                />
              </div>
              <div className="flex gap-2 pt-2">
                <Button variant="secondary" className="flex-1" onClick={() => setShowNewExportacion(false)}>Cancelar</Button>
                <Button className="flex-1" onClick={addExportacion}>Guardar</Button>
              </div>
            </div>
          </Card>
        )}

        {/* Lista de exportaciones */}
        <div className="space-y-4">
          {exportacionesStats.map(exp => (
            <Card key={exp.id}>
              <div className="flex justify-between items-start mb-4">
                <div>
                  <h3 className="text-lg font-bold text-stone-800">{exp.nombre}</h3>
                  <p className="text-xs text-stone-500">{exp.fecha || 'Sin fecha'} • {formatNum(exp.grExport, 0)}g exportados</p>
                </div>
                <div className="text-right">
                  <div className="text-lg font-bold text-emerald-600">{formatEur(exp.importeTotal)}</div>
                  <div className="text-xs text-stone-500">{exp.numEntregas} entregas</div>
                </div>
              </div>

              {/* Barra de progreso */}
              <div className="mb-4">
                <div className="flex justify-between text-xs text-stone-500 mb-1">
                  <span>Cerrado: {formatNum(exp.totalCerrado, 0)}g</span>
                  <span>Pendiente: {formatNum(exp.totalPendiente, 0)}g</span>
                </div>
                <div className="h-2 bg-stone-200 rounded-full overflow-hidden">
                  <div 
                    className="h-full bg-gradient-to-r from-emerald-500 to-green-400 rounded-full"
                    style={{ width: `${exp.totalEntregado > 0 ? (exp.totalCerrado / exp.totalEntregado) * 100 : 0}%` }}
                  />
                </div>
              </div>

              {/* Desglose por cliente */}
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

              {exp.porCliente.length === 0 && (
                <p className="text-stone-400 text-sm text-center py-2">Sin entregas registradas</p>
              )}
            </Card>
          ))}
        </div>
      </div>
    );
  };

  // Vista Parámetros
  const ParametrosView = () => {
    // Estado temporal para edición
    const [tempStock, setTempStock] = useState(stockMador.toString());
    const [tempUmbrales, setTempUmbrales] = useState({
      rojo: umbralStock.rojo.toString(),
      naranja: umbralStock.naranja.toString(),
      amarillo: umbralStock.amarillo.toString(),
    });

    // Comprobar si hay cambios
    const stockChanged = tempStock !== stockMador.toString();
    const umbralesChanged = 
      tempUmbrales.rojo !== umbralStock.rojo.toString() ||
      tempUmbrales.naranja !== umbralStock.naranja.toString() ||
      tempUmbrales.amarillo !== umbralStock.amarillo.toString();

    const guardarStock = () => {
      const valor = parseFloat(tempStock) || 0;
      setStockMador(valor);
      setTempStock(valor.toString());
    };

    const guardarUmbrales = () => {
      const nuevos = {
        rojo: parseFloat(tempUmbrales.rojo) || 0,
        naranja: parseFloat(tempUmbrales.naranja) || 0,
        amarillo: parseFloat(tempUmbrales.amarillo) || 0,
      };
      setUmbralStock(nuevos);
      setTempUmbrales({
        rojo: nuevos.rojo.toString(),
        naranja: nuevos.naranja.toString(),
        amarillo: nuevos.amarillo.toString(),
      });
    };

    // Preview con valores temporales
    const previewUmbrales = {
      rojo: parseFloat(tempUmbrales.rojo) || 0,
      naranja: parseFloat(tempUmbrales.naranja) || 0,
      amarillo: parseFloat(tempUmbrales.amarillo) || 0,
    };
    const previewStock = parseFloat(tempStock) || 0;
    
    const getPreviewColor = (stock) => {
      if (stock < previewUmbrales.rojo) return { bg: 'from-red-600 via-red-500 to-red-600', label: 'CRÍTICO' };
      if (stock < previewUmbrales.naranja) return { bg: 'from-orange-600 via-orange-500 to-orange-600', label: 'BAJO' };
      if (stock < previewUmbrales.amarillo) return { bg: 'from-amber-500 via-yellow-500 to-amber-500', label: 'MEDIO' };
      return { bg: 'from-emerald-600 via-green-500 to-emerald-600', label: 'OK' };
    };

    const previewColor = getPreviewColor(previewStock);

    return (
      <div className="space-y-6">
        <h2 className="text-xl font-bold text-stone-800">Ajustes</h2>
        
        {/* Stock actual */}
        <Card>
          <h3 className="font-bold text-stone-800 mb-4">📦 Stock Ma d'Or Actual</h3>
          <div className="flex items-center gap-3">
            <input
              type="text"
              inputMode="numeric"
              value={tempStock}
              onChange={(e) => setTempStock(e.target.value)}
              className="flex-1 border border-stone-300 rounded-xl px-4 py-3 text-2xl font-bold text-center focus:outline-none focus:ring-2 focus:ring-amber-400"
            />
            <span className="text-stone-500">g</span>
            <Button 
              onClick={guardarStock}
              disabled={!stockChanged}
              variant={stockChanged ? 'primary' : 'secondary'}
            >
              Guardar
            </Button>
          </div>
        </Card>

        {/* Umbrales de color */}
        <Card>
          <h3 className="font-bold text-stone-800 mb-4">🚦 Umbrales de Color del Stock</h3>
          <p className="text-sm text-stone-500 mb-4">Define los niveles de alerta según el stock disponible</p>
          
          <div className="space-y-4">
            {/* Rojo - Crítico */}
            <div className="flex items-center gap-3 p-3 rounded-xl bg-red-50 border border-red-200">
              <div className="w-4 h-4 rounded-full bg-red-500"></div>
              <div className="flex-1">
                <label className="text-sm font-medium text-red-800">Crítico (Rojo)</label>
                <p className="text-xs text-red-600">Menor que este valor</p>
              </div>
              <input
                type="text"
                inputMode="numeric"
                value={tempUmbrales.rojo}
                onChange={(e) => setTempUmbrales({ ...tempUmbrales, rojo: e.target.value })}
                className="w-24 border border-red-300 rounded-lg px-3 py-2 text-center font-mono focus:outline-none focus:ring-2 focus:ring-red-400"
              />
              <span className="text-sm text-stone-500">g</span>
            </div>

            {/* Naranja - Bajo */}
            <div className="flex items-center gap-3 p-3 rounded-xl bg-orange-50 border border-orange-200">
              <div className="w-4 h-4 rounded-full bg-orange-500"></div>
              <div className="flex-1">
                <label className="text-sm font-medium text-orange-800">Bajo (Naranja)</label>
                <p className="text-xs text-orange-600">Menor que este valor</p>
              </div>
              <input
                type="text"
                inputMode="numeric"
                value={tempUmbrales.naranja}
                onChange={(e) => setTempUmbrales({ ...tempUmbrales, naranja: e.target.value })}
                className="w-24 border border-orange-300 rounded-lg px-3 py-2 text-center font-mono focus:outline-none focus:ring-2 focus:ring-orange-400"
              />
              <span className="text-sm text-stone-500">g</span>
            </div>

            {/* Amarillo - Medio */}
            <div className="flex items-center gap-3 p-3 rounded-xl bg-amber-50 border border-amber-200">
              <div className="w-4 h-4 rounded-full bg-amber-500"></div>
              <div className="flex-1">
                <label className="text-sm font-medium text-amber-800">Medio (Amarillo)</label>
                <p className="text-xs text-amber-600">Menor que este valor</p>
              </div>
              <input
                type="text"
                inputMode="numeric"
                value={tempUmbrales.amarillo}
                onChange={(e) => setTempUmbrales({ ...tempUmbrales, amarillo: e.target.value })}
                className="w-24 border border-amber-300 rounded-lg px-3 py-2 text-center font-mono focus:outline-none focus:ring-2 focus:ring-amber-400"
              />
              <span className="text-sm text-stone-500">g</span>
            </div>

            {/* Verde - OK */}
            <div className="flex items-center gap-3 p-3 rounded-xl bg-emerald-50 border border-emerald-200">
              <div className="w-4 h-4 rounded-full bg-emerald-500"></div>
              <div className="flex-1">
                <label className="text-sm font-medium text-emerald-800">OK (Verde)</label>
                <p className="text-xs text-emerald-600">Mayor o igual que amarillo</p>
              </div>
              <div className="w-24 text-center font-mono text-emerald-700">
                ≥ {tempUmbrales.amarillo || '0'}
              </div>
              <span className="text-sm text-stone-500">g</span>
            </div>
          </div>

          {/* Botón guardar umbrales */}
          <div className="mt-4">
            <Button 
              onClick={guardarUmbrales}
              disabled={!umbralesChanged}
              variant={umbralesChanged ? 'primary' : 'secondary'}
              className="w-full"
            >
              {umbralesChanged ? 'Guardar Umbrales' : 'Sin cambios'}
            </Button>
          </div>

          {/* Preview */}
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

  // Modal Nueva Entrega
  const EntregaModal = () => {
    const [formData, setFormData] = useState({
      clienteId: editingEntrega?.clienteId || clientes[0]?.id,
      exportacionId: exportaciones.find(e => e.nombre === 'FUTURA')?.id || exportaciones[0]?.id,
      fechaEntrega: new Date().toISOString().split('T')[0],
      peso: 50,
    });

    return (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => setShowEntregaModal(false)}>
        <div className="bg-white rounded-3xl p-6 w-full max-w-md shadow-2xl" onClick={e => e.stopPropagation()}>
          <h3 className="text-xl font-bold text-stone-800 mb-6">📦 Nueva Entrega</h3>
          
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-stone-700 mb-1">Cliente</label>
              <select
                value={formData.clienteId}
                onChange={(e) => setFormData({ ...formData, clienteId: parseInt(e.target.value) })}
                className="w-full border border-stone-300 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-amber-400"
              >
                {clientes.map(c => (
                  <option key={c.id} value={c.id}>{c.nombre}</option>
                ))}
              </select>
            </div>
            
            <div>
              <label className="block text-sm font-medium text-stone-700 mb-1">Exportación</label>
              <select
                value={formData.exportacionId}
                onChange={(e) => setFormData({ ...formData, exportacionId: parseInt(e.target.value) })}
                className="w-full border border-stone-300 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-amber-400"
              >
                {exportaciones.map(e => (
                  <option key={e.id} value={e.id}>{e.nombre}</option>
                ))}
              </select>
            </div>
            
            <div>
              <label className="block text-sm font-medium text-stone-700 mb-1">Fecha Entrega</label>
              <input
                type="date"
                value={formData.fechaEntrega}
                onChange={(e) => setFormData({ ...formData, fechaEntrega: e.target.value })}
                className="w-full border border-stone-300 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-amber-400"
              />
            </div>
            
            <div>
              <label className="block text-sm font-medium text-stone-700 mb-1">Peso (gramos)</label>
              <div className="flex gap-2">
                {[50, 100, 200, 500].map(p => (
                  <button
                    key={p}
                    onClick={() => setFormData({ ...formData, peso: p })}
                    className={`flex-1 py-2 rounded-xl border-2 font-semibold transition-colors ${
                      formData.peso === p 
                        ? 'border-amber-500 bg-amber-50 text-amber-700' 
                        : 'border-stone-200 text-stone-600 hover:border-stone-300'
                    }`}
                  >
                    {p}g
                  </button>
                ))}
              </div>
              <input
                type="number"
                value={formData.peso}
                onChange={(e) => setFormData({ ...formData, peso: parseFloat(e.target.value) || 0 })}
                className="w-full border border-stone-300 rounded-xl px-4 py-3 mt-2 focus:outline-none focus:ring-2 focus:ring-amber-400"
                placeholder="Otro peso..."
              />
            </div>
          </div>
          
          <div className="flex gap-3 mt-6">
            <Button variant="secondary" className="flex-1" onClick={() => setShowEntregaModal(false)}>
              Cancelar
            </Button>
            <Button className="flex-1" onClick={() => addEntrega(formData)}>
              Registrar Entrega
            </Button>
          </div>
        </div>
      </div>
    );
  };

  // Modal Cierre
  const CierreModal = () => {
    const [formData, setFormData] = useState({
      precioOnza: selectedEntrega?.precioOnza || '',
      fechaCierre: new Date().toISOString().split('T')[0],
      nFactura: '',
      devolucion: 0,
    });

    if (!selectedEntrega) return null;

    const cliente = getCliente(selectedEntrega.clienteId);
    const precioCliente = formData.precioOnza ? calcularPrecioCliente(parseFloat(formData.precioOnza)) : 0;
    const pesoNeto = selectedEntrega.peso - formData.devolucion;
    const importe = formData.precioOnza ? calcularImporte(pesoNeto, parseFloat(formData.precioOnza)) : 0;

    return (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => { setShowCierreModal(false); setSelectedEntrega(null); }}>
        <div className="bg-white rounded-3xl p-6 w-full max-w-md shadow-2xl" onClick={e => e.stopPropagation()}>
          <h3 className="text-xl font-bold text-stone-800 mb-2">🔒 Cerrar Entrega</h3>
          <p className="text-stone-500 text-sm mb-6">{cliente?.nombre} • {selectedEntrega.peso}g</p>
          
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-stone-700 mb-1">Precio €/g (Base)</label>
              <input
                type="number"
                step="0.01"
                value={formData.precioOnza}
                onChange={(e) => setFormData({ ...formData, precioOnza: e.target.value })}
                className="w-full border border-stone-300 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-amber-400 text-lg font-mono"
                placeholder="Ej: 126.83"
              />
              {formData.precioOnza && (
                <div className="mt-2 p-3 bg-amber-50 rounded-xl">
                  <div className="flex justify-between text-sm">
                    <span className="text-stone-600">Precio Cliente (+6%):</span>
                    <span className="font-semibold text-amber-700">{formatNum(precioCliente)} €/g</span>
                  </div>
                </div>
              )}
            </div>
            
            <div>
              <label className="block text-sm font-medium text-stone-700 mb-1">Fecha Cierre</label>
              <input
                type="date"
                value={formData.fechaCierre}
                onChange={(e) => setFormData({ ...formData, fechaCierre: e.target.value })}
                className="w-full border border-stone-300 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-amber-400"
              />
            </div>
            
            <div>
              <label className="block text-sm font-medium text-stone-700 mb-1">Nº Factura</label>
              <input
                type="text"
                value={formData.nFactura}
                onChange={(e) => setFormData({ ...formData, nFactura: e.target.value })}
                className="w-full border border-stone-300 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-amber-400"
                placeholder="Ej: 2026-1.pdf"
              />
            </div>
            
            <div>
              <label className="block text-sm font-medium text-stone-700 mb-1">Devolución (gramos)</label>
              <input
                type="number"
                value={formData.devolucion}
                onChange={(e) => setFormData({ ...formData, devolucion: parseFloat(e.target.value) || 0 })}
                className="w-full border border-stone-300 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-amber-400"
                placeholder="0"
              />
            </div>

            {/* Resumen */}
            {formData.precioOnza && (
              <div className="bg-gradient-to-br from-emerald-50 to-green-50 border border-emerald-200 rounded-2xl p-4">
                <h4 className="font-semibold text-emerald-800 mb-3">💰 Resumen</h4>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-stone-600">Peso neto:</span>
                    <span className="font-mono">{pesoNeto}g</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-stone-600">Precio base:</span>
                    <span className="font-mono">{formatNum(formData.precioOnza)} €/g</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-stone-600">Precio cliente:</span>
                    <span className="font-mono text-amber-600">{formatNum(precioCliente)} €/g</span>
                  </div>
                  <div className="flex justify-between pt-2 border-t border-emerald-200">
                    <span className="font-semibold text-emerald-800">IMPORTE TOTAL:</span>
                    <span className="font-bold text-emerald-700 text-lg">{formatEur(importe)}</span>
                  </div>
                </div>
              </div>
            )}
          </div>
          
          <div className="flex gap-3 mt-6">
            <Button variant="secondary" className="flex-1" onClick={() => { setShowCierreModal(false); setSelectedEntrega(null); }}>
              Cancelar
            </Button>
            <Button 
              variant="success" 
              className="flex-1" 
              disabled={!formData.precioOnza}
              onClick={() => cerrarEntrega(selectedEntrega.id, {
                precioOnza: parseFloat(formData.precioOnza),
                fechaCierre: formData.fechaCierre,
                nFactura: formData.nFactura,
                devolucion: formData.devolucion
              })}
            >
              Confirmar Cierre
            </Button>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-stone-100 via-amber-50/30 to-orange-50/20">
      {/* Header */}
      <header className="bg-gradient-to-r from-stone-800 via-stone-700 to-stone-800 text-white shadow-xl">
        <div className="max-w-2xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 bg-gradient-to-br from-amber-400 to-yellow-500 rounded-xl flex items-center justify-center shadow-lg shadow-amber-500/30">
                <span className="text-2xl">🥇</span>
              </div>
              <div>
                <h1 className="text-xl font-bold tracking-tight">Ma d'Or</h1>
                <p className="text-stone-400 text-xs">Gestión de Lingotes</p>
              </div>
            </div>
            <Button size="sm" onClick={() => setShowEntregaModal(true)}>
              + Entrega
            </Button>
          </div>
        </div>
      </header>

      {/* Navigation */}
      <nav className="bg-white border-b border-stone-200 shadow-sm sticky top-0 z-40">
        <div className="max-w-2xl mx-auto flex">
          <TabButton 
            id="stock" 
            label="Stock" 
            icon="📊" 
          />
          <TabButton 
            id="exportaciones" 
            label="Exportaciones" 
            icon="📦" 
          />
          <TabButton 
            id="parametros" 
            label="Ajustes" 
            icon="⚙️" 
          />
        </div>
      </nav>

      {/* Content */}
      <main className="max-w-2xl mx-auto p-4 pb-24">
        {activeTab === 'stock' && <StockOverview />}
        {activeTab === 'exportaciones' && <ExportacionesView />}
        {activeTab === 'parametros' && <ParametrosView />}
      </main>

      {/* Modals */}
      {showEntregaModal && <EntregaModal />}
      {showCierreModal && <CierreModal />}
    </div>
  );
}
