/**
 * app.js — Lógica principal de la UI de PipeTrack
 * Navegación, renderizado, mapa Leaflet y cálculos mecánicos (API 570)
 */

// ── ESTADO GLOBAL DE LA APP ────────────────────
let state = {
  tubos: [],
  inspecciones: [],
  locaciones: [],
  mapInstance: null,
  mapMarkers: [],
  currentUser: null,
  thresholds: {
    margenCritico: parseFloat(localStorage.getItem('pt_margen') || '1.0'),
    vidaAlerta:    parseFloat(localStorage.getItem('pt_vida')   || '3'),
    crMax:         parseFloat(localStorage.getItem('pt_cr')     || '0.5'),
  }
};

// ── INICIALIZACIÓN (DOM READY) ─────────────────
document.addEventListener('DOMContentLoaded', () => {
  updateClock();
  setInterval(updateClock, 60000);

  // Verificación de Autenticación Segura
  if (!Auth.isLoggedIn()) {
    document.getElementById('login-overlay').style.display = 'flex';
  } else {
    initApp();
  }

  // Sincronizar inputs de configuración con variables locales
  const savedUrl = localStorage.getItem('pt_url');
  const savedKey = localStorage.getItem('pt_key');
  if (savedUrl) document.getElementById('cfg-url').value = savedUrl;
  if (savedKey) document.getElementById('cfg-key').value = savedKey;
  
  document.getElementById('cfg-margen').value = state.thresholds.margenCritico;
  document.getElementById('cfg-vida').value   = state.thresholds.vidaAlerta;
  document.getElementById('cfg-cr').value     = state.thresholds.crMax;
});

async function initApp() {
  const user = Auth.getUser();
  if (user) {
    state.currentUser = user;
    const email = user.email || 'inspector@demo.com';
    const initials = email.split('@')[0].slice(0, 2).toUpperCase();
    document.getElementById('user-avatar').textContent = initials;
    document.getElementById('user-name').textContent   = email.split('@')[0];
    document.getElementById('user-role').textContent   = user.user_metadata?.rol || 'Inspector';
  }
  await loadAllData();
  showPage('dashboard');
}

// ── EXTRACCIÓN Y CARGA DE DATOS ────────────────
async function loadAllData() {
  showSync('Sincronizando...');
  try {
    if (isDemo()) {
      state.locaciones   = DemoData.locaciones;
      state.tubos        = DemoData.tubos;
      state.inspecciones = DemoData.inspecciones;
    } else {
      const [locs, tubos, inspecciones] = await Promise.all([
        Locaciones.getAll(),
        Tubos.getAll(),
        Inspecciones.getRecientes(200),
      ]);
      state.locaciones   = locs;
      state.tubos        = tubos;
      state.inspecciones = inspecciones;
    }
    populateSelects();
    renderDashboard();
    renderTablaInspecciones();
    renderTablaTubos();
    renderAlertas();
    renderResumen();
    showSync('Sincronizado');
  } catch (e) {
    showSync('Error de Conexión', true);
    console.error('Fallo general en carga de datos:', e);
  }
}

function showSync(msg, isError = false) {
  const el = document.getElementById('sync-label');
  const dot = document.querySelector('.sync-dot');
  if (el) el.textContent = msg;
  if (dot) dot.style.background = isError ? 'var(--red)' : 'var(--green)';
}

// ── LLENADO DE SELECTORES DINÁMICOS ────────────
function populateSelects() {
  const locOptions = state.locaciones.map(l => `<option value="${l.id}">${l.nombre}</option>`).join('');
  
  const fl = document.getElementById('filter-locacion');
  if (fl) fl.innerHTML = '<option value="">Todas las locaciones</option>' + locOptions;

  const tl = document.getElementById('tubo-locacion');
  if (tl) tl.innerHTML = '<option value="">Seleccionar...</option>' + locOptions;

  const tuboOptions = state.tubos.map(t => `<option value="${t.id_tubo}">${t.id_tubo}</option>`).join('');
  const selTubo = document.getElementById('insp-tubo-id');
  if (selTubo) selTubo.innerHTML = '<option value="">Seleccionar tubo...</option>' + tuboOptions;
}

