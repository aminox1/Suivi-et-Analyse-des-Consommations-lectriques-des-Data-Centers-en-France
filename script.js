// ================= CONFIGURATION MAP =================
const mapConfig = {
    center: [46.2276, 2.2137],
    zoom: 6,
    minZoom: 5,
    maxBounds: [[41, -6], [52, 12]]
};

// ================= LAYERS & STATE =================
let departmentLayer;
let datacenterLayer;
let allDepartmentsData = []; 
let currentDepartments = []; 
let selectedDeptCode = null; 

// Dictionnaire NAF
const NAF_LABELS = {
    "61": "Télécoms",
    "62": "Prog/Conseil",
    "63": "Data Center"
};

// ================= INIT MAP =================
const map = L.map('map', {
    maxBounds: mapConfig.maxBounds,
    maxBoundsViscosity: 1.0,
    zoomControl: false
}).setView(mapConfig.center, mapConfig.zoom);

L.control.zoom({ position: 'bottomright' }).addTo(map);
L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', { 
    attribution: '© Enedis Open Data', maxZoom: 19 
}).addTo(map);

departmentLayer = L.layerGroup().addTo(map);
datacenterLayer = L.layerGroup();

const dcIcon = L.icon({
    iconUrl: 'https://cdn-icons-png.flaticon.com/512/2880/2880656.png',
    iconSize: [32, 32], iconAnchor: [16, 32], popupAnchor: [0, -32]
});

function getColoredMarker(mwh) {
    const gwh = mwh / 1000;
    let color = "#00C896"; // Vert
    if (gwh >= 10) color = "#d32f2f"; // Rouge
    else if (gwh >= 1) color = "#f57c00"; // Orange

    return L.divIcon({
        className: 'custom-pin',
        html: `<div style="background-color: ${color}; width: 100%; height: 100%; border-radius: 50%; border: 2px solid white; box-shadow: 0 2px 5px rgba(0,0,0,0.4);"></div>`,
        iconSize: [16, 16], iconAnchor: [8, 8]
    });
}

// ================= MASQUE FRANCE =================
async function loadFranceMask() {
    try {
        const res = await fetch('https://raw.githubusercontent.com/johan/world.geo.json/master/countries/FRA.geo.json');
        if (!res.ok) return;
        const data = await res.json();
        L.geoJSON(data.features ? data.features[0] : data, { style: { color: "#667eea", weight: 2, fillOpacity: 0 } }).addTo(map);
    } catch { console.warn("Masque France non chargé"); }
}

// ================= CHARGEMENT =================
async function loadDataFromJSON() {
    try {
        const response = await fetch('data.json');
        if (!response.ok) throw new Error("Fichier data.json introuvable.");
        const data = await response.json();
        return data.departements;
    } catch (error) {
        alert("Lancez 'python etl.py' d'abord pour générer data.json");
        throw error;
    }
}

function transformDepartments(departements) {
    return departements.map(dept => ({
        departement: dept.code, lat: dept.lat, lng: dept.lng, totalMwh: dept.total_mwh,
        dcs: dept.datacenters.map(dc => ({
            nom: dc.nom, adresse_api: dc.adresse_complete, lat: dc.lat, lng: dc.lng,
            departement: dc.departement, code_naf: dc.code_naf, historique: dc.historique
        }))
    }));
}

