/**
 * app.js — Lógica principal de PipeTrack
 * Navegación, renderizado de datos, mapa Leaflet, formularios
 */

// ── ESTADO GLOBAL ──────────────────────────────
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

// ── INIT ───────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  updateClock();
  setInterval(updateClock, 60000);

  if (!Auth.isLoggedIn()) {
    document.getElementById('login-overlay').style.display = 'flex';
  } else {
    initApp();
  }

  // Cargar config guardada
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

// ── CARGAR DATOS ───────────────────────────────
async function loadAllData() {
  showSync('Cargando...');
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
    showSync('Error: ' + e.message, true);
    console.error(e);
  }
}

function showSync(msg, isError = false) {
  const el = document.getElementById('sync-label');
  const dot = document.querySelector('.sync-dot');
  el.textContent = msg;
  dot.style.background = isError ? 'var(--red)' : 'var(--green)';
}

// ── SELECTS DINÁMICOS ──────────────────────────
function populateSelects() {
  const locOptions = state.locaciones.map(l => `<option value="${l.id}">${l.nombre}</option>`).join('');

  ['filter-locacion'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = '<option value="">Todas las locaciones</option>' + locOptions;
  });

  ['tubo-locacion'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = '<option value="">Seleccionar...</option>' + locOptions;
  });

  const tuboOptions = state.tubos.map(t => `<option value="${t.id_tubo}">${t.id_tubo} — ${t.locaciones?.nombre || ''}</option>`).join('');
  const selTubo = document.getElementById('insp-tubo-id');
  if (selTubo) selTubo.innerHTML = '<option value="">Seleccionar tubo...</option>' + tuboOptions;
}

