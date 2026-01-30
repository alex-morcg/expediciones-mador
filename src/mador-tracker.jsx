import React, { useState, useMemo, useEffect } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { useFirestore } from './hooks/useFirestore';
import LingotesTracker from './components/LingotesTracker';

// Formateo numérico europeo (100.000,25)
const formatNum = (num, decimals = 2) => {
  if (num === null || num === undefined || isNaN(num)) return '-';
  return num.toLocaleString('de-DE', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
};

const formatEur = (num) => formatNum(num, 2) + ' €';
const formatEurInt = (num) => formatNum(num, 0) + '€';
const formatGr = (num, decimals = 2) => formatNum(num, decimals) + ' g';

// Extraer número de expedición (E39 → 39, E50 → 50)
const getExpNum = (nombre) => {
  const m = nombre?.match(/E(\d+)/);
  return m ? parseInt(m[1]) : 0;
};
const sortExpDescending = (a, b) => getExpNum(b.nombre) - getExpNum(a.nombre);

// Helper para tiempo relativo
const tiempoRelativo = (fecha) => {
  if (!fecha) return '';
  const ahora = new Date();
  const entonces = new Date(fecha);
  const diffMs = ahora - entonces;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHoras = Math.floor(diffMins / 60);
  const diffDias = Math.floor(diffHoras / 24);
  
  if (diffMins < 1) return 'ahora';
  if (diffMins < 60) return `hace ${diffMins}min`;
  if (diffHoras < 24) return `hace ${diffHoras}h`;
  if (diffDias < 7) return `hace ${diffDias}d`;
  return entonces.toLocaleDateString('es-ES');
};

const COLORES_USUARIO = [
  '#f59e0b', '#eab308', '#3b82f6', '#10b981', '#8b5cf6', 
  '#ef4444', '#ec4899', '#06b6d4', '#84cc16'
];





export default function MadorTracker() {
  // Local UI state - definido primero para usar en useFirestore
  const [showLingotes, setShowLingotes] = useState(false);

  // Firestore data & CRUD - con lazy loading basado en sección activa
  const {
    categorias, clientes, expediciones, paquetes, estadosPaquete, usuarios,
    expedicionActualId, loading, setExpedicionActualId,
    saveCategoria: fsaveCategoria, deleteCategoria, saveCliente: fsaveCliente, deleteCliente, updateClienteKilatajes, updateClienteDatosFiscales,
    saveExpedicion: fsaveExpedicion, deleteExpedicion, savePaquete: fsavePaquete, deletePaquete,
    addLineaToPaquete: faddLinea, removeLineaFromPaquete: fremoveLinea, updatePaqueteCierre: fupdateCierre,
    updatePaqueteFactura: fupdateFactura, updatePaqueteVerificacion: fupdateVerificacion,
    validarVerificacion: fvalidarVerificacion, updatePaqueteEstado: fupdateEstado,
    marcarTodosComoEstado: fmarcarTodos, addComentarioToPaquete: faddComentario,
    deleteComentarioFromPaquete: fdeleteComentario,
    agregarUsuario: fagregarUsuario, eliminarUsuario: feliminarUsuario,
    guardarEdicionUsuario: fguardarEdicionUsuario, regenerarCodigoUsuario: fregenerarCodigoUsuario,
    agregarEstado: fagregarEstado, eliminarEstado: feliminarEstado,
    guardarEdicionEstado: fguardarEdicionEstado,
    updateExpedicionResultados: fupdateResultados,
    matriculas, agregarMatricula: fagregarMatricula, eliminarMatricula: feliminarMatricula,
    lingotesExportaciones, lingotesEntregas, lingotesConfig, lingotesFutura,
    saveLingoteExportacion, deleteLingoteExportacion,
    saveLingoteEntrega, deleteLingoteEntrega, updateLingoteEntrega,
    updateLingotesConfig,
    saveLingoteFutura, deleteLingoteFutura, updateLingoteFutura,
    lingotesFacturas, saveLingoteFactura, deleteLingoteFactura, updateLingoteFactura,
  } = useFirestore(showLingotes ? 'lingotes' : 'expediciones');

  // Local UI state
  const [activeTab, setActiveTab] = useState('expediciones');
  const [statsExpDesde, setStatsExpDesde] = useState(null);
  const [statsExpHasta, setStatsExpHasta] = useState(null);
  const [statsClienteId, setStatsClienteId] = useState(null);

  // Código de URL (sin nombre de parámetro, ej: ?a7x9k2mf)
  const [codigoUrl, setCodigoUrl] = useState(() => {
    if (typeof window !== 'undefined') {
      const searchParams = window.location.search;
      // El código es el primer parámetro sin valor (ej: ?a7x9k2mf)
      if (searchParams.startsWith('?') && searchParams.length > 1) {
        const firstParam = searchParams.slice(1).split('&')[0];
        // Si no tiene '=' es solo el código
        if (!firstParam.includes('=')) {
          return firstParam;
        }
      }
    }
    return null;
  });

  // Usuario activo derivado del código
  const usuarioActivo = useMemo(() => {
    if (!codigoUrl || !usuarios.length) return null;
    const usuario = usuarios.find(u => u.codigo === codigoUrl);
    return usuario?.id || null;
  }, [codigoUrl, usuarios]);

  // Si no hay código válido y hay usuarios cargados, mostrar error
  const codigoInvalido = useMemo(() => {
    if (loading) return false;
    if (!codigoUrl) return true;
    if (!usuarios.length) return false;
    return !usuarios.find(u => u.codigo === codigoUrl);
  }, [codigoUrl, usuarios, loading]);

  // Sync URL when changing user (solo para alex que puede cambiar)
  const cambiarUsuario = (nuevoUsuarioId) => {
    const usuario = usuarios.find(u => u.id === nuevoUsuarioId);
    if (usuario?.codigo) {
      setCodigoUrl(usuario.codigo);
      const url = new URL(window.location);
      url.search = `?${usuario.codigo}`;
      window.history.replaceState({}, '', url);
    }
  };

  // Es alex (puede editar usuarios)
  const esAlex = usuarioActivo === 'alex';

  // Auto-assign "en_jofisa" status when expedition export date has passed
  useEffect(() => {
    if (!expediciones.length || !paquetes.length || !estadosPaquete.length) return;
    const enJofisaEstado = estadosPaquete.find(e => e.id === 'en_jofisa');
    if (!enJofisaEstado) return;
    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);
    expediciones.forEach(exp => {
      if (!exp.fechaExportacion) return;
      const fechaExp = new Date(exp.fechaExportacion);
      if (fechaExp >= hoy) return;
      // Find paquetes of this expedition that are NOT yet en_jofisa
      const paqsToUpdate = paquetes.filter(p => p.expedicionId === exp.id && p.estado !== 'en_jofisa');
      if (paqsToUpdate.length > 0) {
        fmarcarTodos(exp.id, 'en_jofisa', 'sistema', estadosPaquete);
      }
    });
  }, [expediciones, paquetes, estadosPaquete]);

  const getUsuario = (id) => usuarios.find(u => u.id === id);
  const usuarioActual = getUsuario(usuarioActivo);
  
  // Modal states
  const [modalOpen, setModalOpen] = useState(false);
  const [modalType, setModalType] = useState(null);
  const [editingItem, setEditingItem] = useState(null);
  const [selectedExpedicion, setSelectedExpedicion] = useState(null);
  const [selectedPaquete, setSelectedPaquete] = useState(null);
  const [showTextModal, setShowTextModal] = useState(false);
  const [textModalContent, setTextModalContent] = useState('');
  const [ordenVista, setOrdenVista] = useState('normal'); // 'normal', 'cliente', 'estado'
  const [marcarTodosModal, setMarcarTodosModal] = useState({ open: false, estadoId: null });

  // Helper functions
  const getNextPaqueteNumber = (expedicionId) => {
    const expedicionPaquetes = paquetes.filter(p => p.expedicionId === expedicionId);
    return expedicionPaquetes.length + 1;
  };

  const getExpedicionNombre = (expedicionId) => {
    const exp = expediciones.find(e => e.id === expedicionId);
    return exp ? exp.nombre : '';
  };

  const getCategoria = (categoriaId) => {
    return categorias.find(c => c.id === categoriaId);
  };

  const getCliente = (clienteId) => {
    return clientes.find(c => c.id === clienteId);
  };

  const calcularFinoLinea = (bruto, ley) => {
    const fino = bruto * (ley / 1000);
    return Math.trunc(fino * 100) / 100; // Truncar a 2 decimales
  };

  const getExpedicionPrecioPorDefecto = (expedicionId) => {
    const exp = expediciones.find(e => e.id === expedicionId);
    if (exp?.precioPorDefecto) return exp.precioPorDefecto;
    // Fallback: most recent precioFino from paquetes in this expedition
    const expPaquetes = paquetes.filter(p => p.expedicionId === expedicionId && p.precioFino);
    if (expPaquetes.length === 0) return null;
    const sorted = [...expPaquetes].sort((a, b) => (b.id || '').localeCompare(a.id || ''));
    return sorted[0]?.precioFino || null;
  };

  const calcularTotalesPaquete = (paquete, precioPorDefecto) => {
    const cliente = getCliente(paquete.clienteId);
    const noCuentaNegativas = cliente?.lineasNegativasNoCuentanPeso ?? true;

    // Para peso: si noCuentaNegativas, excluimos líneas negativas
    // Para cálculo €: siempre incluimos todas las líneas
    const finoTotalPeso = paquete.lineas.reduce((sum, l) => {
      const fino = calcularFinoLinea(l.bruto, l.ley);
      if (noCuentaNegativas && l.bruto < 0) return sum;
      return sum + fino;
    }, 0);

    const brutoTotalPeso = paquete.lineas.reduce((sum, l) => {
      if (noCuentaNegativas && l.bruto < 0) return sum;
      return sum + l.bruto;
    }, 0);

    // Para cálculo de €: incluimos TODAS las líneas (incluso negativas)
    const finoTotalCalculo = paquete.lineas.reduce((sum, l) => sum + calcularFinoLinea(l.bruto, l.ley), 0);

    // Use precioPorDefecto if paquete has no precioFino
    const precioEfectivo = paquete.precioFino || precioPorDefecto || null;
    const esEstimado = !paquete.precioFino && !!precioPorDefecto;

    if (!precioEfectivo) {
      return { finoTotal: finoTotalPeso, finoTotalCalculo, brutoTotal: brutoTotalPeso, base: 0, descuento: 0, baseCliente: 0, igi: 0, totalFra: 0, fraJofisa: 0, margen: 0, esEstimado: false };
    }

    const base = finoTotalCalculo * precioEfectivo;
    const descuento = base * (paquete.descuento / 100);
    const baseCliente = base - descuento;
    const igi = baseCliente * (paquete.igi / 100);
    const totalFra = baseCliente + igi;
    const cierreJofisa = paquete.cierreJofisa || (precioEfectivo - 0.25);
    const fraJofisa = cierreJofisa * finoTotalCalculo;
    const margen = fraJofisa - baseCliente;

    return { finoTotal: finoTotalPeso, finoTotalCalculo, brutoTotal: brutoTotalPeso, base, descuento, baseCliente, igi, totalFra, fraJofisa, margen, cierreJofisa, esEstimado };
  };

  const calcularTotalesExpedicion = (expedicionId) => {
    const expedicionPaquetes = paquetes.filter(p => p.expedicionId === expedicionId);
    const precioPorDefecto = getExpedicionPrecioPorDefecto(expedicionId);

    let sumaBruto = 0;
    let sumaFino = 0;
    let totalFra = 0;
    let totalFraJofisa = 0;
    let totalMargen = 0;
    let totalFraEstimado = 0;
    const porCategoria = {};
    const porCliente = {};

    expedicionPaquetes.forEach(paq => {
      const totales = calcularTotalesPaquete(paq, precioPorDefecto);
      if (totales.esEstimado) totalFraEstimado += totales.totalFra;
      sumaBruto += totales.brutoTotal;
      sumaFino += totales.finoTotal;
      totalFra += totales.totalFra;
      totalFraJofisa += totales.fraJofisa;
      totalMargen += totales.margen;

      const cat = getCategoria(paq.categoriaId);
      if (cat) {
        if (!porCategoria[cat.nombre]) {
          porCategoria[cat.nombre] = { bruto: 0, fino: 0, totalFra: 0 };
        }
        porCategoria[cat.nombre].bruto += totales.brutoTotal;
        porCategoria[cat.nombre].fino += totales.finoTotal;
        porCategoria[cat.nombre].totalFra += totales.totalFra;
      }

      if (paq.clienteId) {
        if (!porCliente[paq.clienteId]) {
          porCliente[paq.clienteId] = { bruto: 0, fino: 0, finoCalculo: 0, totalFra: 0, baseCliente: 0, fraJofisa: 0, margen: 0 };
        }
        porCliente[paq.clienteId].bruto += totales.brutoTotal;
        porCliente[paq.clienteId].fino += totales.finoTotal;
        porCliente[paq.clienteId].finoCalculo += totales.finoTotalCalculo;
        porCliente[paq.clienteId].totalFra += totales.totalFra;
        porCliente[paq.clienteId].baseCliente += totales.baseCliente;
        porCliente[paq.clienteId].fraJofisa += totales.fraJofisa;
        porCliente[paq.clienteId].margen += totales.margen;
      }
    });
    
    const precioMedioBruto = sumaBruto > 0 ? totalFra / sumaBruto : 0;
    
    Object.keys(porCategoria).forEach(key => {
      porCategoria[key].precioMedioBruto = porCategoria[key].bruto > 0 
        ? porCategoria[key].totalFra / porCategoria[key].bruto 
        : 0;
    });
    
    return { sumaBruto, sumaFino, totalFra, totalFraJofisa, totalMargen, totalFraEstimado, precioMedioBruto, porCategoria, porCliente, numPaquetes: expedicionPaquetes.length };
  };

  const getPrecioRefExpedicion = (expedicionId) => {
    const expedicionPaquetes = paquetes.filter(p => p.expedicionId === expedicionId && p.precioFino);
    if (expedicionPaquetes.length === 0) return null;
    // Ordenar por id (más reciente último) y coger el último precio fino
    const sorted = [...expedicionPaquetes].sort((a, b) => b.id - a.id);
    return sorted[0]?.precioFino || null;
  };

  const generarTexto = (paquete) => {
    const totales = calcularTotalesPaquete(paquete, getExpedicionPrecioPorDefecto(paquete.expedicionId));
    const cliente = getCliente(paquete.clienteId);
    const lineasTexto = paquete.lineas.map(l => {
      const fino = calcularFinoLinea(l.bruto, l.ley);
      return `- Una línea de ${formatNum(fino)} grs. de fino: ${formatNum(l.bruto)} grs de bruto x ley (${l.ley}/1000)`;
    }).join('\n');
    
    const finoParaTexto = totales.finoTotalCalculo || totales.finoTotal;
    
    const texto = `${cliente?.nombre || 'Cliente'}:

La factura contiene ${formatNum(finoParaTexto)} grs. de fino compuestos de:
${lineasTexto}

Los ${formatNum(finoParaTexto)} grs. están cerrados al fixing de ${formatNum(paquete.precioFino)}€.
La base es ${formatNum(finoParaTexto)}x${formatNum(paquete.precioFino)}=${formatNum(totales.base)} menos el ${paquete.descuento}% = ${formatNum(totales.baseCliente)}
A la base le sumamos el ${paquete.igi}% de IGI que nos da un total de ${formatNum(totales.totalFra)}€`;
    
    return texto;
  };

  // Modal handlers
  const openModal = (type, item = null) => {
    setModalType(type);
    setEditingItem(item);
    setModalOpen(true);
  };

  const closeModal = () => {
    setModalOpen(false);
    setModalType(null);
    setEditingItem(null);
  };

  // CRUD wrappers (delegate to Firestore hook)
  const saveCategoria = (data) => { fsaveCategoria(data, editingItem); closeModal(); };
  const saveCliente = (data) => { fsaveCliente(data, editingItem); closeModal(); };
  const saveExpedicion = (data) => { fsaveExpedicion(data, editingItem); closeModal(); };
  const savePaquete = (data) => { fsavePaquete(data, editingItem, { usuarioActivo, getExpedicionNombre, getCliente, getCategoria, paquetes }); closeModal(); };
  const addLineaToPaquete = (paqueteId, linea) => faddLinea(paqueteId, linea, usuarioActivo);
  const removeLineaFromPaquete = (paqueteId, lineaId) => {
    const paq = paquetes.find(p => p.id === paqueteId);
    const linea = paq?.lineas?.find(l => l.id === lineaId);
    if (!confirm(`¿Eliminar línea: ${formatNum(linea?.bruto || 0)}g / ${formatNum(linea?.ley || 0, 0)} ley?`)) return;
    fremoveLinea(paqueteId, lineaId, usuarioActivo);
  };
  const updatePaqueteCierre = (paqueteId, precioFino, cierreJofisa) => fupdateCierre(paqueteId, precioFino, cierreJofisa, usuarioActivo);
  const updatePaqueteFactura = (paqueteId, factura) => fupdateFactura(paqueteId, factura, usuarioActivo);
  const updatePaqueteVerificacion = (paqueteId, verificacionIA) => fupdateVerificacion(paqueteId, verificacionIA, usuarioActivo);
  const validarVerificacion = (paqueteId) => fvalidarVerificacion(paqueteId, usuarioActivo);
  const updatePaqueteEstado = (paqueteId, estado) => fupdateEstado(paqueteId, estado, usuarioActivo, estadosPaquete);
  const marcarTodosComoEstado = (expedicionId, estadoId) => { fmarcarTodos(expedicionId, estadoId, usuarioActivo, estadosPaquete); setMarcarTodosModal({ open: false, estadoId: null }); };
  const addComentarioToPaquete = (paqueteId, texto) => faddComentario(paqueteId, texto, usuarioActivo);
  const deleteComentarioFromPaquete = (paqueteId, comentarioId) => {
    const paq = paquetes.find(p => p.id === paqueteId);
    const comentario = paq?.comentarios?.find(c => c.id === comentarioId);
    const preview = comentario?.texto?.substring(0, 30) + (comentario?.texto?.length > 30 ? '...' : '');
    if (!confirm(`¿Eliminar comentario: "${preview}"?`)) return;
    fdeleteComentario(paqueteId, comentarioId, usuarioActivo);
  };

  // Delete wrappers with confirmations
  const handleDeleteCategoria = (id) => {
    const cat = categorias.find(c => c.id === id);
    if (!confirm(`¿Eliminar la categoría "${cat?.nombre || 'Sin nombre'}"?`)) return;
    deleteCategoria(id);
  };

  const handleDeleteCliente = (id) => {
    const cliente = clientes.find(c => c.id === id);
    if (!confirm(`¿Eliminar el cliente "${cliente?.nombre || 'Sin nombre'}"?`)) return;
    deleteCliente(id);
  };

  const handleDeleteExpedicion = (id) => {
    const exp = expediciones.find(e => e.id === id);
    const numPaquetes = paquetes.filter(p => p.expedicionId === id).length;
    const mensaje = numPaquetes > 0
      ? `¿Eliminar la expedición "${exp?.nombre || 'Sin nombre'}" y sus ${numPaquetes} paquete(s)?`
      : `¿Eliminar la expedición "${exp?.nombre || 'Sin nombre'}"?`;
    if (!confirm(mensaje)) return;
    deleteExpedicion(id);
  };

  const handleDeletePaquete = (id) => {
    const paq = paquetes.find(p => p.id === id);
    const numLineas = paq?.lineas?.length || 0;
    const mensaje = numLineas > 0
      ? `¿Eliminar el paquete "${paq?.nombre || 'Sin nombre'}" con ${numLineas} línea(s)?`
      : `¿Eliminar el paquete "${paq?.nombre || 'Sin nombre'}"?`;
    if (!confirm(mensaje)) return;
    deletePaquete(id);
  };

  // Tab content components
  const TabButton = ({ id, label, icon, badge }) => (
    <button
      onClick={() => setActiveTab(id)}
      className={`flex-1 py-3 px-2 text-xs sm:text-sm font-medium transition-all duration-300 relative ${
        activeTab === id
          ? 'bg-gradient-to-r from-amber-500 to-yellow-500 text-white shadow-md'
          : 'text-amber-700 hover:text-amber-900 hover:bg-amber-100'
      }`}
      style={{ borderRadius: activeTab === id ? '8px' : '0' }}
    >
      <span className="block relative inline-block">
        {icon}
        {badge > 0 && (
          <span className="absolute -top-1 -right-3 bg-red-500 text-white text-[10px] font-bold rounded-full min-w-[16px] h-4 flex items-center justify-center px-1">{badge}</span>
        )}
      </span>
      <span className="block mt-1">{label}</span>
    </button>
  );

  const Card = ({ children, className = '', onClick, style = {} }) => (
    <div 
      onClick={onClick}
      className={`bg-white border rounded-xl p-4 shadow-sm ${onClick ? 'cursor-pointer hover:shadow-md transition-all' : ''} ${className}`}
      style={{ borderColor: '#fcd34d80', ...style }}
    >
      {children}
    </div>
  );

  const Button = ({ children, onClick, variant = 'primary', size = 'md', className = '', disabled = false, disabledReason = '' }) => {
    const variants = {
      primary: 'bg-gradient-to-r from-amber-500 to-yellow-500 text-white hover:from-amber-600 hover:to-yellow-600 shadow-sm',
      secondary: 'bg-amber-100 text-amber-800 border border-amber-300 hover:bg-amber-200',
      danger: 'bg-red-100 text-red-700 border border-red-300 hover:bg-red-200',
      ghost: 'text-amber-700 hover:bg-amber-100',
    };
    const sizes = {
      sm: 'px-2 py-1 text-xs',
      md: 'px-4 py-2 text-sm',
      lg: 'px-6 py-3 text-base',
    };
    const disabledStyle = disabled ? 'opacity-50 cursor-not-allowed grayscale' : '';
    return (
      <button 
        onClick={disabled ? undefined : onClick} 
        disabled={disabled}
        title={disabled ? disabledReason : undefined}
        className={`${variants[variant]} ${sizes[size]} rounded-lg font-medium transition-all duration-200 ${disabledStyle} ${className}`}
      >
        {children}
      </button>
    );
  };

  const Input = ({ label, ...props }) => (
    <div className="mb-3">
      {label && <label className="block text-amber-800 text-sm mb-1 font-medium">{label}</label>}
      <input 
        {...props}
        className="w-full bg-white border border-amber-300 rounded-lg px-3 py-2 text-stone-800 placeholder-stone-400 focus:outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-200 transition-colors"
      />
    </div>
  );

  const Select = ({ label, options, ...props }) => (
    <div className="mb-3">
      {label && <label className="block text-amber-800 text-sm mb-1 font-medium">{label}</label>}
      <select 
        {...props}
        className="w-full bg-white border border-amber-300 rounded-lg px-3 py-2 text-stone-800 focus:outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-200 transition-colors"
      >
        {options.map(opt => (
          <option key={opt.value} value={opt.value}>{opt.label}</option>
        ))}
      </select>
    </div>
  );

  const Checkbox = ({ label, ...props }) => (
    <label className="flex items-center gap-2 cursor-pointer">
      <input type="checkbox" {...props} className="w-4 h-4 accent-amber-500" />
      <span className="text-stone-700 text-sm">{label}</span>
    </label>
  );

  // Expediciones Tab (incluye detalle de paquete)
  const ExpedicionesTab = () => {
    const [newLinea, setNewLinea] = useState({ bruto: '', ley: '' });
    const [cierreData, setCierreData] = useState({ precioFino: '', cierreJofisa: '' });
    const [verificandoFactura, setVerificandoFactura] = useState(false);
    const [showLogsModal, setShowLogsModal] = useState(false);
    const [showFacturaViewer, setShowFacturaViewer] = useState(false);
    const [newComentario, setNewComentario] = useState('');
    
    // Función para verificar factura con IA
    const verificarFacturaConIA = async (paq) => {
      if (!paq.factura?.data) {
        alert('No hay factura subida');
        return;
      }

      const esImagen = paq.factura.tipo?.startsWith('image/');
      const esPDF = paq.factura.tipo === 'application/pdf';

      if (!esImagen && !esPDF) {
        alert('Solo se pueden verificar imágenes o PDFs');
        return;
      }

      setVerificandoFactura(true);

      const totales = calcularTotalesPaquete(paq, getExpedicionPrecioPorDefecto(paq.expedicionId));

      // Preparar resumen de líneas del paquete para comparar pesos
      const lineasResumen = paq.lineas.map(l => `${l.bruto}g x ley ${l.ley}`).join(', ');

      const base64Data = paq.factura.data.split(',')[1];

      const prompt = `Analiza esta factura/albarán y extrae:
1. El importe TOTAL final (lo que paga el cliente)
2. Cada línea de peso bruto con su ley/kilataje

Nuestros datos del paquete son:
- Total calculado: ${totales.totalFra.toFixed(2)} €
- Líneas: ${lineasResumen}
- Bruto total: ${totales.brutoTotal.toFixed(2)} g

Compara CADA línea de peso de la factura con nuestras líneas. Indica discrepancias por línea de gramos (ej: "Línea 244.98g ley 712.5 en factura vs 245.10g ley 712.5 en datos"). NO menciones el total ni la diferencia de importes en las observaciones.

Responde SOLO con JSON, sin texto adicional:
{
  "total": número_o_null,
  "pesos": [{"bruto": número, "ley": número_o_null}],
  "pesosCuadran": true/false,
  "observaciones": "discrepancias por línea de gramos, o null si todo cuadra"
}

Usa punto decimal. Si no encuentras algo, pon null.`;

      const archivoContent = esImagen
        ? { type: 'image', source: { type: 'base64', media_type: paq.factura.tipo, data: base64Data } }
        : { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64Data } };

      try {
        const response = await fetch('/api/verify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            max_tokens: 500,
            messages: [{
              role: 'user',
              content: [
                archivoContent,
                { type: 'text', text: prompt }
              ]
            }]
          })
        });

        if (!response.ok) {
          const errData = await response.json().catch(() => ({}));
          throw new Error(errData.error?.message || `HTTP ${response.status}`);
        }

        const data = await response.json();
        const respuestaTexto = data.content?.[0]?.text || '';

        let resultado = null;
        try {
          const jsonMatch = respuestaTexto.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            resultado = JSON.parse(jsonMatch[0]);
          }
        } catch (e) {
          // No se pudo parsear
        }

        if (!resultado || resultado.total === null) {
          alert('No se pudo leer el total de la factura');
          setVerificandoFactura(false);
          return;
        }

        const diferencia = resultado.total - totales.totalFra;

        updatePaqueteVerificacion(paq.id, {
          totalFactura: resultado.total,
          totalPaquete: totales.totalFra,
          diferencia,
          pesos: resultado.pesos || [],
          pesosCuadran: resultado.pesosCuadran ?? null,
          observaciones: resultado.observaciones || null,
          fecha: new Date().toISOString(),
          archivoNombre: paq.factura.nombre
        });

      } catch (error) {
        alert('Error al conectar con la IA: ' + error.message);
      }

      setVerificandoFactura(false);
    };
    
    // Vista detalle de paquete
    if (selectedPaquete) {
      const paq = paquetes.find(p => p.id === selectedPaquete);
      if (!paq) return null;
      
      const totales = calcularTotalesPaquete(paq, getExpedicionPrecioPorDefecto(paq.expedicionId));
      const cliente = getCliente(paq.clienteId);
      const categoria = getCategoria(paq.categoriaId);
      const clienteColor = cliente?.color || '#f59e0b';
      
      return (
        <div className="space-y-4">
          <Card style={{ backgroundColor: clienteColor + '10', borderColor: clienteColor + '40' }}>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div><span className="text-stone-500">Cliente:</span> <span className="text-stone-800 font-medium">{cliente?.nombre}</span></div>
              <div><span className="text-stone-500">Categoría:</span> <span className="text-stone-800 font-medium">{categoria?.nombre}</span></div>
              <div><span className="text-stone-500">Descuento:</span> <span className="text-stone-800 font-medium">{paq.descuento}%</span></div>
              <div><span className="text-stone-500">IGI:</span> <span className="text-stone-800 font-medium">{paq.igi}%</span></div>
            </div>
          </Card>
          
          <Card style={{ backgroundColor: clienteColor + '10', borderColor: clienteColor + '40' }}>
            <h3 className="font-semibold mb-3" style={{ color: clienteColor }}>📏 Líneas de Oro</h3>
            <div className="space-y-2 mb-4">
              {paq.lineas.map(linea => {
                const fino = calcularFinoLinea(linea.bruto, linea.ley);
                const esNegativa = linea.bruto < 0;
                return (
                  <div 
                    key={linea.id} 
                    className="flex justify-between items-start gap-2 rounded-lg p-2"
                    style={esNegativa 
                      ? { backgroundColor: '#fef2f2', border: '1px solid #fecaca' }
                      : { backgroundColor: clienteColor + '15', border: `1px solid ${clienteColor}30` }
                    }
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-x-2 text-sm">
                        <span className={`font-medium ${esNegativa ? 'text-red-700' : 'text-stone-800'}`}>{linea.bruto}g</span>
                        <span className="text-stone-500">× {linea.ley}</span>
                        <span className="font-medium" style={{ color: esNegativa ? '#dc2626' : clienteColor }}>= {formatNum(fino, 2)}g</span>
                      </div>
                      {esNegativa && <span className="text-xs text-red-500">(no cuenta peso)</span>}
                    </div>
                    <Button size="sm" variant="danger" onClick={() => removeLineaFromPaquete(paq.id, linea.id)}>×</Button>
                  </div>
                );
              })}
              {paq.lineas.length === 0 && <p className="text-stone-400 text-center py-4">Sin líneas</p>}
              {paq.lineas.length > 1 && (
                <div className="mt-2 pt-2 border-t text-right" style={{ borderColor: clienteColor + '30' }}>
                  <span className="font-semibold" style={{ color: clienteColor }}>
                    Total: {formatGr(paq.lineas.reduce((sum, l) => sum + (l.bruto || 0), 0))}
                  </span>
                  <span className="ml-2" style={{ color: clienteColor + 'bb' }}>
                    ({formatGr(paq.lineas.reduce((sum, l) => sum + calcularFinoLinea(l.bruto, l.ley), 0))} fino)
                  </span>
                </div>
              )}
            </div>

            <div className="flex flex-col sm:flex-row gap-2">
              <div className="flex gap-2 flex-1">
                <input
                  type="number"
                  placeholder="Bruto (g)"
                  value={newLinea.bruto}
                  onChange={(e) => setNewLinea({ ...newLinea, bruto: e.target.value })}
                  className="flex-1 min-w-0 bg-white rounded-lg px-3 py-2 text-stone-800 placeholder-stone-400 focus:outline-none"
                  style={{ border: `1px solid ${clienteColor}50` }}
                />
                <input
                  type="number"
                  placeholder="Ley"
                  value={newLinea.ley}
                  onChange={(e) => setNewLinea({ ...newLinea, ley: e.target.value })}
                  className="flex-1 min-w-0 bg-white rounded-lg px-3 py-2 text-stone-800 placeholder-stone-400 focus:outline-none"
                  style={{ border: `1px solid ${clienteColor}50` }}
                />
              </div>
              <Button 
                disabled={!newLinea.bruto || !newLinea.ley}
                disabledReason={!newLinea.bruto && !newLinea.ley ? 'Introduce bruto y ley' : !newLinea.bruto ? 'Falta bruto' : 'Falta ley'}
                onClick={() => {
                  if (newLinea.bruto && newLinea.ley) {
                    addLineaToPaquete(paq.id, { bruto: parseFloat(newLinea.bruto), ley: parseFloat(newLinea.ley) });
                    setNewLinea({ bruto: '', ley: '' });
                  }
                }}
              >+ Añadir</Button>
            </div>
            
            {cliente?.kilatajes && cliente.kilatajes.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-1">
                {cliente.kilatajes.map(k => (
                  <button
                    key={k.nombre}
                    onClick={() => setNewLinea({ ...newLinea, ley: k.ley.toString() })}
                    className="text-xs px-2 py-1 rounded transition-colors"
                    style={{ backgroundColor: clienteColor + '20', color: clienteColor, border: `1px solid ${clienteColor}40` }}
                  >
                    {k.nombre}: {k.ley}
                  </button>
                ))}
              </div>
            )}
          </Card>
          
          <Card style={{ backgroundColor: clienteColor + '10', borderColor: clienteColor + '40' }}>
            <h3 className="font-semibold mb-3" style={{ color: clienteColor }}>🔒 Cierre</h3>
            {(() => {
              const precioFino = parseFloat(cierreData.precioFino) || paq.precioFino || 0;
              const cierreJofisa = parseFloat(cierreData.cierreJofisa) || paq.cierreJofisa || 0;
              const esperado = precioFino ? (precioFino - 0.25) : 0;
              const diferencia = precioFino ? Math.abs(cierreJofisa - esperado) : 0;
              const esIncorrecto = precioFino && diferencia > 0.001;
              
              // Detectar si hay cambios
              const precioFinalNuevo = cierreData.precioFino ? parseFloat(cierreData.precioFino) : null;
              const cierreJofisaNuevo = cierreData.cierreJofisa ? parseFloat(cierreData.cierreJofisa) : null;
              const hayCambios = (precioFinalNuevo !== null && precioFinalNuevo !== paq.precioFino) || 
                                 (cierreJofisaNuevo !== null && cierreJofisaNuevo !== paq.cierreJofisa);
              const noPuedeGuardar = !hayCambios ? 'No hay cambios que guardar' : 
                                     (!paq.precioFino && !cierreData.precioFino) ? 'Introduce un precio fino' : '';
              
              return (
                <div className="flex flex-col sm:flex-row gap-2 mb-4">
                  <div className="flex gap-2 flex-1">
                    <div className="flex-1 min-w-0">
                      <label className="block text-xs mb-1" style={{ color: clienteColor }}>Precio fino €/g</label>
                      <input
                        type="number"
                        placeholder="€/g"
                        value={cierreData.precioFino || paq.precioFino || ''}
                        onChange={(e) => setCierreData({ ...cierreData, precioFino: e.target.value })}
                        className="w-full bg-white rounded-lg px-3 py-2 text-stone-800 placeholder-stone-400 focus:outline-none"
                        style={{ border: `1px solid ${clienteColor}50` }}
                      />
                    </div>
                    <div className="flex-1 min-w-0">
                      <label className="block text-xs mb-1" style={{ color: clienteColor }}>Cierre Jofisa</label>
                      <div className="flex gap-1">
                        <input
                          type="number"
                          placeholder="€/g"
                          value={cierreData.cierreJofisa || paq.cierreJofisa || ''}
                          onChange={(e) => setCierreData({ ...cierreData, cierreJofisa: e.target.value })}
                          className="flex-1 min-w-0 rounded-lg px-3 py-2 placeholder-stone-400 focus:outline-none"
                          style={esIncorrecto
                            ? { backgroundColor: '#fef2f2', border: '2px solid #f87171', color: '#991b1b' }
                            : { backgroundColor: 'white', border: `1px solid ${clienteColor}50`, color: '#1c1917' }
                          }
                        />
                        <button
                          type="button"
                          onClick={() => {
                            const precio = parseFloat(cierreData.precioFino) || paq.precioFino || 0;
                            if (precio > 0) {
                              setCierreData({ ...cierreData, cierreJofisa: (precio - 0.25).toFixed(2) });
                            }
                          }}
                          className="px-2 py-1 text-sm rounded-lg transition-colors"
                          style={{ backgroundColor: clienteColor + '20', color: clienteColor, border: `1px solid ${clienteColor}40` }}
                          title="Auto-rellenar con Precio fino - 0,25"
                        >🪄</button>
                      </div>
                      {esIncorrecto && (
                        <p className="text-red-600 text-xs mt-1">Esperado: {formatNum(esperado, 2)} (mg aplicado: {formatNum(cierreJofisa - precioFino, 2)})</p>
                      )}
                    </div>
                  </div>
                  <Button 
                    className="self-start sm:self-end" 
                    disabled={!!noPuedeGuardar}
                    disabledReason={noPuedeGuardar}
                    onClick={() => {
                      const precioFinal = cierreData.precioFino ? parseFloat(cierreData.precioFino) : paq.precioFino;
                      const cierreJofisaFinal = cierreData.cierreJofisa ? parseFloat(cierreData.cierreJofisa) : paq.cierreJofisa;
                      if (precioFinal) {
                        updatePaqueteCierre(paq.id, precioFinal, cierreJofisaFinal);
                        setCierreData({ precioFino: '', cierreJofisa: '' });
                      }
                    }}
                  >✓ Guardar</Button>
                </div>
              );
            })()}
          </Card>
          
          {/* Estado del paquete */}
          <Card style={{ backgroundColor: clienteColor + '10', borderColor: clienteColor + '40' }}>
            <h3 className="font-semibold mb-3" style={{ color: clienteColor }}>📍 Estado</h3>
            <div className="flex flex-wrap gap-2">
              {estadosPaquete.map(estado => {
                const isActive = paq.estado === estado.id;
                return (
                  <button
                    key={estado.id}
                    onClick={() => updatePaqueteEstado(paq.id, estado.id)}
                    className={`flex items-center gap-2 px-3 py-2 rounded-lg border-2 transition-all ${
                      isActive 
                        ? 'border-current shadow-sm' 
                        : 'border-transparent bg-stone-100 hover:bg-stone-200'
                    }`}
                    style={isActive ? { borderColor: estado.color, backgroundColor: estado.color + '20', color: estado.color } : {}}
                  >
                    <span>{estado.icon}</span>
                    <span className={`text-sm font-medium ${isActive ? '' : 'text-stone-600'}`}>{estado.nombre}</span>
                  </button>
                );
              })}
            </div>
          </Card>
          
          {/* Comentarios */}
          <Card style={{ backgroundColor: clienteColor + '10', borderColor: clienteColor + '40' }}>
            <h3 className="font-semibold mb-3" style={{ color: clienteColor }}>💬 Comentarios</h3>
            
            {/* Lista de comentarios */}
            {paq.comentarios && paq.comentarios.length > 0 && (
              <div className="space-y-2 mb-3">
                {paq.comentarios.map(com => {
                  const usuario = getUsuario(com.usuario);
                  return (
                    <div key={com.id} className="bg-white/50 rounded-lg p-3 group" style={{ border: `1px solid ${clienteColor}30` }}>
                      <div className="flex justify-between items-start mb-1">
                        <span className="font-medium text-sm text-stone-700">{usuario?.nombre}</span>
                        <div className="flex items-center gap-2">
                          <span className="text-stone-400 text-xs">{tiempoRelativo(com.fecha)}</span>
                          <button
                            onClick={() => deleteComentarioFromPaquete(paq.id, com.id)}
                            className="text-red-400 hover:text-red-600 text-xs opacity-50 hover:opacity-100 transition-opacity"
                            title="Eliminar comentario"
                          >✕</button>
                        </div>
                      </div>
                      <p className="text-stone-700 text-sm">{com.texto}</p>
                    </div>
                  );
                })}
              </div>
            )}
            
            {/* Añadir comentario */}
            <div className="flex gap-2">
              <input
                type="text"
                placeholder="Añadir comentario..."
                value={newComentario}
                onChange={(e) => setNewComentario(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && newComentario.trim()) {
                    addComentarioToPaquete(paq.id, newComentario.trim());
                    setNewComentario('');
                  }
                }}
                className="flex-1 bg-white rounded-lg px-3 py-2 text-stone-800 placeholder-stone-400 focus:outline-none"
                style={{ border: `1px solid ${clienteColor}50` }}
              />
              <Button 
                onClick={() => {
                  if (newComentario.trim()) {
                    addComentarioToPaquete(paq.id, newComentario.trim());
                    setNewComentario('');
                  }
                }}
                disabled={!newComentario.trim()}
                disabledReason="Escribe un comentario"
              >+</Button>
            </div>
          </Card>
          
          <Card style={{ backgroundColor: clienteColor + '10', borderColor: clienteColor + '40' }}>
            <h3 className="font-semibold mb-3" style={{ color: clienteColor }}>💰 Cálculos</h3>
            {totales.esEstimado && (
              <div className="mb-3 px-2 py-1 rounded text-xs bg-stone-100 text-stone-500 italic">
                Precio estimado ({formatNum(getExpedicionPrecioPorDefecto(paq.expedicionId))} €/g) — sin precio fino asignado
              </div>
            )}
            <div className="space-y-2 text-sm font-mono">
              <div className="flex justify-between"><span className="text-stone-500">Fino (peso):</span><span className="text-stone-800 font-medium">{formatNum(totales.finoTotal, 2)} g</span></div>
              {totales.finoTotalCalculo !== totales.finoTotal && (
                <div className="flex justify-between"><span className="text-stone-500">Fino (cálculo €):</span><span style={{ color: clienteColor }} className="font-medium">{formatNum(totales.finoTotalCalculo, 2)} g</span></div>
              )}
              <div className="flex justify-between"><span className="text-stone-500">Base:</span><span className={totales.esEstimado ? 'text-stone-400 font-medium italic' : 'text-stone-800 font-medium'}>{totales.esEstimado ? '~' : ''}{formatNum(totales.base)} €</span></div>
              <div className="flex justify-between"><span className="text-stone-500">Descuento ({paq.descuento}%):</span><span className="text-red-600 font-medium">-{formatNum(totales.descuento)} €</span></div>
              <div className="flex justify-between pt-2" style={{ borderTop: `1px solid ${clienteColor}30` }}><span className="text-stone-500">Base cliente:</span><span className={totales.esEstimado ? 'text-stone-400 font-medium italic' : 'text-stone-800 font-medium'}>{totales.esEstimado ? '~' : ''}{formatNum(totales.baseCliente)} €</span></div>
              <div className="flex justify-between"><span className="text-stone-500">IGI ({paq.igi}%):</span><span className="text-stone-800 font-medium">+{formatNum(totales.igi)} €</span></div>
              <div className="flex justify-between pt-2 text-base" style={{ borderTop: `1px solid ${clienteColor}30` }}><span className="font-bold" style={{ color: totales.esEstimado ? '#9ca3af' : clienteColor }}>{totales.esEstimado ? '~' : ''}Total Fra (cl):</span><span className="font-bold" style={{ color: totales.esEstimado ? '#9ca3af' : clienteColor }}>{totales.esEstimado ? '~' : ''}{formatNum(totales.totalFra)} €</span></div>
              <div className="flex justify-between mt-4 pt-2" style={{ borderTop: `1px solid ${clienteColor}30` }}><span className="text-stone-500">Fra a Jofisa:</span><span className="text-stone-800 font-medium">{formatNum(totales.fraJofisa)} €</span></div>
              <div className="flex justify-between"><span className="text-stone-500">Margen:</span><span className={totales.margen >= 0 ? 'text-green-600 font-medium' : 'text-red-600 font-medium'}>{formatNum(totales.margen, 0)} €</span></div>
            </div>
          </Card>
          
          <button 
            className="w-full py-2 px-4 rounded-lg font-medium transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            style={{ 
              backgroundColor: clienteColor + '15', 
              color: clienteColor, 
              border: `1px solid ${clienteColor}40` 
            }}
            disabled={!paq.precioFino}
            title={!paq.precioFino ? "Primero debes cerrar el paquete con un precio fino" : ""}
            onClick={() => {
              setTextModalContent(generarTexto(paq));
              setShowTextModal(true);
            }}
          >
            📋 Generar Texto
          </button>
          
          <Card style={{ backgroundColor: clienteColor + '10', borderColor: clienteColor + '40' }}>
            <h3 className="font-semibold mb-3" style={{ color: clienteColor }}>📄 Factura</h3>
            {paq.factura ? (
              <div className="space-y-2">
                <div className="bg-white/50 rounded-lg p-3 flex items-center gap-3" style={{ border: `1px solid ${clienteColor}30` }}>
                  <span className="text-2xl">{paq.factura.tipo?.startsWith('image/') ? '🖼️' : '📎'}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-stone-800 font-medium truncate">{paq.factura.nombre}</p>
                    <p className="text-stone-500 text-xs">{paq.factura.tipo?.startsWith('image/') ? 'Imagen' : 'PDF'}</p>
                  </div>
                  <Button size="sm" onClick={() => setShowFacturaViewer(true)}>Ver</Button>
                </div>
                {showFacturaViewer && (
                  <div className="fixed inset-0 bg-black/90 z-50 flex flex-col" onClick={() => setShowFacturaViewer(false)}>
                    <div className="flex justify-between items-center p-3 bg-black/50">
                      <span className="text-white text-sm truncate">{paq.factura.nombre}</span>
                      <button onClick={() => setShowFacturaViewer(false)} className="text-white text-2xl font-bold px-3 hover:text-red-400">✕</button>
                    </div>
                    <div className="flex-1 overflow-auto p-2" onClick={e => e.stopPropagation()}>
                      {paq.factura.tipo?.startsWith('image/') ? (
                        <img src={paq.factura.data} alt="Factura" className="w-full h-auto" />
                      ) : (
                        <iframe src={paq.factura.data} className="w-full h-full min-h-[80vh]" style={{ border: 'none' }} />
                      )}
                    </div>
                  </div>
                )}
                
                {/* Resultado de verificación guardado */}
                {paq.verificacionIA && paq.verificacionIA.archivoNombre === paq.factura.nombre && (
                  <div className={`rounded-lg p-3 ${
                    paq.verificacionIA.validado
                      ? 'bg-green-50 border border-green-200'
                      : 'bg-amber-50 border border-amber-200'
                  }`}>
                    <div className="flex justify-between items-center mb-2">
                      <span className="text-stone-600 text-sm font-medium">🤖 Verificación IA</span>
                      <span className="text-stone-400 text-xs">
                        {new Date(paq.verificacionIA.fecha).toLocaleDateString('es-ES')}
                      </span>
                    </div>
                    <div className="space-y-1 text-sm">
                      <div className="flex justify-between">
                        <span className="text-stone-500">Total factura:</span>
                        <span className="text-stone-800 font-mono font-medium">{formatNum(paq.verificacionIA.totalFactura)} €</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-stone-500">Total paquete:</span>
                        <span className="text-stone-800 font-mono font-medium">{formatNum(paq.verificacionIA.totalPaquete)} €</span>
                      </div>
                      {(() => {
                        const dif = paq.verificacionIA.diferencia;
                        const difDisplay = -dif; // positivo = a favor nuestro (paq > fra)
                        return (
                          <div className="flex justify-between border-t border-current/10 pt-1 mt-1">
                            <span className="font-medium">Diferencia:</span>
                            <span className={`font-mono font-bold ${
                              Math.abs(dif) < 0.5
                                ? 'text-stone-500'
                                : difDisplay > 0 ? 'text-green-600' : 'text-red-600'
                            }`}>
                              {difDisplay > 0 ? '+' : ''}{formatNum(difDisplay)} €
                              {Math.abs(dif) >= 0.5 && <span className="text-xs font-normal ml-1">{difDisplay > 0 ? '(a favor)' : '(en contra)'}</span>}
                            </span>
                          </div>
                        );
                      })()}
                      {/* Verificación de pesos */}
                      {paq.verificacionIA.pesosCuadran !== undefined && paq.verificacionIA.pesosCuadran !== null && (
                        <div className={`flex justify-between border-t border-current/10 pt-1 mt-1`}>
                          <span className="font-medium">Pesos:</span>
                          <span className={`font-bold ${paq.verificacionIA.pesosCuadran ? 'text-green-600' : 'text-orange-600'}`}>
                            {paq.verificacionIA.pesosCuadran ? '✓ Cuadran' : '⚠ Discrepancia'}
                          </span>
                        </div>
                      )}
                      {paq.verificacionIA.observaciones && (
                        <div className="bg-white/60 rounded p-2 mt-1">
                          <span className="text-stone-500 text-xs">Obs: </span>
                          <span className="text-stone-700 text-xs">{paq.verificacionIA.observaciones}</span>
                        </div>
                      )}
                      {paq.verificacionIA.pesos && paq.verificacionIA.pesos.length > 0 && (
                        <details className="mt-1">
                          <summary className="text-stone-400 text-xs cursor-pointer hover:text-stone-600">Ver pesos extraídos</summary>
                          <div className="mt-1 space-y-0.5">
                            {paq.verificacionIA.pesos.map((p, i) => (
                              <div key={i} className="flex justify-between text-xs text-stone-500">
                                <span>{p.bruto}g</span>
                                {p.ley && <span>ley {p.ley}</span>}
                              </div>
                            ))}
                          </div>
                        </details>
                      )}
                    </div>
                    
                    {/* Validación manual */}
                    {paq.verificacionIA.validado ? (
                      <div className="mt-3 pt-2 border-t border-green-200">
                        <p className="text-green-700 text-sm font-medium">✅ Verificado y validado</p>
                        <p className="text-green-600 text-xs">
                          {new Date(paq.verificacionIA.fechaValidacion).toLocaleDateString('es-ES')}
                        </p>
                      </div>
                    ) : (
                      <div className="mt-3 pt-2 border-t border-amber-200">
                        <p className="text-amber-700 text-xs mb-2">⚠️ Revisa la diferencia y confirma</p>
                        <Button 
                          size="sm" 
                          className="w-full"
                          onClick={() => validarVerificacion(paq.id)}
                        >
                          ✓ Validar diferencia correcta
                        </Button>
                      </div>
                    )}
                  </div>
                )}
                
                {/* Botón verificar con IA (solo si archivo es nuevo/diferente) */}
                {(paq.factura.tipo?.startsWith('image/') || paq.factura.tipo === 'application/pdf') && 
                 (!paq.verificacionIA || paq.verificacionIA.archivoNombre !== paq.factura.nombre) && (
                  <Button 
                    variant="secondary" 
                    className="w-full"
                    onClick={() => verificarFacturaConIA(paq)}
                    disabled={verificandoFactura}
                    disabledReason="Verificación en progreso..."
                  >
                    {verificandoFactura ? '⏳ Analizando...' : '🔍 Verificar con IA'}
                  </Button>
                )}
                
                <Button 
                  variant="danger" 
                  size="sm" 
                  className="w-full"
                  onClick={() => {
                    updatePaqueteFactura(paq.id, null);
                    updatePaqueteVerificacion(paq.id, null);
                  }}
                >
                  🗑️ Eliminar factura
                </Button>
              </div>
            ) : (
              <div>
                <label className="block w-full cursor-pointer">
                  <div 
                    className="border-2 border-dashed rounded-lg p-6 text-center transition-colors"
                    style={{ borderColor: clienteColor + '50' }}
                  >
                    <span className="text-3xl block mb-2">📤</span>
                    <span style={{ color: clienteColor }}>Subir imagen o PDF</span>
                    <p className="text-stone-400 text-xs mt-1">Toca para seleccionar archivo</p>
                  </div>
                  <input 
                    type="file" 
                    accept="image/*,.pdf"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) {
                        const reader = new FileReader();
                        reader.onload = (ev) => {
                          updatePaqueteFactura(paq.id, {
                            nombre: file.name,
                            tipo: file.type,
                            data: ev.target.result
                          });
                        };
                        reader.readAsDataURL(file);
                      }
                    }}
                  />
                </label>
              </div>
            )}
          </Card>
          
          {/* Botón de Logs */}
          <button 
            className="w-full py-2 px-4 rounded-lg font-medium transition-all"
            style={{ 
              backgroundColor: clienteColor + '15', 
              color: clienteColor, 
              border: `1px solid ${clienteColor}40` 
            }}
            onClick={() => setShowLogsModal(true)}
          >
            📋 Ver Logs ({paq.logs?.length || 0})
          </button>
          
          <div className="flex gap-2">
            <button 
              className="flex-1 py-2 px-4 rounded-lg font-medium transition-all"
              style={{ 
                backgroundColor: clienteColor + '15', 
                color: clienteColor, 
                border: `1px solid ${clienteColor}40` 
              }}
              onClick={() => openModal('paquete', paq)}
            >Editar datos</button>
            <Button variant="danger" className="flex-1" onClick={() => { handleDeletePaquete(paq.id); setSelectedPaquete(null); }}>Eliminar</Button>
          </div>
          
          {/* Modal de Logs */}
          {showLogsModal && (
            <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => setShowLogsModal(false)}>
              <div className="bg-white border border-amber-300 rounded-2xl p-6 w-full max-w-lg max-h-[80vh] shadow-xl flex flex-col" onClick={e => e.stopPropagation()}>
                <h3 className="text-xl font-bold text-amber-800 mb-4">📋 Historial de cambios - {paq.nombre}</h3>
                
                <div className="flex-1 overflow-y-auto space-y-2">
                  {(paq.logs || []).slice().reverse().map(log => {
                    const usuario = getUsuario(log.usuario);
                    const textoAccion = {
                      'crear_paquete': 'Creó el paquete',
                      'editar_datos': 'Editó datos',
                      'añadir_linea': `Añadió línea: ${log.detalles?.bruto}g × ${log.detalles?.ley}`,
                      'eliminar_linea': `Eliminó línea: ${log.detalles?.bruto}g × ${log.detalles?.ley}`,
                      'actualizar_cierre': (() => {
                        const d = log.detalles;
                        const cambios = [];
                        if (d?.precioFino?.antes !== d?.precioFino?.despues) {
                          cambios.push(`precio fino: ${formatNum(d?.precioFino?.antes)} → ${formatNum(d?.precioFino?.despues)}`);
                        }
                        if (d?.cierreJofisa?.antes !== d?.cierreJofisa?.despues) {
                          cambios.push(`cierre Jofisa: ${formatNum(d?.cierreJofisa?.antes)} → ${formatNum(d?.cierreJofisa?.despues)}`);
                        }
                        return cambios.length > 0 ? `Modificó ${cambios.join(', ')}` : 'Actualizó cierre';
                      })(),
                      'subir_factura': `Subió factura: ${log.detalles?.nombre}`,
                      'eliminar_factura': 'Eliminó factura',
                      'verificar_ia': `Verificó con IA (dif: ${formatNum(log.detalles?.diferencia)} €)`,
                      'validar_verificacion': 'Validó la verificación',
                      'cambiar_estado': `Cambió estado: ${log.detalles?.antes} → ${log.detalles?.despues}`,
                      'añadir_comentario': `Comentó: "${log.detalles?.texto}"`,
                      'eliminar_comentario': `Eliminó comentario: "${log.detalles?.texto}"`
                    }[log.accion] || log.accion;
                    
                    return (
                      <div key={log.id} className="bg-amber-50 border border-amber-200 rounded-lg p-3">
                        <div className="flex justify-between items-start mb-1">
                          <span className="font-medium text-stone-700">{usuario?.nombre || log.usuario}</span>
                          <span className="text-stone-400 text-xs">{tiempoRelativo(log.fecha)}</span>
                        </div>
                        <p className="text-stone-700 text-sm">{textoAccion}</p>
                        {log.accion === 'editar_datos' && log.detalles?.cambios && (
                          <ul className="mt-1 text-xs text-stone-500">
                            {log.detalles.cambios.map((c, i) => <li key={i}>• {c}</li>)}
                          </ul>
                        )}
                      </div>
                    );
                  })}
                  {(!paq.logs || paq.logs.length === 0) && (
                    <p className="text-stone-400 text-center py-8">No hay registros</p>
                  )}
                </div>
                
                <Button className="w-full mt-4" onClick={() => setShowLogsModal(false)}>Cerrar</Button>
              </div>
            </div>
          )}
        </div>
      );
    }
    
    // Vista detalle de expedición
    if (selectedExpedicion) {
      const exp = expediciones.find(e => e.id === selectedExpedicion);
      const totales = calcularTotalesExpedicion(selectedExpedicion);
      const expedicionPaquetes = paquetes.filter(p => p.expedicionId === selectedExpedicion);
      
      return (
        <div className="space-y-4">
          <Card>
            <h3 className="text-amber-600 font-semibold mb-3">📊 Totales</h3>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <span className="text-stone-500">Bruto Total</span>
                <p className="text-stone-800 font-mono font-medium">{formatNum(totales.sumaBruto)} g</p>
              </div>
              <div>
                <span className="text-stone-500">Fino Total</span>
                <p className="text-stone-800 font-mono font-medium">{formatNum(totales.sumaFino)} g</p>
              </div>
              <div>
                <span className="text-stone-500">Total Fra</span>
                <p className="text-stone-800 font-mono font-medium">{formatNum(totales.totalFra)} €</p>
                {totales.totalFraEstimado > 0 && (
                  <p className="text-stone-400 text-xs italic font-mono">~{formatNum(totales.totalFraEstimado)} € estimado</p>
                )}
              </div>
              <div>
                <span className="text-stone-500">Fra Jofisa</span>
                <p className="text-stone-800 font-mono font-medium">{formatNum(totales.totalFraJofisa)} €</p>
              </div>
              <div>
                {(() => {
                  const res = exp?.resultados || {};
                  const precio = parseFloat(res.precioFinoSobra) || 0;
                  const clientesRes = res.clientes || {};
                  let euroSobraTotal = 0;
                  let faltaDatos = false;
                  Object.entries(totales.porCliente).forEach(([cId]) => {
                    const cr = clientesRes[cId] || {};
                    const sobraNeto = (cr.finoSobra || 0) - (cr.gramosDevueltos || 0);
                    euroSobraTotal += sobraNeto * precio;
                    if (!cr.finoSobra && cr.finoSobra !== 0) faltaDatos = true;
                  });
                  if (!precio) faltaDatos = true;
                  const tieneEnJofisa = expedicionPaquetes.some(p => p.estado === 'en_jofisa');
                  const mgTotal = totales.totalMargen + euroSobraTotal;
                  return (
                    <>
                      <span className="text-stone-500 flex items-center gap-1">
                        Resultados
                        <button onClick={() => setShowResultadosModal(true)} className="text-amber-500 hover:text-amber-700 text-base">🔍</button>
                        {faltaDatos && tieneEnJofisa && <span className="text-red-500 text-xs font-bold">!</span>}
                      </span>
                      <p className={`font-mono text-xs ${totales.totalMargen >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                        {formatNum(totales.totalMargen, 0)}{euroSobraTotal !== 0 ? ` + ${formatNum(euroSobraTotal, 0)}` : ''} = <span className="font-medium text-sm">{formatNum(mgTotal, 0)}€</span>
                      </p>
                    </>
                  );
                })()}
              </div>
              <div>
                <span className="text-stone-500">€/g Bruto Medio</span>
                <p className="text-stone-800 font-mono font-medium">{formatNum(totales.precioMedioBruto)} €</p>
              </div>
            </div>
          </Card>

          {/* Barra de seguro */}
          {exp.seguro > 0 && (() => {
              const pct = (totales.totalFraJofisa / exp.seguro) * 100;
              const over = pct > 100;
              const maxPct = over ? pct : 100;
              const barPct = (pct / maxPct) * 100;
              const markPct = over ? (100 / pct) * 100 : null;
              return (
                <div className="bg-white rounded-xl p-3 border border-stone-200">
                  <div className="flex justify-between items-center text-xs mb-1">
                    <span className="text-stone-500">Seguro</span>
                    <span className="text-stone-600 font-mono">{formatNum(totales.totalFraJofisa)} / {formatNum(exp.seguro)} €</span>
                  </div>
                  <div className="relative w-full h-5">
                    <div className="absolute top-1 w-full bg-stone-200 rounded-full h-3 overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all ${
                          pct > 90 ? 'bg-red-500' : pct > 70 ? 'bg-amber-500' : 'bg-green-500'
                        }`}
                        style={{ width: `${Math.min(100, barPct)}%` }}
                      />
                    </div>
                    {markPct && (
                      <div className="absolute top-0 w-0.5 h-full bg-stone-800 rounded" style={{ left: `${markPct}%` }} title="Límite seguro" />
                    )}
                  </div>
                  <p className="text-right text-xs text-stone-400 mt-1">{formatNum(pct, 1)}%</p>
                </div>
              );
            })()}

          {/* Resumen por categoría - solo visible en vista por categoría */}
          {ordenVista === 'categoria' && Object.keys(totales.porCategoria).length > 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-3">
              <h4 className="text-amber-700 font-semibold text-sm mb-2">📊 Resumen por Categoría</h4>
              <div className="space-y-1.5">
                {Object.entries(totales.porCategoria)
                  .sort((a, b) => b[1].bruto - a[1].bruto)
                  .map(([catNombre, vals]) => {
                    const cat = categorias.find(c => c.nombre === catNombre);
                    return (
                      <div key={catNombre} className="flex items-center justify-between text-sm">
                        <div className="flex items-center gap-2">
                          <span className="text-stone-700">{catNombre}</span>
                          {cat?.esFino && (
                            <span className="bg-amber-200 text-amber-800 text-xs px-1.5 py-0.5 rounded font-medium">FINO</span>
                          )}
                        </div>
                        <div className="flex items-center gap-3 font-mono text-xs">
                          <span className="text-stone-600">{formatNum(vals.bruto)}g</span>
                          <span className="text-amber-600 font-semibold">{formatNum(vals.precioMedioBruto)} €/g</span>
                        </div>
                      </div>
                    );
                  })}
              </div>
            </div>
          )}

          <div className="flex justify-between items-center">
            <h3 className="text-amber-600 font-semibold">📦 Paquetes ({expedicionPaquetes.length})</h3>
            <Button size="sm" onClick={() => openModal('paquete', null)}>+ Nuevo</Button>
          </div>
          
          {/* Marcar todos como — solo visible en vista por estado */}
          {ordenVista === 'estado' && (
          <div className="flex items-center gap-2 bg-stone-100 rounded-lg p-2">
            <span className="text-stone-600 text-sm">Marcar todos como:</span>
            <select
              value=""
              onChange={(e) => {
                if (e.target.value) {
                  setMarcarTodosModal({ open: true, estadoId: e.target.value });
                }
              }}
              className="flex-1 bg-white border border-stone-300 rounded-lg px-2 py-1 text-sm text-stone-800 focus:outline-none focus:border-amber-500"
            >
              <option value="">Seleccionar estado...</option>
              {estadosPaquete.map(estado => (
                <option key={estado.id} value={estado.id}>{estado.icon} {estado.nombre}</option>
              ))}
            </select>
          </div>
          )}
          
          {/* Modal de confirmación */}
          {marcarTodosModal.open && (
            <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => setMarcarTodosModal({ open: false, estadoId: null })}>
              <div className="bg-white rounded-2xl p-6 w-full max-w-sm shadow-xl" onClick={e => e.stopPropagation()}>
                <h3 className="text-lg font-bold text-stone-800 mb-3">⚠️ Confirmar cambio masivo</h3>
                <p className="text-stone-600 mb-4">
                  ¿Estás seguro de que quieres marcar los <strong>{expedicionPaquetes.length} paquetes</strong> de esta expedición como <strong>"{estadosPaquete.find(e => e.id === marcarTodosModal.estadoId)?.nombre}"</strong>?
                </p>
                <div className="flex gap-2">
                  <Button 
                    variant="secondary" 
                    className="flex-1" 
                    onClick={() => setMarcarTodosModal({ open: false, estadoId: null })}
                  >Cancelar</Button>
                  <Button 
                    className="flex-1"
                    onClick={() => marcarTodosComoEstado(selectedExpedicion, marcarTodosModal.estadoId)}
                  >Confirmar</Button>
                </div>
              </div>
            </div>
          )}
          
          <div className="space-y-2">
            {(() => {
              const basePaquetes = ordenVista === 'pendientes'
                ? expedicionPaquetes.filter(p => !p.precioFino || !p.factura || !(p.verificacionIA?.validado && p.verificacionIA?.archivoNombre === p.factura?.nombre))
                : expedicionPaquetes;
              const sortedPaquetes = [...basePaquetes].sort((a, b) => {
                if (ordenVista === 'cliente') {
                  const clienteA = getCliente(a.clienteId)?.nombre || '';
                  const clienteB = getCliente(b.clienteId)?.nombre || '';
                  if (clienteA !== clienteB) return clienteA.localeCompare(clienteB);
                } else if (ordenVista === 'estado') {
                  const estadoOrden = ['por_recoger', 'en_banco', 'en_casa'];
                  const getOrden = (estadoId) => {
                    const idx = estadoOrden.indexOf(estadoId);
                    return idx >= 0 ? idx : 100 + estadosPaquete.findIndex(e => e.id === estadoId);
                  };
                  const indexA = getOrden(a.estado);
                  const indexB = getOrden(b.estado);
                  if (indexA !== indexB) return indexA - indexB;
                } else if (ordenVista === 'categoria') {
                  const catA = getCategoria(a.categoriaId)?.nombre || '';
                  const catB = getCategoria(b.categoriaId)?.nombre || '';
                  if (catA !== catB) return catA.localeCompare(catB);
                }
                return b.numero - a.numero;
              });

              const expPrecioPorDefecto = getExpedicionPrecioPorDefecto(selectedExpedicion);

              // Pre-calcular suma de bruto por cliente
              const brutoPorCliente = {};
              expedicionPaquetes.forEach(paq => {
                const totales = calcularTotalesPaquete(paq, expPrecioPorDefecto);
                if (!brutoPorCliente[paq.clienteId]) {
                  brutoPorCliente[paq.clienteId] = 0;
                }
                brutoPorCliente[paq.clienteId] += totales.brutoTotal;
              });

              // Pre-calcular suma de bruto por categoría
              const brutoPorCategoria = {};
              expedicionPaquetes.forEach(paq => {
                const totales = calcularTotalesPaquete(paq, expPrecioPorDefecto);
                if (!brutoPorCategoria[paq.categoriaId]) {
                  brutoPorCategoria[paq.categoriaId] = 0;
                }
                brutoPorCategoria[paq.categoriaId] += totales.brutoTotal;
              });

              // Pre-calcular suma de bruto por estado
              const brutoPorEstado = {};
              expedicionPaquetes.forEach(paq => {
                const totales = calcularTotalesPaquete(paq, expPrecioPorDefecto);
                if (!brutoPorEstado[paq.estado]) {
                  brutoPorEstado[paq.estado] = 0;
                }
                brutoPorEstado[paq.estado] += totales.brutoTotal;
              });
              
              let lastClienteId = null;
              let lastEstadoId = null;
              let lastCategoriaId = null;
              
              return sortedPaquetes.map(paq => {
                const paqTotales = calcularTotalesPaquete(paq, expPrecioPorDefecto);
                const cliente = getCliente(paq.clienteId);
                const categoria = getCategoria(paq.categoriaId);
                const tieneVerificacion = paq.verificacionIA && paq.factura && paq.verificacionIA.archivoNombre === paq.factura.nombre;
                const validado = tieneVerificacion && paq.verificacionIA.validado;
                const ultimaMod = paq.ultimaModificacion;
                const usuarioMod = ultimaMod ? getUsuario(ultimaMod.usuario) : null;
                const estadoPaq = estadosPaquete.find(e => e.id === paq.estado);
                
                // Header de cliente cuando cambia
                const showClienteHeader = ordenVista === 'cliente' && paq.clienteId !== lastClienteId;
                const clienteBrutoTotal = brutoPorCliente[paq.clienteId] || 0;
                lastClienteId = paq.clienteId;
                
                // Header de estado cuando cambia
                const showEstadoHeader = ordenVista === 'estado' && paq.estado !== lastEstadoId;
                lastEstadoId = paq.estado;
                
                // Header de categoría cuando cambia
                const showCategoriaHeader = ordenVista === 'categoria' && paq.categoriaId !== lastCategoriaId;
                const categoriaBrutoTotal = brutoPorCategoria[paq.categoriaId] || 0;
                lastCategoriaId = paq.categoriaId;
                
                return (
                  <React.Fragment key={paq.id}>
                    {showClienteHeader && (
                      <div 
                        className="flex items-center gap-2 pt-3 pb-1 mt-2 border-t-2"
                        style={{ borderColor: cliente?.color || '#f59e0b' }}
                      >
                        <div 
                          className="w-3 h-3 rounded-full"
                          style={{ backgroundColor: cliente?.color || '#f59e0b' }}
                        />
                        <span className="font-bold text-stone-700 flex-1">{cliente?.nombre}</span>
                        {cliente?.abreviacion && (
                          <span 
                            className="text-xs px-1.5 py-0.5 rounded font-mono font-bold"
                            style={{ backgroundColor: (cliente?.color || '#f59e0b') + '20', color: cliente?.color || '#f59e0b' }}
                          >{cliente.abreviacion}</span>
                        )}
                        <span 
                          className="text-sm font-mono font-bold"
                          style={{ color: cliente?.color || '#f59e0b' }}
                        >{formatNum(clienteBrutoTotal)}g</span>
                      </div>
                    )}
                    {showEstadoHeader && (
                      <div
                        className="flex items-center gap-2 pt-3 pb-1 mt-2 border-t-2"
                        style={{ borderColor: estadoPaq?.color || '#9ca3af' }}
                      >
                        <span className="text-lg">{estadoPaq?.icon || '❓'}</span>
                        <span className="font-bold text-stone-700 flex-1">{estadoPaq?.nombre || 'Sin estado'}</span>
                        <span className="text-sm font-mono font-bold" style={{ color: estadoPaq?.color || '#9ca3af' }}>{formatNum(brutoPorEstado[paq.estado] || 0)}g</span>
                      </div>
                    )}
                    {showCategoriaHeader && (
                      <div 
                        className="flex items-center gap-2 pt-3 pb-1 mt-2 border-t-2 border-amber-400"
                      >
                        <span className="text-lg">🏷️</span>
                        <span className="font-bold text-stone-700 flex-1">{categoria?.nombre || 'Sin categoría'}</span>
                        {categoria?.esFino && (
                          <span className="bg-amber-200 text-amber-800 text-xs px-2 py-0.5 rounded font-medium">FINO</span>
                        )}
                        <span className="text-sm font-mono font-bold text-amber-600">{formatNum(categoriaBrutoTotal)}g</span>
                      </div>
                    )}
                    <Card 
                      onClick={() => { setSelectedPaquete(paq.id); window.scrollTo(0, 0); }}
                      style={{ 
                        backgroundColor: cliente?.color ? cliente.color + '10' : undefined, 
                        borderColor: cliente?.color ? cliente.color + '40' : undefined 
                      }}
                    >
                      <div className="flex justify-between items-start">
                        <div className="flex items-start gap-2">
                          {!paq.precioFino ? (
                            <span className="w-3 h-3 rounded-full bg-red-500 inline-block mt-1 flex-shrink-0" title="Sin cerrar" />
                          ) : !paq.factura ? (
                            <span className="w-3 h-3 rounded-full bg-orange-400 inline-block mt-1 flex-shrink-0" title="Sin factura" />
                          ) : validado ? (
                            <span className="text-green-500 text-lg leading-none flex-shrink-0">✓</span>
                          ) : (
                            <span className="w-3 h-3 rounded-full bg-amber-300 inline-block mt-1 flex-shrink-0" title="Pendiente verificar" />
                          )}
                          <div>
                            <div className="flex items-center gap-2">
                              {cliente?.abreviacion && (
                                <span 
                                  className="text-xs px-1.5 py-0.5 rounded font-bold"
                                  style={{ backgroundColor: cliente.color + '20', color: cliente.color }}
                                >{cliente.abreviacion}</span>
                              )}
                              <p className="text-stone-800 font-semibold">{paq.nombre}</p>
                              {estadoPaq && (
                                <span 
                                  className="text-xs px-2 py-0.5 rounded-full font-medium"
                                  style={{ backgroundColor: estadoPaq.color + '20', color: estadoPaq.color }}
                                >
                                  {estadoPaq.icon} {estadoPaq.nombre}
                                </span>
                              )}
                            </div>
                            <p className="text-stone-500 text-xs">{cliente?.nombre} • {categoria?.nombre}</p>
                            {ultimaMod && (
                              <p className="text-stone-400 text-xs mt-1">
                                <span className="text-stone-600">{usuarioMod?.nombre}</span> • {tiempoRelativo(ultimaMod.fecha)}
                              </p>
                            )}
                          </div>
                        </div>
                        <div className="text-right">
                          <p className={`font-mono text-sm font-medium ${paqTotales.esEstimado ? 'text-stone-400 italic' : 'text-amber-700'}`}>
                            {paqTotales.esEstimado ? '~' : ''}{formatNum(paqTotales.totalFra)} €
                          </p>
                          <p className="text-stone-500 text-xs">{formatNum(paqTotales.brutoTotal)}g bruto</p>
                        </div>
                      </div>
                    </Card>
                  </React.Fragment>
                );
              });
            })()}
            {expedicionPaquetes.length === 0 && (
              <p className="text-stone-400 text-center py-8">No hay paquetes. Crea uno nuevo.</p>
            )}
          </div>
        </div>
      );
    }
    
    return (
      <div className="space-y-4">
        <div className="flex justify-between items-center">
          <h2 className="text-xl font-bold text-amber-800">Expediciones</h2>
          <Button onClick={() => openModal('expedicion')}>+ Nueva</Button>
        </div>
        
        <div className="space-y-3">
          {[...expediciones].sort((a, b) => {
            if (a.id === expedicionActualId) return -1;
            if (b.id === expedicionActualId) return 1;
            return sortExpDescending(a, b);
          }).map(exp => {
            const totales = calcularTotalesExpedicion(exp.id);
            const esActual = exp.id === expedicionActualId;
            const precioRef = getPrecioRefExpedicion(exp.id);
            const expPaqs = paquetes.filter(p => p.expedicionId === exp.id);
            const expNum = getExpNum(exp.nombre);
            const showBadges = expNum > 52;
            const sinCerrar = showBadges ? expPaqs.filter(p => !p.precioFino).length : 0;
            const sinFactura = showBadges ? expPaqs.filter(p => p.precioFino && !p.factura).length : 0;
            const sinVerificar = showBadges ? expPaqs.filter(p => p.precioFino && p.factura && !(p.verificacionIA?.validado && p.verificacionIA?.archivoNombre === p.factura?.nombre)).length : 0;
            // Check if logistics pending (has export date but missing fields)
            const logisticaPendiente = exp.fechaExportacion && (!exp.matriculaId || !exp.bultos || !exp.horaExportacion);
            return (
              <Card key={exp.id} onClick={() => setSelectedExpedicion(exp.id)} className={esActual ? 'ring-2 ring-amber-400' : ''}>
                <div className="flex justify-between items-start">
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="text-stone-800 font-bold text-lg">{exp.nombre} {esActual && <span className="text-amber-500">★</span>}</h3>
                      <div className="flex gap-1">
                        {logisticaPendiente && (
                          <span className="bg-orange-500 text-white text-xs font-bold rounded-full px-1.5 h-5 flex items-center justify-center" title="Logística pendiente">🚗</span>
                        )}
                        {sinCerrar > 0 && (
                          <span className="bg-red-500 text-white text-xs font-bold rounded-full w-5 h-5 flex items-center justify-center">{sinCerrar}</span>
                        )}
                        {sinFactura > 0 && (
                          <span className="bg-orange-400 text-white text-xs font-bold rounded-full w-5 h-5 flex items-center justify-center">{sinFactura}</span>
                        )}
                        {sinVerificar > 0 && (
                          <span className="bg-amber-300 text-white text-xs font-bold rounded-full w-5 h-5 flex items-center justify-center">{sinVerificar}</span>
                        )}
                      </div>
                    </div>
                    <p className="text-stone-500 text-sm">
                      {precioRef ? `Último precio: ${formatNum(precioRef)} €/g` : 'Sin precios aún'}
                    </p>
                    {exp.fechaExportacion && (
                      <p className="text-stone-400 text-xs">📅 {new Date(exp.fechaExportacion).toLocaleDateString('es-ES')}</p>
                    )}
                    <p className="text-stone-400 text-xs mt-1">{totales.numPaquetes} paquetes</p>
                  </div>
                  <div className="text-right">
                    <p className="text-amber-600 font-mono font-bold">{formatNum(totales.totalFra)} €</p>
                    <p className="text-stone-500 text-xs">{formatNum(totales.sumaFino)}g fino</p>
                  </div>
                </div>
                <div className="flex gap-2 mt-3">
                  <Button size="sm" variant="secondary" onClick={(e) => { e.stopPropagation(); openModal('expedicion', exp); }}>Editar</Button>
                  <Button size="sm" variant="danger" onClick={(e) => { e.stopPropagation(); handleDeleteExpedicion(exp.id); }}>Eliminar</Button>
                </div>
                {exp.seguro > 0 && (() => {
                  const pct = (totales.totalFraJofisa / exp.seguro) * 100;
                  const over = pct > 100;
                  const barPct = over ? 100 : pct;
                  const markPct = over ? (100 / pct) * 100 : null;
                  return (
                    <div className="mt-3 pt-2 border-t border-stone-200">
                      <div className="flex justify-between items-center text-xs mb-1">
                        <span className="text-stone-400">Seguro</span>
                        <span className="text-stone-500 font-mono">{formatNum(pct, 1)}%</span>
                      </div>
                      <div className="relative w-full h-4">
                        <div className="absolute top-1 w-full bg-stone-200 rounded-full h-2 overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all ${
                              pct > 90 ? 'bg-red-500' : pct > 70 ? 'bg-amber-500' : 'bg-green-500'
                            }`}
                            style={{ width: `${barPct}%` }}
                          />
                        </div>
                        {markPct && (
                          <div className="absolute top-0 w-0.5 h-full bg-stone-800 rounded" style={{ left: `${markPct}%` }} />
                        )}
                      </div>
                    </div>
                  );
                })()}
              </Card>
            );
          })}
          {expediciones.length === 0 && (
            <p className="text-stone-400 text-center py-8">No hay expediciones. Crea una nueva.</p>
          )}
        </div>
      </div>
    );
  };

  // Clientes Tab
  const ClientesTab = () => {
    const [editingKilatajes, setEditingKilatajes] = useState(null);
    const [newKilataje, setNewKilataje] = useState({ nombre: '', ley: '' });
    const [editingDatosFiscales, setEditingDatosFiscales] = useState(null);
    const [datosFiscalesForm, setDatosFiscalesForm] = useState({
      razonSocial: '', direccion: '', codigoPostal: '', ciudad: '', pais: '', nrt: ''
    });

    const startEditDatosFiscales = (cliente) => {
      setEditingDatosFiscales(cliente.id);
      setDatosFiscalesForm({
        razonSocial: cliente.razonSocial || '',
        direccion: cliente.direccion || '',
        codigoPostal: cliente.codigoPostal || '',
        ciudad: cliente.ciudad || '',
        pais: cliente.pais || '',
        nrt: cliente.nrt || '',
      });
    };

    const saveDatosFiscales = async (clienteId) => {
      await updateClienteDatosFiscales(clienteId, datosFiscalesForm);
      setEditingDatosFiscales(null);
    };

    return (
      <div className="space-y-4">
        <div className="flex justify-between items-center">
          <h2 className="text-xl font-bold text-amber-800">Clientes</h2>
          <Button onClick={() => openModal('cliente')}>+ Nuevo</Button>
        </div>
        
        <div className="space-y-3">
          {clientes.map(cliente => (
            <Card 
              key={cliente.id}
              style={{ 
                backgroundColor: (cliente.color || '#f59e0b') + '10',
                borderColor: (cliente.color || '#f59e0b') + '40'
              }}
            >
              <div className="flex justify-between items-start mb-3">
                <div className="flex items-center gap-2">
                  <div 
                    className="w-4 h-4 rounded-full flex-shrink-0"
                    style={{ backgroundColor: cliente.color || '#f59e0b' }}
                  />
                  <h3 className="text-stone-800 font-bold">{cliente.nombre}</h3>
                  {cliente.abreviacion && (
                    <span 
                      className="text-xs px-1.5 py-0.5 rounded font-mono font-bold"
                      style={{ backgroundColor: (cliente.color || '#f59e0b') + '20', color: cliente.color || '#f59e0b' }}
                    >{cliente.abreviacion}</span>
                  )}
                </div>
                <div className="flex gap-2">
                  <Button size="sm" variant="secondary" onClick={() => openModal('cliente', cliente)}>Editar</Button>
                  <Button size="sm" variant="danger" onClick={() => handleDeleteCliente(cliente.id)}>×</Button>
                </div>
              </div>
              
              <div className="grid grid-cols-2 gap-2 text-sm mb-3">
                <div><span className="text-stone-500">Dto. Estándar:</span> <span className="text-stone-800 font-medium">{cliente.descuentoEstandar}%</span></div>
                <div><span className="text-stone-500">Dto. Fino:</span> <span className="text-stone-800 font-medium">{cliente.descuentoFino}%</span></div>
              </div>
              {cliente.lineasNegativasNoCuentanPeso && (
                <p className="text-xs text-amber-600 mb-3">⚠️ Líneas negativas no cuentan en peso</p>
              )}
              
              <div 
                className="rounded-lg p-3"
                style={{ backgroundColor: (cliente.color || '#f59e0b') + '10', border: `1px solid ${(cliente.color || '#f59e0b')}30` }}
              >
                <div className="flex justify-between items-center mb-2">
                  <span className="text-sm font-medium" style={{ color: cliente.color || '#f59e0b' }}>Kilatajes</span>
                  <Button size="sm" variant="ghost" onClick={() => setEditingKilatajes(editingKilatajes === cliente.id ? null : cliente.id)}>
                    {editingKilatajes === cliente.id ? 'Cerrar' : 'Editar'}
                  </Button>
                </div>
                <div className="flex flex-wrap gap-2">
                  {cliente.kilatajes?.map(k => (
                    <span 
                      key={k.nombre} 
                      className="bg-white text-xs px-2 py-1 rounded"
                      style={{ color: cliente.color || '#f59e0b', border: `1px solid ${(cliente.color || '#f59e0b')}40` }}
                    >
                      {k.nombre}: {k.ley}
                      {editingKilatajes === cliente.id && (
                        <button 
                          className="ml-1 text-red-500 hover:text-red-700"
                          onClick={() => {
                            updateClienteKilatajes(cliente.id, cliente.kilatajes.filter(kk => kk.nombre !== k.nombre));
                          }}
                        >×</button>
                      )}
                    </span>
                  ))}
                </div>
                {editingKilatajes === cliente.id && (
                  <div className="flex gap-2 mt-2">
                    <input
                      type="text"
                      placeholder="Nombre (14kt)"
                      value={newKilataje.nombre}
                      onChange={(e) => setNewKilataje({ ...newKilataje, nombre: e.target.value })}
                      className="flex-1 bg-white rounded px-2 py-1 text-sm text-stone-800"
                      style={{ border: `1px solid ${(cliente.color || '#f59e0b')}40` }}
                    />
                    <input
                      type="number"
                      placeholder="Ley"
                      value={newKilataje.ley}
                      onChange={(e) => setNewKilataje({ ...newKilataje, ley: e.target.value })}
                      className="w-20 bg-white rounded px-2 py-1 text-sm text-stone-800"
                      style={{ border: `1px solid ${(cliente.color || '#f59e0b')}40` }}
                    />
                    <Button size="sm" onClick={() => {
                      if (newKilataje.nombre && newKilataje.ley) {
                        updateClienteKilatajes(cliente.id, [...(cliente.kilatajes || []), { nombre: newKilataje.nombre, ley: parseFloat(newKilataje.ley) }]);
                        setNewKilataje({ nombre: '', ley: '' });
                      }
                    }}>+</Button>
                  </div>
                )}
              </div>

              {/* Datos Fiscales */}
              <div
                className="rounded-lg p-3 mt-3"
                style={{ backgroundColor: (cliente.color || '#f59e0b') + '10', border: `1px solid ${(cliente.color || '#f59e0b')}30` }}
              >
                <div className="flex justify-between items-center mb-2">
                  <span className="text-sm font-medium" style={{ color: cliente.color || '#f59e0b' }}>Datos Fiscales</span>
                  <Button size="sm" variant="ghost" onClick={() => editingDatosFiscales === cliente.id ? setEditingDatosFiscales(null) : startEditDatosFiscales(cliente)}>
                    {editingDatosFiscales === cliente.id ? 'Cerrar' : (cliente.nrt ? 'Editar' : 'Añadir')}
                  </Button>
                </div>

                {editingDatosFiscales === cliente.id ? (
                  <div className="space-y-2">
                    <input
                      type="text"
                      placeholder="Razón Social"
                      value={datosFiscalesForm.razonSocial}
                      onChange={(e) => setDatosFiscalesForm({ ...datosFiscalesForm, razonSocial: e.target.value })}
                      className="w-full bg-white rounded px-2 py-1 text-sm text-stone-800"
                      style={{ border: `1px solid ${(cliente.color || '#f59e0b')}40` }}
                    />
                    <input
                      type="text"
                      placeholder="Dirección"
                      value={datosFiscalesForm.direccion}
                      onChange={(e) => setDatosFiscalesForm({ ...datosFiscalesForm, direccion: e.target.value })}
                      className="w-full bg-white rounded px-2 py-1 text-sm text-stone-800"
                      style={{ border: `1px solid ${(cliente.color || '#f59e0b')}40` }}
                    />
                    <div className="flex gap-2">
                      <input
                        type="text"
                        placeholder="CP"
                        value={datosFiscalesForm.codigoPostal}
                        onChange={(e) => setDatosFiscalesForm({ ...datosFiscalesForm, codigoPostal: e.target.value })}
                        className="w-24 bg-white rounded px-2 py-1 text-sm text-stone-800"
                        style={{ border: `1px solid ${(cliente.color || '#f59e0b')}40` }}
                      />
                      <input
                        type="text"
                        placeholder="Ciudad"
                        value={datosFiscalesForm.ciudad}
                        onChange={(e) => setDatosFiscalesForm({ ...datosFiscalesForm, ciudad: e.target.value })}
                        className="flex-1 bg-white rounded px-2 py-1 text-sm text-stone-800"
                        style={{ border: `1px solid ${(cliente.color || '#f59e0b')}40` }}
                      />
                    </div>
                    <input
                      type="text"
                      placeholder="País"
                      value={datosFiscalesForm.pais}
                      onChange={(e) => setDatosFiscalesForm({ ...datosFiscalesForm, pais: e.target.value })}
                      className="w-full bg-white rounded px-2 py-1 text-sm text-stone-800"
                      style={{ border: `1px solid ${(cliente.color || '#f59e0b')}40` }}
                    />
                    <input
                      type="text"
                      placeholder="NRT / CIF"
                      value={datosFiscalesForm.nrt}
                      onChange={(e) => setDatosFiscalesForm({ ...datosFiscalesForm, nrt: e.target.value })}
                      className="w-full bg-white rounded px-2 py-1 text-sm text-stone-800"
                      style={{ border: `1px solid ${(cliente.color || '#f59e0b')}40` }}
                    />
                    <Button size="sm" className="w-full" onClick={() => saveDatosFiscales(cliente.id)}>Guardar</Button>
                  </div>
                ) : cliente.nrt ? (
                  <div className="text-xs text-stone-600 space-y-0.5">
                    {cliente.razonSocial && <div className="font-medium">{cliente.razonSocial}</div>}
                    {cliente.direccion && <div>{cliente.direccion}</div>}
                    {(cliente.codigoPostal || cliente.ciudad) && <div>{[cliente.codigoPostal, cliente.ciudad].filter(Boolean).join(' ')}</div>}
                    {cliente.pais && <div>{cliente.pais}</div>}
                    {cliente.nrt && <div className="font-mono mt-1">NRT: {cliente.nrt}</div>}
                  </div>
                ) : (
                  <p className="text-xs text-stone-400">Sin datos fiscales</p>
                )}
              </div>
            </Card>
          ))}
          {clientes.length === 0 && (
            <p className="text-stone-400 text-center py-8">No hay clientes. Crea uno nuevo.</p>
          )}
        </div>
      </div>
    );
  };

  // Matrículas Section (used in ParametrosTab)
  const MatriculasSection = () => {
    const [nuevaMatricula, setNuevaMatricula] = useState('');

    const agregarMatricula = async () => {
      if (!nuevaMatricula.trim()) return;
      try {
        await fagregarMatricula(nuevaMatricula.trim());
        setNuevaMatricula('');
      } catch (e) {
        alert(e.message);
      }
    };

    const eliminarMatricula = async (id) => {
      if (confirm('¿Eliminar esta matrícula?')) {
        await feliminarMatricula(id);
      }
    };

    return (
      <div>
        <h2 className="text-xl font-bold text-amber-800 mb-4">🚗 Matrículas</h2>

        <div className="space-y-2">
          {matriculas.map(m => (
            <Card key={m.id}>
              <div className="flex items-center justify-between">
                <span className="text-stone-800 font-mono font-medium">{m.matricula}</span>
                <button
                  onClick={() => eliminarMatricula(m.id)}
                  className="text-red-400 hover:text-red-600 px-1 text-sm"
                >🗑️</button>
              </div>
            </Card>
          ))}
          {matriculas.length === 0 && (
            <p className="text-stone-400 text-center py-4 text-sm">No hay matrículas registradas.</p>
          )}
        </div>

        <div className="flex gap-2 mt-3">
          <input
            type="text"
            placeholder="Nueva matrícula..."
            value={nuevaMatricula}
            onChange={(e) => setNuevaMatricula(e.target.value.toUpperCase())}
            onKeyDown={(e) => e.key === 'Enter' && nuevaMatricula.trim() && agregarMatricula()}
            className="flex-1 bg-white border border-amber-300 rounded-lg px-3 py-2 text-stone-800 font-mono placeholder-stone-400 focus:outline-none focus:border-amber-500"
          />
          <Button
            onClick={agregarMatricula}
            disabled={!nuevaMatricula.trim()}
          >+ Añadir</Button>
        </div>
      </div>
    );
  };

  // Parámetros Tab (antes Categorías)
  const ParametrosTab = () => {
    const [nuevoNombreUsuario, setNuevoNombreUsuario] = useState('');
    const [editandoUsuarioId, setEditandoUsuarioId] = useState(null);
    const [nombreUsuarioEditado, setNombreUsuarioEditado] = useState('');
    const [editandoEstadoId, setEditandoEstadoId] = useState(null);
    const [estadoEditado, setEstadoEditado] = useState({ nombre: '', icon: '', color: '' });
    const [nuevoEstado, setNuevoEstado] = useState({ nombre: '', icon: '📌', color: '#6b7280' });
    
    const agregarUsuario = async () => {
      if (!nuevoNombreUsuario.trim()) return;
      try {
        await fagregarUsuario(nuevoNombreUsuario.trim());
        setNuevoNombreUsuario('');
      } catch (e) {
        alert(e.message);
      }
    };

    const eliminarUsuario = async (id) => {
      try {
        await feliminarUsuario(id);
      } catch (e) {
        alert(e.message);
      }
    };

    const regenerarCodigo = async (id) => {
      try {
        const nuevoCodigo = await fregenerarCodigoUsuario(id);
        alert(`Nuevo código generado: ${nuevoCodigo}`);
      } catch (e) {
        alert(e.message);
      }
    };

    const guardarEdicionUsuario = async (id) => {
      if (!nombreUsuarioEditado.trim()) return;
      await fguardarEdicionUsuario(id, nombreUsuarioEditado.trim());
      setEditandoUsuarioId(null);
      setNombreUsuarioEditado('');
    };

    const agregarEstado = async () => {
      if (!nuevoEstado.nombre.trim()) return;
      try {
        await fagregarEstado(nuevoEstado);
        setNuevoEstado({ nombre: '', icon: '📌', color: '#6b7280' });
      } catch (e) {
        alert(e.message);
      }
    };

    const eliminarEstado = async (id) => {
      try {
        await feliminarEstado(id);
      } catch (e) {
        alert(e.message);
      }
    };

    const guardarEdicionEstado = async (id) => {
      if (!estadoEditado.nombre.trim()) return;
      await fguardarEdicionEstado(id, estadoEditado);
      setEditandoEstadoId(null);
      setEstadoEditado({ nombre: '', icon: '', color: '' });
    };
    
    return (
      <div className="space-y-6">
        {/* Sección Usuarios - solo visible para alex */}
        {esAlex && (
        <div>
          <h2 className="text-xl font-bold text-amber-800 mb-4">👥 Editar Usuarios</h2>

          <p className="text-stone-500 text-sm mb-4">
            Cada usuario tiene un código único de acceso. Comparte la URL con el código para dar acceso.
          </p>

          <div className="space-y-2">
            {usuarios.map(u => (
              <Card key={u.id} className={u.id === usuarioActivo ? 'ring-2 ring-amber-400' : ''}>
                <div className="flex items-center gap-2">
                  {editandoUsuarioId === u.id ? (
                    <input
                      type="text"
                      value={nombreUsuarioEditado}
                      onChange={(e) => setNombreUsuarioEditado(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && guardarEdicionUsuario(u.id)}
                      className="flex-1 bg-white border border-amber-300 rounded px-2 py-1 text-sm text-stone-800"
                      autoFocus
                    />
                  ) : (
                    <div className="flex-1">
                      <span className="text-stone-800 font-medium">{u.nombre}</span>
                      <div className="flex items-center gap-2 mt-1">
                        <code className="text-xs bg-stone-100 px-2 py-0.5 rounded text-stone-600 font-mono">?{u.codigo}</code>
                        <button
                          onClick={() => {
                            navigator.clipboard.writeText(`${window.location.origin}${window.location.pathname}?${u.codigo}`);
                            alert('URL copiada al portapapeles');
                          }}
                          className="text-xs text-amber-600 hover:text-amber-800"
                        >copiar URL</button>
                      </div>
                    </div>
                  )}
                  {u.id === usuarioActivo && <span className="text-amber-500 text-xs">✓ Tú</span>}
                  <div className="flex gap-1">
                    {editandoUsuarioId === u.id ? (
                      <button onClick={() => guardarEdicionUsuario(u.id)} className="text-green-600 px-2">✓</button>
                    ) : (
                      <>
                        <button
                          onClick={() => regenerarCodigo(u.id)}
                          className="text-blue-600 hover:text-blue-800 px-1 text-sm"
                          title="Regenerar código"
                        >🔄</button>
                        <button onClick={() => { setEditandoUsuarioId(u.id); setNombreUsuarioEditado(u.nombre); }} className="text-amber-600 hover:text-amber-800 px-1 text-sm">✏️</button>
                        {u.id !== 'alex' && (
                          <button onClick={() => eliminarUsuario(u.id)} className="text-red-400 hover:text-red-600 px-1 text-sm">🗑️</button>
                        )}
                      </>
                    )}
                  </div>
                </div>
              </Card>
            ))}
          </div>

          <div className="flex gap-2 mt-3">
            <input
              type="text"
              placeholder="Nuevo usuario..."
              value={nuevoNombreUsuario}
              onChange={(e) => setNuevoNombreUsuario(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && nuevoNombreUsuario.trim() && agregarUsuario()}
              className="flex-1 bg-white border border-amber-300 rounded-lg px-3 py-2 text-stone-800 placeholder-stone-400 focus:outline-none focus:border-amber-500"
            />
            <Button
              onClick={agregarUsuario}
              disabled={!nuevoNombreUsuario.trim()}
              disabledReason="Escribe un nombre"
            >+ Añadir</Button>
          </div>
        </div>
        )}
        
        {/* Separador */}
        <hr className="border-amber-200" />
        
        {/* Sección Estados */}
        <div>
          <h2 className="text-xl font-bold text-amber-800 mb-4">📍 Estados de Paquete</h2>
          
          <div className="space-y-2">
            {estadosPaquete.map(estado => (
              <Card key={estado.id}>
                {editandoEstadoId === estado.id ? (
                  <div className="space-y-2">
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={estadoEditado.icon}
                        onChange={(e) => setEstadoEditado({ ...estadoEditado, icon: e.target.value })}
                        placeholder="Emoji"
                        className="w-16 bg-white border border-amber-300 rounded px-2 py-1 text-center text-lg"
                      />
                      <input
                        type="text"
                        value={estadoEditado.nombre}
                        onChange={(e) => setEstadoEditado({ ...estadoEditado, nombre: e.target.value })}
                        placeholder="Nombre"
                        className="flex-1 bg-white border border-amber-300 rounded px-2 py-1 text-sm text-stone-800"
                      />
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-stone-500 text-xs">Color:</span>
                      <div className="flex gap-1 flex-wrap flex-1">
                        {COLORES_USUARIO.map(color => (
                          <button
                            key={color}
                            type="button"
                            onClick={() => setEstadoEditado({ ...estadoEditado, color })}
                            className={`w-6 h-6 rounded border-2 transition-all ${estadoEditado.color === color ? 'border-stone-800 scale-110' : 'border-transparent'}`}
                            style={{ backgroundColor: color }}
                          />
                        ))}
                      </div>
                      <button onClick={() => guardarEdicionEstado(estado.id)} className="text-green-600 px-2 font-bold">✓</button>
                      <button onClick={() => setEditandoEstadoId(null)} className="text-stone-400 px-2">✕</button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center gap-3">
                    <span className="text-xl">{estado.icon}</span>
                    <span className="flex-1 text-stone-800 font-medium">{estado.nombre}</span>
                    <div 
                      className="w-4 h-4 rounded-full"
                      style={{ backgroundColor: estado.color }}
                    />
                    <button 
                      onClick={() => { 
                        setEditandoEstadoId(estado.id); 
                        setEstadoEditado({ nombre: estado.nombre, icon: estado.icon, color: estado.color }); 
                      }} 
                      className="text-amber-600 hover:text-amber-800 px-1 text-sm"
                    >✏️</button>
                    <button onClick={() => eliminarEstado(estado.id)} className="text-red-400 hover:text-red-600 px-1 text-sm">🗑️</button>
                  </div>
                )}
              </Card>
            ))}
          </div>
          
          {/* Añadir nuevo estado */}
          <Card className="mt-3 bg-amber-50">
            <p className="text-amber-700 text-sm font-medium mb-2">Añadir nuevo estado</p>
            <div className="flex gap-2 mb-2">
              <input
                type="text"
                value={nuevoEstado.icon}
                onChange={(e) => setNuevoEstado({ ...nuevoEstado, icon: e.target.value })}
                placeholder="📌"
                className="w-16 bg-white border border-amber-300 rounded px-2 py-1 text-center text-lg"
              />
              <input
                type="text"
                value={nuevoEstado.nombre}
                onChange={(e) => setNuevoEstado({ ...nuevoEstado, nombre: e.target.value })}
                placeholder="Nombre del estado"
                className="flex-1 bg-white border border-amber-300 rounded px-2 py-1 text-sm text-stone-800"
              />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-stone-500 text-xs">Color:</span>
              <div className="flex gap-1 flex-wrap flex-1">
                {COLORES_USUARIO.map(color => (
                  <button
                    key={color}
                    type="button"
                    onClick={() => setNuevoEstado({ ...nuevoEstado, color })}
                    className={`w-6 h-6 rounded border-2 transition-all ${nuevoEstado.color === color ? 'border-stone-800 scale-110' : 'border-transparent'}`}
                    style={{ backgroundColor: color }}
                  />
                ))}
              </div>
              <Button 
                size="sm"
                onClick={agregarEstado}
                disabled={!nuevoEstado.nombre.trim()}
                disabledReason="Escribe un nombre"
              >+ Añadir</Button>
            </div>
          </Card>
        </div>
        
        {/* Separador */}
        <hr className="border-amber-200" />

        {/* Sección Matrículas */}
        <MatriculasSection />

        {/* Separador */}
        <hr className="border-amber-200" />

        {/* Sección Categorías */}
        <div>
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-xl font-bold text-amber-800">🏷️ Categorías</h2>
            <Button onClick={() => openModal('categoria')}>+ Nueva</Button>
          </div>
          
          <div className="space-y-3">
            {categorias.map(cat => (
              <Card key={cat.id}>
                <div className="flex justify-between items-center">
                  <div className="flex items-center gap-3">
                    <span className="text-stone-800 font-medium">{cat.nombre}</span>
                    {cat.esFino && <span className="bg-amber-200 text-amber-800 text-xs px-2 py-1 rounded font-medium">FINO</span>}
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" variant="secondary" onClick={() => openModal('categoria', cat)}>Editar</Button>
                    <Button size="sm" variant="danger" onClick={() => handleDeleteCategoria(cat.id)}>×</Button>
                  </div>
                </div>
                <p className="text-stone-500 text-xs mt-2">
                  IGI por defecto: {cat.esFino ? '0%' : '4.5%'} • Descuento: {cat.esFino ? 'Fino' : 'Estándar'}
                </p>
              </Card>
            ))}
            {categorias.length === 0 && (
              <p className="text-stone-400 text-center py-8">No hay categorías. Crea una nueva.</p>
            )}
          </div>
        </div>
      </div>
    );
  };

  // Estadisticas Tab
  const EstadisticasTab = () => {
    const sortedExpediciones = useMemo(() =>
      [...expediciones].sort((a, b) => getExpNum(a.nombre) - getExpNum(b.nombre)),
      [expediciones]
    );

    const filteredExpediciones = useMemo(() => {
      let exps = sortedExpediciones;
      if (statsExpDesde) {
        const desdeNum = getExpNum(expediciones.find(e => e.id === statsExpDesde)?.nombre);
        exps = exps.filter(e => getExpNum(e.nombre) >= desdeNum);
      }
      if (statsExpHasta) {
        const hastaNum = getExpNum(expediciones.find(e => e.id === statsExpHasta)?.nombre);
        exps = exps.filter(e => getExpNum(e.nombre) <= hastaNum);
      }
      return exps;
    }, [sortedExpediciones, statsExpDesde, statsExpHasta, expediciones]);

    const filteredExpIds = useMemo(() =>
      new Set(filteredExpediciones.map(e => e.id)),
      [filteredExpediciones]
    );

    const filteredClientes = useMemo(() =>
      statsClienteId ? clientes.filter(c => c.id === statsClienteId) : clientes,
      [clientes, statsClienteId]
    );

    const chartData = useMemo(() => {
      return filteredExpediciones.map(exp => {
        const dataPoint = { expedicion: exp.nombre };
        filteredClientes.forEach(cliente => {
          const clientePaquetes = paquetes.filter(
            p => p.expedicionId === exp.id && p.clienteId === cliente.id
          );
          const brutoTotal = clientePaquetes.reduce((sum, paq) => {
            return sum + paq.lineas.reduce((s, l) => s + Math.max(0, l.bruto), 0);
          }, 0);
          dataPoint[cliente.nombre] = brutoTotal;
        });
        return dataPoint;
      });
    }, [filteredExpediciones, filteredClientes, paquetes]);

    return (
      <div className="space-y-4">
        <h2 className="text-xl font-bold text-amber-800">Estadísticas</h2>

        {/* Filtros */}
        <Card>
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-amber-600 font-semibold text-sm">Filtros</h3>
            {(statsExpDesde || statsExpHasta || statsClienteId) && (
              <button
                onClick={() => { setStatsExpDesde(null); setStatsExpHasta(null); setStatsClienteId(null); }}
                className="text-xs text-stone-400 hover:text-red-500 transition-colors"
              >Limpiar filtros</button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <label className="text-stone-600 text-sm min-w-[3rem]">Desde</label>
            <select
              value={statsExpDesde || ''}
              onChange={(e) => setStatsExpDesde(e.target.value || null)}
              className="flex-1 bg-white border border-amber-300 rounded-lg px-2 py-1.5 text-sm text-stone-800 focus:outline-none focus:border-amber-500"
            >
              <option value="">Inicio</option>
              {sortedExpediciones.map(exp => (
                <option key={exp.id} value={exp.id}>{exp.nombre}</option>
              ))}
            </select>
            <label className="text-stone-600 text-sm min-w-[3rem]">Hasta</label>
            <select
              value={statsExpHasta || ''}
              onChange={(e) => setStatsExpHasta(e.target.value || null)}
              className="flex-1 bg-white border border-amber-300 rounded-lg px-2 py-1.5 text-sm text-stone-800 focus:outline-none focus:border-amber-500"
            >
              <option value="">Final</option>
              {sortedExpediciones.map(exp => (
                <option key={exp.id} value={exp.id}>{exp.nombre}</option>
              ))}
            </select>
          </div>
          {statsClienteId && (() => {
            const cliente = clientes.find(c => c.id === statsClienteId);
            return (
              <div className="flex items-center gap-2 mt-2 bg-amber-50 rounded-lg px-3 py-1.5">
                <div className="w-3 h-3 rounded-full" style={{ backgroundColor: cliente?.color || '#999' }} />
                <span className="text-stone-700 text-sm">Filtrando por: <strong>{cliente?.nombre}</strong></span>
                <button
                  onClick={() => setStatsClienteId(null)}
                  className="ml-auto text-stone-400 hover:text-red-500 text-lg leading-none"
                >&times;</button>
              </div>
            );
          })()}
        </Card>

        <Card>
          <h3 className="text-amber-600 font-semibold mb-4">Volumen Bruto por Expedición y Cliente</h3>
          <div className="w-full h-80 -ml-4">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ top: 20, right: 10, left: 0, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e5e5" />
                <XAxis dataKey="expedicion" tick={{ fill: '#78716c', fontSize: 12 }} />
                <YAxis tick={{ fill: '#78716c', fontSize: 10 }} tickFormatter={(v) => `${(v/1000).toFixed(1)}k`} />
                <Tooltip
                  formatter={(value, name) => [`${formatNum(value)} g`, name]}
                  contentStyle={{ backgroundColor: '#fffbeb', border: '1px solid #fcd34d', borderRadius: '8px' }}
                />
                <Legend wrapperStyle={{ fontSize: '11px' }} />
                {filteredClientes.map((cliente) => (
                  <Bar
                    key={cliente.id}
                    dataKey={cliente.nombre}
                    stackId="a"
                    fill={cliente.color || '#999999'}
                  />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        {/* Tabla resumen — click para filtrar por cliente */}
        <Card>
          <h3 className="text-amber-600 font-semibold mb-3">Resumen por Cliente</h3>
          <div className="space-y-1">
            {clientes.map((cliente) => {
              const totalBruto = paquetes
                .filter(p => p.clienteId === cliente.id && filteredExpIds.has(p.expedicionId))
                .reduce((sum, paq) => sum + paq.lineas.reduce((s, l) => s + Math.max(0, l.bruto), 0), 0);
              const numPaquetes = paquetes.filter(p => p.clienteId === cliente.id && filteredExpIds.has(p.expedicionId)).length;

              if (numPaquetes === 0) return null;

              const isActive = statsClienteId === cliente.id;

              return (
                <div
                  key={cliente.id}
                  onClick={() => setStatsClienteId(isActive ? null : cliente.id)}
                  className={`flex justify-between items-center py-2 px-2 rounded-lg cursor-pointer transition-all ${
                    isActive
                      ? 'bg-amber-100 ring-1 ring-amber-400'
                      : statsClienteId
                        ? 'opacity-40 hover:opacity-70'
                        : 'hover:bg-amber-50'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <div
                      className="w-3 h-3 rounded-full"
                      style={{ backgroundColor: cliente.color || '#999999' }}
                    />
                    <span className="text-stone-800 font-medium">{cliente.nombre}</span>
                    <span className="text-stone-400 text-xs">({numPaquetes} paq.)</span>
                  </div>
                  <span className="text-stone-800 font-mono">{formatNum(totalBruto)} g</span>
                </div>
              );
            })}
          </div>
        </Card>
      </div>
    );
  };

  // Modal Forms
  const ModalForm = () => {
    const [formData, setFormData] = useState(() => {
      if (modalType === 'categoria') {
        return editingItem || { nombre: '', esFino: false };
      }
      if (modalType === 'cliente') {
        return editingItem || { nombre: '', abreviacion: '', color: '#f59e0b', descuentoEstandar: 5, descuentoFino: 3, kilatajes: [], lineasNegativasNoCuentanPeso: true };
      }
      if (modalType === 'expedicion') {
        if (editingItem) {
          // Auto-populate precioPorDefecto from most recent cierre if not set
          const defaultPrecio = editingItem.precioPorDefecto || getExpedicionPrecioPorDefecto(editingItem.id) || '';
          return { ...editingItem, precioPorDefecto: defaultPrecio, esActual: expedicionActualId === editingItem.id };
        }
        // Auto-suggest next expedition number
        const maxNum = expediciones.reduce((max, exp) => {
          const match = exp.nombre?.match(/^E(\d+)$/);
          return match ? Math.max(max, parseInt(match[1])) : max;
        }, 0);
        const suggestedName = maxNum > 0 ? `E${maxNum + 1}` : '';
        // Get most recent precioFino across all expediciones as starting default
        const allPreciosFino = paquetes.filter(p => p.precioFino).map(p => p.precioFino);
        const defaultPrecio = allPreciosFino.length > 0 ? allPreciosFino[allPreciosFino.length - 1] : '';
        return { nombre: suggestedName, fechaExportacion: null, esActual: false, precioPorDefecto: defaultPrecio, seguro: 600000, matriculaId: null, bultos: null, horaExportacion: null, matriculaLog: null, bultosLog: null, horaLog: null };
      }
      if (modalType === 'paquete') {
        const defaultCliente = clientes[0];
        const defaultCategoria = categorias[0];
        const esFino = defaultCategoria?.esFino || false;
        if (editingItem) {
          return { ...editingItem };
        }
        const expId = selectedExpedicion || expedicionActualId;
        const nextNum = getNextPaqueteNumber(expId);
        return { 
          expedicionId: expId,
          numero: nextNum,
          clienteId: defaultCliente?.id,
          categoriaId: defaultCategoria?.id,
          descuento: esFino ? defaultCliente?.descuentoFino : defaultCliente?.descuentoEstandar || 5,
          igi: esFino ? 0 : 4.5,
          lineas: [],
        };
      }
      return {};
    });

    const handleCategoriaChange = (categoriaId) => {
      const cat = getCategoria(categoriaId);
      const cliente = getCliente(formData.clienteId);
      setFormData({
        ...formData,
        categoriaId,
        igi: cat?.esFino ? 0 : 4.5,
        descuento: cat?.esFino ? cliente?.descuentoFino : cliente?.descuentoEstandar || 5
      });
    };

    const handleClienteChange = (clienteId) => {
      const cliente = getCliente(clienteId);
      const cat = getCategoria(formData.categoriaId);
      setFormData({
        ...formData,
        clienteId,
        descuento: cat?.esFino ? cliente?.descuentoFino : cliente?.descuentoEstandar || 5
      });
    };

    const [showConfirmExit, setShowConfirmExit] = useState(false);
    const [leyendoFactura, setLeyendoFactura] = useState(false);

    const leerFacturaConIA = async (file) => {
      if (!file) return;
      setLeyendoFactura(true);
      try {
        const base64 = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result);
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });
        const base64Data = base64.split(',')[1];
        const esImagen = file.type.startsWith('image/');
        const esPDF = file.type === 'application/pdf';
        if (!esImagen && !esPDF) { alert('Solo imágenes o PDFs'); setLeyendoFactura(false); return; }

        const clientesList = clientes.map(c => c.nombre).join(', ');
        const archivoContent = esImagen
          ? { type: 'image', source: { type: 'base64', media_type: file.type, data: base64Data } }
          : { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64Data } };

        const response = await fetch('/api/verify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            max_tokens: 800,
            messages: [{
              role: 'user',
              content: [
                archivoContent,
                { type: 'text', text: `Analiza esta factura/albarán y extrae:
1. Todas las líneas de peso bruto (en gramos) con su ley/kilataje
2. El nombre del cliente o empresa (mira el logo, encabezado, o nombre que aparezca)

Clientes conocidos: ${clientesList}

Responde SOLO con JSON, sin texto adicional:
{
  "lineas": [{"bruto": número, "ley": número}],
  "cliente": "nombre exacto de la lista de clientes conocidos, o null si no lo reconoces"
}

Usa punto decimal. Si un peso aparece en kg, conviértelo a gramos.` }
              ]
            }]
          })
        });

        if (!response.ok) {
          const err = await response.json().catch(() => ({}));
          throw new Error(err.error || `HTTP ${response.status}`);
        }

        const data = await response.json();
        const texto = data.content?.[0]?.text || '';
        const jsonMatch = texto.match(/\{[\s\S]*\}/);
        if (!jsonMatch) { alert('No se pudo leer la factura'); setLeyendoFactura(false); return; }

        const resultado = JSON.parse(jsonMatch[0]);
        const nuevasLineas = (resultado.lineas || [])
          .filter(l => l.bruto && l.ley)
          .map((l, i) => ({ id: Date.now() + i, bruto: l.bruto, ley: l.ley }));

        const updates = { ...formData, lineas: [...(formData.lineas || []), ...nuevasLineas] };

        if (resultado.cliente) {
          const match = clientes.find(c => c.nombre.toLowerCase() === resultado.cliente.toLowerCase());
          if (match) {
            const cat = getCategoria(updates.categoriaId);
            updates.clienteId = match.id;
            updates.descuento = cat?.esFino ? match.descuentoFino : match.descuentoEstandar || 5;
          }
        }

        setFormData(updates);
        if (nuevasLineas.length > 0) {
          alert(`Leídas ${nuevasLineas.length} líneas` + (resultado.cliente ? ` — Cliente: ${resultado.cliente}` : ''));
        } else {
          alert('No se encontraron líneas de peso en el documento');
        }
      } catch (e) {
        alert('Error al leer factura: ' + e.message);
      }
      setLeyendoFactura(false);
    };

    const handleClose = () => {
      // Check for unsaved changes based on modal type
      let hasChanges = false;

      if (modalType === 'paquete' && !editingItem) {
        hasChanges = formData.lineas?.length > 0 || formData.precioFino;
      } else if (modalType === 'categoria' && !editingItem) {
        hasChanges = formData.nombre !== '';
      } else if (modalType === 'cliente' && !editingItem) {
        hasChanges = formData.nombre !== '' || formData.abreviacion !== '';
      } else if (modalType === 'expedicion' && !editingItem) {
        hasChanges = formData.nombre !== '';
      }

      if (hasChanges) {
        setShowConfirmExit(true);
        return;
      }
      closeModal();
    };

    const confirmExit = () => {
      setShowConfirmExit(false);
      closeModal();
    };

    // Obtener nombre de expedición para el título
    const getPaqueteTitulo = () => {
      if (modalType !== 'paquete') return null;
      const expNombre = getExpedicionNombre(formData.expedicionId);
      return `${expNombre}-${formData.numero || '?'}`;
    };

    return (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 overflow-y-auto">
        <div className="bg-white border border-amber-300 rounded-2xl w-full max-w-md shadow-xl flex flex-col my-auto" style={{ maxHeight: 'calc(100vh - 32px)' }}>
          <div className="p-4 border-b border-amber-200 flex-shrink-0">
            <div className="flex justify-between items-center gap-2">
              <h3 className="text-xl font-bold text-amber-800 truncate min-w-0">
                {modalType === 'paquete'
                  ? `Paquete ${getPaqueteTitulo()}`
                  : `${editingItem ? 'Editar' : 'Nueva'} ${modalType}`
                }
              </h3>
              {modalType === 'paquete' && (
                <>
                  <input
                    type="file"
                    id="leer-factura-input"
                    accept="image/*,application/pdf"
                    className="hidden"
                    onChange={(e) => { if (e.target.files[0]) leerFacturaConIA(e.target.files[0]); e.target.value = ''; }}
                  />
                  <button
                    type="button"
                    disabled={leyendoFactura}
                    onClick={() => document.getElementById('leer-factura-input').click()}
                    className="flex-shrink-0 text-sm bg-amber-100 text-amber-700 px-3 py-1.5 rounded-lg hover:bg-amber-200 border border-amber-300 disabled:opacity-50"
                  >
                    {leyendoFactura ? '⏳ Leyendo...' : '🤖 Leer factura'}
                  </button>
                </>
              )}
            </div>
          </div>
          
          <div className="flex-1 overflow-y-auto px-4 py-3 min-h-0">
          {modalType === 'categoria' && (
            <>
              <Input 
                label="Nombre" 
                value={formData.nombre} 
                onChange={(e) => setFormData({ ...formData, nombre: e.target.value })}
                placeholder="Ej: Chatarra 18"
              />
              <Checkbox 
                label="Es Fino (IGI 0%, Dto. Fino)" 
                checked={formData.esFino} 
                onChange={(e) => setFormData({ ...formData, esFino: e.target.checked })}
              />
            </>
          )}
          
          {modalType === 'cliente' && (
            <>
              <Input 
                label="Nombre" 
                value={formData.nombre} 
                onChange={(e) => setFormData({ ...formData, nombre: e.target.value })}
                placeholder="Nombre del cliente"
              />
              <div className="flex gap-3 mb-3">
                <div className="flex-1">
                  <label className="block text-amber-800 text-sm mb-1 font-medium">Abreviación</label>
                  <input 
                    type="text"
                    maxLength={4}
                    value={formData.abreviacion || ''} 
                    onChange={(e) => setFormData({ ...formData, abreviacion: e.target.value.toUpperCase() })}
                    placeholder="GEM"
                    className="w-full bg-white border border-amber-300 rounded-lg px-3 py-2 text-stone-800 placeholder-stone-400 focus:outline-none focus:border-amber-500 font-mono"
                  />
                </div>
                <div>
                  <label className="block text-amber-800 text-sm mb-1 font-medium">Color</label>
                  <div className="flex gap-1 flex-wrap">
                    {COLORES_USUARIO.map(color => (
                      <button
                        key={color}
                        type="button"
                        onClick={() => setFormData({ ...formData, color })}
                        className={`w-8 h-8 rounded-lg border-2 transition-all ${formData.color === color ? 'border-stone-800 scale-110' : 'border-transparent'}`}
                        style={{ backgroundColor: color }}
                      />
                    ))}
                  </div>
                </div>
              </div>
              <Input 
                label="Descuento Estándar (%)" 
                type="number"
                value={formData.descuentoEstandar} 
                onChange={(e) => setFormData({ ...formData, descuentoEstandar: parseFloat(e.target.value) })}
              />
              <Input 
                label="Descuento Fino (%)" 
                type="number"
                value={formData.descuentoFino} 
                onChange={(e) => setFormData({ ...formData, descuentoFino: parseFloat(e.target.value) })}
              />
              <div className="mb-3">
                <Checkbox 
                  label="Líneas negativas no cuentan en peso (pero sí en €)" 
                  checked={formData.lineasNegativasNoCuentanPeso ?? true} 
                  onChange={(e) => setFormData({ ...formData, lineasNegativasNoCuentanPeso: e.target.checked })}
                />
              </div>
            </>
          )}
          
          {modalType === 'expedicion' && (
            <>
              <Input
                label="Nombre"
                value={formData.nombre}
                onChange={(e) => setFormData({ ...formData, nombre: e.target.value })}
                placeholder="Ej: E50"
              />
              <Input
                label="Precio por defecto (€/g)"
                type="number"
                step="0.01"
                value={formData.precioPorDefecto || ''}
                onChange={(e) => setFormData({ ...formData, precioPorDefecto: e.target.value ? parseFloat(e.target.value) : null })}
                placeholder="Para paquetes sin precio fino"
              />
              <Input
                label="Fecha de exportación"
                type="date"
                value={formData.fechaExportacion || ''}
                onChange={(e) => setFormData({ ...formData, fechaExportacion: e.target.value || null })}
              />
              <Input
                label="Valor seguro (€)"
                type="number"
                step="1"
                value={formData.seguro || ''}
                onChange={(e) => setFormData({ ...formData, seguro: e.target.value ? parseFloat(e.target.value) : null })}
                placeholder="Ej: 600000"
              />
              <div className="mb-3">
                <Checkbox
                  label="Expedición actual (para nuevos paquetes)"
                  checked={formData.esActual || false}
                  onChange={(e) => setFormData({ ...formData, esActual: e.target.checked })}
                />
              </div>

              {/* Campos de logística */}
              {(() => {
                // Si hay fecha de exportación, los campos vacíos se marcan en rojo
                const tieneExportacion = !!formData.fechaExportacion;
                const faltaMatricula = tieneExportacion && !formData.matriculaId;
                const faltaBultos = tieneExportacion && !formData.bultos;
                const faltaHora = tieneExportacion && !formData.horaExportacion;

                return (
                  <div className={`rounded-xl p-3 space-y-3 border ${tieneExportacion && (faltaMatricula || faltaBultos || faltaHora) ? 'bg-red-50 border-red-200' : 'bg-stone-50 border-stone-200'}`}>
                    <p className={`text-xs font-medium uppercase tracking-wide ${tieneExportacion && (faltaMatricula || faltaBultos || faltaHora) ? 'text-red-500' : 'text-stone-500'}`}>
                      Logística {tieneExportacion && (faltaMatricula || faltaBultos || faltaHora) && '⚠️'}
                    </p>

                    {/* Matrícula */}
                    <div className={faltaMatricula ? 'bg-red-100 rounded-lg p-2 -mx-1' : ''}>
                      <Select
                        label={<span className={faltaMatricula ? 'text-red-700' : ''}>Matrícula del coche {faltaMatricula && <span className="text-red-500">*</span>}</span>}
                        value={formData.matriculaId || ''}
                        onChange={(e) => {
                          const val = e.target.value || null;
                          setFormData({
                            ...formData,
                            matriculaId: val,
                            matriculaLog: val ? { usuario: usuarioActivo, fecha: new Date().toISOString() } : null
                          });
                        }}
                        options={[
                          { value: '', label: '— Seleccionar —' },
                          ...matriculas.map(m => ({ value: m.id, label: m.matricula }))
                        ]}
                      />
                      {faltaMatricula && (
                        <p className="text-red-600 text-xs mt-1">⚠️ Campo requerido</p>
                      )}
                      {formData.matriculaId && formData.matriculaLog && (
                        <div className="mt-1 px-2 py-1 bg-green-50 border border-green-200 rounded-lg">
                          <p className="text-green-700 text-xs font-medium">
                            ✅ {formData.matriculaLog.usuario} • {new Date(formData.matriculaLog.fecha).toLocaleDateString('es-ES')} {new Date(formData.matriculaLog.fecha).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}
                          </p>
                        </div>
                      )}
                    </div>

                    {/* Bultos */}
                    <div className={faltaBultos ? 'bg-red-100 rounded-lg p-2 -mx-1' : ''}>
                      <label className={`block text-sm mb-1 font-medium ${faltaBultos ? 'text-red-700' : 'text-amber-800'}`}>
                        Bultos {faltaBultos && <span className="text-red-500">*</span>}
                      </label>
                      <div className="flex gap-2">
                        {[1, 2, 3].map(n => (
                          <button
                            key={n}
                            type="button"
                            onClick={() => setFormData({
                              ...formData,
                              bultos: n,
                              bultosLog: { usuario: usuarioActivo, fecha: new Date().toISOString() }
                            })}
                            className={`flex-1 py-2 rounded-xl border-2 font-semibold transition-colors ${
                              formData.bultos === n
                                ? 'border-amber-500 bg-amber-50 text-amber-700'
                                : faltaBultos
                                  ? 'border-red-300 text-red-600 hover:border-red-400'
                                  : 'border-stone-200 text-stone-600 hover:border-stone-300'
                            }`}
                          >
                            {n}
                          </button>
                        ))}
                      </div>
                      {faltaBultos && (
                        <p className="text-red-600 text-xs mt-1">⚠️ Campo requerido</p>
                      )}
                      {formData.bultos && formData.bultosLog && (
                        <div className="mt-1 px-2 py-1 bg-green-50 border border-green-200 rounded-lg">
                          <p className="text-green-700 text-xs font-medium">
                            ✅ {formData.bultosLog.usuario} • {new Date(formData.bultosLog.fecha).toLocaleDateString('es-ES')} {new Date(formData.bultosLog.fecha).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}
                          </p>
                        </div>
                      )}
                    </div>

                    {/* Hora exportación */}
                    <div className={faltaHora ? 'bg-red-100 rounded-lg p-2 -mx-1' : ''}>
                      <Input
                        label={<span className={faltaHora ? 'text-red-700' : ''}>Hora de exportación {faltaHora && <span className="text-red-500">*</span>}</span>}
                        type="time"
                        value={formData.horaExportacion || ''}
                        onChange={(e) => {
                          const val = e.target.value || null;
                          setFormData({
                            ...formData,
                            horaExportacion: val,
                            horaLog: val ? { usuario: usuarioActivo, fecha: new Date().toISOString() } : null
                          });
                        }}
                      />
                      {faltaHora && (
                        <p className="text-red-600 text-xs mt-1">⚠️ Campo requerido</p>
                      )}
                      {formData.horaExportacion && formData.horaLog && (
                        <div className="mt-1 px-2 py-1 bg-green-50 border border-green-200 rounded-lg">
                          <p className="text-green-700 text-xs font-medium">
                            ✅ {formData.horaLog.usuario} • {new Date(formData.horaLog.fecha).toLocaleDateString('es-ES')} {new Date(formData.horaLog.fecha).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}
                          </p>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })()}
            </>
          )}

          {modalType === 'paquete' && (
            <>
              <div className="flex gap-2 mb-3">
                <div className="flex-1">
                  <label className="block text-amber-800 text-sm mb-1 font-medium">Expedición</label>
                  <select 
                    value={formData.expedicionId}
                    onChange={(e) => {
                      const newExpId = e.target.value;
                      const newNum = getNextPaqueteNumber(newExpId);
                      setFormData({ ...formData, expedicionId: newExpId, numero: newNum });
                    }}
                    className="w-full bg-white border border-amber-300 rounded-lg px-3 py-2 text-stone-800 focus:outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-200"
                  >
                    {[...expediciones].sort(sortExpDescending).map(e => (
                      <option key={e.id} value={e.id}>{e.nombre}</option>
                    ))}
                  </select>
                </div>
                <div className="w-20">
                  <label className="block text-amber-800 text-sm mb-1 font-medium">Nº</label>
                  <input 
                    type="number"
                    value={formData.numero || ''}
                    onChange={(e) => setFormData({ ...formData, numero: parseInt(e.target.value) || '' })}
                    className="w-full bg-white border border-amber-300 rounded-lg px-3 py-2 text-stone-800 focus:outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-200"
                  />
                </div>
              </div>
              <Select 
                label="Cliente"
                value={formData.clienteId}
                onChange={(e) => handleClienteChange(e.target.value)}
                options={clientes.map(c => ({ value: c.id, label: c.nombre }))}
              />
              <Select 
                label="Categoría"
                value={formData.categoriaId}
                onChange={(e) => handleCategoriaChange(e.target.value)}
                options={categorias.map(c => ({ value: c.id, label: `${c.nombre}${c.esFino ? ' (Fino)' : ''}` }))}
              />
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 mb-3">
                <p className="text-amber-700 text-xs">
                  {getCategoria(formData.categoriaId)?.esFino 
                    ? '✨ Categoría FINO: IGI 0%, Dto. Fino del cliente' 
                    : '📦 Categoría normal: IGI 4.5%, Dto. Estándar del cliente'}
                </p>
              </div>
              <Input 
                label="Descuento (%)" 
                type="number"
                step="0.1"
                value={formData.descuento} 
                onChange={(e) => setFormData({ ...formData, descuento: parseFloat(e.target.value) })}
              />
              <Input 
                label="IGI (%)" 
                type="number"
                step="0.1"
                value={formData.igi} 
                onChange={(e) => setFormData({ ...formData, igi: parseFloat(e.target.value) })}
              />
              
              {/* Líneas de oro */}
              <div className="border-t border-amber-200 pt-3 mt-3">
                <h4 className="text-amber-700 font-medium mb-2">📏 Líneas de Oro</h4>
                
                {/* Lista de líneas añadidas */}
                {formData.lineas && formData.lineas.length > 0 && (
                  <div className="space-y-1 mb-3">
                    {formData.lineas.map((linea, idx) => {
                      const fino = calcularFinoLinea(linea.bruto, linea.ley);
                      return (
                        <div key={linea.id || idx} className="flex justify-between items-center bg-amber-50 rounded p-2 text-sm">
                          <span>{linea.bruto}g × {linea.ley} = <span className="text-amber-700 font-medium">{formatNum(fino, 2)}g fino</span></span>
                          <button 
                            type="button"
                            onClick={() => setFormData({
                              ...formData, 
                              lineas: formData.lineas.filter((_, i) => i !== idx)
                            })}
                            className="text-red-500 hover:text-red-700 px-2"
                          >×</button>
                        </div>
                      );
                    })}
                  </div>
                )}
                
                {/* Input para nueva línea */}
                <div className="flex gap-2">
                  <input
                    type="number"
                    placeholder="Bruto (g)"
                    id="modal-bruto"
                    className="flex-1 min-w-0 bg-white border border-amber-300 rounded-lg px-3 py-2 text-sm text-stone-800 placeholder-stone-400 focus:outline-none focus:border-amber-500"
                  />
                  <input
                    type="number"
                    placeholder="Ley"
                    id="modal-ley"
                    className="flex-1 min-w-0 bg-white border border-amber-300 rounded-lg px-3 py-2 text-sm text-stone-800 placeholder-stone-400 focus:outline-none focus:border-amber-500"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      const brutoInput = document.getElementById('modal-bruto');
                      const leyInput = document.getElementById('modal-ley');
                      const bruto = parseFloat(brutoInput.value);
                      const ley = parseFloat(leyInput.value);
                      if (bruto && ley) {
                        setFormData({
                          ...formData,
                          lineas: [...(formData.lineas || []), { id: Date.now(), bruto, ley }]
                        });
                        brutoInput.value = '';
                        leyInput.value = '';
                      }
                    }}
                    className="bg-amber-500 text-white px-3 py-2 rounded-lg hover:bg-amber-600 flex-shrink-0"
                  >+</button>
                </div>
                
                {/* Kilatajes rápidos del cliente */}
                {(() => {
                  const cliente = getCliente(formData.clienteId);
                  if (cliente?.kilatajes && cliente.kilatajes.length > 0) {
                    return (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {cliente.kilatajes.map(k => (
                          <button
                            key={k.nombre}
                            type="button"
                            onClick={() => {
                              document.getElementById('modal-ley').value = k.ley;
                            }}
                            className="text-xs bg-amber-100 text-amber-700 px-2 py-1 rounded hover:bg-amber-200 border border-amber-300"
                          >
                            {k.nombre}: {k.ley}
                          </button>
                        ))}
                      </div>
                    );
                  }
                  return null;
                })()}

                {/* Total bruto y fino (solo si hay más de 1 línea) */}
                {formData.lineas?.length > 1 && (
                  <div className="mt-3 pt-2 border-t border-amber-200 text-right">
                    <span className="text-amber-800 font-semibold">
                      Total: {formatGr(formData.lineas.reduce((sum, l) => sum + (l.bruto || 0), 0))}
                    </span>
                    <span className="text-amber-600 ml-2">
                      ({formatGr(formData.lineas.reduce((sum, l) => sum + calcularFinoLinea(l.bruto, l.ley), 0))} fino)
                    </span>
                  </div>
                )}
              </div>

              {/* Cierre */}
              <div className="border-t border-amber-200 pt-3 mt-3">
                <h4 className="text-amber-700 font-medium mb-2">🔒 Cierre (opcional)</h4>
                <div className="flex gap-2">
                  <div className="flex-1 min-w-0">
                    <label className="block text-amber-800 text-xs mb-1">Base €/g</label>
                    <input
                      type="number"
                      step="0.01"
                      value={formData.precioFino ?? ''}
                      onChange={(e) => setFormData({ ...formData, precioFino: e.target.value === '' ? null : parseFloat(e.target.value) })}
                      className="w-full bg-white border border-amber-300 rounded-lg px-3 py-2 text-sm text-stone-800 focus:outline-none focus:border-amber-500"
                    />
                  </div>
                  <div className="flex-1 min-w-0">
                    <label className="block text-amber-800 text-xs mb-1">Cierre Jofisa</label>
                    <div className="flex gap-1">
                      <input
                        type="number"
                        step="0.01"
                        value={formData.cierreJofisa ?? ''}
                        onChange={(e) => setFormData({ ...formData, cierreJofisa: e.target.value === '' ? '' : parseFloat(e.target.value) })}
                        className="flex-1 min-w-0 bg-white border border-amber-300 rounded-lg px-3 py-2 text-sm text-stone-800 focus:outline-none focus:border-amber-500"
                      />
                      <button
                        type="button"
                        onClick={() => {
                          if (formData.precioFino > 0) {
                            setFormData({ ...formData, cierreJofisa: parseFloat((formData.precioFino - 0.25).toFixed(2)) });
                          }
                        }}
                        className="px-2 py-1 text-sm bg-amber-100 text-amber-700 rounded-lg border border-amber-300 hover:bg-amber-200"
                        title="Auto-rellenar con Base - 0,25"
                      >🪄</button>
                    </div>
                  </div>
                </div>
              </div>
            </>
          )}
          </div>
          
          {showConfirmExit && (
            <div className="p-4 bg-red-50 border-t border-red-200">
              <p className="text-red-700 text-sm mb-3">⚠️ Los datos del paquete no se guardarán. ¿Salir?</p>
              <div className="flex gap-2">
                <Button variant="secondary" size="sm" className="flex-1" onClick={() => setShowConfirmExit(false)}>No, volver</Button>
                <Button variant="danger" size="sm" className="flex-1" onClick={confirmExit}>Sí, salir</Button>
              </div>
            </div>
          )}
          
          {!showConfirmExit && (
            <div className="p-4 border-t border-amber-200 flex-shrink-0">
              <div className="flex gap-3">
                <Button variant="secondary" className="flex-1" onClick={handleClose}>Cancelar</Button>
                {(() => {
                  let disabled = false;
                  let reason = '';
                  if (modalType === 'categoria' && !formData.nombre?.trim()) {
                    disabled = true;
                    reason = 'Introduce un nombre';
                  } else if (modalType === 'cliente' && !formData.nombre?.trim()) {
                    disabled = true;
                    reason = 'Introduce un nombre';
                  } else if (modalType === 'expedicion' && !formData.nombre?.trim()) {
                    disabled = true;
                    reason = 'Introduce un nombre';
                  } else if (modalType === 'paquete' && !formData.clienteId) {
                    disabled = true;
                    reason = 'Selecciona un cliente';
                  }
                  return (
                    <Button 
                      className="flex-1" 
                      disabled={disabled}
                      disabledReason={reason}
                      onClick={() => {
                        if (modalType === 'categoria') saveCategoria(formData);
                        if (modalType === 'cliente') saveCliente(formData);
                        if (modalType === 'expedicion') saveExpedicion(formData);
                        if (modalType === 'paquete') savePaquete(formData);
                      }}
                    >Guardar</Button>
                  );
                })()}
              </div>
            </div>
          )}
        </div>
      </div>
    );
  };

  // Text Modal
  const TextModal = () => (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white border border-amber-300 rounded-2xl p-6 w-full max-w-lg shadow-xl">
        <h3 className="text-xl font-bold text-amber-800 mb-4">📋 Texto Generado</h3>
        <textarea 
          readOnly 
          value={textModalContent}
          className="w-full h-48 bg-amber-50 border border-amber-200 rounded-lg p-3 text-stone-800 text-sm font-mono"
        />
        <div className="flex gap-3 mt-4">
          <Button variant="secondary" className="flex-1" onClick={() => setShowTextModal(false)}>Cerrar</Button>
          <Button className="flex-1" onClick={() => {
            navigator.clipboard.writeText(textModalContent);
          }}>Copiar</Button>
        </div>
      </div>
    </div>
  );

  // Estado para modal de categorías
  const [showCategoriasModal, setShowCategoriasModal] = useState(false);


  // Modal de resumen por categorías
  const CategoriasResumenModal = () => {
    if (!showCategoriasModal || !selectedExpedicion) return null;
    const totales = calcularTotalesExpedicion(selectedExpedicion);
    const expInfo = expediciones.find(e => e.id === selectedExpedicion);
    
    return (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => setShowCategoriasModal(false)}>
        <div className="bg-white border border-amber-300 rounded-2xl p-6 w-full max-w-lg shadow-xl" onClick={e => e.stopPropagation()}>
          <h3 className="text-xl font-bold text-amber-800 mb-4">📊 {expInfo?.nombre} por Categoría</h3>
          <div className="space-y-3">
            {Object.entries(totales.porCategoria).map(([catNombre, vals]) => {
              const cat = categorias.find(c => c.nombre === catNombre);
              return (
                <div key={catNombre} className="bg-amber-50 border border-amber-200 rounded-lg p-3">
                  <div className="flex justify-between items-center mb-2">
                    <span className="text-stone-800 font-medium">{catNombre}</span>
                    {cat?.esFino && <span className="bg-amber-200 text-amber-800 text-xs px-2 py-1 rounded">FINO</span>}
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <div><span className="text-stone-500">Bruto:</span> <span className="text-stone-800">{formatNum(vals.bruto)}g</span></div>
                    <div><span className="text-stone-500">Fino:</span> <span className="text-stone-800">{formatNum(vals.fino)}g</span></div>
                    <div><span className="text-stone-500">Total Fra:</span> <span className="text-stone-800">{formatNum(vals.totalFra)}€</span></div>
                    <div><span className="text-stone-500">€/g Bruto:</span> <span className="text-stone-800">{formatNum(vals.precioMedioBruto)}€</span></div>
                  </div>
                </div>
              );
            })}
          </div>
          <Button className="w-full mt-4" onClick={() => setShowCategoriasModal(false)}>Cerrar</Button>
        </div>
      </div>
    );
  };

  // Estado para modal de resultados
  const [showResultadosModal, setShowResultadosModal] = useState(false);

  // Estado local para edición en modal de resultados (evita re-render de Firestore al escribir)
  const [resultadosLocal, setResultadosLocal] = useState(null);

  // Sincronizar estado local al abrir modal
  useEffect(() => {
    if (showResultadosModal && selectedExpedicion) {
      const expInfo = expediciones.find(e => e.id === selectedExpedicion);
      setResultadosLocal(expInfo?.resultados || {});
    } else {
      setResultadosLocal(null);
    }
  }, [showResultadosModal, selectedExpedicion]);

  // Modal de resultados por cliente
  const ResultadosModal = () => {
    if (!showResultadosModal || !selectedExpedicion || !resultadosLocal) return null;
    const totales = calcularTotalesExpedicion(selectedExpedicion);
    const expInfo = expediciones.find(e => e.id === selectedExpedicion);
    const precioFinoSobra = resultadosLocal.precioFinoSobra ?? '';
    const clientesResultados = resultadosLocal.clientes || {};

    const updateLocal = (newResultados) => {
      setResultadosLocal(newResultados);
    };

    const saveToFirestore = () => {
      fupdateResultados(selectedExpedicion, resultadosLocal);
    };

    const handlePrecioChange = (val) => {
      updateLocal({ ...resultadosLocal, precioFinoSobra: val === '' ? null : parseFloat(val), clientes: { ...clientesResultados } });
    };

    const handleClienteField = (clienteId, field, val) => {
      const clienteData = { ...(clientesResultados[clienteId] || {}) };
      clienteData[field] = val === '' ? null : parseFloat(val);
      updateLocal({ ...resultadosLocal, clientes: { ...clientesResultados, [clienteId]: clienteData } });
    };

    const clienteEntries = Object.entries(totales.porCliente).sort((a, b) => {
      const cA = getCliente(a[0])?.nombre || '';
      const cB = getCliente(b[0])?.nombre || '';
      return cA.localeCompare(cB);
    });

    let totalFinoSobra = 0;
    let totalGramosDevueltos = 0;
    clienteEntries.forEach(([cId]) => {
      totalFinoSobra += clientesResultados[cId]?.finoSobra || 0;
      totalGramosDevueltos += clientesResultados[cId]?.gramosDevueltos || 0;
    });
    const precioNum = parseFloat(precioFinoSobra) || 0;
    const valorTotalSobra = totalFinoSobra * precioNum;
    const finoSobraNeto = totalFinoSobra - totalGramosDevueltos;

    // Calcular totales para la tabla resumen
    let sumMgFras = 0, sumEuroSobra = 0, sumMgTotal = 0, sumBruto = 0;
    const clienteRows = clienteEntries.map(([clienteId, vals]) => {
      const finoSobraRaw = clientesResultados[clienteId]?.finoSobra || 0;
      const devueltos = clientesResultados[clienteId]?.gramosDevueltos || 0;
      const finoSobraNeto = finoSobraRaw - devueltos;
      const euroSobra = finoSobraNeto * precioNum;
      const mgTotal = vals.margen + euroSobra;
      const eurGBruto = vals.bruto > 0 ? mgTotal / vals.bruto : 0;
      sumMgFras += vals.margen;
      sumEuroSobra += euroSobra;
      sumMgTotal += mgTotal;
      sumBruto += vals.bruto;
      const eurGFras = vals.bruto > 0 ? vals.margen / vals.bruto : 0;
      const eurGSobra = vals.bruto > 0 ? euroSobra / vals.bruto : 0;
      return { clienteId, vals, finoSobraNeto, euroSobra, mgTotal, eurGBruto, eurGFras, eurGSobra };
    });
    const totalEurGBruto = sumBruto > 0 ? sumMgTotal / sumBruto : 0;

    return (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => { saveToFirestore(); setShowResultadosModal(false); }}>
        <div className="bg-white border border-amber-300 rounded-2xl w-full max-w-lg shadow-xl max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
          <div className="sticky top-0 bg-white border-b border-amber-200 px-5 py-3 rounded-t-2xl z-10 flex items-center gap-3">
            <button onClick={() => { saveToFirestore(); setShowResultadosModal(false); }} className="text-amber-600 hover:text-amber-800 text-lg">←</button>
            <h3 className="text-lg font-bold text-amber-800">📊 {expInfo?.nombre} — Resultados</h3>
          </div>
          <div className="p-5">

          {/* Resumen por Cliente — tabla */}
          <div className="mb-4">
            <div className="space-y-2">
              {clienteRows.map(({ clienteId, vals, finoSobraNeto: fsn, euroSobra, mgTotal, eurGBruto, eurGFras, eurGSobra }) => {
                const cliente = getCliente(clienteId);
                const color = cliente?.color || '#f59e0b';
                return (
                  <div key={clienteId} className="rounded-lg p-3 border" style={{ backgroundColor: color + '10', borderColor: color + '40' }}>
                    {/* Fila 1: nombre | €/g Fras | Mg Fras */}
                    <div className="grid grid-cols-3 items-center text-xs">
                      <span className="font-medium text-sm" style={{ color }}>{cliente?.nombre || 'Sin cliente'}</span>
                      <span className="font-mono text-stone-400 text-center">{formatNum(eurGFras)}</span>
                      <span className={`font-mono text-right ${vals.margen >= 0 ? 'text-green-700' : 'text-red-700'}`}>{formatNum(vals.margen, 0)}€</span>
                    </div>
                    {/* Fila 2: grs extra | €/g Sobra | € Sobra */}
                    <div className="grid grid-cols-3 items-center text-xs mt-0.5">
                      <span className="text-stone-400 font-mono">{formatNum(fsn)}g extra</span>
                      <span className="font-mono text-stone-400 text-center">{formatNum(eurGSobra)}</span>
                      <span className={`font-mono text-right ${euroSobra >= 0 ? 'text-green-700' : 'text-red-700'}`}>{formatNum(euroSobra, 0)}€</span>
                    </div>
                    {/* Fila 3: grs bruto | €/g Total | Mg Total */}
                    <div className="grid grid-cols-3 items-center mt-1 pt-1" style={{ borderTop: `1px solid ${color}20` }}>
                      <span className="text-stone-400 font-mono text-xs">{formatNum(vals.bruto)}g</span>
                      <span className={`font-mono font-bold text-sm text-center ${eurGBruto >= 0 ? 'text-stone-800' : 'text-red-600'}`}>{formatNum(eurGBruto)}</span>
                      <span className={`font-mono font-bold text-sm text-right ${mgTotal >= 0 ? 'text-green-600' : 'text-red-600'}`}>{formatNum(mgTotal, 0)}€</span>
                    </div>
                  </div>
                );
              })}
            </div>
            {/* Totales */}
            <div className="mt-2 border-t-2 border-amber-300 pt-2">
              <div className="grid grid-cols-3 items-center text-xs">
                <span className="font-semibold text-stone-600">Total</span>
                <span className="font-mono text-stone-400 text-center">{formatNum(sumBruto > 0 ? sumMgFras / sumBruto : 0)}</span>
                <span className={`font-mono text-right ${sumMgFras >= 0 ? 'text-green-700' : 'text-red-700'}`}>{formatNum(sumMgFras, 0)}€</span>
              </div>
              <div className="grid grid-cols-3 items-center text-xs mt-0.5">
                <span className="text-stone-400 font-mono">{formatNum(finoSobraNeto)}g extra</span>
                <span className="font-mono text-stone-400 text-center">{formatNum(sumBruto > 0 ? sumEuroSobra / sumBruto : 0)}</span>
                <span className={`font-mono text-right ${sumEuroSobra >= 0 ? 'text-green-700' : 'text-red-700'}`}>{formatNum(sumEuroSobra, 0)}€</span>
              </div>
              <div className="grid grid-cols-3 items-center mt-1 pt-1 border-t border-amber-200">
                <span className="text-stone-400 font-mono text-xs">{formatNum(sumBruto)}g</span>
                <span className={`font-mono font-bold text-sm text-center ${totalEurGBruto >= 0 ? 'text-stone-800' : 'text-red-600'}`}>{formatNum(totalEurGBruto)}</span>
                <span className={`font-mono font-bold text-sm text-right ${sumMgTotal >= 0 ? 'text-green-600' : 'text-red-600'}`}>{formatNum(sumMgTotal, 0)}€</span>
              </div>
            </div>
          </div>

          {/* Fino Sobra por Cliente */}
          <div className="mb-4">
            <h4 className="text-sm font-semibold text-stone-600 mb-2">Fino Sobra por Cliente</h4>
            <div className="space-y-2">
              {clienteEntries.map(([clienteId]) => {
                const cliente = getCliente(clienteId);
                const color = cliente?.color || '#f59e0b';
                const finoSobra = clientesResultados[clienteId]?.finoSobra ?? '';
                return (
                  <div key={clienteId} className="flex items-center gap-2">
                    <span className="text-sm font-medium w-24 truncate" style={{ color }}>{cliente?.nombre}</span>
                    <input
                      type="number"
                      step="0.01"
                      placeholder="0.00"
                      value={finoSobra}
                      onChange={e => handleClienteField(clienteId, 'finoSobra', e.target.value)}
                      onBlur={saveToFirestore}
                      className="flex-1 border border-stone-300 rounded px-2 py-1 text-sm font-mono text-right"
                    />
                    <span className="text-xs text-stone-400">g</span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Valoración Fino Sobra */}
          <div className="mb-4 bg-amber-50 border border-amber-200 rounded-lg p-3">
            <h4 className="text-sm font-semibold text-stone-600 mb-2">Valoración Fino Sobra</h4>
            <div className="flex items-center gap-2 mb-2">
              <span className="text-sm text-stone-500">Precio €/g:</span>
              <input
                type="number"
                step="0.01"
                placeholder="0.00"
                value={precioFinoSobra}
                onChange={e => handlePrecioChange(e.target.value)}
                onBlur={saveToFirestore}
                className="w-28 border border-stone-300 rounded px-2 py-1 text-sm font-mono text-right"
              />
            </div>
            <div className="grid grid-cols-2 gap-2 text-sm">
              <div><span className="text-stone-500">Total sobra:</span> <span className="text-stone-800 font-mono">{formatNum(totalFinoSobra)} g</span></div>
              <div><span className="text-stone-500">Neto:</span> <span className="text-stone-800 font-mono">{formatNum(finoSobraNeto)} g</span></div>
            </div>
          </div>

          {/* Gramos Devueltos */}
          <div className="mb-4">
            <h4 className="text-sm font-semibold text-stone-600 mb-2">Gramos Devueltos</h4>
            <div className="space-y-2">
              {clienteEntries.map(([clienteId]) => {
                const cliente = getCliente(clienteId);
                const color = cliente?.color || '#f59e0b';
                const gramosDevueltos = clientesResultados[clienteId]?.gramosDevueltos ?? '';
                return (
                  <div key={clienteId} className="flex items-center gap-2">
                    <span className="text-sm font-medium w-24 truncate" style={{ color }}>{cliente?.nombre}</span>
                    <input
                      type="number"
                      step="0.01"
                      placeholder="0.00"
                      value={gramosDevueltos}
                      onChange={e => handleClienteField(clienteId, 'gramosDevueltos', e.target.value)}
                      onBlur={saveToFirestore}
                      className="flex-1 border border-stone-300 rounded px-2 py-1 text-sm font-mono text-right"
                    />
                    <span className="text-xs text-stone-400">g</span>
                  </div>
                );
              })}
            </div>
          </div>

          <Button className="w-full" onClick={() => { saveToFirestore(); setShowResultadosModal(false); }}>Cerrar</Button>
          </div>
        </div>
      </div>
    );
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-amber-50 via-white to-orange-50 flex items-center justify-center">
        <div className="text-center">
          <div className="text-4xl mb-4">✋</div>
          <p className="text-amber-800 font-medium">Cargando Ma d'Or...</p>
        </div>
      </div>
    );
  }

  // Gate: require valid code in URL
  if (codigoInvalido) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-amber-50 via-white to-orange-50 flex items-center justify-center p-4">
        <div className="bg-white border border-amber-300 rounded-2xl p-8 shadow-xl max-w-sm w-full text-center">
          <div className="text-4xl mb-4">🔐</div>
          <h1 className="text-xl font-bold text-amber-800 mb-2">Ma d'Or Tracker</h1>
          {!codigoUrl ? (
            <p className="text-stone-600 mb-4">Necesitas un código de acceso para entrar.</p>
          ) : (
            <p className="text-red-600 mb-4">Código de acceso inválido.</p>
          )}
          <p className="text-stone-500 text-sm">Contacta con el administrador para obtener tu código de acceso.</p>
        </div>
      </div>
    );
  }

  // Total pendientes across E53+ expeditions for tab badge
  const totalPendientes = expediciones.reduce((sum, exp) => {
    if (getExpNum(exp.nombre) <= 52) return sum;
    const expPaqs = paquetes.filter(p => p.expedicionId === exp.id);
    return sum + expPaqs.filter(p => !p.precioFino || !p.factura || !(p.verificacionIA?.validado && p.verificacionIA?.archivoNombre === p.factura?.nombre)).length;
  }, 0);

  // Check expeditions with logistics pending (has export date but missing matricula/bultos/hora)
  const expedicionesLogisticaPendiente = expediciones.filter(exp => {
    if (!exp.fechaExportacion) return false;
    // Check if any logistics field is missing
    return !exp.matriculaId || !exp.bultos || !exp.horaExportacion;
  });
  const logisticaPendienteCount = expedicionesLogisticaPendiente.length;

  if (showLingotes) {
    return (
      <LingotesTracker
        clientes={clientes}
        exportaciones={lingotesExportaciones}
        entregas={lingotesEntregas}
        futuraLingotes={lingotesFutura}
        facturas={lingotesFacturas}
        config={lingotesConfig}
        currentUser={usuarioActual?.nombre || 'Usuario'}
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
        onSaveFactura={saveLingoteFactura}
        onDeleteFactura={deleteLingoteFactura}
        onUpdateFactura={updateLingoteFactura}
      />
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-amber-50 via-white to-orange-50 text-stone-800">
      {/* Header + Nav sticky */}
      <div className="sticky top-0 z-40">
        <header className="bg-gradient-to-r from-stone-700 to-stone-600 border-b border-stone-500 p-3 shadow-md">
          <div className="flex items-center justify-between max-w-2xl mx-auto">
            <div className="flex items-center gap-2 cursor-pointer" onClick={() => setShowLingotes(true)}>
              <span className="text-2xl">✋</span>
              <h1 className="text-xl font-bold text-white drop-shadow-sm">Ma d'Or</h1>
              <span className="text-xs text-white/50 font-mono">v1.0</span>
            </div>
            <div className="flex items-center gap-2">
              {/* Indicador de logística pendiente */}
              {logisticaPendienteCount > 0 && (
                <div
                  className="flex items-center gap-1 bg-orange-500 text-white text-xs px-2 py-1 rounded-full cursor-pointer animate-pulse"
                  onClick={() => {
                    const expPendiente = expedicionesLogisticaPendiente[0];
                    if (expPendiente) {
                      openModal('expedicion', expPendiente);
                    }
                  }}
                  title={`${logisticaPendienteCount} expedición(es) con logística pendiente`}
                >
                  <span>🚗</span>
                  <span className="font-bold">{logisticaPendienteCount}</span>
                </div>
              )}
              {/* Indicador usuario activo */}
              <span className="text-white/80 text-sm">{getUsuario(usuarioActivo)?.nombre}</span>
              <Button
                onClick={() => openModal('paquete')}
                className="bg-white text-blue-600 hover:bg-blue-50 text-sm px-3 py-1"
              >
                + Paquete
              </Button>
            </div>
          </div>
        </header>
        
        {/* Navigation */}
        <nav className="bg-white border-b border-amber-200 flex shadow-sm">
          <TabButton id="expediciones" label="Expediciones" icon="📦" badge={totalPendientes} />
          <TabButton id="clientes" label="Clientes" icon="👥" />
          <TabButton id="parametros" label="Parámetros" icon="⚙️" />
          <TabButton id="estadisticas" label="Stats" icon="📊" />
        </nav>
        
        {/* Subnavegación contextual */}
        {activeTab === 'expediciones' && (selectedExpedicion || selectedPaquete) && (
          <div className="bg-amber-50 border-b border-amber-200 px-4 py-2">
            <div className="flex items-center gap-2 max-w-2xl mx-auto">
              {selectedPaquete ? (
                (() => {
                  const paq = paquetes.find(p => p.id === selectedPaquete);
                  const cliente = paq ? getCliente(paq.clienteId) : null;
                  const categoria = paq ? getCategoria(paq.categoriaId) : null;
                  const totales = paq ? calcularTotalesPaquete(paq, getExpedicionPrecioPorDefecto(paq?.expedicionId)) : null;
                  return (
                    <>
                      <Button variant="ghost" size="sm" onClick={() => setSelectedPaquete(null)}>← Volver</Button>
                      <h2 className="text-lg font-bold text-amber-800">{paq?.nombre}</h2>
                      {cliente && (
                        <span 
                          className="text-xs px-2 py-1 rounded font-bold"
                          style={{ backgroundColor: (cliente.color || '#f59e0b') + '20', color: cliente.color || '#f59e0b' }}
                        >{cliente.abreviacion || cliente.nombre}</span>
                      )}
                      {totales && totales.totalFra > 0 && (
                        <span 
                          className="text-sm font-mono font-bold ml-auto"
                          style={{ color: cliente?.color || '#f59e0b' }}
                        >{formatNum(totales.totalFra)}€</span>
                      )}
                      {categoria?.esFino && (
                        <span className="bg-amber-200 text-amber-800 text-xs px-2 py-1 rounded font-medium">FINO</span>
                      )}
                    </>
                  );
                })()
              ) : selectedExpedicion ? (
                <>
                  <Button variant="ghost" size="sm" onClick={() => setSelectedExpedicion(null)}>← Volver</Button>
                  <h2 className="text-lg font-bold text-amber-800 flex-1">Expedición {expediciones.find(e => e.id === selectedExpedicion)?.nombre}</h2>
                  <select
                    value={ordenVista}
                    onChange={(e) => setOrdenVista(e.target.value)}
                    className="bg-amber-100 border border-amber-300 rounded-lg px-2 py-1 text-sm text-amber-800 font-medium focus:outline-none focus:border-amber-500"
                  >
                    <option value="normal">📋 Normal</option>
                    <option value="pendientes">⚠️ Pendientes</option>
                    <option value="cliente">👥 Por cliente</option>
                    <option value="estado">📍 Por estado</option>
                    <option value="categoria">🏷️ Por categoría</option>
                  </select>
                </>
              ) : null}
            </div>
          </div>
        )}
      </div>
      
      {/* Content */}
      <main className="p-4 pb-20 max-w-2xl mx-auto">
        {activeTab === 'expediciones' && <ExpedicionesTab />}
        {activeTab === 'clientes' && <ClientesTab />}
        {activeTab === 'parametros' && <ParametrosTab />}
        {activeTab === 'estadisticas' && <EstadisticasTab />}
      </main>
      
      {/* Modals */}
      {modalOpen && <ModalForm />}
      {showTextModal && <TextModal />}
      <CategoriasResumenModal />
      {ResultadosModal()}
    </div>
  );
}
