// ================= CONFIGURATION MAP =================
const mapConfig = {
    center: [46.2276, 2.2137],
    zoom: 6,
    minZoom: 5,
    maxBounds: [[41, -6], [52, 12]]
};

// ================= LAYERS =================
let departmentLayer;
let datacenterLayer;
let currentDepartments = [];

// Mapping NAF codes to labels
const NAF_LABELS = {
    "61": "Télécommunications",
    "63": "Data Center"
};

// ================= INIT MAP =================
const map = L.map('map', {
    maxBounds: mapConfig.maxBounds,
    maxBoundsViscosity: 1.0,
    zoomControl: false
}).setView(mapConfig.center, mapConfig.zoom);

L.control.zoom({ position: 'bottomright' }).addTo(map);

L.tileLayer(
    'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
    { attribution: '© Enedis Open Data (Data Fair)', maxZoom: 19 }
).addTo(map);

departmentLayer = L.layerGroup().addTo(map);
datacenterLayer = L.layerGroup();

// ================= ICON =================
const dcIcon = L.icon({
    iconUrl: 'https://cdn-icons-png.flaticon.com/512/2880/2880656.png',
    iconSize: [32, 32],
    iconAnchor: [16, 32],
    popupAnchor: [0, -32]
});

// ================= MASQUE FRANCE =================
async function loadFranceMask() {
    try {
        const res = await fetch(
            'https://raw.githubusercontent.com/johan/world.geo.json/master/countries/FRA.geo.json'
        );
        if (!res.ok) return;
        const data = await res.json();
        const geometry = data.features ? data.features[0] : data;
        L.geoJSON(geometry, {
            style: { color: "#0055FF", weight: 2, fillOpacity: 0 }
        }).addTo(map);
    } catch {
        console.warn("Masque France non chargé");
    }
}

// ================= CHARGEMENT DES DONNÉES =================
async function loadDataFromJSON() {
    try {
        const response = await fetch('data.json');
        if (!response.ok) throw new Error("Erreur lors du chargement de data.json");
        
        const data = await response.json();
        return data.departements;
        
    } catch (error) {
        console.error("Erreur:", error);
        throw new Error("Fichier data.json introuvable. Veuillez exécuter 'python etl.py' d'abord.");
    }
}

// ================= TRANSFORMATION DES DONNÉES =================
function transformDepartments(departements) {
    return departements.map(dept => ({
        departement: dept.code,
        lat: dept.lat,
        lng: dept.lng,
        totalMwh: dept.total_mwh,
        dcs: dept.datacenters.map(dc => ({
            nom: dc.nom,
            adresse_api: dc.adresse_complete,
            lat: dc.lat,
            lng: dc.lng,
            departement: dc.departement,
            code_naf: dc.code_naf,
            historique: dc.historique,
            source: "Enedis Open Data"
        }))
    }));
}

// ================= UI =================
function updateLoadingState(msg) {
    const el = document.getElementById('dc-count');
    el.innerText = msg || "";
}

function updateGlobalStats(data) {
    document.getElementById('dc-count').innerText = data.length;
    const total = data.reduce((acc, d) => {
        return acc + (d.historique[0]?.mwh || 0);
    }, 0);
    document.getElementById('total-conso').innerText =
        (total / 1000).toFixed(1) + " GWh";
}

// ================= MARKERS =================
function renderDepartmentMarkers(departments) {
    departmentLayer.clearLayers();
    datacenterLayer.clearLayers();
    departments.forEach(dep => {
        const marker = L.marker([dep.lat, dep.lng], { icon: dcIcon });
        marker.bindTooltip(
            `<strong>Département ${dep.departement}</strong><br>
             ${dep.dcs.length} data centers<br>
             ${(dep.totalMwh / 1000).toFixed(1)} GWh`,
            { direction: 'top' }
        );
        marker.on('click', () => {
            zoomToDepartment(dep);
        });
        marker.addTo(departmentLayer);
    });
}

