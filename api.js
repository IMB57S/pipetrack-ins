/**
 * api.js — Capa de acceso a datos con Supabase
 * ─────────────────────────────────────────────
 * Reemplaza SUPABASE_URL y SUPABASE_KEY con tus credenciales.
 * Toda la app consume SOLO estas funciones. Si en el futuro
 * cambias de base de datos, solo editas este archivo.
 */

// ── CONFIGURACIÓN ─────────────────────────────
// Estas variables se sobreescriben desde localStorage (panel Config)
let SUPABASE_URL = localStorage.getItem('pt_url') || 'https://qimzodicacsmrbfnnjvc.supabase.co';
let SUPABASE_KEY = localStorage.getItem('pt_key') || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFpbXpvZGljYWNzbXJiZm5uanZjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUwNzUwMzgsImV4cCI6MjA5MDY1MTAzOH0.bid4FHqRDrYBBYIhpuFwvGwbY5xWFVEBkacNxvrb1UY';

// ── CLIENTE HTTP BASE ─────────────────────────
async function supaFetch(endpoint, options = {}) {
  const url = `${SUPABASE_URL}/rest/v1/${endpoint}`;
  const headers = {
    'apikey': SUPABASE_KEY,
    'Authorization': `Bearer ${SUPABASE_KEY}`,
    'Content-Type': 'application/json',
    'Prefer': options.prefer || 'return=representation',
    ...options.headers
  };

  try {
    const res = await fetch(url, { ...options, headers });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ message: res.statusText }));
      throw new Error(err.message || `HTTP ${res.status}`);
    }
    if (res.status === 204) return [];
    return await res.json();
  } catch (e) {
    console.error('Supabase error:', e.message);
    throw e;
  }
}

// ── AUTH (Supabase Auth) ──────────────────────
const Auth = {
  async login(email, password) {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: { 'apikey': SUPABASE_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error_description || 'Credenciales incorrectas');
    localStorage.setItem('pt_token', data.access_token);
    localStorage.setItem('pt_user', JSON.stringify(data.user));
    SUPABASE_KEY = data.access_token; // Usar JWT del usuario para RLS
    return data.user;
  },

  logout() {
    localStorage.removeItem('pt_token');
    localStorage.removeItem('pt_user');
    location.reload();
  },

  getUser() {
    const u = localStorage.getItem('pt_user');
    return u ? JSON.parse(u) : null;
  },

  isLoggedIn() {
    // Para DEMO sin Supabase real, aceptar credenciales locales
    return !!localStorage.getItem('pt_token') || !!localStorage.getItem('pt_demo');
  }
};

// ── LOCACIONES ────────────────────────────────
const Locaciones = {
  async getAll() {
    return await supaFetch('locaciones?select=*&order=nombre.asc');
  },

  async getById(id) {
    const data = await supaFetch(`locaciones?id=eq.${id}&select=*`);
    return data[0];
  }
};

// ── TUBOS ─────────────────────────────────────
const Tubos = {
  async getAll(locacionId = null) {
    let q = 'tubos?select=*,locaciones(nombre)&order=id_tubo.asc';
    if (locacionId) q += `&locacion_id=eq.${locacionId}`;
    return await supaFetch(q);
  },

  async getById(idTubo) {
    const data = await supaFetch(
      `tubos?id_tubo=eq.${idTubo}&select=*,locaciones(nombre)`
    );
    return data[0];
  },

  async search(term) {
    return await supaFetch(
      `tubos?or=(id_tubo.ilike.*${term}*,codigo_linea.ilike.*${term}*)&select=*,locaciones(nombre)&limit=100`
    );
  },

  async create(data) {
    return await supaFetch('tubos', {
      method: 'POST',
      body: JSON.stringify(data)
    });
  },

  async update(idTubo, data) {
    return await supaFetch(`tubos?id_tubo=eq.${idTubo}`, {
      method: 'PATCH',
      body: JSON.stringify(data)
    });
  },

  async getConMapa() {
    // Solo tubos con coordenadas GPS para el mapa
    return await supaFetch(
      'tubos?select=id_tubo,latitud,longitud,locacion_id,locaciones(nombre)&latitud=not.is.null&longitud=not.is.null'
    );
  }
};