// ================= GESTION DES FILTRES =================
function applyFilters() {
    const nafFilter = document.getElementById('filter-naf').value;
    const consoFilter = document.getElementById('filter-conso').value;

    let filteredData = JSON.parse(JSON.stringify(allDepartmentsData));

    filteredData = filteredData.map(dep => {
        dep.dcs = dep.dcs.filter(dc => {
            if (nafFilter !== 'all' && String(dc.code_naf) !== String(nafFilter)) return false;
            const gwh = (dc.historique[0]?.mwh || 0) / 1000;
            if (consoFilter === 'high' && gwh < 10) return false;
            if (consoFilter === 'medium' && (gwh < 1 || gwh >= 10)) return false;
            if (consoFilter === 'low' && gwh >= 1) return false;
            return true;
        });
        dep.totalMwh = dep.dcs.reduce((sum, dc) => sum + (dc.historique[0]?.mwh || 0), 0);
        return dep;
    }).filter(dep => dep.dcs.length > 0); 

    currentDepartments = filteredData;
    updateGlobalStats(currentDepartments.flatMap(d => d.dcs));
    
    if (selectedDeptCode !== null) {
        const currentDep = currentDepartments.find(d => d.departement === selectedDeptCode);
        if (currentDep) zoomToDepartment(currentDep, false); 
        else goBackToFrance(); 
    } else {
        renderDepartmentMarkers(currentDepartments);
    }
    
    if(!document.getElementById('ranking-panel').classList.contains('hidden')){
        renderRanking(document.querySelector('.filter-btn.active').dataset.filter);
    }
}

document.getElementById('filter-naf').addEventListener('change', applyFilters);
document.getElementById('filter-conso').addEventListener('change', applyFilters);

// ================= UI STATISTIQUES (MODIFIÉ) =================
function updateGlobalStats(dcs) {
    document.getElementById('dc-count').innerText = dcs.length;
    
    // NOUVEAU : Répartition par code NAF
    document.getElementById('count-61').innerText = dcs.filter(d => d.code_naf === '61').length;
    document.getElementById('count-62').innerText = dcs.filter(d => d.code_naf === '62').length;
    document.getElementById('count-63').innerText = dcs.filter(d => d.code_naf === '63').length;

    const total = dcs.reduce((acc, d) => acc + (d.historique[0]?.mwh || 0), 0);
    document.getElementById('total-conso').innerText = (total / 1000).toFixed(1) + " GWh";
}

// ================= MARKERS & NAVIGATION =================
function renderDepartmentMarkers(departments) {
    departmentLayer.clearLayers();
    datacenterLayer.clearLayers();
    departments.forEach(dep => {
        const marker = L.marker([dep.lat, dep.lng], { icon: dcIcon });
        marker.bindTooltip(`<strong>Dpt ${dep.departement}</strong><br>${dep.dcs.length} sites<br>${(dep.totalMwh / 1000).toFixed(1)} GWh`, { direction: 'top' });
        marker.on('click', () => zoomToDepartment(dep, true));
        marker.addTo(departmentLayer);
    });
}

function goBackToFrance() {
    selectedDeptCode = null; 
    datacenterLayer.clearLayers();
    map.removeLayer(datacenterLayer);
    renderDepartmentMarkers(currentDepartments);
    map.setView(mapConfig.center, mapConfig.zoom);
    document.getElementById('back-btn').classList.add('hidden');
    document.getElementById('sidebar').classList.add('hidden');
}

document.getElementById('back-btn').addEventListener('click', goBackToFrance);

function zoomToDepartment(dep, animate = true) {
    selectedDeptCode = dep.departement; 
    departmentLayer.clearLayers();
    datacenterLayer.clearLayers();
    datacenterLayer.addTo(map);
    
    const bounds = [];
    dep.dcs.forEach(dc => {
        const mwh = dc.historique[0]?.mwh || 0;
        const marker = L.marker([dc.lat, dc.lng], { icon: getColoredMarker(mwh) });
        // Envoie l'info du département pour pouvoir y revenir
        marker.on('click', () => showSidebar(dc, dep));
        marker.addTo(datacenterLayer);
        bounds.push([dc.lat, dc.lng]);
    });
    
    if (bounds.length && animate) map.fitBounds(bounds, { padding: [40, 40], animate: true });
    
    showDepartmentSidebar(dep);
    document.getElementById('back-btn').classList.remove('hidden');
}