// ── DASHBOARD ─────────────────────────────────
function renderDashboard() {
  const ultimas = getUltimaInspeccionPorTubo();
  const total     = ultimas.length;
  const buenos    = ultimas.filter(i => i.estado_general === 'Bueno').length;
  const regulares = ultimas.filter(i => i.estado_general === 'Regular').length;
  const criticos  = ultimas.filter(i => i.estado_general === 'Crítico').length;

  const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  const pct = (n) => total ? `${Math.round(n/total*100)}% del total` : '—';

  set('kpi-val-total',   total || state.tubos.length);
  set('kpi-val-bueno',   buenos);
  set('kpi-val-regular', regulares);
  set('kpi-val-critico', criticos);
  set('kpi-pct-bueno',   pct(buenos));
  set('kpi-pct-regular', pct(regulares));
  set('kpi-pct-critico', pct(criticos));

  const pctB = total ? buenos/total*100 : 0;
  const pctR = total ? regulares/total*100 : 0;
  const pctC = total ? criticos/total*100 : 0;

  animateBar('kpi-bar-bueno',   pctB);
  animateBar('kpi-bar-regular', pctR);
  animateBar('kpi-bar-critico', pctC);

  // Badge alertas
  const badge = document.getElementById('badge-alertas');
  if (badge) badge.textContent = criticos;

  // Tabla recientes
  const recientes = [...state.inspecciones].slice(0, 8);
  const tbody = document.getElementById('tbody-recientes');
  if (tbody) {
    tbody.innerHTML = recientes.length
      ? recientes.map(i => `
          <tr>
            <td><span class="tube-id">${i.tubos?.id_tubo || i.tubo_id || i.id_tubo}</span></td>
            <td>${i.tubos?.locaciones?.nombre || '—'}</td>
            <td>${Number(i.espesor_med_mm).toFixed(1)}</td>
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
  for (const i of state.inspecciones) {
    const key = i.tubo_id || i.id_tubo;
    if (!map[key]) map[key] = i;
  }
  return Object.values(map);
}

// ── TABLA INSPECCIONES ─────────────────────────
function renderTablaInspecciones(filtroEstado = '') {
  const data = filtroEstado
    ? state.inspecciones.filter(i => i.estado_general === filtroEstado)
    : state.inspecciones;

  const tbody = document.getElementById('tbody-inspecciones');
  if (!tbody) return;

  tbody.innerHTML = data.length
    ? data.map(i => `
        <tr>
          <td><span class="tube-id" style="color:var(--muted);font-size:11px">${i.id || '—'}</span></td>
          <td><span class="tube-id">${i.tubos?.id_tubo || i.tubo_id || i.id_tubo}</span></td>
          <td>${i.tubos?.locaciones?.nombre || '—'}</td>
          <td style="font-weight:600;color:${colorEspesor(i.espesor_med_mm, i.espesor_min_mm)}">${Number(i.espesor_med_mm).toFixed(2)}</td>
          <td style="color:${(i.espesor_med_mm - i.espesor_min_mm) < 1.5 ? 'var(--red)' : 'var(--text)'}">${margen(i)}</td>
          <td style="color:${(i.tasa_corrosion_mmpa||0) > 0.5 ? 'var(--red)' : 'var(--text)'}">${i.tasa_corrosion_mmpa ? Number(i.tasa_corrosion_mmpa).toFixed(3) : '—'}</td>
          <td style="color:${(i.vida_remanente_anios||99) < 3 ? 'var(--red)' : 'var(--green)'}">${i.vida_remanente_anios ? Number(i.vida_remanente_anios).toFixed(1) : '—'}</td>
          <td>${i.corrosion_visual || '—'}</td>
          <td>${estadoPill(i.estado_general)}</td>
          <td>${i.inspector || '—'}</td>
          <td>${formatDate(i.fecha_inspeccion)}</td>
          <td>${i.foto_anomalia_1 ? `<a href="${i.foto_anomalia_1}" target="_blank" style="color:var(--accent);font-size:11px">📷 Ver</a>` : '—'}</td>
        </tr>`).join('')
    : '<tr><td colspan="12" class="loading-cell">Sin resultados</td></tr>';
}

document.addEventListener('change', (e) => {
  if (e.target.id === 'filter-estado') renderTablaInspecciones(e.target.value);
});

// ── TABLA TUBOS ────────────────────────────────
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
          <td>${t.locaciones?.nombre || '—'}</td>
          <td style="font-family:'JetBrains Mono',monospace;font-size:11px;color:var(--muted)">${t.codigo_linea || '—'}</td>
          <td style="text-align:center">${t.diametro_nom_pulg || '—'}"</td>
          <td style="text-align:center">${t.espesor_nom_mm || '—'}</td>
          <td style="text-align:center;color:var(--yellow)">${t.espesor_min_mm || '—'}</td>
          <td><span style="background:var(--surface2);padding:2px 8px;border-radius:4px;font-size:11px;font-family:'JetBrains Mono',monospace">${t.grado_material || '—'}</span></td>
          <td style="text-align:center">${t.clase_inspeccion || '—'}</td>
          <td style="color:${vencido ? 'var(--red)' : 'var(--muted)';font-family:'JetBrains Mono',monospace;font-size:11px">${t.proximo_insp_fecha ? formatDate(t.proximo_insp_fecha) : '—'} ${vencido ? '⚠' : ''}</td>
          <td>
            <button class="btn-link" onclick="verDetalleTubo('${t.id_tubo}')">Detalle</button>
          </td>
        </tr>`;
      }).join('')
    : '<tr><td colspan="10" class="loading-cell">Sin tubos registrados</td></tr>';
}

function filterTubos() {
  const term = document.getElementById('search-tubos')?.value?.toLowerCase() || '';
  if (!term) { renderTablaTubos(); return; }
  const filtered = state.tubos.filter(t =>
    t.id_tubo?.toLowerCase().includes(term) ||
    t.codigo_linea?.toLowerCase().includes(term) ||
    t.grado_material?.toLowerCase().includes(term) ||
    t.locaciones?.nombre?.toLowerCase().includes(term)
  );
  renderTablaTubos(filtered);
}

