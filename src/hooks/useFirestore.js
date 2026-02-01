import { useState, useEffect, useRef, useCallback } from 'react';
import {
  collection,
  doc,
  onSnapshot,
  addDoc,
  updateDoc,
  deleteDoc,
  setDoc,
  getDoc,
  getDocs,
  query,
  where,
  orderBy,
  writeBatch,
} from 'firebase/firestore';
import { db } from '../firebase';

// Helper para calcular fino de una línea (mismo cálculo que en mador-tracker.jsx)
const calcularFinoLinea = (bruto, ley) => {
  const fino = bruto * (ley / 1000);
  return Math.trunc(fino * 100) / 100;
};

// Helper para calcular totales de un paquete (versión simplificada para recálculo)
const calcularTotalFraPaquete = (paquete, cliente) => {
  const noCuentaNegativas = cliente?.lineasNegativasNoCuentanPeso ?? true;

  // Para cálculo de €: incluimos TODAS las líneas (incluso negativas)
  const finoTotalCalculo = paquete.lineas.reduce((sum, l) => sum + calcularFinoLinea(l.bruto, l.ley), 0);

  const precioEfectivo = paquete.precioFino || null;
  if (!precioEfectivo) return null;

  const base = finoTotalCalculo * precioEfectivo;
  const descuento = base * (paquete.descuento / 100);
  const baseCliente = base - descuento;
  const igi = baseCliente * (paquete.igi / 100);
  const totalFra = baseCliente + igi;

  return totalFra;
};

// Helper para comparar pesos del paquete con los extraídos por la IA
// Retorna { pesosCuadran, observaciones }
const compararPesosConIA = (lineasPaquete, pesosIA) => {
  if (!pesosIA || !pesosIA.length) {
    return { pesosCuadran: true, observaciones: 'Sin pesos de IA para comparar' };
  }

  // Crear copia de pesos IA para ir marcando los que coinciden
  const pesosIARestantes = [...pesosIA];
  const discrepancias = [];

  // Para cada línea del paquete, buscar coincidencia en pesos IA
  for (const linea of lineasPaquete) {
    const bruto = Math.abs(linea.bruto); // Ignorar signo para comparar
    const ley = linea.ley;

    // Buscar coincidencia - solo por bruto si la IA no tiene ley
    const idx = pesosIARestantes.findIndex(p => {
      const brutoIA = Math.abs(p.bruto || 0);
      const leyIA = p.ley;
      // Si la IA tiene ley, comparar ambos; si no, solo bruto
      if (leyIA != null) {
        return Math.abs(brutoIA - bruto) < 0.5 && Math.abs(leyIA - ley) < 5;
      } else {
        return Math.abs(brutoIA - bruto) < 0.5;
      }
    });

    if (idx >= 0) {
      // Encontrado, quitar de la lista
      pesosIARestantes.splice(idx, 1);
    } else {
      // No encontrado en factura
      discrepancias.push(`Línea ${bruto}g x ${ley} no está en factura`);
    }
  }

  // Los pesos IA restantes son los que están en factura pero no en paquete
  for (const p of pesosIARestantes) {
    const brutoIA = p.bruto || 0;
    discrepancias.push(`Línea ${brutoIA}g en factura no está en paquete`);
  }

  const pesosCuadran = discrepancias.length === 0;
  const observaciones = discrepancias.length > 0 ? discrepancias.join('; ') : 'Pesos coinciden';

  return { pesosCuadran, observaciones };
};

// Seed data — used only on first run when Firestore is empty
const seedCategorias = [
  { nombre: 'Lingote Chatarra 18K', esFino: false },
  { nombre: 'Chatarra', esFino: false },
  { nombre: 'lingot o làmina amb llei menor a 995', esFino: true },
  { nombre: 'Lingote Chatarra 22K', esFino: false },
  { nombre: 'Lingote fino', esFino: true },
  { nombre: 'Milla Chatarra', esFino: false },
];

const seedClientes = [
  { nombre: 'Gaudia', abreviacion: 'GAU', color: '#f59e0b', descuentoEstandar: 5, descuentoFino: 5, lineasNegativasNoCuentanPeso: true, kilatajes: [] },
  { nombre: "Gemma d'Or", abreviacion: 'GEM', color: '#3b82f6', descuentoEstandar: 6.5, descuentoFino: 6, lineasNegativasNoCuentanPeso: true, kilatajes: [] },
  { nombre: "La Milla d'Or", abreviacion: 'MIL', color: '#10b981', descuentoEstandar: 6.5, descuentoFino: 6.5, lineasNegativasNoCuentanPeso: true, kilatajes: [] },
  { nombre: 'OrCash', abreviacion: 'ORC', color: '#8b5cf6', descuentoEstandar: 5, descuentoFino: 5, lineasNegativasNoCuentanPeso: true, kilatajes: [] },
  { nombre: 'Nova Joia', abreviacion: 'NOV', color: '#ef4444', descuentoEstandar: 6.5, descuentoFino: 6.5, lineasNegativasNoCuentanPeso: true, kilatajes: [] },
  { nombre: 'Alquimia', abreviacion: 'ALQ', color: '#ec4899', descuentoEstandar: 6.5, descuentoFino: 6.5, lineasNegativasNoCuentanPeso: true, kilatajes: [] },
  { nombre: 'Mador stock', abreviacion: 'MAD', color: '#06b6d4', descuentoEstandar: 0, descuentoFino: 0, lineasNegativasNoCuentanPeso: true, kilatajes: [] },
  { nombre: 'Contratos particulares', abreviacion: 'PAR', color: '#84cc16', descuentoEstandar: 6.5, descuentoFino: 6.5, lineasNegativasNoCuentanPeso: true, kilatajes: [] },
];

const seedExpediciones = [
  { nombre: 'E50', precioOro: 110 },
  { nombre: 'E51', precioOro: 112 },
  { nombre: 'E52', precioOro: 120 },
  { nombre: 'E53', precioOro: 138 },
];