// ── INSPECCIONES ──────────────────────────────
const Inspecciones = {
  async getRecientes(limit = 20) {
    return await supaFetch(
      `inspecciones?select=*,tubos(id_tubo,locaciones(nombre))&order=fecha_inspeccion.desc&limit=${limit}`
    );
  },

  async getByTubo(idTubo) {
    return await supaFetch(
      `inspecciones?tubo_id=eq.${idTubo}&select=*&order=fecha_inspeccion.desc`
    );
  },

  async getAll(filtroEstado = null) {
    let q = 'inspecciones?select=*,tubos(id_tubo,locaciones(nombre))&order=fecha_inspeccion.desc&limit=500';
    if (filtroEstado) q += `&estado_general=eq.${filtroEstado}`;
    return await supaFetch(q);
  },

  async getUltimaByTubo(idTubo) {
    const data = await supaFetch(
      `inspecciones?tubo_id=eq.${idTubo}&select=estado_general,espesor_med_mm&order=fecha_inspeccion.desc&limit=1`
    );
    return data[0] || null;
  },

  async create(data) {
    return await supaFetch('inspecciones', {
      method: 'POST',
      body: JSON.stringify({
        ...data,
        fecha_inspeccion: new Date().toISOString(),
      })
    });
  },

  async getEstadisticas() {
    // Cuenta por estado usando columna estado_general
    const [total, criticos, regulares] = await Promise.all([
      supaFetch('inspecciones?select=count&order=fecha_inspeccion.desc', { headers: { 'Prefer': 'count=exact', 'Range': '0-0' } }).catch(() => []),
      supaFetch('inspecciones?estado_general=eq.Crítico&select=id,tubo_id,tubos(id_tubo,locaciones(nombre)),espesor_med_mm,espesor_min_mm,tasa_corrosion_mmpa,vida_remanente_anios,fecha_inspeccion,inspector&order=fecha_inspeccion.desc'),
      supaFetch('inspecciones?estado_general=eq.Regular&select=id&limit=1000'),
    ]);
    return { criticos, regulares };
  }
};

// ── ESTADÍSTICAS DEL DASHBOARD ────────────────
const Stats = {
  async getKPIs() {
    // Obtenemos todas las últimas inspecciones por tubo
    // (usamos una vista en Supabase o calculamos aquí)
    const todas = await supaFetch(
      'inspecciones?select=id_tubo,estado_general&order=id_tubo.asc,fecha_inspeccion.desc'
    );

    // Deduplicar: quedarse solo con la inspección más reciente por tubo
    const ultimaMap = {};
    for (const insp of todas) {
      if (!ultimaMap[insp.id_tubo]) ultimaMap[insp.id_tubo] = insp;
    }

    const ultimas = Object.values(ultimaMap);
    const total   = ultimas.length;
    const buenos  = ultimas.filter(i => i.estado_general === 'Bueno').length;
    const regulares = ultimas.filter(i => i.estado_general === 'Regular').length;
    const criticos  = ultimas.filter(i => i.estado_general === 'Crítico').length;

    return { total, buenos, regulares, criticos };
  }
};