// ================= SIDEBAR =================
function showSidebar(dc) {
    const sidebar = document.getElementById('sidebar');
    sidebar.classList.remove('hidden');
    document.getElementById('dc-name').innerText = dc.nom;
    document.getElementById('dc-address').innerText = dc.adresse_api;
    document.getElementById('dc-operator').innerText = dc.source;
    
    // Afficher le badge NAF avec le secteur
    const nafLabel = NAF_LABELS[dc.code_naf] || dc.code_naf;
    document.getElementById('naf-badge').innerText = `NAF ${dc.code_naf} - ${nafLabel}`;
    
    const tbody = document.getElementById('history-body');
    tbody.innerHTML = '';
    
    if (dc.historique.length === 0) {
        document.getElementById('dc-conso').innerText = "N/A";
        document.getElementById('conso-bar').style.width = "0%";
        tbody.innerHTML = `<tr><td colspan="3" style="text-align:center;color:#999">Aucune donnée disponible</td></tr>`;
        return;
    }
    
    const last = dc.historique[0];
    document.getElementById('dc-conso').innerText =
        (last.mwh / 1000).toFixed(1) + " GWh";
    document.getElementById('conso-bar').style.width =
        Math.min((last.mwh / 150000) * 100, 100) + "%";
    
    dc.historique.forEach((rec, i) => {
        let trend = '-';
        if (i < dc.historique.length - 1) {
            const prev = dc.historique[i + 1].mwh;
            const diff = rec.mwh - prev;
            const pct = ((diff / prev) * 100).toFixed(1);
            trend = diff > 0 ? `+${pct}% ↗` : diff < 0 ? `${pct}% ↘` : '-';
        }
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td><strong>${rec.annee}</strong></td>
            <td>${rec.mwh.toLocaleString('fr-FR')}</td>
            <td>${trend}</td>
        `;
        tbody.appendChild(tr);
    });
}

document.getElementById('close-sidebar')
    .addEventListener('click', () =>
        document.getElementById('sidebar').classList.add('hidden')
    );

// ================= INIT =================
async function initDashboard() {
    loadFranceMask();
    updateLoadingState("Chargement des données...");
    try {
        const departements = await loadDataFromJSON();
        currentDepartments = transformDepartments(departements);
        renderDepartmentMarkers(currentDepartments);
        
        const allDCs = currentDepartments.flatMap(d => d.dcs);
        updateGlobalStats(allDCs);
        
    } catch (e) {
        console.error(e);
        updateLoadingState("Erreur");
        alert(e.message);
    }
}

// ================= DEPARTMENT SIDEBAR - CORRECTION ICI =================
function showDepartmentSidebar(dep) {
    const sidebar = document.getElementById('sidebar');
    sidebar.classList.remove('hidden');
    
    document.getElementById('dc-name').innerText = `Département ${dep.departement}`;
    document.getElementById('dc-address').innerText = `${dep.dcs.length} data centers`;
    document.getElementById('dc-operator').innerText = `${(dep.totalMwh / 1000).toFixed(1)} GWh`;
    document.getElementById('naf-badge').innerText = "NAF 61 & 63";
    
    const tbody = document.getElementById('history-body');
    tbody.innerHTML = '';
    
    // CORRECTION: Afficher la liste des DCs avec le bon format de colonnes
    dep.dcs.forEach(dc => {
        const nafLabel = NAF_LABELS[dc.code_naf] || dc.code_naf;
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td colspan="3" style="cursor:pointer">
                <strong>${dc.nom}</strong><br>
                <span style="font-size:0.85rem;color:#888">
                    ${(dc.historique[0]?.mwh || 0).toLocaleString('fr-FR')} MWh • ${nafLabel}
                </span>
            </td>
        `;
        tr.onclick = () => showSidebar(dc);
        tbody.appendChild(tr);
    });
}

function showBackButton() {
    const btn = document.getElementById('back-btn');
    btn.classList.remove('hidden');
    btn.onclick = () => {
        datacenterLayer.clearLayers();
        map.removeLayer(datacenterLayer);
        renderDepartmentMarkers(currentDepartments);
        map.setView(mapConfig.center, mapConfig.zoom);
        btn.classList.add('hidden');
        document.getElementById('sidebar').classList.add('hidden');
    };
}

function zoomToDepartment(dep) {
    departmentLayer.clearLayers();
    datacenterLayer.clearLayers();
    datacenterLayer.addTo(map);
    const bounds = [];
    dep.dcs.forEach(dc => {
        const marker = L.marker([dc.lat, dc.lng], { icon: dcIcon });
        marker.on('click', () => showSidebar(dc));
        marker.addTo(datacenterLayer);
        bounds.push([dc.lat, dc.lng]);
    });
    if (bounds.length) {
        map.fitBounds(bounds, {
            padding: [40, 40],
            animate: true
        });
    }
    showDepartmentSidebar(dep);
    showBackButton();
}

// ================= RANKING PANEL =================
function showRankingPanel() {
    const panel = document.getElementById('ranking-panel');
    panel.classList.remove('hidden');
    renderRanking('conso');
}

function renderRanking(sortBy = 'conso') {
    const list = document.getElementById('ranking-list');
    list.innerHTML = '';
    
    const sorted = [...currentDepartments].sort((a, b) => {
        if (sortBy === 'conso') {
            return b.totalMwh - a.totalMwh;
        } else {
            return b.dcs.length - a.dcs.length;
        }
    });
    
    sorted.forEach((dep, index) => {
        const item = document.createElement('div');
        item.className = 'ranking-item';
        item.innerHTML = `
            <div class="rank-number">#${index + 1}</div>
            <div class="rank-info">
                <div class="dept-name">Département ${dep.departement}</div>
                <div class="dept-stats">
                    ${dep.dcs.length} DC • ${(dep.totalMwh / 1000).toFixed(1)} GWh
                </div>
                <div class="rank-bar">
                    <div class="rank-bar-fill" style="width: ${(dep.totalMwh / sorted[0].totalMwh * 100).toFixed(1)}%"></div>
                </div>
            </div>
        `;
        
        item.onclick = () => {
            document.getElementById('ranking-panel').classList.add('hidden');
            zoomToDepartment(dep);
        };
        
        list.appendChild(item);
    });
}

document.getElementById('ranking-btn').addEventListener('click', showRankingPanel);
document.getElementById('close-ranking').addEventListener('click', () => {
    document.getElementById('ranking-panel').classList.add('hidden');
});

document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
        document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
        e.target.classList.add('active');
        renderRanking(e.target.dataset.filter);
    });
});

initDashboard();