// ── ALERTAS ────────────────────────────────────
function renderAlertas() {
  const criticos = state.inspecciones.filter(i => i.estado_general === 'Crítico');
  const regulares = state.inspecciones.filter(i =>
    i.estado_general === 'Regular' && (i.vida_remanente_anios || 99) < state.thresholds.vidaAlerta
  );

  const mkAlerta = (i, tipo) => `
    <div class="alert-item ${tipo === 'warn' ? 'warn' : ''}">
      <div class="alert-icon">${tipo === 'crit' ? '🚨' : '⚠️'}</div>
      <div class="alert-body">
        <div class="alert-title">${i.tubos?.id_tubo || i.tubo_id} — ${tipo === 'crit' ? 'Estado CRÍTICO' : 'Vida remanente < ' + state.thresholds.vidaAlerta + ' años'}</div>
        <div class="alert-desc">
          Espesor: ${Number(i.espesor_med_mm).toFixed(2)}mm · 
          CR: ${i.tasa_corrosion_mmpa ? Number(i.tasa_corrosion_mmpa).toFixed(3) : '—'} mm/año · 
          Vida rem.: ${i.vida_remanente_anios ? Number(i.vida_remanente_anios).toFixed(1) : '—'} años · 
          ${i.tubos?.locaciones?.nombre || '—'}
        </div>
      </div>
      <div class="alert-time">${formatDate(i.fecha_inspeccion)}</div>
    </div>`;

  const html = [
    ...criticos.map(i  => mkAlerta(i, 'crit')),
    ...regulares.map(i => mkAlerta(i, 'warn')),
  ].join('') || '<div class="loading-cell">Sin alertas activas ✓</div>';

  const el1 = document.getElementById('alertas-list');
  const el2 = document.getElementById('alertas-full-list');
  if (el1) el1.innerHTML = html;
  if (el2) el2.innerHTML = html;
}

// ── MAPA LEAFLET ───────────────────────────────
function initMap() {
  if (state.mapInstance) return;

  const map = L.map('map', {
    center: [-10.1, -75.4],
    zoom: 11,
    zoomControl: true,
  });

  // Tile layer oscuro gratuito (OpenStreetMap con filtro CSS)
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap',
    maxZoom: 19,
  }).addTo(map);

  // Overlay oscuro vía CSS
  document.getElementById('map').style.filter = 'invert(1) hue-rotate(200deg) brightness(0.9) contrast(0.9)';

  state.mapInstance = map;
  renderMapPins();
}

function renderMapPins() {
  const map = state.mapInstance;
  if (!map) return;

  // Limpiar pins anteriores
  state.mapMarkers.forEach(m => m.remove());
  state.mapMarkers = [];

  const ultimaMap = {};
  for (const i of state.inspecciones) {
    const key = i.tubo_id || i.id_tubo;
    if (!ultimaMap[key]) ultimaMap[key] = i;
  }

  const colores = { 'Bueno': '#18C47A', 'Regular': '#E8B80C', 'Crítico': '#E83030' };

  const tubosConCoords = state.tubos.filter(t => t.latitud && t.longitud);

  if (tubosConCoords.length === 0) {
    // Si no hay coords reales, usar demo data con pequeño offset
    DemoData.tubos.forEach(t => {
      if (!t.latitud) return;
      const insp = ultimaMap[t.id_tubo];
      const estado = insp?.estado_general || 'Bueno';
      const color  = colores[estado] || '#18C47A';
      addMapPin(map, t, estado, color, insp);
    });
  } else {
    tubosConCoords.forEach(t => {
      const insp  = ultimaMap[t.id_tubo];
      const estado = insp?.estado_general || 'Sin inspección';
      const color  = colores[estado] || '#4A6278';
      addMapPin(map, t, estado, color, insp);
    });
  }
}