// ── RENDERIZADO DEL DASHBOARD VUE ──────────────
function renderDashboard() {
  const ultimas = getUltimaInspeccionPorTubo();
  const total     = state.tubos.length || ultimas.length;
  const buenos    = ultimas.filter(i => i.estado_general === 'Bueno').length;
  const regulares = ultimas.filter(i => i.estado_general === 'Regular').length;
  const criticos  = ultimas.filter(i => i.estado_general === 'Crítico').length;

  const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  const pct = (n) => total ? `${Math.round(n/total*100)}% del total` : '0% del total';

  set('kpi-val-total',   total);
  set('kpi-val-bueno',   buenos);
  set('kpi-val-regular', regulares);
  set('kpi-val-critico', criticos);
  
  set('kpi-pct-bueno',   pct(buenos));
  set('kpi-pct-regular', pct(regulares));
  set('kpi-pct-critico', pct(criticos));

  animateBar('kpi-bar-bueno',   total ? (buenos/total*100) : 0);
  animateBar('kpi-bar-regular', total ? (regulares/total*100) : 0);
  animateBar('kpi-bar-critico', total ? (criticos/total*100) : 0);

  const badge = document.getElementById('badge-alertas');
  if (badge) badge.textContent = criticos;

  const recientes = [...state.inspecciones].slice(0, 8);
  const tbody = document.getElementById('tbody-recientes');
  if (tbody) {
    tbody.innerHTML = recientes.length
      ? recientes.map(i => `
          <tr>
            <td><span class="tube-id">${i.tubo_id || i.id_tubo}</span></td>
            <td>${i.tubos?.locaciones?.nombre || 'General'}</td>
            <td>${Number(i.espesor_med_mm).toFixed(1)} mm</td>
            <td>${i.corrosion_visual || '—'}</td>
            <td>${estadoPill(i.estado_general)}</td>
            <td>${i.inspector || '—'}</td>
            <td>${formatDate(i.fecha_inspeccion)}</td>
          </tr>`).join('')
      : '<tr><td colspan="7" class="loading-cell">Sin inspecciones registradas</td></tr>';
  }
}

function animateBar(id, pct) {
  const el = document.getElementById(id);
  if (el) setTimeout(() => el.style.width = pct + '%', 100);
}

function getUltimaInspeccionPorTubo() {
  const map = {};
  // Al estar ordenadas por fecha desc, la primera que encuentre es la más reciente
  for (const i of state.inspecciones) {
    const key = i.tubo_id || i.id_tubo;
    if (!map[key]) map[key] = i;
  }
  return Object.values(map);
}

// ── TABLA DE INSPECCIONES COMPLETA ─────────────
function renderTablaInspecciones(filtroEstado = '') {
  const data = filtroEstado ? state.inspecciones.filter(i => i.estado_general === filtroEstado) : state.inspecciones;
  const tbody = document.getElementById('tbody-inspecciones');
  if (!tbody) return;

  tbody.innerHTML = data.length
    ? data.map(i => `
        <tr>
          <td><span class="tube-id" style="color:var(--muted);font-size:11px">${i.id || '—'}</span></td>
          <td><span class="tube-id">${i.tubo_id || i.id_tubo}</span></td>
          <td>${i.tubos?.locaciones?.nombre || 'General'}</td>
          <td style="font-weight:600;color:${colorEspesor(i.espesor_med_mm, i.espesor_min_mm)}">${Number(i.espesor_med_mm).toFixed(2)}</td>
          <td>${margen(i)} mm</td>
          <td>${i.tasa_corrosion_mmpa ? Number(i.tasa_corrosion_mmpa).toFixed(3) : '—'}</td>
          <td>${i.vida_remanente_anios ? Number(i.vida_remanente_anios).toFixed(1) : '—'}</td>
          <td>${i.corrosion_visual || '—'}</td>
          <td>${estadoPill(i.estado_general)}</td>
          <td>${i.inspector || '—'}</td>
          <td>${formatDate(i.fecha_inspeccion)}</td>
          <td>${i.foto_anomalia_1 ? `<a href="${i.foto_anomalia_1}" target="_blank" style="color:var(--accent)">📷 Ver</a>` : '—'}</td>
        </tr>`).join('')
    : '<tr><td colspan="12" class="loading-cell">Sin registros de inspección</td></tr>';
}