// ================= SIDEBARS DYNAMIQUES =================
function showDepartmentSidebar(dep) {
    const sidebar = document.getElementById('sidebar');
    sidebar.classList.remove('hidden');
    
    // On cache le bouton "Retour Liste" car on EST dans la liste
    document.getElementById('sidebar-back-btn').classList.add('hidden');

    document.getElementById('dc-name').innerText = `Département ${dep.departement}`;
    document.getElementById('dc-address').innerText = `${dep.dcs.length} sites trouvés`;
    document.getElementById('naf-badge').style.display = 'none';
    
    document.getElementById('conso-section').classList.remove('hidden');
    document.getElementById('dc-conso').innerText = (dep.totalMwh / 1000).toFixed(1) + " GWh";
    document.getElementById('conso-bar').style.width = "100%";

    const thead = document.querySelector('table thead');
    if(thead) {
        thead.innerHTML = `<tr><th>Site / Adresse</th><th style="text-align:right">Conso</th><th style="text-align:right">Secteur</th></tr>`;
    }

    const tbody = document.getElementById('history-body');
    tbody.innerHTML = '';
    
    dep.dcs.forEach(dc => {
        const nafLabel = NAF_LABELS[dc.code_naf] || dc.code_naf;
        const gwh = ((dc.historique[0]?.mwh || 0) / 1000).toFixed(2);
        
        let color = '#666';
        if(dc.code_naf === '61') color = '#1565c0'; 
        else if(dc.code_naf === '62') color = '#8e24aa'; 
        else if(dc.code_naf === '63') color = '#c2185b'; 

        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td style="cursor:pointer; color:#0055FF; font-weight:600; border-left: 4px solid ${color}; padding-left: 8px;">${dc.nom}</td>
            <td style="text-align:right">${gwh} GWh</td>
            <td style="text-align:right; font-size:0.8em; color:#888;">${nafLabel}</td>
        `;
        // Envoie l'info du département pour pouvoir y revenir
        tr.onclick = () => showSidebar(dc, dep);
        tbody.appendChild(tr);
    });
}

function showSidebar(dc, parentDep = null) {
    const sidebar = document.getElementById('sidebar');
    sidebar.classList.remove('hidden');
    
    // NOUVEAU : Afficher le bouton Retour Liste si on vient d'un département
    const backListBtn = document.getElementById('sidebar-back-btn');
    if (parentDep) {
        backListBtn.classList.remove('hidden');
        backListBtn.onclick = () => showDepartmentSidebar(parentDep);
    } else {
        backListBtn.classList.add('hidden');
    }

    document.getElementById('dc-name').innerText = dc.nom;
    document.getElementById('dc-address').innerText = dc.adresse_api || "";
    
    const nafLabel = NAF_LABELS[dc.code_naf] || "Inconnu";
    const badge = document.getElementById('naf-badge');
    if(badge) {
        badge.style.display = 'inline-block';
        badge.innerText = `NAF ${dc.code_naf} (${nafLabel})`;
        if(dc.code_naf === '61') { badge.style.backgroundColor = '#E3F2FD'; badge.style.color = '#1565C0'; }
        else if(dc.code_naf === '62') { badge.style.backgroundColor = '#F3E5F5'; badge.style.color = '#8E24AA'; }
        else { badge.style.backgroundColor = '#FCE4EC'; badge.style.color = '#C2185B'; }
    }

    document.getElementById('conso-section').classList.remove('hidden');

    const thead = document.querySelector('table thead');
    if(thead) {
        thead.innerHTML = `<tr><th>Année</th><th style="text-align:right">Conso (MWh)</th><th style="text-align:right">Évolution</th></tr>`;
    }

    const tbody = document.getElementById('history-body');
    tbody.innerHTML = '';
    
    if (!dc.historique || dc.historique.length === 0) {
        document.getElementById('dc-conso').innerText = "N/A";
        document.getElementById('conso-bar').style.width = "0%";
        tbody.innerHTML = `<tr><td colspan="3" style="text-align:center;">Aucune donnée</td></tr>`;
        return;
    }
    
    const last = dc.historique[0];
    document.getElementById('dc-conso').innerText = (last.mwh / 1000).toFixed(1) + " GWh";
    document.getElementById('conso-bar').style.width = Math.min((last.mwh / 150000) * 100, 100) + "%";
    
    dc.historique.forEach((rec, i) => {
        let trend = '-';
        if (i < dc.historique.length - 1) {
            const prev = dc.historique[i + 1].mwh;
            const diff = rec.mwh - prev;
            const pct = ((diff / prev) * 100).toFixed(1);
            trend = diff > 0 ? `<span style='color:#E63946; font-weight:bold;'>+${pct}% ↗</span>` : `<span style='color:#00C896; font-weight:bold;'>${pct}% ↘</span>`;
        }
        const tr = document.createElement('tr');
        tr.innerHTML = `<td><strong>${rec.annee}</strong></td><td style="text-align:right">${rec.mwh.toLocaleString('fr-FR')}</td><td style="text-align:right">${trend}</td>`;
        tbody.appendChild(tr);
    });
}

document.getElementById('close-sidebar').addEventListener('click', () => document.getElementById('sidebar').classList.add('hidden'));

// ================= RANKING PANEL =================
function showRankingPanel() {
    document.getElementById('ranking-panel').classList.remove('hidden');
    renderRanking(document.querySelector('.filter-btn.active').dataset.filter);
}

function renderRanking(sortBy = 'conso') {
    const list = document.getElementById('ranking-list');
    list.innerHTML = '';
    
    if (currentDepartments.length === 0) {
        list.innerHTML = "<div style='text-align:center; padding:20px; color:#888;'>Aucun département pour ce filtre.</div>";
        return;
    }

    const sorted = [...currentDepartments].sort((a, b) => {
        return sortBy === 'conso' ? b.totalMwh - a.totalMwh : b.dcs.length - a.dcs.length;
    });
    
    const maxVal = sortBy === 'conso' ? sorted[0].totalMwh : sorted[0].dcs.length;

    sorted.forEach((dep, index) => {
        const item = document.createElement('div');
        const val = sortBy === 'conso' ? dep.totalMwh : dep.dcs.length;
        const pct = (val / maxVal) * 100;
        
        item.className = 'ranking-item';
        item.innerHTML = `
            <div class="rank-number">#${index + 1}</div>
            <div class="rank-info">
                <div class="dept-name">Département ${dep.departement}</div>
                <div class="dept-stats">${dep.dcs.length} Sites • ${(dep.totalMwh / 1000).toFixed(1)} GWh</div>
                <div class="rank-bar"><div class="rank-bar-fill" style="width: ${pct}%"></div></div>
            </div>
        `;
        item.onclick = () => {
            document.getElementById('ranking-panel').classList.add('hidden');
            zoomToDepartment(dep, true);
        };
        list.appendChild(item);
    });
}

// ================= INIT =================
document.getElementById('ranking-btn').addEventListener('click', showRankingPanel);
document.getElementById('close-ranking').addEventListener('click', () => document.getElementById('ranking-panel').classList.add('hidden'));

document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
        document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
        e.target.classList.add('active');
        renderRanking(e.target.dataset.filter);
    });
});

async function initDashboard() {
    loadFranceMask();
    document.getElementById('dc-count').innerText = "...";
    try {
        const departements = await loadDataFromJSON();
        allDepartmentsData = transformDepartments(departements);
        currentDepartments = [...allDepartmentsData];
        
        renderDepartmentMarkers(currentDepartments);
        updateGlobalStats(currentDepartments.flatMap(d => d.dcs));
    } catch (e) {
        document.getElementById('dc-count').innerText = "Err";
    }
}

initDashboard();