function addMapPin(map, tubo, estado, color, insp) {
  const icon = L.divIcon({
    className: '',
    html: `<div style="
      width:12px;height:12px;
      background:${color};
      border:2px solid rgba(0,0,0,0.4);
      border-radius:50%;
      box-shadow:0 0 8px ${color};
      ${estado==='Crítico'?'animation:blink 1s infinite;':''}
    "></div>`,
    iconSize: [12, 12],
    iconAnchor: [6, 6],
  });

  const marker = L.marker([tubo.latitud, tubo.longitud], { icon })
    .bindPopup(`
      <div style="font-family:monospace;min-width:200px">
        <b style="color:#E8890C;font-size:14px">${tubo.id_tubo}</b><br>
        <span style="color:#888">${tubo.locaciones?.nombre || ''}</span><br><hr style="border-color:#333;margin:6px 0">
        Estado: <b style="color:${color}">${estado}</b><br>
        ${insp ? `
          Espesor: <b>${Number(insp.espesor_med_mm).toFixed(2)} mm</b><br>
          CR: <b>${insp.tasa_corrosion_mmpa ? Number(insp.tasa_corrosion_mmpa).toFixed(3) : '—'} mm/año</b><br>
          Vida rem.: <b>${insp.vida_remanente_anios ? Number(insp.vida_remanente_anios).toFixed(1) : '—'} años</b><br>
          Inspector: ${insp.inspector}<br>
          Fecha: ${formatDate(insp.fecha_inspeccion)}
        ` : 'Sin inspecciones registradas'}
      </div>
    `, { maxWidth: 260 })
    .addTo(map);

  state.mapMarkers.push(marker);
}

// ── CÁLCULOS API 570 EN FORMULARIO ────────────
function calcularInspeccion() {
  const tuboId   = document.getElementById('insp-tubo-id')?.value;
  const espMed   = parseFloat(document.getElementById('insp-espesor')?.value);
  const espPrev  = parseFloat(document.getElementById('insp-esp-prev')?.value);
  const meses    = parseFloat(document.getElementById('insp-meses')?.value);

  if (!espMed) { document.getElementById('calc-panel').style.display = 'none'; return; }

  const tubo   = state.tubos.find(t => t.id_tubo === tuboId);
  const espMin = tubo?.espesor_min_mm || 5.2;

  const margenVal = espMed - espMin;
  const crVal     = (espPrev && meses > 0) ? ((espPrev - espMed) / (meses / 12)) : null;
  const vidaVal   = (crVal && crVal > 0) ? (margenVal / crVal) : null;

  const estado = margenVal < state.thresholds.margenCritico
    ? 'Crítico'
    : (vidaVal !== null && vidaVal < state.thresholds.vidaAlerta)
      ? 'Regular'
      : 'Bueno';

  const estadoColor = { 'Bueno': 'var(--green)', 'Regular': 'var(--yellow)', 'Crítico': 'var(--red)' };

  document.getElementById('calc-panel').style.display = 'block';
  document.getElementById('calc-margen').textContent  = margenVal.toFixed(2) + ' mm';
  document.getElementById('calc-margen').style.color  = margenVal < 1 ? 'var(--red)' : 'var(--green)';
  document.getElementById('calc-cr').textContent      = crVal !== null ? crVal.toFixed(3) + ' mm/a' : '—';
  document.getElementById('calc-cr').style.color      = crVal > 0.5 ? 'var(--red)' : 'var(--text)';
  document.getElementById('calc-vida').textContent    = vidaVal !== null ? vidaVal.toFixed(1) + ' años' : '—';
  document.getElementById('calc-vida').style.color    = vidaVal !== null && vidaVal < 3 ? 'var(--red)' : 'var(--green)';
  document.getElementById('calc-estado').textContent  = estado;
  document.getElementById('calc-estado').style.color  = estadoColor[estado];

  // Sugerir estado en el selector
  const selEstado = document.getElementById('insp-estado');
  if (selEstado) selEstado.value = estado;
  const selAccion = document.getElementById('insp-accion');
  if (selAccion) {
    selAccion.value = estado === 'Crítico' ? 'Reemplazar'
                    : estado === 'Regular' ? 'Monitorear' : 'Ninguna';
  }
}