document.addEventListener('change', (e) => {
  if (e.target.id === 'filter-estado') renderTablaInspecciones(e.target.value);
});

// ── TABLA DE TUBOS (INVENTARIO) ────────────────
function renderTablaTubos(datos = null) {
  const data = datos || state.tubos;
  const tbody = document.getElementById('tbody-tubos');
  if (!tbody) return;

  tbody.innerHTML = data.length
    ? data.map(t => {
        const hoy = new Date();
        const prox = t.proximo_insp_fecha ? new Date(t.proximo_insp_fecha) : null;
        const vencido = prox && prox < hoy;
        return `
        <tr>
          <td><span class="tube-id">${t.id_tubo}</span></td>
          <td>${t.locaciones?.nombre || 'General'}</td>
          <td style="font-family:'JetBrains Mono',monospace;font-size:11px;color:var(--muted)">${t.codigo_linea || '—'}</td>
          <td style="text-align:center">${t.diametro_nom_pulg || '—'}"</td>
          <td style="text-align:center">${t.espesor_nom_mm || '—'}</td>
          <td style="text-align:center;color:var(--yellow)">${t.espesor_min_mm || '—'}</td>
          <td><span style="background:var(--surface2);padding:2px 8px;border-radius:4px;font-size:11px">${t.grado_material || '—'}</span></td>
          <td style="text-align:center">${t.clase_inspeccion || '—'}</td>
          <td style="color:${vencido ? 'var(--red)' : 'var(--muted)'};font-size:11px">${t.proximo_insp_fecha ? formatDate(t.proximo_insp_fecha) : '—'} ${vencido ? '⚠' : ''}</td>
          <td><button class="btn-link" onclick="verDetalleTubo('${t.id_tubo}')">Detalle</button></td>
        </tr>`;
      }).join('')
    : '<tr><td colspan="10" class="loading-cell">Sin componentes de tubería registrados</td></tr>';
}

function filterTubos() {
  const term = document.getElementById('search-tubos')?.value?.toLowerCase() || '';
  if (!term) { renderTablaTubos(); return; }
  const filtered = state.tubos.filter(t =>
    t.id_tubo?.toLowerCase().includes(term) ||
    t.codigo_linea?.toLowerCase().includes(term) ||
    t.locaciones?.nombre?.toLowerCase().includes(term)
  );
  renderTablaTubos(filtered);
}

// ── MANEJO LOG DE ALERTAS ACTIVAS ──────────────
function renderAlertas() {
  const ultimas = getUltimaInspeccionPorTubo();
  const criticos = ultimas.filter(i => i.estado_general === 'Crítico');
  const regulares = ultimas.filter(i => i.estado_general === 'Regular' && (i.vida_remanente_anios || 99) < state.thresholds.vidaAlerta);

  const mkAlerta = (i, tipo) => `
    <div class="alert-item ${tipo === 'warn' ? 'warn' : ''}">
      <div class="alert-icon">${tipo === 'crit' ? '🚨' : '⚠️'}</div>
      <div class="alert-body">
        <div class="alert-title">${i.tubo_id || i.id_tubo} — ${tipo === 'crit' ? 'Estado CRÍTICO' : 'Vida remanente baja'}</div>
        <div class="alert-desc">
          Espesor: ${Number(i.espesor_med_mm).toFixed(2)}mm · CR: ${i.tasa_corrosion_mmpa ? Number(i.tasa_corrosion_mmpa).toFixed(3) : '0.00'} mm/a · Vida rem.: ${i.vida_remanente_anios ? Number(i.vida_remanente_anios).toFixed(1) : '—'} años
        </div>
      </div>
      <div class="alert-time">${formatDate(i.fecha_inspeccion)}</div>
    </div>`;

  const html = [...criticos.map(i => mkAlerta(i, 'crit')), ...regulares.map(i => mkAlerta(i, 'warn'))].join('') || '<div class="loading-cell">Sin alertas críticas en el sistema ✓</div>';

  const el1 = document.getElementById('alertas-list');
  const el2 = document.getElementById('alertas-full-list');
  if (el1) el1.innerHTML = html;
  if (el2) el2.innerHTML = html;
}

