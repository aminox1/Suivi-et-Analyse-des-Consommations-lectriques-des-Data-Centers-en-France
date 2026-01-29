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



// ================= INIT MAP =================
const map = L.map('map', {
    maxBounds: mapConfig.maxBounds,
    maxBoundsViscosity: 1.0,
    zoomControl: false
}).setView(mapConfig.center, mapConfig.zoom);

L.control.zoom({ position: 'bottomright' }).addTo(map);

L.tileLayer(
    'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
    { attribution: '&copy; Enedis Open Data (Data Fair)', maxZoom: 19 }
).addTo(map);

// ✅ INITIALISATION DES LAYERS ICI
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

// ================= API ENEDIS =================
async function fetchEnedisOpenData() {
    const baseUrl =
        "https://opendata.enedis.fr/data-fair/api/v1/datasets/consommation-annuelle-entreprise-par-adresse/lines";

    const params = new URLSearchParams({
        format: "json",
        size: "10000",
        code_secteur_naf2_eq: "63",
        consommation_annuelle_totale_de_ladresse_mwh_gte: "9000"
    });

    const url = `${baseUrl}?${params.toString()}`;
    const proxy = `https://corsproxy.io/?${encodeURIComponent(url)}`;


    const response = await fetch(proxy);
    if (!response.ok) throw new Error("Erreur API Enedis");

    const data = await response.json();
    const records = Array.isArray(data) ? data : (data.results || []);

    return await processApiResults(records);

}

// ================= TRAITEMENT DONNÉES =================
async function processApiResults(records) {
    const points = {};

    for (const rec of records) {
        if (!rec.adresse) continue;

        const fullAddress =
            `${rec.adresse} ${rec.code_postal || ""} ${rec.commune || ""}`;

        if (!points[fullAddress]) {
            const coords = await geocodeAddress(fullAddress);
            if (!coords) continue;

            points[fullAddress] = {
                nom: rec.adresse,
                adresse_api: fullAddress,
                lat: coords.lat,
                lng: coords.lng,
                departement: coords.dept,
                historique: [],
                source: "Enedis Officiel"
            };
        }

        const conso =
            rec.consommation_annuelle_totale_de_ladresse_mwh || 0;

        points[fullAddress].historique.push({
            annee: parseInt(rec.annee),
            mwh: conso
        });
    }

    Object.values(points).forEach(p =>
        p.historique.sort((a, b) => b.annee - a.annee)
    );

    return Object.values(points);
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

    const tbody = document.getElementById('history-body');
    tbody.innerHTML = '';

    if (dc.historique.length === 0) {
        document.getElementById('dc-conso').innerText = "N/A";
        document.getElementById('conso-bar').style.width = "0%";
        tbody.innerHTML =
            `<tr><td colspan="3" style="text-align:center;color:#999">
                Aucune donnée disponible
            </td></tr>`;
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
    updateLoadingState("Chargement des données Enedis...");

    try {
        const data = await fetchEnedisOpenData();
        currentDepartments = groupByDepartment(data);

        renderDepartmentMarkers(currentDepartments);
        updateGlobalStats(data);
    } catch (e) {
        console.error(e);
        updateLoadingState("Erreur de chargement");
    }
}



async function geocodeAddress(address) {
    const url = `https://api-adresse.data.gouv.fr/search/?q=${encodeURIComponent(address)}&limit=1`;
    const res = await fetch(url);
    const data = await res.json();

    if (data.features && data.features.length > 0) {
        const f = data.features[0];
        const [lng, lat] = f.geometry.coordinates;
        const dept = f.properties.context.split(',')[0]; // ex: "93"

        return { lat, lng, dept };
    }
    return null;
}

function groupByDepartment(data) {
    const depts = {};

    data.forEach(dc => {
        if (!depts[dc.departement]) {
            depts[dc.departement] = {
                departement: dc.departement,
                lat: dc.lat,
                lng: dc.lng,
                dcs: [],
                totalMwh: 0
            };
        }

        depts[dc.departement].dcs.push(dc);
        depts[dc.departement].totalMwh += dc.historique[0]?.mwh || 0;
    });

    return Object.values(depts);
}

function showDepartmentSidebar(dep) {
    const sidebar = document.getElementById('sidebar');
    sidebar.classList.remove('hidden');

    document.getElementById('dc-name').innerText =
        `Département ${dep.departement}`;

    document.getElementById('dc-address').innerText =
        `${dep.dcs.length} data centers`;

    document.getElementById('dc-operator').innerText =
        (dep.totalMwh / 1000).toFixed(1) + " GWh";

    const tbody = document.getElementById('history-body');
    tbody.innerHTML = '';

    dep.dcs.forEach(dc => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td colspan="3" style="cursor:pointer">
                <strong>${dc.nom}</strong><br>
                <span style="font-size:0.75rem;color:#888">
                    ${(dc.historique[0]?.mwh || 0) / 1000} GWh
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
            <div class="rank">#${index + 1}</div>
            <div class="dept-info">
                <div class="dept-name">Département ${dep.departement}</div>
                <div class="dept-stats">
                    ${dep.dcs.length} DC • ${(dep.totalMwh / 1000).toFixed(1)} GWh
                </div>
            </div>
            <div class="dept-bar-container">
                <div class="dept-bar" style="width: ${(dep.totalMwh / sorted[0].totalMwh * 100).toFixed(1)}%"></div>
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