// ── DATOS DEMO (cuando no hay Supabase real) ──
const DemoData = {
  locaciones: [
    { id: 1, nombre: 'Pozo Norte #1' },
    { id: 2, nombre: 'Pozo Sur #2' },
    { id: 3, nombre: 'Planta Compresora A' },
    { id: 4, nombre: 'Línea Troncal Km 45' },
    { id: 5, nombre: 'Estación Medición #3' },
    { id: 6, nombre: 'Pozo Este #4' },
    { id: 7, nombre: 'Batería de Producción' },
  ],
  tubos: [
    { id_tubo:'TUB-001', locacion_id:1, codigo_linea:'LP-GAS-001', diametro_nom_pulg:6, espesor_nom_mm:7.11, espesor_min_mm:5.2, grado_material:'X52', clase_inspeccion:'Clase 2', latitud:-10.1234, longitud:-75.4561, locaciones:{nombre:'Pozo Norte #1'} },
    { id_tubo:'TUB-002', locacion_id:1, codigo_linea:'LP-GAS-001', diametro_nom_pulg:6, espesor_nom_mm:7.11, espesor_min_mm:5.2, grado_material:'X52', clase_inspeccion:'Clase 2', latitud:-10.1238, longitud:-75.4563, locaciones:{nombre:'Pozo Norte #1'} },
    { id_tubo:'TUB-047', locacion_id:2, codigo_linea:'LP-GAS-002', diametro_nom_pulg:6, espesor_nom_mm:7.11, espesor_min_mm:5.2, grado_material:'X52', clase_inspeccion:'Clase 1', latitud:-10.1299, longitud:-75.4589, locaciones:{nombre:'Pozo Sur #2'} },
    { id_tubo:'TUB-048', locacion_id:2, codigo_linea:'LP-GAS-002', diametro_nom_pulg:8, espesor_nom_mm:8.18, espesor_min_mm:6.0, grado_material:'X60', clase_inspeccion:'Clase 2', latitud:-10.1302, longitud:-75.4592, locaciones:{nombre:'Pozo Sur #2'} },
    { id_tubo:'TUB-120', locacion_id:3, codigo_linea:'HP-GAS-003', diametro_nom_pulg:10, espesor_nom_mm:9.27, espesor_min_mm:7.0, grado_material:'X65', clase_inspeccion:'Clase 1', latitud:-10.1450, longitud:-75.4700, locaciones:{nombre:'Planta Compresora A'} },
    { id_tubo:'TUB-205', locacion_id:4, codigo_linea:'TR-OIL-001', diametro_nom_pulg:12, espesor_nom_mm:9.52, espesor_min_mm:7.2, grado_material:'X70', clase_inspeccion:'Clase 2', latitud:-10.1600, longitud:-75.4800, locaciones:{nombre:'Línea Troncal Km 45'} },
    { id_tubo:'TUB-310', locacion_id:5, codigo_linea:'MED-GAS-001', diametro_nom_pulg:4, espesor_nom_mm:6.02, espesor_min_mm:4.5, grado_material:'X42', clase_inspeccion:'Clase 3', latitud:-10.0980, longitud:-75.4420, locaciones:{nombre:'Estación Medición #3'} },
    { id_tubo:'TUB-401', locacion_id:6, codigo_linea:'LP-OIL-001', diametro_nom_pulg:6, espesor_nom_mm:7.11, espesor_min_mm:5.2, grado_material:'X52', clase_inspeccion:'Clase 2', latitud:-10.0850, longitud:-75.4100, locaciones:{nombre:'Pozo Este #4'} },
  ],
  inspecciones: [
    { id:'INS-001', id_tubo:'TUB-001', tubo_id:'TUB-001', espesor_med_mm:6.9, espesor_prev_mm:7.1, espesor_min_mm:5.2, corrosion_visual:'Leve', estado_general:'Bueno', tasa_corrosion_mmpa:0.24, vida_remanente_anios:7.1, inspector:'J. Rodríguez', fecha_inspeccion:'2026-03-25', accion_requerida:'Ninguna', tubos:{id_tubo:'TUB-001', locaciones:{nombre:'Pozo Norte #1'}} },
    { id:'INS-002', id_tubo:'TUB-002', tubo_id:'TUB-002', espesor_med_mm:6.5, espesor_prev_mm:7.0, espesor_min_mm:5.2, corrosion_visual:'Moderada', estado_general:'Regular', tasa_corrosion_mmpa:0.42, vida_remanente_anios:3.1, inspector:'J. Rodríguez', fecha_inspeccion:'2026-03-24', accion_requerida:'Monitorear', tubos:{id_tubo:'TUB-002', locaciones:{nombre:'Pozo Norte #1'}} },
    { id:'INS-003', id_tubo:'TUB-047', tubo_id:'TUB-047', espesor_med_mm:5.4, espesor_prev_mm:6.1, espesor_min_mm:5.2, corrosion_visual:'Severa', estado_general:'Crítico', tasa_corrosion_mmpa:0.70, vida_remanente_anios:0.3, inspector:'M. López', fecha_inspeccion:'2026-03-28', accion_requerida:'Reemplazar', tubos:{id_tubo:'TUB-047', locaciones:{nombre:'Pozo Sur #2'}} },
    { id:'INS-004', id_tubo:'TUB-048', tubo_id:'TUB-048', espesor_med_mm:7.8, espesor_prev_mm:8.0, espesor_min_mm:6.0, corrosion_visual:'Sin daño', estado_general:'Bueno', tasa_corrosion_mmpa:0.10, vida_remanente_anios:18.0, inspector:'M. López', fecha_inspeccion:'2026-03-22', accion_requerida:'Ninguna', tubos:{id_tubo:'TUB-048', locaciones:{nombre:'Pozo Sur #2'}} },
    { id:'INS-005', id_tubo:'TUB-120', tubo_id:'TUB-120', espesor_med_mm:7.9, espesor_prev_mm:8.5, espesor_min_mm:7.0, corrosion_visual:'Moderada', estado_general:'Regular', tasa_corrosion_mmpa:0.48, vida_remanente_anios:1.9, inspector:'A. Castro', fecha_inspeccion:'2026-03-20', accion_requerida:'Mantenimiento', tubos:{id_tubo:'TUB-120', locaciones:{nombre:'Planta Compresora A'}} },
    { id:'INS-006', id_tubo:'TUB-205', tubo_id:'TUB-205', espesor_med_mm:8.9, espesor_prev_mm:9.2, espesor_min_mm:7.2, corrosion_visual:'Leve', estado_general:'Bueno', tasa_corrosion_mmpa:0.15, vida_remanente_anios:11.3, inspector:'A. Castro', fecha_inspeccion:'2026-03-18', accion_requerida:'Ninguna', tubos:{id_tubo:'TUB-205', locaciones:{nombre:'Línea Troncal Km 45'}} },
    { id:'INS-007', id_tubo:'TUB-310', tubo_id:'TUB-310', espesor_med_mm:5.4, espesor_prev_mm:5.7, espesor_min_mm:4.5, corrosion_visual:'Leve', estado_general:'Bueno', tasa_corrosion_mmpa:0.18, vida_remanente_anios:5.0, inspector:'R. Flores', fecha_inspeccion:'2026-03-15', accion_requerida:'Ninguna', tubos:{id_tubo:'TUB-310', locaciones:{nombre:'Estación Medición #3'}} },
    { id:'INS-008', id_tubo:'TUB-401', tubo_id:'TUB-401', espesor_med_mm:5.5, espesor_prev_mm:6.2, espesor_min_mm:5.2, corrosion_visual:'Severa', estado_general:'Crítico', tasa_corrosion_mmpa:0.84, vida_remanente_anios:0.4, inspector:'R. Flores', fecha_inspeccion:'2026-03-28', accion_requerida:'Reemplazar', tubos:{id_tubo:'TUB-401', locaciones:{nombre:'Pozo Este #4'}} },
  ]
};

// ── MODO DEMO: redirige llamadas si no hay Supabase ──
function isDemo() {
  return localStorage.getItem('pt_demo') === 'true' || SUPABASE_URL.includes('TU-PROYECTO');
}