// ── LEAFLET GPS INTEGRATION ────────────────────
function initMap() {
  if (state.mapInstance) return;
  const map = L.map('map').setView([-0.18065, -78.46783], 11);

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '© OpenStreetMap'
  }).addTo(map);

  document.getElementById('map').style.filter = 'invert(1) hue-rotate(200deg) brightness(0.95) contrast(0.9)';
  state.mapInstance = map;
  renderMapPins();
}

function renderMapPins() {
  const map = state.mapInstance;
  if (!map) return;

  state.mapMarkers.forEach(m => m.remove());
  state.mapMarkers = [];

  const ultimas = getUltimaInspeccionPorTubo();
  const colores = { 'Bueno': '#18C47A', 'Regular': '#E8B80C', 'Crítico': '#E83030' };

  state.tubos.forEach(t => {
    if (!t.latitud || !t.longitud) return;
    const insp = ultimas.find(i => (i.tubo_id || i.id_tubo) === t.id_tubo);
    const estado = insp?.estado_general || 'Bueno';
    const color = colores[estado] || '#18C47A';

    const icon = L.divIcon({
      className: '',
      html: `<div style="width:12px;height:12px;background:${color};border:2px solid #000;border-radius:50%;box-shadow:0 0 8px ${color};"></div>`,
      iconSize: [12, 12]
    });

    const marker = L.marker([t.latitud, t.longitud], { icon })
      .bindPopup(`<b>${t.id_tubo}</b><br>Estado: <span style="color:${color}">${estado}</span>`)
      .addTo(map);

    state.mapMarkers.push(marker);
  });
}

// ── ASISTENTE DE CÁLCULO API 570 ────────────────
function calcularInspeccion() {
  const tuboId = document.getElementById('insp-tubo-id')?.value;
  const espMed = parseFloat(document.getElementById('insp-espesor')?.value);
  const espPrev = parseFloat(document.getElementById('insp-esp-prev')?.value);
  const meses = parseFloat(document.getElementById('insp-meses')?.value);

  if (!espMed || !tuboId) { document.getElementById('calc-panel').style.display = 'none'; return; }

  const tubo = state.tubos.find(t => t.id_tubo === tuboId);
  const espMin = tubo?.espesor_min_mm || 4.0;

  const margenVal = espMed - espMin;
  const crVal = (espPrev && meses > 0) ? ((espPrev - espMed) / (meses / 12)) : null;
  const vidaVal = (crVal && crVal > 0) ? (margenVal / crVal) : null;

  const estado = margenVal < state.thresholds.margenCritico ? 'Crítico' : (vidaVal !== null && vidaVal < state.thresholds.vidaAlerta) ? 'Regular' : 'Bueno';
  const colors = { 'Bueno': 'var(--green)', 'Regular': 'var(--yellow)', 'Crítico': 'var(--red)' };

  document.getElementById('calc-panel').style.display = 'block';
  document.getElementById('calc-margen').textContent = margenVal.toFixed(2) + ' mm';
  document.getElementById('calc-cr').textContent = crVal !== null ? crVal.toFixed(3) + ' mm/a' : '—';
  document.getElementById('calc-vida').textContent = vidaVal !== null ? vidaVal.toFixed(1) + ' años' : '—';
  document.getElementById('calc-estado').textContent = estado;
  document.getElementById('calc-estado').style.color = colors[estado];

  const se = document.getElementById('insp-estado'); if (se) se.value = estado;
  const sa = document.getElementById('insp-accion'); if (sa) sa.value = estado === 'Crítico' ? 'Reemplazar' : estado === 'Regular' ? 'Monitorear' : 'Ninguna';
}