// ── GUARDAR INSPECCIÓN ─────────────────────────
async function guardarInspeccion() {
  const tuboId  = document.getElementById('insp-tubo-id')?.value;
  const espMed  = parseFloat(document.getElementById('insp-espesor')?.value);
  const espPrev = parseFloat(document.getElementById('insp-esp-prev')?.value);
  const meses   = parseFloat(document.getElementById('insp-meses')?.value);
  const estado  = document.getElementById('insp-estado')?.value;

  if (!tuboId || !espMed || !estado) {
    return showToast('Completa los campos obligatorios (*)', 'error');
  }

  const tubo   = state.tubos.find(t => t.id_tubo === tuboId);
  const espMin = tubo?.espesor_min_mm || 5.2;
  const margenV = espMed - espMin;
  const crV     = (espPrev && meses > 0) ? ((espPrev - espMed) / (meses / 12)) : null;
  const vidaV   = (crV && crV > 0) ? (margenV / crV) : null;

  const payload = {
    tubo_id:               tuboId,
    espesor_med_mm:        espMed,
    espesor_prev_mm:       espPrev || null,
    espesor_min_mm:        espMin,
    corrosion_visual:      document.getElementById('insp-corrosion')?.value,
    estado_general:        estado,
    metodo_medicion:       document.getElementById('insp-metodo')?.value,
    accion_requerida:      document.getElementById('insp-accion')?.value,
    observaciones:         document.getElementById('insp-notas')?.value,
    foto_anomalia_1:       document.getElementById('insp-foto')?.value || null,
    margen_corrosion_mm:   parseFloat(margenV.toFixed(3)),
    tasa_corrosion_mmpa:   crV ? parseFloat(crV.toFixed(4)) : null,
    vida_remanente_anios:  vidaV ? parseFloat(vidaV.toFixed(2)) : null,
    inspector:             state.currentUser?.email?.split('@')[0] || 'Inspector',
    fecha_inspeccion:      new Date().toISOString(),
  };

  try {
    if (isDemo()) {
      // En modo demo, agregar al estado local
      const newInsp = {
        ...payload,
        id: 'INS-' + Date.now(),
        id_tubo: tuboId,
        tubos: { id_tubo: tuboId, locaciones: { nombre: tubo?.locaciones?.nombre || '—' } }
      };
      state.inspecciones.unshift(newInsp);
    } else {
      const result = await Inspecciones.create(payload);
      state.inspecciones.unshift({ ...result[0], tubos: { id_tubo: tuboId } });
    }

    closeModal('modal-inspeccion');
    renderDashboard();
    renderTablaInspecciones();
    renderAlertas();
    if (state.mapInstance) renderMapPins();
    showToast(`Inspección de ${tuboId} guardada correctamente`);

    // Limpiar formulario
    ['insp-tubo-id','insp-espesor','insp-esp-prev','insp-meses','insp-notas','insp-foto'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = '';
    });
    document.getElementById('calc-panel').style.display = 'none';

  } catch (e) {
    showToast('Error al guardar: ' + e.message, 'error');
  }
}

