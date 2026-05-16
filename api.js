/**
 * api.js — Conexión y Autenticación con Supabase (PipeTrack)
 */

// Intentar cargar credenciales desde el almacenamiento local
let SUPABASE_URL = localStorage.getItem('pt_url') || '';
let SUPABASE_KEY = localStorage.getItem('pt_key') || '';

// Helper para verificar si estamos operando en modo Demo local
function isDemo() {
  return localStorage.getItem('pt_demo') === 'true' || (!SUPABASE_URL || !SUPABASE_KEY);
}

// Configuración de Cabeceras para peticiones HTTP a Supabase Rest API
function getHeaders() {
  return {
    'Content-Type': 'application/json',
    'apikey': SUPABASE_KEY,
    'Authorization': `Bearer ${localStorage.getItem('pt_token') || SUPABASE_KEY}`
  };
}

// ── SERVICIO DE AUTENTICACIÓN ──────────────────
const Auth = {
  async login(email, password) {
    if (!SUPABASE_URL || !SUPABASE_KEY) {
      throw new Error('Falta configurar la URL y la API Key de Supabase en la sección de Configuración.');
    }

    const url = `${SUPABASE_URL}/auth/v1/token?grant_type=password`;
    
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': SUPABASE_KEY
        },
        body: JSON.stringify({ email, password })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error_description || data.message || 'Credenciales incorrectas o error de Supabase');
      }

      // Guardar sesión de forma segura si todo sale bien
      localStorage.setItem('pt_token', data.access_token);
      localStorage.setItem('pt_user', JSON.stringify(data.user));
      localStorage.setItem('pt_demo', 'false');
      
      return data.user;
    } catch (error) {
      console.error('Error crítico en Auth.login:', error);
      throw error;
    }
  },

  logout() {
    localStorage.removeItem('pt_token');
    localStorage.removeItem('pt_user');
    localStorage.setItem('pt_demo', 'true'); // Regresa a entorno seguro demo por defecto
    window.location.reload();
  },

  isLoggedIn() {
    if (isDemo()) {
      return localStorage.getItem('pt_token') === 'demo';
    }
    return localStorage.getItem('pt_token') !== null;
  },

  getUser() {
    try {
      return JSON.parse(localStorage.getItem('pt_user'));
    } catch (e) {
      return null;
    }
  }
};

// ── CONSULTAS A TABLAS (API REST SUPABASE) ─────
const Locaciones = {
  async getAll() {
    if (isDemo()) return DemoData.locaciones;
    const res = await fetch(`${SUPABASE_URL}/rest/v1/locaciones?select=*&order=nombre.asc`, { headers: getHeaders() });
    if (!res.ok) throw new Error('Error al cargar locaciones desde Supabase');
    return await res.json();
  }
};

const Tubos = {
  async getAll() {
    if (isDemo()) return DemoData.tubos;
    const res = await fetch(`${SUPABASE_URL}/rest/v1/tubos?select=*,locaciones(nombre)&order=id_tubo.asc`, { headers: getHeaders() });
    if (!res.ok) throw new Error('Error al cargar inventario de tubos');
    return await res.json();
  },
  async create(payload) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/tubos`, {
      method: 'POST',
      headers: { ...getHeaders(), 'Prefer': 'return=representation' },
      body: JSON.stringify(payload)
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.message || 'Error al registrar tubo en la base de datos');
    }
    return await res.json();
  }
};

const Inspecciones = {
  async getRecientes(limit = 50) {
    if (isDemo()) return DemoData.inspecciones;
    const res = await fetch(`${SUPABASE_URL}/rest/v1/inspecciones?select=*,tubos(id_tubo,locaciones(nombre))&order=fecha_inspeccion.desc&limit=${limit}`, { headers: getHeaders() });
    if (!res.ok) throw new Error('Error al extraer historial de inspecciones');
    return await res.json();
  },
  async create(payload) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/inspecciones`, {
      method: 'POST',
      headers: { ...getHeaders(), 'Prefer': 'return=representation' },
      body: JSON.stringify(payload)
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.message || 'Error al almacenar la inspección en Supabase');
    }
    return await res.json();
  }
};

// ── DATA DE RESPALDO (DEMO LOCAL) ──────────────
const DemoData = {
  locaciones: [
    { id: 1, nombre: "Estación Central — Recibo" },
    { id: 2, nombre: "Línea de Transferencia Km 12" },
    { id: 3, nombre: "Terminal de Despacho" }
  ],
  tubos: [
    { id_tubo: "TUB-001", locacion_id: 1, codigo_linea: "PL-CRU-04", diametro_nom_pulg: 6, espesor_nom_mm: 7.11, espesor_min_mm: 4.80, grado_material: "X52", clase_inspeccion: "Clase 1", latitud: -0.18065, longitud: -78.46783, proximo_insp_fecha: "2026-08-15" },
    { id_tubo: "TUB-002", locacion_id: 1, codigo_linea: "PL-GAS-02", diametro_nom_pulg: 4, espesor_nom_mm: 6.02, espesor_min_mm: 3.50, grado_material: "X42", clase_inspeccion: "Clase 2", latitud: -0.18210, longitud: -78.46910, proximo_insp_fecha: "2026-03-10" },
    { id_tubo: "TUB-003", locacion_id: 2, codigo_linea: "TL-CRU-12", diametro_nom_pulg: 12, espesor_nom_mm: 9.52, espesor_min_mm: 6.20, grado_material: "X65", clase_inspeccion: "Clase 1", latitud: -0.19500, longitud: -78.45200, proximo_insp_fecha: "2026-12-01" }
  ],
  inspecciones: [
    { id: "INS-901", tubo_id: "TUB-001", espesor_med_mm: 6.85, espesor_min_mm: 4.80, corrosion_visual: "Leve", estado_general: "Bueno", metodo_medicion: "UT", accion_requerida: "Ninguna", tasa_corrosion_mmpa: 0.052, vida_remanente_anios: 39.4, inspector: "m.gomez", fecha_inspeccion: "2026-02-14T10:30:00Z" },
    { id: "INS-902", tubo_id: "TUB-002", espesor_med_mm: 3.62, espesor_min_mm: 3.50, corrosion_visual: "Severa", estado_general: "Crítico", metodo_medicion: "UT", accion_requerida: "Reemplazar", tasa_corrosion_mmpa: 0.610, vida_remanente_anios: 0.2, inspector: "m.gomez", fecha_inspeccion: "2026-03-01T15:45:00Z" }
  ]
};