// ── REGISTROS (CREATE ACTION) ──────────────────
async function guardarInspeccion() {
  const tuboId = document.getElementById('insp-tubo-id')?.value;
  const espMed = parseFloat(document.getElementById('insp-espesor')?.value);
  const estado = document.getElementById('insp-estado')?.value;

  if (!tuboId || !espMed || !estado) return showToast('Completa los campos (*) requeridos', 'error');

  const payload = {
    tubo_id: tuboId,
    espesor_med_mm: espMed,
    estado_general: estado,
    corrosion_visual: document.getElementById('insp-corrosion')?.value,
    metodo_medicion: document.getElementById('insp-metodo')?.value,
    accion_requerida: document.getElementById('insp-accion')?.value,
    observaciones: document.getElementById('insp-notas')?.value,
    fecha_inspeccion: new Date().toISOString(),
    inspector: state.currentUser?.email?.split('@')[0] || 'Inspector'
  };

  try {
    if (isDemo()) {
      state.inspecciones.unshift({ ...payload, id: 'INS-' + Date.now() });
    } else {
      await Inspecciones.create(payload);
    }
    closeModal('modal-inspeccion');
    await loadAllData();
    showToast('Inspección guardada correctamente');
  } catch (e) {
    showToast(e.message, 'error');
  }
}

async function guardarTubo() {
  const idTubo = document.getElementById('tubo-id')?.value?.trim();
  const locId = document.getElementById('tubo-locacion')?.value;

  if (!idTubo || !locId) return showToast('ID Tubo y Locación obligatorios', 'error');

  const payload = {
    id_tubo: idTubo,
    locacion_id: parseInt(locId),
    codigo_linea: document.getElementById('tubo-linea')?.value,
    grado_material: document.getElementById('tubo-grado')?.value,
    espesor_nom_mm: parseFloat(document.getElementById('tubo-esp-nom')?.value) || 0,
    espesor_min_mm: parseFloat(document.getElementById('tubo-esp-min')?.value) || 0,
    latitud: parseFloat(document.getElementById('tubo-lat')?.value) || null,
    longitud: parseFloat(document.getElementById('tubo-lon')?.value) || null
  };

  try {
    if (isDemo()) {
      state.tubos.push(payload);
    } else {
      await Tubos.create(payload);
    }
    closeModal('modal-tubo');
    await loadAllData();
    showToast(`Tubo ${idTubo} añadido`);
  } catch (e) {
    showToast(e.message, 'error');
  }
}

// ── INTERFAZ DE AUTENTICACIÓN (LOGIN CONTROL) ──
async function login() {
  const email = document.getElementById('login-email')?.value?.trim();
  const pass  = document.getElementById('login-pass')?.value;
  const errEl = document.getElementById('login-error');
  const loginBtn = document.querySelector('.login-card .btn-primary');

  if (!email || !pass) {
    return showToast('Ingresa correo y contraseña', 'error');
  }

  if (errEl) errEl.style.display = 'none';
  if (loginBtn) { loginBtn.textContent = 'Autenticando...'; loginBtn.disabled = true; }

  // Caso A: Modo Demo Local
  if (email === 'demo@pipetrack.com' && pass === 'demo1234') {
    localStorage.setItem('pt_demo', 'true');
    localStorage.setItem('pt_token', 'demo');
    localStorage.setItem('pt_user', JSON.stringify({ email, user_metadata: { rol: 'Demo' } }));
    
    document.getElementById('login-overlay').style.display = 'none';
    if (loginBtn) { loginBtn.textContent = 'Ingresar al Sistema'; loginBtn.disabled = false; }
    await initApp();
    return;
  }

  // Caso B: Cuenta Supabase Real
  try {
    localStorage.removeItem('pt_demo'); // Rompe herencia de datos simulados
    
    const sessionUser = await Auth.login(email, pass);
    
    if (!sessionUser) throw new Error('Servidor no generó un token de acceso válido.');

    document.getElementById('login-overlay').style.display = 'none';
    await initApp();
    showToast('Conexión exitosa');
  } catch (error) {
    console.error('Fallo de Login capturado:', error);
    if (errEl) {
      errEl.textContent = error.message || 'Error de comunicación con base de datos.';
      errEl.style.display = 'block';
    } else {
      showToast(error.message, 'error');
    }
  } finally {
    // ESTO EVITA QUE EL BOTÓN SE QUEDE CONGELADO SI FALLA LA PETICIÓN
    if (loginBtn) { loginBtn.textContent = 'Ingresar al Sistema'; loginBtn.disabled = false; }
  }
}