// ── GUARDAR TUBO ───────────────────────────────
async function guardarTubo() {
  const idTubo = document.getElementById('tubo-id')?.value?.trim();
  const locId  = document.getElementById('tubo-locacion')?.value;

  if (!idTubo || !locId) {
    return showToast('ID Tubo y Locación son obligatorios', 'error');
  }

  const payload = {
    id_tubo:           idTubo,
    locacion_id:       parseInt(locId),
    codigo_linea:      document.getElementById('tubo-linea')?.value || null,
    grado_material:    document.getElementById('tubo-grado')?.value || null,
    diametro_nom_pulg: parseFloat(document.getElementById('tubo-diam')?.value) || null,
    espesor_nom_mm:    parseFloat(document.getElementById('tubo-esp-nom')?.value) || null,
    espesor_min_mm:    parseFloat(document.getElementById('tubo-esp-min')?.value) || null,
    clase_inspeccion:  document.getElementById('tubo-clase')?.value || null,
    latitud:           parseFloat(document.getElementById('tubo-lat')?.value) || null,
    longitud:          parseFloat(document.getElementById('tubo-lon')?.value) || null,
    fecha_instalacion: document.getElementById('tubo-fecha')?.value || null,
  };

  try {
    if (isDemo()) {
      const loc = state.locaciones.find(l => l.id == locId);
      state.tubos.push({ ...payload, locaciones: { nombre: loc?.nombre || '' } });
    } else {
      const result = await Tubos.create(payload);
      state.tubos.push(result[0]);
    }

    closeModal('modal-tubo');
    populateSelects();
    renderTablaTubos();
    renderDashboard();
    showToast(`Tubo ${idTubo} registrado correctamente`);

  } catch (e) {
    showToast('Error al guardar: ' + e.message, 'error');
  }
}

// ── RESUMEN SISTEMA ────────────────────────────
function renderResumen() {
  const el = document.getElementById('resumen-sistema');
  if (!el) return;
  const crit = state.inspecciones.filter(i => i.estado_general === 'Crítico').length;
  el.innerHTML = `
    Tubos registrados:    ${state.tubos.length}<br>
    Inspecciones totales: ${state.inspecciones.length}<br>
    Locaciones activas:   ${state.locaciones.length}<br>
    Tubos críticos:       ${crit}<br>
    Última actualización: ${new Date().toLocaleString('es')}
  `;
}

// ── EXPORTAR CSV ───────────────────────────────
function exportCSV(tabla) {
  const datos = { tubos: state.tubos, inspecciones: state.inspecciones, alertas: state.inspecciones.filter(i => i.estado_general === 'Crítico') };
  const data  = datos[tabla] || [];
  if (!data.length) return showToast('Sin datos para exportar', 'warn');

  const keys = Object.keys(data[0]).filter(k => typeof data[0][k] !== 'object');
  const csv  = [keys.join(','), ...data.map(row => keys.map(k => `"${row[k] ?? ''}"`).join(','))].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = `pipetrack_${tabla}_${Date.now()}.csv`; a.click();
  showToast(`${tabla}.csv descargado`);
}

// ── CONFIGURACIÓN ──────────────────────────────
function saveConfig() {
  const url = document.getElementById('cfg-url')?.value?.trim();
  const key = document.getElementById('cfg-key')?.value?.trim();
  if (!url || !key) return;
  localStorage.setItem('pt_url', url);
  localStorage.setItem('pt_key', key);
  SUPABASE_URL = url;
  SUPABASE_KEY = key;
  localStorage.removeItem('pt_demo');
  document.getElementById('config-status').textContent = '✓ Guardado. Recargando datos...';
  setTimeout(() => loadAllData(), 500);
}

function saveThresholds() {
  const m = parseFloat(document.getElementById('cfg-margen')?.value) || 1.0;
  const v = parseFloat(document.getElementById('cfg-vida')?.value)   || 3;
  const c = parseFloat(document.getElementById('cfg-cr')?.value)     || 0.5;
  localStorage.setItem('pt_margen', m);
  localStorage.setItem('pt_vida', v);
  localStorage.setItem('pt_cr', c);
  state.thresholds = { margenCritico: m, vidaAlerta: v, crMax: c };
  showToast('Umbrales actualizados');
}