// Generar código único de 8 caracteres alfanuméricos
const generarCodigoUsuario = () => {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let codigo = '';
  for (let i = 0; i < 8; i++) {
    codigo += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return codigo;
};

const seedUsuarios = [
  { id: 'alex', nombre: 'Alex', codigo: 'admin001' }, // alex es especial - puede editar usuarios
  { id: 'maria', nombre: 'María', codigo: 'm4r1a001' },
  { id: 'pedro', nombre: 'Pedro', codigo: 'p3dr0001' },
  { id: 'ana', nombre: 'Ana', codigo: 'an4a0001' },
  { id: 'carlos', nombre: 'Carlos', codigo: 'c4rl0s01' },
];

const seedEstados = [
  { id: 'por_recoger', nombre: 'Por recoger', icon: '📍', color: '#ef4444' },
  { id: 'en_banco', nombre: 'En el banco', icon: '🏦', color: '#3b82f6' },
  { id: 'en_casa', nombre: 'En casa', icon: '🏠', color: '#10b981' },
];

// Map from old numeric IDs to new Firestore doc IDs (populated during seeding)
let categoriaIdMap = {};
let clienteIdMap = {};
let expedicionIdMap = {};

const seedPaquetes = [
  { expedicionIdx: 0, numero: 1, nombre: 'E50-1', clienteIdx: 0, categoriaIdx: 0, descuento: 5.0, igi: 4.5, precioFino: 106.17, cierreJofisa: 106.0, lineas: [{ id: 1, bruto: 262.85, ley: 708.0 }, { id: 2, bruto: 141.94, ley: 875.0 }] },
  { expedicionIdx: 0, numero: 2, nombre: 'E50-2', clienteIdx: 1, categoriaIdx: 2, descuento: 6.0, igi: 0.0, precioFino: 105.75, cierreJofisa: 105.5, lineas: [{ id: 3, bruto: 403.6, ley: 1000.0 }] },
  { expedicionIdx: 0, numero: 3, nombre: 'E50-3', clienteIdx: 1, categoriaIdx: 1, descuento: 6.5, igi: 4.5, precioFino: 105.87, cierreJofisa: 105.62, lineas: [{ id: 4, bruto: 161.1, ley: 910.0 }] },
  { expedicionIdx: 0, numero: 4, nombre: 'E50-4', clienteIdx: 0, categoriaIdx: 0, descuento: 5.0, igi: 4.5, precioFino: 106.3, cierreJofisa: 106.05, lineas: [{ id: 5, bruto: 208.4, ley: 708.0 }] },
  { expedicionIdx: 0, numero: 5, nombre: 'E50-5', clienteIdx: 0, categoriaIdx: 0, descuento: 5.0, igi: 4.5, precioFino: 116.61, cierreJofisa: 116.28, lineas: [{ id: 6, bruto: 617.83, ley: 708.0 }] },
  { expedicionIdx: 0, numero: 6, nombre: 'E50-6', clienteIdx: 2, categoriaIdx: 1, descuento: 6.5, igi: 4.5, precioFino: 108.65, cierreJofisa: 108.4, lineas: [{ id: 7, bruto: 3.36, ley: 780.0 }, { id: 8, bruto: 338.71, ley: 730.0 }, { id: 9, bruto: -10.0, ley: 1000.0 }] },
  { expedicionIdx: 0, numero: 7, nombre: 'E50-7', clienteIdx: 1, categoriaIdx: 0, descuento: 6.5, igi: 4.5, precioFino: 111.72, cierreJofisa: 111.47, lineas: [{ id: 10, bruto: 235.9, ley: 720.0 }] },
  { expedicionIdx: 0, numero: 8, nombre: 'E50-8', clienteIdx: 2, categoriaIdx: 1, descuento: 6.5, igi: 4.5, precioFino: 113.0, cierreJofisa: 112.75, lineas: [{ id: 11, bruto: 26.05, ley: 896.0 }, { id: 12, bruto: 7.09, ley: 780.0 }, { id: 13, bruto: 209.41, ley: 730.0 }] },
  { expedicionIdx: 0, numero: 9, nombre: 'E50-9', clienteIdx: 3, categoriaIdx: 1, descuento: 5.0, igi: 4.5, precioFino: 116.52, cierreJofisa: 116.27, lineas: [{ id: 14, bruto: 33.96, ley: 908.33 }, { id: 15, bruto: 34.52, ley: 916.67 }, { id: 16, bruto: 33.42, ley: 883.33 }, { id: 17, bruto: 16.67, ley: 891.67 }, { id: 18, bruto: 8.28, ley: 862.5 }] },
  { expedicionIdx: 0, numero: 10, nombre: 'E50-10', clienteIdx: 3, categoriaIdx: 1, descuento: 5.0, igi: 4.5, precioFino: 119.47, cierreJofisa: 119.22, lineas: [{ id: 19, bruto: 27.0, ley: 879.17 }, { id: 20, bruto: 27.08, ley: 887.5 }, { id: 21, bruto: 13.54, ley: 862.5 }, { id: 22, bruto: 8.07, ley: 879.17 }, { id: 23, bruto: 8.06, ley: 875.0 }, { id: 24, bruto: 7.98, ley: 912.5 }] },
  { expedicionIdx: 0, numero: 11, nombre: 'E50-11', clienteIdx: 4, categoriaIdx: 1, descuento: 6.5, igi: 4.5, precioFino: 118.91, cierreJofisa: 118.66, lineas: [{ id: 25, bruto: 76.3, ley: 994.0 }, { id: 26, bruto: 450.25, ley: 710.0 }, { id: 27, bruto: 81.41, ley: 670.0 }, { id: 28, bruto: 17.63, ley: 650.0 }, { id: 29, bruto: 9.79, ley: 540.0 }] },
  { expedicionIdx: 0, numero: 12, nombre: 'E50-12', clienteIdx: 0, categoriaIdx: 0, descuento: 5.0, igi: 4.5, precioFino: 118.53, cierreJofisa: 118.28, lineas: [{ id: 30, bruto: 445.88, ley: 708.0 }] },
  { expedicionIdx: 0, numero: 13, nombre: 'E50-13', clienteIdx: 1, categoriaIdx: 0, descuento: 6.5, igi: 4.5, precioFino: 117.05, cierreJofisa: 116.8, lineas: [{ id: 31, bruto: 394.7, ley: 720.0 }, { id: 32, bruto: 6.8, ley: 580.0 }] },
  { expedicionIdx: 1, numero: 1, nombre: 'E51-1', clienteIdx: 5, categoriaIdx: 0, descuento: 6.5, igi: 4.5, precioFino: 118.08, cierreJofisa: 117.83, lineas: [{ id: 33, bruto: 35.72, ley: 702.0 }] },
  { expedicionIdx: 0, numero: 15, nombre: 'E50-15', clienteIdx: 3, categoriaIdx: 0, descuento: 6.5, igi: 4.5, precioFino: 116.78, cierreJofisa: 116.53, lineas: [{ id: 34, bruto: 599.46, ley: 729.17 }] },
  { expedicionIdx: 0, numero: 16, nombre: 'E50-16', clienteIdx: 4, categoriaIdx: 1, descuento: 6.5, igi: 4.5, precioFino: 115.06, cierreJofisa: 118.66, lineas: [{ id: 35, bruto: 19.21, ley: 740.0 }, { id: 36, bruto: 314.1, ley: 710.0 }] },
  { expedicionIdx: 0, numero: 17, nombre: 'E50-17', clienteIdx: 1, categoriaIdx: 0, descuento: 6.5, igi: 4.5, precioFino: 111.63, cierreJofisa: 111.38, lineas: [{ id: 37, bruto: 186.0, ley: 720.0 }] },
  { expedicionIdx: 0, numero: 18, nombre: 'E50-18', clienteIdx: 3, categoriaIdx: 3, descuento: 5.0, igi: 4.5, precioFino: 112.72, cierreJofisa: 112.47, lineas: [{ id: 38, bruto: 201.77, ley: 912.0 }] },
  { expedicionIdx: 0, numero: 19, nombre: 'E50-19', clienteIdx: 3, categoriaIdx: 3, descuento: 5.0, igi: 4.5, precioFino: 113.68, cierreJofisa: 113.57, lineas: [{ id: 39, bruto: 644.2, ley: 912.0 }] },
  { expedicionIdx: 0, numero: 20, nombre: 'E50-20', clienteIdx: 3, categoriaIdx: 3, descuento: 6.5, igi: 4.5, precioFino: 113.68, cierreJofisa: 111.3, lineas: [{ id: 40, bruto: 644.2, ley: 912.0 }] },
  { expedicionIdx: 0, numero: 21, nombre: 'E50-21', clienteIdx: 2, categoriaIdx: 1, descuento: 6.5, igi: 4.5, precioFino: 111.58, cierreJofisa: 111.33, lineas: [{ id: 41, bruto: 22.84, ley: 896.0 }, { id: 42, bruto: 41.23, ley: 780.0 }, { id: 43, bruto: 520.79, ley: 730.0 }, { id: 44, bruto: 4.28, ley: 565.0 }, { id: 45, bruto: 3.9, ley: 500.0 }, { id: 46, bruto: 3.19, ley: 355.0 }] },
  { expedicionIdx: 0, numero: 22, nombre: 'E50-22', clienteIdx: 1, categoriaIdx: 0, descuento: 6.5, igi: 4.5, precioFino: 111.55, cierreJofisa: 111.3, lineas: [{ id: 47, bruto: 137.5, ley: 720.0 }, { id: 48, bruto: 76.2, ley: 720.0 }] },
  { expedicionIdx: 0, numero: 23, nombre: 'E50-23', clienteIdx: 6, categoriaIdx: 2, descuento: 6.5, igi: 4.5, precioFino: null, cierreJofisa: 110.0, lineas: [{ id: 49, bruto: 950.0, ley: 1000.0 }] },
  { expedicionIdx: 0, numero: 24, nombre: 'E50-24', clienteIdx: 3, categoriaIdx: 0, descuento: 5.0, igi: 4.5, precioFino: 108.7, cierreJofisa: 108.45, lineas: [{ id: 50, bruto: 230.36, ley: 720.83 }] },
  { expedicionIdx: 1, numero: 2, nombre: 'E51-2', clienteIdx: 0, categoriaIdx: 0, descuento: 5.0, igi: 4.5, precioFino: 111.25, cierreJofisa: 111.0, lineas: [{ id: 51, bruto: 423.01, ley: 708.0 }] },
  { expedicionIdx: 1, numero: 3, nombre: 'E51-3', clienteIdx: 2, categoriaIdx: 0, descuento: 6.5, igi: 4.5, precioFino: 111.55, cierreJofisa: 111.3, lineas: [{ id: 52, bruto: 795.5, ley: 725.0 }] },
  { expedicionIdx: 1, numero: 4, nombre: 'E51-4', clienteIdx: 1, categoriaIdx: 0, descuento: 6.5, igi: 4.5, precioFino: 111.57, cierreJofisa: 111.32, lineas: [{ id: 53, bruto: 172.3, ley: 720.0 }, { id: 54, bruto: 121.3, ley: 720.0 }] },
  { expedicionIdx: 1, numero: 5, nombre: 'E51-5', clienteIdx: 3, categoriaIdx: 0, descuento: 5.0, igi: 4.5, precioFino: 111.12, cierreJofisa: 110.87, lineas: [{ id: 55, bruto: 283.07, ley: 720.83 }] },
  { expedicionIdx: 1, numero: 6, nombre: 'E51-6', clienteIdx: 3, categoriaIdx: 0, descuento: 5.0, igi: 4.5, precioFino: 111.41, cierreJofisa: 112.0, lineas: [{ id: 56, bruto: 453.88, ley: 737.5 }] },
  { expedicionIdx: 1, numero: 7, nombre: 'E51-7', clienteIdx: 1, categoriaIdx: 0, descuento: 6.5, igi: 4.5, precioFino: 111.42, cierreJofisa: 111.17, lineas: [{ id: 57, bruto: 254.7, ley: 770.0 }, { id: 58, bruto: -4.15, ley: 1000.0 }] },
  { expedicionIdx: 1, numero: 8, nombre: 'E51-8', clienteIdx: 0, categoriaIdx: 0, descuento: 5.0, igi: 4.5, precioFino: 113.25, cierreJofisa: 113.07, lineas: [{ id: 59, bruto: 764.19, ley: 708.0 }] },
  { expedicionIdx: 1, numero: 9, nombre: 'E51-9', clienteIdx: 3, categoriaIdx: 0, descuento: 5.0, igi: 4.5, precioFino: 115.15, cierreJofisa: 114.9, lineas: [{ id: 60, bruto: 299.33, ley: 716.67 }] },
  { expedicionIdx: 1, numero: 10, nombre: 'E51-10', clienteIdx: 4, categoriaIdx: 0, descuento: 6.5, igi: 4.5, precioFino: 116.37, cierreJofisa: 112.0, lineas: [{ id: 61, bruto: 576.68, ley: 710.0 }, { id: 62, bruto: 43.36, ley: 666.0 }, { id: 63, bruto: 4.33, ley: 540.0 }] },
  { expedicionIdx: 1, numero: 11, nombre: 'E51-11', clienteIdx: 3, categoriaIdx: 0, descuento: 5.0, igi: 4.5, precioFino: 115.07, cierreJofisa: 114.82, lineas: [{ id: 64, bruto: 178.29, ley: 720.83 }] },
  { expedicionIdx: 1, numero: 13, nombre: 'E51-13', clienteIdx: 3, categoriaIdx: 0, descuento: 5.0, igi: 4.5, precioFino: 115.91, cierreJofisa: 115.66, lineas: [{ id: 65, bruto: 562.9, ley: 725.0 }] },
  { expedicionIdx: 1, numero: 14, nombre: 'E51-14', clienteIdx: 0, categoriaIdx: 0, descuento: 5.0, igi: 4.5, precioFino: 116.72, cierreJofisa: 116.47, lineas: [{ id: 66, bruto: 509.88, ley: 708.0 }] },
  { expedicionIdx: 1, numero: 15, nombre: 'E51-15', clienteIdx: 1, categoriaIdx: 0, descuento: 6.5, igi: 4.5, precioFino: 116.97, cierreJofisa: 116.72, lineas: [{ id: 67, bruto: 226.4, ley: 650.0 }] },
  { expedicionIdx: 1, numero: 16, nombre: 'E51-16', clienteIdx: 0, categoriaIdx: 4, descuento: 5.0, igi: 0.0, precioFino: 112.13, cierreJofisa: 111.88, lineas: [{ id: 68, bruto: 999.93, ley: 996.6 }] },
  { expedicionIdx: 1, numero: 17, nombre: 'E51-17', clienteIdx: 2, categoriaIdx: 0, descuento: 6.5, igi: 4.5, precioFino: 112.63, cierreJofisa: 112.38, lineas: [{ id: 69, bruto: 546.59, ley: 747.0 }] },
  { expedicionIdx: 2, numero: 1, nombre: 'E52-1', clienteIdx: 0, categoriaIdx: 0, descuento: 5.0, igi: 4.5, precioFino: 113.25, cierreJofisa: 112.98, lineas: [{ id: 70, bruto: 323.87, ley: 708.0 }, { id: 71, bruto: 315.56, ley: 708.0 }, { id: 72, bruto: 85.43, ley: 833.0 }] },
  { expedicionIdx: 2, numero: 2, nombre: 'E52-2', clienteIdx: 1, categoriaIdx: 0, descuento: 6.5, igi: 4.5, precioFino: 114.09, cierreJofisa: 113.84, lineas: [{ id: 73, bruto: 209.5, ley: 720.0 }] },
  { expedicionIdx: 2, numero: 3, nombre: 'E52-3', clienteIdx: 0, categoriaIdx: 0, descuento: 5.0, igi: 4.5, precioFino: 115.13, cierreJofisa: 114.88, lineas: [{ id: 74, bruto: 386.47, ley: 708.0 }] },
  { expedicionIdx: 2, numero: 4, nombre: 'E52-4', clienteIdx: 7, categoriaIdx: 0, descuento: 6.5, igi: 4.5, precioFino: 115.24, cierreJofisa: 114.99, lineas: [{ id: 75, bruto: 396.17, ley: 752.0 }] },
  { expedicionIdx: 2, numero: 5, nombre: 'E52-5', clienteIdx: 3, categoriaIdx: 0, descuento: 5.0, igi: 4.5, precioFino: 115.29, cierreJofisa: 115.04, lineas: [{ id: 76, bruto: 276.96, ley: 720.83 }] },
  { expedicionIdx: 2, numero: 6, nombre: 'E52-6', clienteIdx: 3, categoriaIdx: 0, descuento: 5.0, igi: 4.5, precioFino: 115.35, cierreJofisa: 115.1, lineas: [{ id: 77, bruto: 299.72, ley: 725.0 }] },
  { expedicionIdx: 2, numero: 7, nombre: 'E52-7', clienteIdx: 2, categoriaIdx: 1, descuento: 6.5, igi: 4.5, precioFino: 115.33, cierreJofisa: 115.08, lineas: [{ id: 78, bruto: 34.22, ley: 896.0 }, { id: 79, bruto: 17.62, ley: 780.0 }, { id: 80, bruto: 321.61, ley: 730.0 }, { id: 81, bruto: 13.54, ley: 565.0 }, { id: 82, bruto: 1.15, ley: 355.0 }] },
  { expedicionIdx: 2, numero: 8, nombre: 'E52-8', clienteIdx: 4, categoriaIdx: 1, descuento: 6.5, igi: 4.5, precioFino: 118.88, cierreJofisa: 118.73, lineas: [{ id: 83, bruto: 639.91, ley: 710.0 }, { id: 84, bruto: 15.46, ley: 900.0 }, { id: 85, bruto: 11.43, ley: 800.0 }] },
  { expedicionIdx: 2, numero: 9, nombre: 'E52-9', clienteIdx: 1, categoriaIdx: 1, descuento: 6.5, igi: 4.5, precioFino: 115.91, cierreJofisa: 115.66, lineas: [{ id: 86, bruto: 67.6, ley: 910.0 }, { id: 87, bruto: 33.8, ley: 890.0 }, { id: 88, bruto: 16.6, ley: 900.0 }, { id: 89, bruto: 41.7, ley: 880.0 }] },
  { expedicionIdx: 2, numero: 10, nombre: 'E52-10', clienteIdx: 0, categoriaIdx: 0, descuento: 5.0, igi: 4.5, precioFino: 115.93, cierreJofisa: 115.69, lineas: [{ id: 90, bruto: 513.4, ley: 708.0 }] },
  { expedicionIdx: 2, numero: 11, nombre: 'E52-11', clienteIdx: 1, categoriaIdx: 0, descuento: 6.5, igi: 4.5, precioFino: 116.37, cierreJofisa: 116.12, lineas: [{ id: 91, bruto: 272.8, ley: 690.0 }] },
  { expedicionIdx: 2, numero: 12, nombre: 'E52-12', clienteIdx: 1, categoriaIdx: 2, descuento: 6.0, igi: 0.0, precioFino: 116.53, cierreJofisa: 116.28, lineas: [{ id: 92, bruto: 537.5, ley: 1000.0 }] },
  { expedicionIdx: 2, numero: 13, nombre: 'E52-13', clienteIdx: 0, categoriaIdx: 2, descuento: 5.0, igi: 0.0, precioFino: 116.48, cierreJofisa: 116.28, lineas: [{ id: 93, bruto: 1100.0, ley: 1000.0 }] },
  { expedicionIdx: 2, numero: 14, nombre: 'E52-14', clienteIdx: 0, categoriaIdx: 2, descuento: 5.0, igi: 0.0, precioFino: 116.41, cierreJofisa: 116.1, lineas: [{ id: 94, bruto: 462.0, ley: 1000.0 }] },
  { expedicionIdx: 2, numero: 15, nombre: 'E52-15', clienteIdx: 3, categoriaIdx: 0, descuento: 5.0, igi: 4.5, precioFino: 115.94, cierreJofisa: 115.69, lineas: [{ id: 95, bruto: 207.76, ley: 708.33 }] },
  { expedicionIdx: 2, numero: 16, nombre: 'E52-16', clienteIdx: 3, categoriaIdx: 0, descuento: 5.0, igi: 4.5, precioFino: 116.1, cierreJofisa: 115.85, lineas: [{ id: 96, bruto: 212.07, ley: 708.33 }] },
  { expedicionIdx: 2, numero: 17, nombre: 'E52-17', clienteIdx: 2, categoriaIdx: 1, descuento: 6.5, igi: 4.5, precioFino: 118.73, cierreJofisa: 118.48, lineas: [{ id: 97, bruto: 18.11, ley: 896.0 }, { id: 98, bruto: 3.08, ley: 780.0 }, { id: 99, bruto: 230.76, ley: 730.0 }, { id: 100, bruto: 3.33, ley: 565.0 }, { id: 101, bruto: -6.0, ley: 1000.0 }, { id: 102, bruto: 0.76, ley: 355.0 }] },
  { expedicionIdx: 2, numero: 18, nombre: 'E52-18', clienteIdx: 1, categoriaIdx: 0, descuento: 6.5, igi: 4.5, precioFino: 118.33, cierreJofisa: 118.08, lineas: [{ id: 103, bruto: 109.5, ley: 890.0 }, { id: 104, bruto: 179.3, ley: 650.0 }] },
  { expedicionIdx: 2, numero: 19, nombre: 'E52-19', clienteIdx: 3, categoriaIdx: 0, descuento: 5.0, igi: 4.5, precioFino: 118.42, cierreJofisa: 118.17, lineas: [{ id: 105, bruto: 339.4, ley: 712.5 }] },
  { expedicionIdx: 2, numero: 20, nombre: 'E52-20', clienteIdx: 0, categoriaIdx: 0, descuento: 5.0, igi: 4.5, precioFino: 117.93, cierreJofisa: 117.68, lineas: [{ id: 106, bruto: 153.12, ley: 875.0 }, { id: 107, bruto: 614.15, ley: 708.0 }] },
  { expedicionIdx: 2, numero: 21, nombre: 'E52-21', clienteIdx: 3, categoriaIdx: 0, descuento: 5.0, igi: 4.5, precioFino: 118.69, cierreJofisa: 118.44, lineas: [{ id: 108, bruto: 259.98, ley: 712.5 }] },
  { expedicionIdx: 2, numero: 22, nombre: 'E52-22', clienteIdx: 4, categoriaIdx: 1, descuento: 6.5, igi: 4.5, precioFino: 120.79, cierreJofisa: 120.54, lineas: [{ id: 109, bruto: 15.87, ley: 335.0 }, { id: 110, bruto: 7.44, ley: 540.0 }, { id: 111, bruto: 50.37, ley: 660.0 }, { id: 112, bruto: 20.73, ley: 740.0 }, { id: 113, bruto: 8.24, ley: 800.0 }, { id: 114, bruto: 79.6, ley: 690.0 }, { id: 115, bruto: 971.59, ley: 710.0 }] },
  { expedicionIdx: 2, numero: 23, nombre: 'E52-23', clienteIdx: 2, categoriaIdx: 1, descuento: 6.5, igi: 4.5, precioFino: 120.74, cierreJofisa: 120.49, lineas: [{ id: 116, bruto: 29.03, ley: 896.0 }, { id: 117, bruto: 2.75, ley: 780.0 }, { id: 118, bruto: 206.94, ley: 730.0 }, { id: 119, bruto: 49.15, ley: 565.0 }] },
  { expedicionIdx: 3, numero: 1, nombre: 'E53-1', clienteIdx: 3, categoriaIdx: 0, descuento: 5.0, igi: 4.5, precioFino: 122.17, cierreJofisa: 121.92, lineas: [{ id: 120, bruto: 244.98, ley: 712.5 }] },
  { expedicionIdx: 3, numero: 2, nombre: 'E53-2', clienteIdx: 0, categoriaIdx: 0, descuento: 5.0, igi: 4.5, precioFino: 123.09, cierreJofisa: 123.07, lineas: [{ id: 121, bruto: 399.2, ley: 708.0 }] },
  { expedicionIdx: 3, numero: 3, nombre: 'E53-3', clienteIdx: 3, categoriaIdx: 0, descuento: 5.0, igi: 4.5, precioFino: 122.92, cierreJofisa: 122.67, lineas: [{ id: 122, bruto: 323.96, ley: 737.5 }] },
  { expedicionIdx: 3, numero: 4, nombre: 'E53-4', clienteIdx: 1, categoriaIdx: 0, descuento: 6.5, igi: 4.5, precioFino: 122.9, cierreJofisa: 122.65, lineas: [{ id: 123, bruto: 114.4, ley: 740.0 }] },
  { expedicionIdx: 3, numero: 5, nombre: 'E53-5', clienteIdx: 4, categoriaIdx: 1, descuento: 6.5, igi: 4.5, precioFino: 122.39, cierreJofisa: 122.14, lineas: [{ id: 124, bruto: 183.25, ley: 680.0 }, { id: 125, bruto: 289.02, ley: 740.0 }, { id: 126, bruto: 518.29, ley: 710.0 }, { id: 127, bruto: -22.0, ley: 1000.0 }] },
  { expedicionIdx: 3, numero: 6, nombre: 'E53-6', clienteIdx: 2, categoriaIdx: 1, descuento: 6.5, igi: 4.5, precioFino: 121.95, cierreJofisa: 121.7, lineas: [{ id: 128, bruto: 6.82, ley: 780.0 }, { id: 129, bruto: 616.23, ley: 730.0 }, { id: 130, bruto: 17.23, ley: 565.0 }, { id: 131, bruto: 1.07, ley: 355.0 }, { id: 132, bruto: -6.0, ley: 1000.0 }] },
  { expedicionIdx: 3, numero: 7, nombre: 'E53-7', clienteIdx: 0, categoriaIdx: 0, descuento: 5.0, igi: 4.5, precioFino: 123.46, cierreJofisa: 123.21, lineas: [{ id: 133, bruto: 588.9, ley: 708.0 }] },
  { expedicionIdx: 3, numero: 8, nombre: 'E53-8', clienteIdx: 3, categoriaIdx: 0, descuento: 5.0, igi: 4.5, precioFino: 126.33, cierreJofisa: 126.08, lineas: [{ id: 134, bruto: 536.16, ley: 737.5 }] },
  { expedicionIdx: 3, numero: 9, nombre: 'E53-9', clienteIdx: 1, categoriaIdx: 2, descuento: 6.5, igi: 0.0, precioFino: 127.2, cierreJofisa: 126.95, lineas: [{ id: 135, bruto: 1001.7, ley: 996.9 }] },
  { expedicionIdx: 3, numero: 10, nombre: 'E53-10', clienteIdx: 3, categoriaIdx: 0, descuento: 5.0, igi: 4.5, precioFino: 127.96, cierreJofisa: 127.71, lineas: [{ id: 136, bruto: 385.84, ley: 733.33 }] },
  { expedicionIdx: 3, numero: 11, nombre: 'E53-11', clienteIdx: 5, categoriaIdx: 0, descuento: 6.5, igi: 4.5, precioFino: 128.97, cierreJofisa: 128.72, lineas: [{ id: 137, bruto: 118.0, ley: 740.0 }] },
  { expedicionIdx: 3, numero: 12, nombre: 'E53-12', clienteIdx: 1, categoriaIdx: 0, descuento: 6.5, igi: 4.5, precioFino: 128.9, cierreJofisa: 128.65, lineas: [{ id: 138, bruto: 97.2, ley: 710.0 }, { id: 139, bruto: 155.9, ley: 720.0 }] },
  { expedicionIdx: 3, numero: 13, nombre: 'E53-13', clienteIdx: 7, categoriaIdx: 0, descuento: 6.5, igi: 4.5, precioFino: null, cierreJofisa: 138.0, lineas: [{ id: 140, bruto: 175.51, ley: 740.0 }, { id: 141, bruto: 261.38, ley: 730.0 }] },
  { expedicionIdx: 3, numero: 14, nombre: 'E53-14', clienteIdx: 2, categoriaIdx: 1, descuento: 6.5, igi: 4.5, precioFino: 134.7, cierreJofisa: 134.45, lineas: [{ id: 142, bruto: 7.97, ley: 896.0 }, { id: 143, bruto: 39.74, ley: 780.0 }, { id: 144, bruto: 325.02, ley: 730.0 }, { id: 145, bruto: 19.28, ley: 565.0 }] },
];

async function seedDatabase() {
  // Check if already seeded
  const catSnap = await getDocs(collection(db, 'categorias'));
  if (!catSnap.empty) return; // Already has data

  console.log('Seeding database with initial data...');

  // Seed categorias
  const catIds = [];
  for (const cat of seedCategorias) {
    const ref = await addDoc(collection(db, 'categorias'), cat);
    catIds.push(ref.id);
  }

  // Seed clientes
  const clienteIds = [];
  for (const cli of seedClientes) {
    const ref = await addDoc(collection(db, 'clientes'), cli);
    clienteIds.push(ref.id);
  }

  // Seed expediciones
  const expIds = [];
  for (const exp of seedExpediciones) {
    const ref = await addDoc(collection(db, 'expediciones'), exp);
    expIds.push(ref.id);
  }

  // Seed usuarios (with fixed IDs and codes)
  for (const usr of seedUsuarios) {
    await setDoc(doc(db, 'usuarios', usr.id), { nombre: usr.nombre, codigo: usr.codigo });
  }

  // Seed estados (with fixed IDs)
  for (const est of seedEstados) {
    await setDoc(doc(db, 'estadosPaquete', est.id), { nombre: est.nombre, icon: est.icon, color: est.color });
  }

  // Seed paquetes (mapping indices to Firestore IDs)
  for (const paq of seedPaquetes) {
    await addDoc(collection(db, 'paquetes'), {
      expedicionId: expIds[paq.expedicionIdx],
      numero: paq.numero,
      nombre: paq.nombre,
      clienteId: clienteIds[paq.clienteIdx],
      categoriaId: catIds[paq.categoriaIdx],
      descuento: paq.descuento,
      igi: paq.igi,
      precioFino: paq.precioFino,
      cierreJofisa: paq.cierreJofisa,
      lineas: paq.lineas,
      logs: [],
      comentarios: [],
    });
  }

  // Seed config
  await setDoc(doc(db, 'config', 'settings'), {
    expedicionActualId: expIds[3], // E53
  });

  console.log('Database seeded successfully!');
}

// Fecha hace 6 meses para filtrar
const getSixMonthsAgo = () => {
  const d = new Date();
  d.setMonth(d.getMonth() - 6);
  return d.toISOString().split('T')[0];
};

export function useFirestore(activeSection = 'expediciones') {
  // Core data - siempre cargado
  const [categorias, setCategorias] = useState([]);
  const [clientes, setClientes] = useState([]);
  const [expediciones, setExpediciones] = useState([]);
  const [paquetes, setPaquetes] = useState([]);
  const [estadosPaquete, setEstadosPaquete] = useState([]);
  const [usuarios, setUsuarios] = useState([]);
  const [expedicionActualId, setExpedicionActualIdState] = useState(null);
  const [configGeneral, setConfigGeneral] = useState({ limiteExposicionCliente: 100000, seguroExpedicionDefault: 600000, alertaExposicionUmbral: 80000, alertaExposicionUsuarios: [] });
  const [matriculas, setMatriculas] = useState([]);

  // Lingotes data - solo cuando activeSection === 'lingotes'
  const [lingotesExportaciones, setLingotesExportaciones] = useState([]);
  const [lingotesEntregas, setLingotesEntregas] = useState([]);
  const [lingotesConfig, setLingotesConfig] = useState({ stockMador: 0, umbralRojo: 200, umbralNaranja: 500, umbralAmarillo: 1000 });
  const [lingotesFutura, setLingotesFutura] = useState([]);
  const [lingotesFacturas, setLingotesFacturas] = useState([]);

  const [loading, setLoading] = useState(true);
  const seedTriggered = useRef(false);
  const lingotesUnsubscribers = useRef([]);
  const lingotesLoaded = useRef(false);

  // Core listeners - siempre activos
  useEffect(() => {
    console.log('[useFirestore] Setting up core listeners...');

    let cancelled = false;
    const unsubscribers = [];
    let loadedCount = 0;
    const totalCoreCollections = 8; // categorias, clientes, expediciones, paquetes, estadosPaquete, usuarios, config, matriculas

    const checkLoaded = () => {
      loadedCount++;
      if (loadedCount >= totalCoreCollections && !cancelled) {
        setLoading(false);
      }
    };

    // Categorias listener — also triggers seeding if empty
    unsubscribers.push(
      onSnapshot(collection(db, 'categorias'), (snap) => {
        if (!cancelled) setCategorias(snap.docs.map(d => ({ id: d.id, ...d.data() })));
        checkLoaded();
        if (snap.empty && !seedTriggered.current) {
          seedTriggered.current = true;
          seedDatabase().catch(err => console.error('[useFirestore] Seed error:', err));
        }
      }, (error) => {
        console.error('Firestore error (categorias):', error);
        checkLoaded();
      })
    );

    unsubscribers.push(
      onSnapshot(collection(db, 'clientes'), (snap) => {
        if (!cancelled) setClientes(snap.docs.map(d => ({ id: d.id, ...d.data() })));
        checkLoaded();
      }, (error) => {
        console.error('Firestore error (clientes):', error);
        checkLoaded();
      })
    );

    unsubscribers.push(
      onSnapshot(collection(db, 'expediciones'), (snap) => {
        if (!cancelled) setExpediciones(snap.docs.map(d => ({ id: d.id, ...d.data() })));
        checkLoaded();
      }, (error) => {
        console.error('Firestore error (expediciones):', error);
        checkLoaded();
      })
    );

    unsubscribers.push(
      onSnapshot(collection(db, 'paquetes'), (snap) => {
        if (!cancelled) setPaquetes(snap.docs.map(d => ({ id: d.id, ...d.data() })));
        checkLoaded();
      }, (error) => {
        console.error('Firestore error (paquetes):', error);
        checkLoaded();
      })
    );

    unsubscribers.push(
      onSnapshot(collection(db, 'estadosPaquete'), (snap) => {
        if (!cancelled) setEstadosPaquete(snap.docs.map(d => ({ id: d.id, ...d.data() })));
        checkLoaded();
      }, (error) => {
        console.error('Firestore error (estadosPaquete):', error);
        checkLoaded();
      })
    );

    unsubscribers.push(
      onSnapshot(collection(db, 'usuarios'), (snap) => {
        if (!cancelled) setUsuarios(snap.docs.map(d => ({ id: d.id, ...d.data() })));
        checkLoaded();
      }, (error) => {
        console.error('Firestore error (usuarios):', error);
        checkLoaded();
      })
    );

    unsubscribers.push(
      onSnapshot(doc(db, 'config', 'settings'), (snap) => {
        if (!cancelled) {
          if (snap.exists()) {
            const data = snap.data();
            setExpedicionActualIdState(data.expedicionActualId || null);
            setConfigGeneral({
              limiteExposicionCliente: data.limiteExposicionCliente ?? 100000,
              seguroExpedicionDefault: data.seguroExpedicionDefault ?? 600000,
              alertaExposicionUmbral: data.alertaExposicionUmbral ?? 80000,
              alertaExposicionUsuarios: data.alertaExposicionUsuarios ?? [],
            });
          }
        }
        checkLoaded();
      }, (error) => {
        console.error('Firestore error (config):', error);
        checkLoaded();
      })
    );

    unsubscribers.push(
      onSnapshot(collection(db, 'matriculas'), (snap) => {
        if (!cancelled) setMatriculas(snap.docs.map(d => ({ id: d.id, ...d.data() })));
        checkLoaded();
      }, (error) => {
        console.error('Firestore error (matriculas):', error);
        checkLoaded();
      })
    );

    return () => {
      cancelled = true;
      unsubscribers.forEach(unsub => unsub());
    };
  }, []);

  // Lingotes listeners - solo cuando activeSection === 'lingotes'
  useEffect(() => {
    if (activeSection !== 'lingotes') {
      // Desuscribirse de lingotes cuando salimos de la sección
      if (lingotesUnsubscribers.current.length > 0) {
        console.log('[useFirestore] Unsubscribing from lingotes listeners');
        lingotesUnsubscribers.current.forEach(unsub => unsub());
        lingotesUnsubscribers.current = [];
        lingotesLoaded.current = false;
      }
      return;
    }

    // Ya está cargado, no hacer nada
    if (lingotesLoaded.current) return;

    console.log('[useFirestore] Setting up lingotes listeners...');
    lingotesLoaded.current = true;

    // Query filtrado: entregas de últimos 6 meses
    const sixMonthsAgo = getSixMonthsAgo();

    lingotesUnsubscribers.current.push(
      onSnapshot(collection(db, 'lingotes_exportaciones'), (snap) => {
        setLingotesExportaciones(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      }, (error) => {
        console.error('Firestore error (lingotes_exportaciones):', error);
      })
    );

    // Entregas filtradas por fecha (últimos 6 meses) o sin finalizar
    lingotesUnsubscribers.current.push(
      onSnapshot(collection(db, 'lingotes_entregas'), (snap) => {
        const all = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        // Filtrar: entregas de últimos 6 meses O entregas no finalizadas
        const filtered = all.filter(e => {
          if (!e.fechaEntrega) return true; // Sin fecha = incluir
          if (e.fechaEntrega >= sixMonthsAgo) return true; // Últimos 6 meses
          // Entregas antiguas pero con lingotes pendientes
          const tieneActivos = (e.lingotes || []).some(l => l.estado === 'activo' || l.estado === 'pendiente_pago');
          return tieneActivos;
        });
        setLingotesEntregas(filtered);
      }, (error) => {
        console.error('Firestore error (lingotes_entregas):', error);
      })
    );

    lingotesUnsubscribers.current.push(
      onSnapshot(doc(db, 'lingotes_config', 'settings'), (snap) => {
        if (snap.exists()) {
          setLingotesConfig(snap.data());
        }
      }, (error) => {
        console.error('Firestore error (lingotes_config):', error);
      })
    );

    lingotesUnsubscribers.current.push(
      onSnapshot(collection(db, 'lingotes_futura'), (snap) => {
        setLingotesFutura(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      }, (error) => {
        console.error('Firestore error (lingotes_futura):', error);
      })
    );

    lingotesUnsubscribers.current.push(
      onSnapshot(collection(db, 'lingotes_facturas'), (snap) => {
        setLingotesFacturas(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      }, (error) => {
        console.error('Firestore error (lingotes_facturas):', error);
      })
    );

    return () => {
      // Cleanup se maneja en el próximo efecto cuando cambie activeSection
    };
  }, [activeSection]);

  // --- CRUD functions ---

  const setExpedicionActualId = async (id) => {
    await setDoc(doc(db, 'config', 'settings'), { expedicionActualId: id }, { merge: true });
  };

  const updateConfigGeneral = async (data) => {
    await setDoc(doc(db, 'config', 'settings'), data, { merge: true });
  };

  // Categorias
  const saveCategoria = async (data, editingItem) => {
    if (editingItem) {
      const { id, ...rest } = data;
      await updateDoc(doc(db, 'categorias', editingItem.id), rest);
    } else {
      await addDoc(collection(db, 'categorias'), data);
    }
  };

  const deleteCategoria = async (id) => {
    await deleteDoc(doc(db, 'categorias', id));
  };

  // Clientes
  const saveCliente = async (data, editingItem) => {
    if (editingItem) {
      const { id, ...rest } = data;
      await updateDoc(doc(db, 'clientes', editingItem.id), rest);
    } else {
      await addDoc(collection(db, 'clientes'), data);
    }
  };

  const deleteCliente = async (id) => {
    await deleteDoc(doc(db, 'clientes', id));
  };

  const updateClienteKilatajes = async (clienteId, kilatajes) => {
    await updateDoc(doc(db, 'clientes', clienteId), { kilatajes });
  };

  const updateClienteDatosFiscales = async (clienteId, datosFiscales) => {
    await updateDoc(doc(db, 'clientes', clienteId), datosFiscales);
  };

  // Expediciones
  const saveExpedicion = async (data, editingItem) => {
    const { esActual, id, ...expedicionData } = data;
    if (editingItem) {
      await updateDoc(doc(db, 'expediciones', editingItem.id), expedicionData);
      if (esActual) {
        await setExpedicionActualId(editingItem.id);
      }
    } else {
      const ref = await addDoc(collection(db, 'expediciones'), expedicionData);
      if (esActual) {
        await setExpedicionActualId(ref.id);
      }
    }
  };

  const deleteExpedicion = async (id) => {
    // Cascade: delete all paquetes for this expedicion
    const paqSnap = await getDocs(query(collection(db, 'paquetes'), where('expedicionId', '==', id)));
    const batch = writeBatch(db);
    paqSnap.docs.forEach(d => batch.delete(d.ref));
    batch.delete(doc(db, 'expediciones', id));
    await batch.commit();
  };

  // Paquetes
  const savePaquete = async (data, editingItem, { usuarioActivo, getExpedicionNombre, getCliente, getCategoria, paquetes: currentPaquetes }) => {
    const modificacion = { usuario: usuarioActivo, fecha: new Date().toISOString() };
    const expNombre = getExpedicionNombre(data.expedicionId);
    const nuevoNombre = `${expNombre}-${data.numero}`;

    if (editingItem) {
      const oldPaq = currentPaquetes.find(p => p.id === editingItem.id);
      const cambios = [];
      if (oldPaq.clienteId !== data.clienteId) cambios.push(`cliente: ${getCliente(oldPaq.clienteId)?.nombre} → ${getCliente(data.clienteId)?.nombre}`);
      if (oldPaq.categoriaId !== data.categoriaId) cambios.push(`categoría: ${getCategoria(oldPaq.categoriaId)?.nombre} → ${getCategoria(data.categoriaId)?.nombre}`);
      if (oldPaq.descuento !== data.descuento) cambios.push(`descuento: ${oldPaq.descuento}% → ${data.descuento}%`);
      if (oldPaq.igi !== data.igi) cambios.push(`IGI: ${oldPaq.igi}% → ${data.igi}%`);
      if (oldPaq.numero !== data.numero) cambios.push(`número: ${oldPaq.numero} → ${data.numero}`);

      const log = cambios.length > 0 ? {
        id: Date.now(),
        fecha: modificacion.fecha,
        usuario: usuarioActivo,
        accion: 'editar_datos',
        detalles: { cambios }
      } : null;

      const { id, ...rest } = data;
      const updateData = {
        ...rest,
        nombre: nuevoNombre,
        ultimaModificacion: modificacion,
      };

      let logs = [...(oldPaq.logs || [])];
      if (log) {
        logs.push(log);
      }

      // Recalcular verificación si existe y cambiaron datos que afectan al total
      const cambioAfectaTotal = oldPaq.descuento !== data.descuento || oldPaq.igi !== data.igi;
      if (cambioAfectaTotal && oldPaq.verificacionIA && oldPaq.verificacionIA.totalFactura != null) {
        const cliente = getCliente(data.clienteId);
        const paqActualizado = { ...oldPaq, ...data, lineas: oldPaq.lineas };
        const nuevoTotalPaquete = calcularTotalFraPaquete(paqActualizado, cliente);

        if (nuevoTotalPaquete != null) {
          const diferenciaAnterior = oldPaq.verificacionIA.diferencia;
          const nuevaDiferencia = oldPaq.verificacionIA.totalFactura - nuevoTotalPaquete;

          updateData.verificacionIA = {
            ...oldPaq.verificacionIA,
            totalPaquete: nuevoTotalPaquete,
            diferencia: nuevaDiferencia,
            validado: false,
          };

          const logRecalculo = {
            id: Date.now() + 1,
            fecha: modificacion.fecha,
            usuario: usuarioActivo,
            accion: 'recalcular_verificacion',
            detalles: { diferenciaAntes: diferenciaAnterior, diferenciaDespues: nuevaDiferencia },
          };
          logs.push(logRecalculo);
        }
      }

      updateData.logs = logs;
      await updateDoc(doc(db, 'paquetes', editingItem.id), updateData);
    } else {
      const log = {
        id: Date.now(),
        fecha: modificacion.fecha,
        usuario: usuarioActivo,
        accion: 'crear_paquete',
        detalles: null,
      };
      const { id, ...rest } = data;
      await addDoc(collection(db, 'paquetes'), {
        ...rest,
        nombre: nuevoNombre,
        lineas: data.lineas || [],
        logs: [log],
        comentarios: [],
        estado: 'por_recoger',
        creadoPor: modificacion,
        ultimaModificacion: modificacion,
      });
    }
  };

  const deletePaquete = async (id) => {
    await deleteDoc(doc(db, 'paquetes', id));
  };

  const addLineaToPaquete = async (paqueteId, linea, usuarioActivo) => {
    const paq = paquetes.find(p => p.id === paqueteId);
    if (!paq) return;
    const modificacion = { usuario: usuarioActivo, fecha: new Date().toISOString() };
    const log = {
      id: Date.now(),
      fecha: modificacion.fecha,
      usuario: usuarioActivo,
      accion: 'añadir_linea',
      detalles: { bruto: linea.bruto, ley: linea.ley },
    };

    const newLineas = [...paq.lineas, { id: Date.now(), ...linea }];
    const updateData = {
      lineas: newLineas,
      ultimaModificacion: modificacion,
      logs: [...(paq.logs || []), log],
    };

    // Recalcular verificación si existe
    if (paq.verificacionIA && paq.verificacionIA.totalFactura != null) {
      const cliente = clientes.find(c => c.id === paq.clienteId);
      const paqConNuevasLineas = { ...paq, lineas: newLineas };
      const nuevoTotalPaquete = calcularTotalFraPaquete(paqConNuevasLineas, cliente);

      if (nuevoTotalPaquete != null) {
        const diferenciaAnterior = paq.verificacionIA.diferencia;
        const nuevaDiferencia = paq.verificacionIA.totalFactura - nuevoTotalPaquete;

        // Comparar pesos con los extraídos por la IA
        const { pesosCuadran, observaciones } = compararPesosConIA(newLineas, paq.verificacionIA.pesos);

        updateData.verificacionIA = {
          ...paq.verificacionIA,
          totalPaquete: nuevoTotalPaquete,
          diferencia: nuevaDiferencia,
          pesosCuadran,
          observaciones,
          validado: false, // Invalidar al cambiar
        };

        // Añadir log del recálculo
        const logRecalculo = {
          id: Date.now() + 1,
          fecha: modificacion.fecha,
          usuario: usuarioActivo,
          accion: 'recalcular_verificacion',
          detalles: { diferenciaAntes: diferenciaAnterior, diferenciaDespues: nuevaDiferencia, pesosCuadran },
        };
        updateData.logs = [...updateData.logs, logRecalculo];
      }
    }

    await updateDoc(doc(db, 'paquetes', paqueteId), updateData);
  };

  const removeLineaFromPaquete = async (paqueteId, lineaId, usuarioActivo) => {
    const paq = paquetes.find(p => p.id === paqueteId);
    if (!paq) return;
    const linea = paq.lineas.find(l => l.id === lineaId);
    const modificacion = { usuario: usuarioActivo, fecha: new Date().toISOString() };
    const log = {
      id: Date.now(),
      fecha: modificacion.fecha,
      usuario: usuarioActivo,
      accion: 'eliminar_linea',
      detalles: linea ? { bruto: linea.bruto, ley: linea.ley } : null,
    };

    const newLineas = paq.lineas.filter(l => l.id !== lineaId);
    const updateData = {
      lineas: newLineas,
      ultimaModificacion: modificacion,
      logs: [...(paq.logs || []), log],
    };

    // Recalcular verificación si existe
    if (paq.verificacionIA && paq.verificacionIA.totalFactura != null) {
      const cliente = clientes.find(c => c.id === paq.clienteId);
      const paqConNuevasLineas = { ...paq, lineas: newLineas };
      const nuevoTotalPaquete = calcularTotalFraPaquete(paqConNuevasLineas, cliente);

      if (nuevoTotalPaquete != null) {
        const diferenciaAnterior = paq.verificacionIA.diferencia;
        const nuevaDiferencia = paq.verificacionIA.totalFactura - nuevoTotalPaquete;

        // Comparar pesos con los extraídos por la IA
        const { pesosCuadran, observaciones } = compararPesosConIA(newLineas, paq.verificacionIA.pesos);

        updateData.verificacionIA = {
          ...paq.verificacionIA,
          totalPaquete: nuevoTotalPaquete,
          diferencia: nuevaDiferencia,
          pesosCuadran,
          observaciones,
          validado: false,
        };

        const logRecalculo = {
          id: Date.now() + 1,
          fecha: modificacion.fecha,
          usuario: usuarioActivo,
          accion: 'recalcular_verificacion',
          detalles: { diferenciaAntes: diferenciaAnterior, diferenciaDespues: nuevaDiferencia, pesosCuadran },
        };
        updateData.logs = [...updateData.logs, logRecalculo];
      }
    }

    await updateDoc(doc(db, 'paquetes', paqueteId), updateData);
  };

  const updatePaqueteCierre = async (paqueteId, precioFino, cierreJofisa, usuarioActivo) => {
    const paq = paquetes.find(p => p.id === paqueteId);
    if (!paq) return;
    // Normalizar a números para comparación
    const oldPrecio = paq.precioFino ?? null;
    const oldCierre = paq.cierreJofisa ?? null;
    const newPrecio = precioFino ?? null;
    const newCierre = cierreJofisa ?? null;
    if (oldPrecio === newPrecio && oldCierre === newCierre) return;

    const modificacion = { usuario: usuarioActivo, fecha: new Date().toISOString() };
    const log = {
      id: Date.now(),
      fecha: modificacion.fecha,
      usuario: usuarioActivo,
      accion: 'actualizar_cierre',
      detalles: {
        precioFino: { antes: paq.precioFino, despues: precioFino },
        cierreJofisa: { antes: paq.cierreJofisa, despues: cierreJofisa },
      },
    };

    let logs = [...(paq.logs || []), log];
    const updateData = {
      precioFino,
      cierreJofisa,
      ultimaModificacion: modificacion,
    };

    // Recalcular verificación si existe y cambió el precio fino
    if (oldPrecio !== newPrecio && paq.verificacionIA && paq.verificacionIA.totalFactura != null) {
      const cliente = clientes.find(c => c.id === paq.clienteId);
      const paqActualizado = { ...paq, precioFino };
      const nuevoTotalPaquete = calcularTotalFraPaquete(paqActualizado, cliente);

      if (nuevoTotalPaquete != null) {
        const diferenciaAnterior = paq.verificacionIA.diferencia;
        const nuevaDiferencia = paq.verificacionIA.totalFactura - nuevoTotalPaquete;

        updateData.verificacionIA = {
          ...paq.verificacionIA,
          totalPaquete: nuevoTotalPaquete,
          diferencia: nuevaDiferencia,
          validado: false,
        };

        const logRecalculo = {
          id: Date.now() + 1,
          fecha: modificacion.fecha,
          usuario: usuarioActivo,
          accion: 'recalcular_verificacion',
          detalles: { diferenciaAntes: diferenciaAnterior, diferenciaDespues: nuevaDiferencia },
        };
        logs.push(logRecalculo);
      }
    }

    updateData.logs = logs;
    await updateDoc(doc(db, 'paquetes', paqueteId), updateData);
  };

  const updatePaqueteFactura = async (paqueteId, factura, usuarioActivo) => {
    const paq = paquetes.find(p => p.id === paqueteId);
    if (!paq) return;
    const modificacion = { usuario: usuarioActivo, fecha: new Date().toISOString() };
    const log = {
      id: Date.now(),
      fecha: modificacion.fecha,
      usuario: usuarioActivo,
      accion: factura ? 'subir_factura' : 'eliminar_factura',
      detalles: factura ? { nombre: factura.nombre } : null,
    };
    await updateDoc(doc(db, 'paquetes', paqueteId), {
      factura: factura || null,
      ultimaModificacion: modificacion,
      logs: [...(paq.logs || []), log],
    });
  };

  const updatePaqueteVerificacion = async (paqueteId, verificacionIA, usuarioActivo) => {
    const paq = paquetes.find(p => p.id === paqueteId);
    if (!paq) return;
    const modificacion = { usuario: usuarioActivo, fecha: new Date().toISOString() };
    const log = {
      id: Date.now(),
      fecha: modificacion.fecha,
      usuario: usuarioActivo,
      accion: 'verificar_ia',
      detalles: verificacionIA ? { totalFactura: verificacionIA.totalFactura, diferencia: verificacionIA.diferencia } : null,
    };
    await updateDoc(doc(db, 'paquetes', paqueteId), {
      verificacionIA: verificacionIA || null,
      ultimaModificacion: modificacion,
      logs: [...(paq.logs || []), log],
    });
  };

  const validarVerificacion = async (paqueteId, usuarioActivo) => {
    const paq = paquetes.find(p => p.id === paqueteId);
    if (!paq || !paq.verificacionIA) return;
    const modificacion = { usuario: usuarioActivo, fecha: new Date().toISOString() };
    const log = {
      id: Date.now(),
      fecha: modificacion.fecha,
      usuario: usuarioActivo,
      accion: 'validar_verificacion',
      detalles: null,
    };
    await updateDoc(doc(db, 'paquetes', paqueteId), {
      verificacionIA: {
        ...paq.verificacionIA,
        validado: true,
        validadoPor: usuarioActivo,
        fechaValidacion: new Date().toISOString(),
      },
      ultimaModificacion: modificacion,
      logs: [...(paq.logs || []), log],
    });
  };

  const updatePaqueteEstado = async (paqueteId, estado, usuarioActivo, estadosPaqueteList) => {
    const paq = paquetes.find(p => p.id === paqueteId);
    if (!paq) return;
    const modificacion = { usuario: usuarioActivo, fecha: new Date().toISOString() };
    const estadoAnterior = estadosPaqueteList.find(e => e.id === paq.estado);
    const estadoNuevo = estadosPaqueteList.find(e => e.id === estado);
    const log = {
      id: Date.now(),
      fecha: modificacion.fecha,
      usuario: usuarioActivo,
      accion: 'cambiar_estado',
      detalles: { antes: estadoAnterior?.nombre || 'Sin estado', despues: estadoNuevo?.nombre },
    };
    await updateDoc(doc(db, 'paquetes', paqueteId), {
      estado,
      ultimaModificacion: modificacion,
      logs: [...(paq.logs || []), log],
    });
  };

  const updatePaqueteEstadoPago = async (paqueteId, estadoPago, usuarioActivo) => {
    const paq = paquetes.find(p => p.id === paqueteId);
    if (!paq) return;
    const modificacion = { usuario: usuarioActivo, fecha: new Date().toISOString() };
    const estadoAnterior = paq.estadoPago || 'por_pagar';
    const log = {
      id: Date.now(),
      fecha: modificacion.fecha,
      usuario: usuarioActivo,
      accion: 'cambiar_estado_pago',
      detalles: { antes: estadoAnterior, despues: estadoPago },
    };
    await updateDoc(doc(db, 'paquetes', paqueteId), {
      estadoPago,
      estadoPagoLog: { usuario: usuarioActivo, fecha: modificacion.fecha },
      ultimaModificacion: modificacion,
      logs: [...(paq.logs || []), log],
    });
  };

  const marcarTodosComoEstado = async (expedicionId, estadoId, usuarioActivo, estadosPaqueteList) => {
    const modificacion = { usuario: usuarioActivo, fecha: new Date().toISOString() };
    const estadoNuevo = estadosPaqueteList.find(e => e.id === estadoId);
    const toUpdate = paquetes.filter(p => p.expedicionId === expedicionId && p.estado !== estadoId);

    for (const paq of toUpdate) {
      const estadoAnterior = estadosPaqueteList.find(e => e.id === paq.estado);
      const log = {
        id: Date.now() + Math.random(),
        fecha: modificacion.fecha,
        usuario: usuarioActivo,
        accion: 'cambiar_estado',
        detalles: { antes: estadoAnterior?.nombre || 'Sin estado', despues: estadoNuevo?.nombre },
      };
      await updateDoc(doc(db, 'paquetes', paq.id), {
        estado: estadoId,
        ultimaModificacion: modificacion,
        logs: [...(paq.logs || []), log],
      });
    }
  };

  const addComentarioToPaquete = async (paqueteId, texto, usuarioActivo) => {
    const paq = paquetes.find(p => p.id === paqueteId);
    if (!paq) return;
    const modificacion = { usuario: usuarioActivo, fecha: new Date().toISOString() };
    const comentario = {
      id: Date.now(),
      fecha: modificacion.fecha,
      usuario: usuarioActivo,
      texto,
    };
    const log = {
      id: Date.now() + 1,
      fecha: modificacion.fecha,
      usuario: usuarioActivo,
      accion: 'añadir_comentario',
      detalles: { texto: texto.substring(0, 50) + (texto.length > 50 ? '...' : '') },
    };
    await updateDoc(doc(db, 'paquetes', paqueteId), {
      comentarios: [...(paq.comentarios || []), comentario],
      ultimaModificacion: modificacion,
      logs: [...(paq.logs || []), log],
    });
  };

  const deleteComentarioFromPaquete = async (paqueteId, comentarioId, usuarioActivo) => {
    const paq = paquetes.find(p => p.id === paqueteId);
    if (!paq) return;
    const comentario = paq.comentarios?.find(c => c.id === comentarioId);
    const modificacion = { usuario: usuarioActivo, fecha: new Date().toISOString() };
    const log = {
      id: Date.now(),
      fecha: modificacion.fecha,
      usuario: usuarioActivo,
      accion: 'eliminar_comentario',
      detalles: { texto: comentario?.texto?.substring(0, 50) + (comentario?.texto?.length > 50 ? '...' : '') },
    };
    await updateDoc(doc(db, 'paquetes', paqueteId), {
      comentarios: (paq.comentarios || []).filter(c => c.id !== comentarioId),
      ultimaModificacion: modificacion,
      logs: [...(paq.logs || []), log],
    });
  };

  // Resultados expedición
  const updateExpedicionResultados = async (expedicionId, resultados) => {
    await updateDoc(doc(db, 'expediciones', expedicionId), { resultados });
  };

  // Usuarios
  const agregarUsuario = async (nombre) => {
    const id = nombre.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
    if (usuarios.find(u => u.id === id)) {
      throw new Error('Ya existe un usuario con ese nombre');
    }
    // Generar código único
    let codigo = generarCodigoUsuario();
    // Asegurar que no exista ya
    while (usuarios.find(u => u.codigo === codigo)) {
      codigo = generarCodigoUsuario();
    }
    await setDoc(doc(db, 'usuarios', id), { nombre, codigo });
    return { id, codigo };
  };

  const eliminarUsuario = async (id) => {
    if (usuarios.length <= 1) {
      throw new Error('Debe haber al menos un usuario');
    }
    // No permitir eliminar a alex
    if (id === 'alex') {
      throw new Error('No se puede eliminar al usuario admin');
    }
    await deleteDoc(doc(db, 'usuarios', id));
  };

  const guardarEdicionUsuario = async (id, nombre) => {
    await updateDoc(doc(db, 'usuarios', id), { nombre });
  };

  // Regenerar código de usuario (solo alex puede hacerlo)
  const regenerarCodigoUsuario = async (id) => {
    let codigo = generarCodigoUsuario();
    while (usuarios.find(u => u.codigo === codigo)) {
      codigo = generarCodigoUsuario();
    }
    await updateDoc(doc(db, 'usuarios', id), { codigo });
    return codigo;
  };

  // Actualizar permisos de usuario
  const actualizarPermisosUsuario = async (id, permisos) => {
    await updateDoc(doc(db, 'usuarios', id), { permisos });
  };

  // Estados
  const agregarEstado = async (data) => {
    const id = data.nombre.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
    if (estadosPaquete.find(e => e.id === id)) {
      throw new Error('Ya existe un estado con ese nombre');
    }
    await setDoc(doc(db, 'estadosPaquete', id), { nombre: data.nombre, icon: data.icon, color: data.color });
  };

  const eliminarEstado = async (id) => {
    if (estadosPaquete.length <= 1) {
      throw new Error('Debe haber al menos un estado');
    }
    await deleteDoc(doc(db, 'estadosPaquete', id));
  };

  const guardarEdicionEstado = async (id, data) => {
    await updateDoc(doc(db, 'estadosPaquete', id), data);
  };

  // Matriculas
  const agregarMatricula = async (matricula) => {
    const id = matricula.toUpperCase().replace(/\s+/g, '').replace(/[^A-Z0-9]/g, '');
    if (matriculas.find(m => m.id === id)) {
      throw new Error('Ya existe esa matrícula');
    }
    await setDoc(doc(db, 'matriculas', id), { matricula: matricula.toUpperCase() });
    return id;
  };

  const eliminarMatricula = async (id) => {
    await deleteDoc(doc(db, 'matriculas', id));
  };

  // --- Lingotes CRUD ---
  const saveLingoteExportacion = async (data, editId) => {
    if (editId) {
      await updateDoc(doc(db, 'lingotes_exportaciones', editId), data);
    } else {
      await addDoc(collection(db, 'lingotes_exportaciones'), data);
    }
  };

  const deleteLingoteExportacion = async (id) => {
    await deleteDoc(doc(db, 'lingotes_exportaciones', id));
  };

  const saveLingoteEntrega = async (data) => {
    await addDoc(collection(db, 'lingotes_entregas'), data);
  };

  const deleteLingoteEntrega = async (id) => {
    await deleteDoc(doc(db, 'lingotes_entregas', id));
  };

  const updateLingoteEntrega = async (id, data) => {
    await updateDoc(doc(db, 'lingotes_entregas', id), data);
  };

  const updateLingotesConfig = async (data) => {
    await setDoc(doc(db, 'lingotes_config', 'settings'), data, { merge: true });
  };

  // Lingotes Futura CRUD
  const saveLingoteFutura = async (data) => {
    const docRef = await addDoc(collection(db, 'lingotes_futura'), data);
    return docRef.id;
  };

  const deleteLingoteFutura = async (id) => {
    await deleteDoc(doc(db, 'lingotes_futura', id));
  };

  const updateLingoteFutura = async (id, data) => {
    await updateDoc(doc(db, 'lingotes_futura', id), data);
  };

  // Lingotes Facturas CRUD
  const saveLingoteFactura = async (data) => {
    const docRef = await addDoc(collection(db, 'lingotes_facturas'), data);
    return docRef.id;
  };

  const deleteLingoteFactura = async (id) => {
    await deleteDoc(doc(db, 'lingotes_facturas', id));
  };

  const updateLingoteFactura = async (id, data) => {
    await updateDoc(doc(db, 'lingotes_facturas', id), data);
  };

  return {
    // Data
    categorias,
    clientes,
    expediciones,
    paquetes,
    estadosPaquete,
    usuarios,
    expedicionActualId,
    configGeneral,
    loading,

    // Config
    setExpedicionActualId,
    updateConfigGeneral,

    // CRUD
    saveCategoria,
    deleteCategoria,
    saveCliente,
    deleteCliente,
    updateClienteKilatajes,
    updateClienteDatosFiscales,
    saveExpedicion,
    deleteExpedicion,
    savePaquete,
    deletePaquete,
    addLineaToPaquete,
    removeLineaFromPaquete,
    updatePaqueteCierre,
    updatePaqueteFactura,
    updatePaqueteVerificacion,
    validarVerificacion,
    updatePaqueteEstado,
    updatePaqueteEstadoPago,
    marcarTodosComoEstado,
    addComentarioToPaquete,
    deleteComentarioFromPaquete,
    agregarUsuario,
    eliminarUsuario,
    guardarEdicionUsuario,
    regenerarCodigoUsuario,
    actualizarPermisosUsuario,
    agregarEstado,
    eliminarEstado,
    guardarEdicionEstado,
    updateExpedicionResultados,

    // Matriculas
    matriculas,
    agregarMatricula,
    eliminarMatricula,

    // Lingotes
    lingotesExportaciones,
    lingotesEntregas,
    lingotesConfig,
    lingotesFutura,
    lingotesFacturas,
    saveLingoteExportacion,
    deleteLingoteExportacion,
    saveLingoteEntrega,
    deleteLingoteEntrega,
    updateLingoteEntrega,
    updateLingotesConfig,
    saveLingoteFutura,
    deleteLingoteFutura,
    updateLingoteFutura,
    saveLingoteFactura,
    deleteLingoteFactura,
    updateLingoteFactura,
  };
}