function logout() { Auth.logout(); }

// ── NAVEGACIÓN Y PANELES MÓVILES ───────────────
function showPage(name) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));

  const p = document.getElementById(`page-${name}`); if (p) p.classList.add('active');
  const n = document.querySelector(`[data-page="${name}"]`); if (n) n.classList.add('active');

  const lbls = { dashboard: 'Dashboard', mapa: 'Mapa de Tuberías', tubos: 'Inventario', inspecciones: 'Inspecciones', alertas: 'Alertas', reportes: 'Reportes', config: 'Configuración' };
  const bc = document.getElementById('breadcrumb'); if (bc) bc.textContent = lbls[name] || name;

  if (name === 'mapa') setTimeout(initMap, 150);
}

document.querySelectorAll('.nav-item').forEach(item => {
  item.addEventListener('click', (e) => { e.preventDefault(); showPage(item.dataset.page); });
});

function toggleSidebar() {
  document.getElementById('sidebar').classList.toggle('hidden');
  document.getElementById('main-content').classList.toggle('full');
}

function openModal(id) { const m = document.getElementById(id); if (m) m.classList.add('open'); }
function closeModal(id) { const m = document.getElementById(id); if (m) m.classList.remove('open'); }
function closeModalOutside(e) { if (e.target === e.currentTarget) closeModal(e.currentTarget.id); }

// ── UTILS & FORMATTERS ─────────────────────────
function estadoPill(est) {
  const cls = { 'Bueno': 'pill-bueno', 'Regular': 'pill-regular', 'Crítico': 'pill-critico' };
  return `<span class="status-pill ${cls[est] || ''}">● ${est || 'Sin datos'}</span>`;
}
function margen(i) { return (i.espesor_med_mm - i.espesor_min_mm).toFixed(2); }
function colorEspesor(med, min) { return (med - min) < 1.0 ? 'var(--red)' : (med - min) < 2.0 ? 'var(--yellow)' : 'var(--green)'; }
function formatDate(d) { return d ? new Date(d).toLocaleDateString('es') : '—'; }
function updateClock() { const el = document.getElementById('topbar-date'); if (el) el.textContent = new Date().toLocaleTimeString('es', {hour:'2-digit', minute:'2-digit'}); }
function renderResumen() { document.getElementById('resumen-sistema').innerHTML = `Componentes: ${state.tubos.length}<br>Inspecciones: ${state.inspecciones.length}`; }
function saveConfig() { localStorage.setItem('pt_url', document.getElementById('cfg-url').value); localStorage.setItem('pt_key', document.getElementById('cfg-key').value); window.location.reload(); }
function showToast(msg, type='ok') { const t = document.createElement('div'); t.className=`toast ${type}`; t.textContent=msg; document.body.appendChild(t); setTimeout(() => t.remove(), 3000); }
function verDetalleTubo(id) { alert(`Componente: ${id}\nRevise el mapa o la tabla de inspecciones para ver el historial analítico completo.`); }
