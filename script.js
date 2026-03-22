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
/** Données précomputées par l'ETL pour recalculer le matching (rayon) dans le navigateur */
let matchContext = null;

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
async function loadDataFromJSON(cacheBust = false) {
    const url = cacheBust ? `data.json?t=${Date.now()}` : 'data.json';
    try {
        const response = await fetch(url);
        if (!response.ok) throw new Error("Erreur lors du chargement de data.json");

        const data = await response.json();
        return data.departements;
    } catch (error) {
        console.error("Erreur:", error);
        throw new Error("Fichier data.json introuvable. Veuillez exécuter 'python etl.py' d'abord.");
    }
}

async function loadMatchContext(cacheBust = false) {
    const url = cacheBust ? `match_context.json?t=${Date.now()}` : "match_context.json";
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error("match_context.json introuvable");
    }
    return response.json();
}

/** Même formule haversine que dans etl.py (distance_m) */
function distanceMeters(lat1, lon1, lat2, lon2) {
    const R = 6371000;
    const toRad = Math.PI / 180;
    const phi1 = lat1 * toRad;
    const phi2 = lat2 * toRad;
    const dphi = (lat2 - lat1) * toRad;
    const dlambda = (lon2 - lon1) * toRad;
    const a =
        Math.sin(dphi / 2) ** 2 +
        Math.cos(phi1) * Math.cos(phi2) * Math.sin(dlambda / 2) ** 2;
    return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Reproduit les étapes 4–5 de transform_data (etl.py) pour un rayon donné.
 * @returns {Array} liste départements au même format que dans data.json
 */
function buildDepartementsFromMatchContext(ctx, rayonM) {
    const carte = ctx.carte_coords || [];
    const datacenters = [];

    for (const data of ctx.addresses || []) {
        const lat = parseFloat(data.lat);
        const lng = parseFloat(data.lng);
        if (Number.isNaN(lat) || Number.isNaN(lng)) continue;

        let matchFound = false;
        for (const p of carte) {
            if (distanceMeters(lat, lng, p.lat, p.lng) <= rayonM) {
                matchFound = true;
                break;
            }
        }
        if (!matchFound) continue;

        const historique = [...(data.historique || [])].sort((a, b) => b.annee - a.annee);
        const deptFinal = data.code_departement || "00";

        datacenters.push({
            nom: data.adresse,
            adresse_complete: `${data.adresse}, ${data.code_postal} ${data.commune}`,
            lat: Math.round(lat * 1e6) / 1e6,
            lng: Math.round(lng * 1e6) / 1e6,
            departement: deptFinal,
            code_naf: data.code_naf,
            historique,
            match_carte: true
        });
    }

    const departementsMap = {};
    for (const dc of datacenters) {
        const dept = dc.departement;
        if (!departementsMap[dept]) {
            departementsMap[dept] = {
                code: dept,
                datacenters: [],
                total_mwh: 0,
                count: 0
            };
        }
        departementsMap[dept].datacenters.push(dc);
        departementsMap[dept].count += 1;
        if (dc.historique.length) {
            departementsMap[dept].total_mwh += dc.historique[0].mwh;
        }
    }

    const departements = Object.values(departementsMap).map((deptData) => {
        const dcs = deptData.datacenters;
        const avgLat = dcs.reduce((s, d) => s + d.lat, 0) / dcs.length;
        const avgLng = dcs.reduce((s, d) => s + d.lng, 0) / dcs.length;
        return {
            code: deptData.code,
            lat: avgLat,
            lng: avgLng,
            total_mwh: deptData.total_mwh,
            count: deptData.count,
            datacenters: dcs
        };
    });

    departements.sort((a, b) => b.total_mwh - a.total_mwh);
    return departements;
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
function applyDepartementsData(departements) {
    currentDepartments = transformDepartments(departements);
    document.getElementById('back-btn').classList.add('hidden');
    datacenterLayer.clearLayers();
    map.removeLayer(datacenterLayer);
    renderDepartmentMarkers(currentDepartments);
    const allDCs = currentDepartments.flatMap(d => d.dcs);
    updateGlobalStats(allDCs);
    map.setView(mapConfig.center, mapConfig.zoom);
    document.getElementById('sidebar').classList.add('hidden');
    document.getElementById('ranking-panel').classList.add('hidden');
}

async function initDashboard() {
    loadFranceMask();
    updateLoadingState("Chargement des données...");
    try {
        const departements = await loadDataFromJSON(false);
        try {
            matchContext = await loadMatchContext(false);
            const defR = matchContext?.filters?.default_rayon_match_m;
            if (defR != null) {
                document.getElementById("rayon-input").value = String(defR);
            }
        } catch (e) {
            console.warn(e);
            matchContext = null;
        }
        applyDepartementsData(departements);
    } catch (e) {
        console.error(e);
        updateLoadingState("Erreur");
        alert(e.message);
    }
}

function applyRayonFromTextbox() {
    const v = parseInt(document.getElementById("rayon-input").value, 10);
    if (Number.isNaN(v) || v <= 0) {
        alert("Entrez un rayon valide en mètres (entier > 0).");
        return;
    }
    if (!matchContext) {
        alert(
            "Fichier match_context.json introuvable. Exécutez une fois : python etl.py\n" +
                "(l'ETL génère data.json et match_context.json.)"
        );
        return;
    }
    updateLoadingState("Recalcul…");
    requestAnimationFrame(() => {
        try {
            const departements = buildDepartementsFromMatchContext(matchContext, v);
            applyDepartementsData(departements);
        } catch (err) {
            console.error(err);
            updateLoadingState("Erreur");
            alert("Erreur lors du recalcul du rayon.");
        }
    });
}

document.getElementById("validate-rayon").addEventListener("click", applyRayonFromTextbox);

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