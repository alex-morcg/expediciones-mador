import React, { useState, useMemo, useEffect } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { useFirestore } from './hooks/useFirestore';

// Formateo numérico europeo (100.000,25)
const formatNum = (num, decimals = 2) => {
  if (num === null || num === undefined || isNaN(num)) return '-';
  return num.toLocaleString('de-DE', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
};

const formatEur = (num) => formatNum(num, 2) + ' €';
const formatGr = (num, decimals = 2) => formatNum(num, decimals) + ' g';

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
  // Firestore data & CRUD
  const {
    categorias, clientes, expediciones, paquetes, estadosPaquete, usuarios,
    expedicionActualId, loading, setExpedicionActualId,
    saveCategoria: fsaveCategoria, deleteCategoria, saveCliente: fsaveCliente, deleteCliente, updateClienteKilatajes,
    saveExpedicion: fsaveExpedicion, deleteExpedicion, savePaquete: fsavePaquete, deletePaquete,
    addLineaToPaquete: faddLinea, removeLineaFromPaquete: fremoveLinea, updatePaqueteCierre: fupdateCierre,
    updatePaqueteFactura: fupdateFactura, updatePaqueteVerificacion: fupdateVerificacion,
    validarVerificacion: fvalidarVerificacion, updatePaqueteEstado: fupdateEstado,
    marcarTodosComoEstado: fmarcarTodos, addComentarioToPaquete: faddComentario,
    deleteComentarioFromPaquete: fdeleteComentario,
    agregarUsuario: fagregarUsuario, eliminarUsuario: feliminarUsuario,
    guardarEdicionUsuario: fguardarEdicionUsuario,
    agregarEstado: fagregarEstado, eliminarEstado: feliminarEstado,
    guardarEdicionEstado: fguardarEdicionEstado,
  } = useFirestore();

  // Local UI state
  const [activeTab, setActiveTab] = useState('expediciones');
  const [filtroExpedicionId, setFiltroExpedicionId] = useState(null);

  // Usuario activo (local session state)
  const [usuarioActivo, setUsuarioActivo] = useState(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      const userParam = params.get('user');
      if (userParam) return userParam;
    }
    return null;
  });

  // Set default user once loaded
  useEffect(() => {
    if (!loading && usuarios.length > 0 && !usuarioActivo) {
      setUsuarioActivo(usuarios[0].id);
    }
  }, [loading, usuarios, usuarioActivo]);

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

  const calcularTotalesPaquete = (paquete) => {
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
    
    if (!paquete.precioFino) {
      return { finoTotal: finoTotalPeso, finoTotalCalculo, brutoTotal: brutoTotalPeso, base: 0, descuento: 0, baseCliente: 0, igi: 0, totalFra: 0, fraJofisa: 0, margen: 0 };
    }
    
    const base = finoTotalCalculo * paquete.precioFino;
    const descuento = base * (paquete.descuento / 100);
    const baseCliente = base - descuento;
    const igi = baseCliente * (paquete.igi / 100);
    const totalFra = baseCliente + igi;
    const cierreJofisa = paquete.cierreJofisa || (paquete.precioFino - 0.25);
    const fraJofisa = cierreJofisa * finoTotalCalculo;
    const margen = fraJofisa - baseCliente;
    
    return { finoTotal: finoTotalPeso, finoTotalCalculo, brutoTotal: brutoTotalPeso, base, descuento, baseCliente, igi, totalFra, fraJofisa, margen, cierreJofisa };
  };

  const calcularTotalesExpedicion = (expedicionId) => {
    const expedicionPaquetes = paquetes.filter(p => p.expedicionId === expedicionId);
    
    let sumaBruto = 0;
    let sumaFino = 0;
    let totalFra = 0;
    let totalFraJofisa = 0;
    let totalMargen = 0;
    const porCategoria = {};
    
    expedicionPaquetes.forEach(paq => {
      const totales = calcularTotalesPaquete(paq);
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
    });
    
    const precioMedioBruto = sumaBruto > 0 ? totalFra / sumaBruto : 0;
    
    Object.keys(porCategoria).forEach(key => {
      porCategoria[key].precioMedioBruto = porCategoria[key].bruto > 0 
        ? porCategoria[key].totalFra / porCategoria[key].bruto 
        : 0;
    });
    
    return { sumaBruto, sumaFino, totalFra, totalFraJofisa, totalMargen, precioMedioBruto, porCategoria, numPaquetes: expedicionPaquetes.length };
  };

  const getPrecioRefExpedicion = (expedicionId) => {
    const expedicionPaquetes = paquetes.filter(p => p.expedicionId === expedicionId && p.precioFino);
    if (expedicionPaquetes.length === 0) return null;
    // Ordenar por id (más reciente último) y coger el último precio fino
    const sorted = [...expedicionPaquetes].sort((a, b) => b.id - a.id);
    return sorted[0]?.precioFino || null;
  };

  const generarTexto = (paquete) => {
    const totales = calcularTotalesPaquete(paquete);
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
  const removeLineaFromPaquete = (paqueteId, lineaId) => fremoveLinea(paqueteId, lineaId, usuarioActivo);
  const updatePaqueteCierre = (paqueteId, precioFino, cierreJofisa) => fupdateCierre(paqueteId, precioFino, cierreJofisa, usuarioActivo);
  const updatePaqueteFactura = (paqueteId, factura) => fupdateFactura(paqueteId, factura, usuarioActivo);
  const updatePaqueteVerificacion = (paqueteId, verificacionIA) => fupdateVerificacion(paqueteId, verificacionIA, usuarioActivo);
  const validarVerificacion = (paqueteId) => fvalidarVerificacion(paqueteId, usuarioActivo);
  const updatePaqueteEstado = (paqueteId, estado) => fupdateEstado(paqueteId, estado, usuarioActivo, estadosPaquete);
  const marcarTodosComoEstado = (expedicionId, estadoId) => { fmarcarTodos(expedicionId, estadoId, usuarioActivo, estadosPaquete); setMarcarTodosModal({ open: false, estadoId: null }); };
  const addComentarioToPaquete = (paqueteId, texto) => faddComentario(paqueteId, texto, usuarioActivo);
  const deleteComentarioFromPaquete = (paqueteId, comentarioId) => fdeleteComentario(paqueteId, comentarioId, usuarioActivo);

  // Tab content components
  const TabButton = ({ id, label, icon }) => (
    <button
      onClick={() => setActiveTab(id)}
      className={`flex-1 py-3 px-2 text-xs sm:text-sm font-medium transition-all duration-300 ${
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
      
      const totales = calcularTotalesPaquete(paq);
      
      // Extraer base64 sin el prefijo data:...
      const base64Data = paq.factura.data.split(',')[1];
      
      const prompt = `Analiza esta factura/albarán y extrae SOLO el importe TOTAL final de la factura (el que pagaría el cliente). 
Responde SOLO con un JSON así, sin texto adicional:
{"total": número}

El número debe usar punto decimal, no coma. Si no encuentras el total, pon {"total": null}`;

      // Construir el contenido según el tipo de archivo
      const archivoContent = esImagen 
        ? {
            type: 'image',
            source: {
              type: 'base64',
              media_type: paq.factura.tipo,
              data: base64Data
            }
          }
        : {
            type: 'document',
            source: {
              type: 'base64',
              media_type: 'application/pdf',
              data: base64Data
            }
          };

      try {
        const response = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: 'claude-sonnet-4-20250514',
            max_tokens: 200,
            messages: [{
              role: 'user',
              content: [
                archivoContent,
                { type: 'text', text: prompt }
              ]
            }]
          })
        });

        const data = await response.json();
        const respuestaTexto = data.content?.[0]?.text || '';
        
        // Intentar parsear JSON de la respuesta
        let totalFactura = null;
        try {
          const jsonMatch = respuestaTexto.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            const parsed = JSON.parse(jsonMatch[0]);
            totalFactura = parsed.total;
          }
        } catch (e) {
          // No se pudo parsear
        }
        
        if (totalFactura === null) {
          alert('No se pudo leer el total de la factura');
          setVerificandoFactura(false);
          return;
        }
        
        // Calcular diferencia y guardar
        const diferencia = totalFactura - totales.totalFra;
        
        updatePaqueteVerificacion(paq.id, {
          totalFactura,
          totalPaquete: totales.totalFra,
          diferencia,
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
      
      const totales = calcularTotalesPaquete(paq);
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
                        onChange={(e) => {
                          const precio = parseFloat(e.target.value) || 0;
                          setCierreData({ precioFino: e.target.value, cierreJofisa: (precio - 0.25).toFixed(2) });
                        }}
                        className="w-full bg-white rounded-lg px-3 py-2 text-stone-800 placeholder-stone-400 focus:outline-none"
                        style={{ border: `1px solid ${clienteColor}50` }}
                      />
                    </div>
                    <div className="flex-1 min-w-0">
                      <label className="block text-xs mb-1" style={{ color: clienteColor }}>Cierre Jofisa</label>
                      <input
                        type="number"
                        placeholder="€/g"
                        value={cierreData.cierreJofisa || paq.cierreJofisa || ''}
                        onChange={(e) => setCierreData({ ...cierreData, cierreJofisa: e.target.value })}
                        className="w-full rounded-lg px-3 py-2 placeholder-stone-400 focus:outline-none"
                        style={esIncorrecto 
                          ? { backgroundColor: '#fef2f2', border: '2px solid #f87171', color: '#991b1b' }
                          : { backgroundColor: 'white', border: `1px solid ${clienteColor}50`, color: '#1c1917' }
                        }
                      />
                      {esIncorrecto && (
                        <p className="text-red-600 text-xs mt-1">Esperado: {formatNum(esperado, 2)} (−0,25)</p>
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
            <div className="space-y-2 text-sm font-mono">
              <div className="flex justify-between"><span className="text-stone-500">Fino (peso):</span><span className="text-stone-800 font-medium">{formatNum(totales.finoTotal, 2)} g</span></div>
              {totales.finoTotalCalculo !== totales.finoTotal && (
                <div className="flex justify-between"><span className="text-stone-500">Fino (cálculo €):</span><span style={{ color: clienteColor }} className="font-medium">{formatNum(totales.finoTotalCalculo, 2)} g</span></div>
              )}
              <div className="flex justify-between"><span className="text-stone-500">Base:</span><span className="text-stone-800 font-medium">{formatNum(totales.base)} €</span></div>
              <div className="flex justify-between"><span className="text-stone-500">Descuento ({paq.descuento}%):</span><span className="text-red-600 font-medium">-{formatNum(totales.descuento)} €</span></div>
              <div className="flex justify-between pt-2" style={{ borderTop: `1px solid ${clienteColor}30` }}><span className="text-stone-500">Base cliente:</span><span className="text-stone-800 font-medium">{formatNum(totales.baseCliente)} €</span></div>
              <div className="flex justify-between"><span className="text-stone-500">IGI ({paq.igi}%):</span><span className="text-stone-800 font-medium">+{formatNum(totales.igi)} €</span></div>
              <div className="flex justify-between pt-2 text-base" style={{ borderTop: `1px solid ${clienteColor}30` }}><span className="font-bold" style={{ color: clienteColor }}>Total Fra:</span><span className="font-bold" style={{ color: clienteColor }}>{formatNum(totales.totalFra)} €</span></div>
              <div className="flex justify-between mt-4 pt-2" style={{ borderTop: `1px solid ${clienteColor}30` }}><span className="text-stone-500">Fra a Jofisa:</span><span className="text-stone-800 font-medium">{formatNum(totales.fraJofisa)} €</span></div>
              <div className="flex justify-between"><span className="text-stone-500">Margen:</span><span className={totales.margen >= 0 ? 'text-green-600 font-medium' : 'text-red-600 font-medium'}>{formatNum(totales.margen)} €</span></div>
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
            📋 Generar Texto OrCash
          </button>
          
          <Card style={{ backgroundColor: clienteColor + '10', borderColor: clienteColor + '40' }}>
            <h3 className="font-semibold mb-3" style={{ color: clienteColor }}>📄 Factura</h3>
            {paq.factura ? (
              <div className="space-y-2">
                {paq.factura.tipo?.startsWith('image/') ? (
                  <img 
                    src={paq.factura.data} 
                    alt="Factura" 
                    className="w-full rounded-lg cursor-pointer"
                    style={{ border: `1px solid ${clienteColor}30` }}
                    onClick={() => window.open(paq.factura.data, '_blank')}
                  />
                ) : (
                  <div className="bg-white/50 rounded-lg p-3 flex items-center gap-3" style={{ border: `1px solid ${clienteColor}30` }}>
                    <span className="text-2xl">📎</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-stone-800 font-medium truncate">{paq.factura.nombre}</p>
                      <p className="text-stone-500 text-xs">PDF</p>
                    </div>
                    <Button size="sm" onClick={() => window.open(paq.factura.data, '_blank')}>Ver</Button>
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
                      <div className="flex justify-between border-t border-current/10 pt-1 mt-1">
                        <span className="font-medium">Diferencia:</span>
                        <span className={`font-mono font-bold ${
                          Math.abs(paq.verificacionIA.diferencia) < 0.5
                            ? 'text-green-600'
                            : 'text-orange-600'
                        }`}>
                          {paq.verificacionIA.diferencia >= 0 ? '+' : ''}{formatNum(paq.verificacionIA.diferencia)} €
                        </span>
                      </div>
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
            <Button variant="danger" className="flex-1" onClick={() => { deletePaquete(paq.id); setSelectedPaquete(null); }}>Eliminar</Button>
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
              </div>
              <div>
                <span className="text-stone-500">Fra Jofisa</span>
                <p className="text-stone-800 font-mono font-medium">{formatNum(totales.totalFraJofisa)} €</p>
              </div>
              <div>
                <span className="text-stone-500">Margen Total</span>
                <p className={`font-mono font-medium ${totales.totalMargen >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                  {formatNum(totales.totalMargen)} €
                </p>
              </div>
              <div>
                <span className="text-stone-500">€/g Bruto Medio</span>
                <p className="text-stone-800 font-mono font-medium">{formatNum(totales.precioMedioBruto)} €</p>
              </div>
            </div>
          </Card>
          
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
              const sortedPaquetes = [...expedicionPaquetes].sort((a, b) => {
                if (ordenVista === 'cliente') {
                  const clienteA = getCliente(a.clienteId)?.nombre || '';
                  const clienteB = getCliente(b.clienteId)?.nombre || '';
                  if (clienteA !== clienteB) return clienteA.localeCompare(clienteB);
                } else if (ordenVista === 'estado') {
                  const estadoIndexA = estadosPaquete.findIndex(e => e.id === a.estado);
                  const estadoIndexB = estadosPaquete.findIndex(e => e.id === b.estado);
                  const indexA = estadoIndexA === -1 ? 999 : estadoIndexA;
                  const indexB = estadoIndexB === -1 ? 999 : estadoIndexB;
                  if (indexA !== indexB) return indexA - indexB;
                } else if (ordenVista === 'categoria') {
                  const catA = getCategoria(a.categoriaId)?.nombre || '';
                  const catB = getCategoria(b.categoriaId)?.nombre || '';
                  if (catA !== catB) return catA.localeCompare(catB);
                }
                return a.numero - b.numero;
              });
              
              // Pre-calcular suma de bruto por cliente
              const brutoPorCliente = {};
              expedicionPaquetes.forEach(paq => {
                const totales = calcularTotalesPaquete(paq);
                if (!brutoPorCliente[paq.clienteId]) {
                  brutoPorCliente[paq.clienteId] = 0;
                }
                brutoPorCliente[paq.clienteId] += totales.brutoTotal;
              });
              
              // Pre-calcular suma de bruto por categoría
              const brutoPorCategoria = {};
              expedicionPaquetes.forEach(paq => {
                const totales = calcularTotalesPaquete(paq);
                if (!brutoPorCategoria[paq.categoriaId]) {
                  brutoPorCategoria[paq.categoriaId] = 0;
                }
                brutoPorCategoria[paq.categoriaId] += totales.brutoTotal;
              });
              
              let lastClienteId = null;
              let lastEstadoId = null;
              let lastCategoriaId = null;
              
              return sortedPaquetes.map(paq => {
                const paqTotales = calcularTotalesPaquete(paq);
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
                      onClick={() => setSelectedPaquete(paq.id)}
                      style={{ 
                        backgroundColor: cliente?.color ? cliente.color + '10' : undefined, 
                        borderColor: cliente?.color ? cliente.color + '40' : undefined 
                      }}
                    >
                      <div className="flex justify-between items-start">
                        <div className="flex items-start gap-2">
                          {validado ? (
                            <span className="text-green-500 text-lg">✓</span>
                          ) : tieneVerificacion ? (
                            <span className="text-amber-500 text-lg">○</span>
                          ) : null}
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
                          <p className="text-amber-700 font-mono text-sm font-medium">{formatNum(paqTotales.totalFra)} €</p>
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
            return 0;
          }).map(exp => {
            const totales = calcularTotalesExpedicion(exp.id);
            const esActual = exp.id === expedicionActualId;
            const precioRef = getPrecioRefExpedicion(exp.id);
            return (
              <Card key={exp.id} onClick={() => setSelectedExpedicion(exp.id)} className={esActual ? 'ring-2 ring-amber-400' : ''}>
                <div className="flex justify-between items-start">
                  <div>
                    <h3 className="text-stone-800 font-bold text-lg">{exp.nombre} {esActual && <span className="text-amber-500">★</span>}</h3>
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
                  <Button size="sm" variant="danger" onClick={(e) => { e.stopPropagation(); deleteExpedicion(exp.id); }}>Eliminar</Button>
                </div>
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
                  <Button size="sm" variant="danger" onClick={() => deleteCliente(cliente.id)}>×</Button>
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
            </Card>
          ))}
          {clientes.length === 0 && (
            <p className="text-stone-400 text-center py-8">No hay clientes. Crea uno nuevo.</p>
          )}
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
      if (usuarioActivo === id) {
        const otroUsuario = usuarios.find(u => u.id !== id);
        if (otroUsuario) setUsuarioActivo(otroUsuario.id);
      }
      try {
        await feliminarUsuario(id);
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
        {/* Sección Usuarios */}
        <div>
          <h2 className="text-xl font-bold text-amber-800 mb-4">👥 Usuarios</h2>
          
          {/* Usuario activo */}
          <Card className="mb-3">
            <div className="flex items-center justify-between">
              <span className="text-stone-600 text-sm">Usuario activo:</span>
              <select
                value={usuarioActivo}
                onChange={(e) => setUsuarioActivo(e.target.value)}
                className="bg-amber-50 border border-amber-300 rounded-lg px-3 py-1 text-stone-800 font-medium focus:outline-none focus:border-amber-500"
              >
                {usuarios.map(u => (
                  <option key={u.id} value={u.id}>{u.nombre}</option>
                ))}
              </select>
            </div>
          </Card>
          
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
                    <span className="flex-1 text-stone-800 font-medium">{u.nombre}</span>
                  )}
                  {u.id === usuarioActivo && <span className="text-amber-500 text-xs">✓ Activo</span>}
                  <div className="flex gap-1">
                    {editandoUsuarioId === u.id ? (
                      <button onClick={() => guardarEdicionUsuario(u.id)} className="text-green-600 px-2">✓</button>
                    ) : (
                      <>
                        <button onClick={() => { setEditandoUsuarioId(u.id); setNombreUsuarioEditado(u.nombre); }} className="text-amber-600 hover:text-amber-800 px-1 text-sm">✏️</button>
                        <button onClick={() => eliminarUsuario(u.id)} className="text-red-400 hover:text-red-600 px-1 text-sm">🗑️</button>
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
                    <Button size="sm" variant="danger" onClick={() => deleteCategoria(cat.id)}>×</Button>
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
    // Preparar datos para el gráfico: bruto por expedición y cliente
    const chartData = useMemo(() => {
      return expediciones.map(exp => {
        const dataPoint = { expedicion: exp.nombre };
        
        // Para cada cliente, sumar el bruto de sus paquetes en esta expedición
        clientes.forEach(cliente => {
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
    }, [expediciones, clientes, paquetes]);

    return (
      <div className="space-y-4">
        <h2 className="text-xl font-bold text-amber-800">Estadísticas</h2>
        
        <Card>
          <h3 className="text-amber-600 font-semibold mb-4">📊 Volumen Bruto por Expedición y Cliente</h3>
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
                {clientes.map((cliente) => (
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

        {/* Tabla resumen */}
        <Card>
          <h3 className="text-amber-600 font-semibold mb-3">📋 Resumen por Cliente</h3>
          <div className="space-y-2">
            {clientes.map((cliente) => {
              const totalBruto = paquetes
                .filter(p => p.clienteId === cliente.id)
                .reduce((sum, paq) => sum + paq.lineas.reduce((s, l) => s + Math.max(0, l.bruto), 0), 0);
              const numPaquetes = paquetes.filter(p => p.clienteId === cliente.id).length;
              
              if (numPaquetes === 0) return null;
              
              return (
                <div key={cliente.id} className="flex justify-between items-center py-2 border-b border-amber-100 last:border-0">
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
          return { ...editingItem, esActual: expedicionActualId === editingItem.id };
        }
        // Auto-suggest next expedition number
        const maxNum = expediciones.reduce((max, exp) => {
          const match = exp.nombre?.match(/^E(\d+)$/);
          return match ? Math.max(max, parseInt(match[1])) : max;
        }, 0);
        const suggestedName = maxNum > 0 ? `E${maxNum + 1}` : '';
        return { nombre: suggestedName, fechaExportacion: null, esActual: false };
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

    const handleClose = () => {
      if (modalType === 'paquete' && !editingItem) {
        const hasData = formData.lineas?.length > 0 || formData.precioFino;
        if (hasData) {
          setShowConfirmExit(true);
          return;
        }
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
            <h3 className="text-xl font-bold text-amber-800">
              {modalType === 'paquete' 
                ? `Paquete ${getPaqueteTitulo()}`
                : `${editingItem ? 'Editar' : 'Nueva'} ${modalType}`
              }
            </h3>
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
                label="Fecha de exportación" 
                type="date"
                value={formData.fechaExportacion || ''} 
                onChange={(e) => setFormData({ ...formData, fechaExportacion: e.target.value || null })}
              />
              <div className="mb-3">
                <Checkbox 
                  label="Expedición actual (para nuevos paquetes)" 
                  checked={formData.esActual || false} 
                  onChange={(e) => setFormData({ ...formData, esActual: e.target.checked })}
                />
              </div>
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
                    {expediciones.map(e => (
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
              </div>
              
              {/* Cierre */}
              <div className="border-t border-amber-200 pt-3 mt-3">
                <h4 className="text-amber-700 font-medium mb-2">🔒 Cierre (opcional)</h4>
                <div className="flex gap-2">
                  <div className="flex-1 min-w-0">
                    <label className="block text-amber-800 text-xs mb-1">Precio Fino €/g</label>
                    <input
                      type="number"
                      step="0.01"
                      value={formData.precioFino || ''}
                      onChange={(e) => {
                        const precio = parseFloat(e.target.value) || 0;
                        setFormData({ 
                          ...formData, 
                          precioFino: e.target.value ? precio : null,
                          cierreJofisa: precio ? precio - 0.25 : null
                        });
                      }}
                      className="w-full bg-white border border-amber-300 rounded-lg px-3 py-2 text-sm text-stone-800 focus:outline-none focus:border-amber-500"
                    />
                  </div>
                  <div className="flex-1 min-w-0">
                    <label className="block text-amber-800 text-xs mb-1">Cierre Jofisa</label>
                    <input
                      type="number"
                      step="0.01"
                      value={formData.cierreJofisa || ''}
                      onChange={(e) => setFormData({ ...formData, cierreJofisa: parseFloat(e.target.value) || null })}
                      className="w-full bg-white border border-amber-300 rounded-lg px-3 py-2 text-sm text-stone-800 focus:outline-none focus:border-amber-500"
                    />
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
        <h3 className="text-xl font-bold text-amber-800 mb-4">📋 Texto OrCash</h3>
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

  return (
    <div className="min-h-screen bg-gradient-to-br from-amber-50 via-white to-orange-50 text-stone-800">
      {/* Header + Nav sticky */}
      <div className="sticky top-0 z-40">
        <header className="bg-gradient-to-r from-stone-700 to-stone-600 border-b border-stone-500 p-3 shadow-md">
          <div className="flex items-center justify-between max-w-2xl mx-auto">
            <div className="flex items-center gap-2">
              <span className="text-2xl">✋</span>
              <h1 className="text-xl font-bold text-white drop-shadow-sm">Ma d'Or</h1>
              <span className="text-xs text-white/50 font-mono">v0.2</span>
            </div>
            <div className="flex items-center gap-2">
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
          <TabButton id="expediciones" label="Expediciones" icon="📦" />
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
                  const totales = paq ? calcularTotalesPaquete(paq) : null;
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
    </div>
  );
}