// ── AUTH ───────────────────────────────────────
async function login() {
  const email = document.getElementById('login-email')?.value;
  const pass  = document.getElementById('login-pass')?.value;
  const errEl = document.getElementById('login-error');

  // DEMO mode
  if (email === 'demo@pipetrack.com' && pass === 'demo1234') {
    localStorage.setItem('pt_demo', 'true');
    localStorage.setItem('pt_token', 'demo');
    localStorage.setItem('pt_user', JSON.stringify({ email, user_metadata: { rol: 'Demo' } }));
    document.getElementById('login-overlay').style.display = 'none';
    initApp();
    return;
  }

  try {
    if (errEl) errEl.style.display = 'none';
    await Auth.login(email, pass);
    document.getElementById('login-overlay').style.display = 'none';
    initApp();
  } catch (e) {
    if (errEl) { errEl.textContent = e.message; errEl.style.display = 'block'; }
  }
}

function logout() {
  localStorage.removeItem('pt_demo');
  Auth.logout();
}

// ── NAVEGACIÓN ─────────────────────────────────
function showPage(name) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));

  const page = document.getElementById(`page-${name}`);
  if (page) page.classList.add('active');

  const nav = document.querySelector(`[data-page="${name}"]`);
  if (nav) nav.classList.add('active');

  const labels = {
    dashboard: 'Dashboard', mapa: 'Mapa de Tuberías', tubos: 'Inventario',
    inspecciones: 'Inspecciones', alertas: 'Alertas', reportes: 'Reportes', config: 'Configuración'
  };
  const bc = document.getElementById('breadcrumb');
  if (bc) bc.textContent = labels[name] || name;

  if (name === 'mapa') setTimeout(initMap, 100);
}

document.querySelectorAll('.nav-item').forEach(item => {
  item.addEventListener('click', (e) => {
    e.preventDefault();
    showPage(item.dataset.page);
  });
});

// ── SIDEBAR TOGGLE ─────────────────────────────
function toggleSidebar() {
  const sb = document.getElementById('sidebar');
  const mc = document.getElementById('main-content');
  sb.classList.toggle('hidden');
  mc.classList.toggle('full');
}

// ── MODALS ─────────────────────────────────────
function openModal(id) {
  const el = document.getElementById(id);
  if (el) el.classList.add('open');
}

function closeModal(id) {
  const el = document.getElementById(id);
  if (el) el.classList.remove('open');
}

function closeModalOutside(e) {
  if (e.target === e.currentTarget) closeModal(e.currentTarget.id);
}

// ── HELPERS ────────────────────────────────────
function estadoPill(estado) {
  const cls = { 'Bueno': 'pill-bueno', 'Regular': 'pill-regular', 'Crítico': 'pill-critico' };
  const dot = { 'Bueno': '●', 'Regular': '●', 'Crítico': '●' };
  return `<span class="status-pill ${cls[estado] || ''}">${dot[estado] || ''} ${estado || '—'}</span>`;
}

function margen(i) {
  const m = i.margen_corrosion_mm ?? (i.espesor_med_mm - i.espesor_min_mm);
  return isNaN(m) ? '—' : Number(m).toFixed(2);
}

function colorEspesor(med, min) {
  if (!med || !min) return 'var(--text)';
  const m = med - min;
  return m < 1 ? 'var(--red)' : m < 2 ? 'var(--yellow)' : 'var(--green)';
}

function formatDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('es', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function updateClock() {
  const el = document.getElementById('topbar-date');
  if (el) el.textContent = new Date().toLocaleString('es', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function showToast(msg, type = 'ok') {
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 3500);
}

function verDetalleTubo(idTubo) {
  const t = state.tubos.find(t => t.id_tubo === idTubo);
  if (!t) return;
  const inspTs = state.inspecciones.filter(i => (i.tubo_id || i.id_tubo) === idTubo);
  alert(`${idTubo}\n\nLocación: ${t.locaciones?.nombre}\nGrado: ${t.grado_material}\nØ: ${t.diametro_nom_pulg}"\nEsp. Nom: ${t.espesor_nom_mm} mm\nEsp. Mín: ${t.espesor_min_mm} mm\n\nInspecciones registradas: ${inspTs.length}`);
}
