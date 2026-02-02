// Data Cache
let boroughData = {};

// Configuration
const MAP_CENTER = [51.505, -0.09];
const MAP_ZOOM_DEFAULT = 10;
const MAP_ZOOM_SELECTED = 14;

// State
let currentYear = 2026;
let currentType = 'all'; // 'all', 'detached', 'semi', 'terraced', 'flat'
let currentSize = 'all'; // 'all', 'Q1'...'Q5'
let maxPrice = 3000000;
let currentMode = 'price'; // 'price', 'crime', 'central', 'culture'
let geoJsonLayer;
let map;

// DOM Elements
const priceDisplay = document.getElementById('price-display');
const priceRange = document.getElementById('price-range');
const yearSelect = document.getElementById('year-select');
const typeSelect = document.getElementById('type-select');
const sizeSelect = document.getElementById('size-select');
const postcodeInput = document.getElementById('postcode-input');
const postcodeSearchBtn = document.getElementById('postcode-search-btn');
const postcodeStatus = document.getElementById('postcode-status');
const detailsPanel = document.getElementById('borough-details');
const legendContent = document.getElementById('legend-content');
const modeButtons = document.querySelectorAll('.mode-btn');

// Initialization
document.addEventListener('DOMContentLoaded', async () => {
    initMap();
    initControls();
    await loadData();
});

function initMap() {
    map = L.map('map', {
        zoomControl: false,
        attributionControl: false
    }).setView(MAP_CENTER, MAP_ZOOM_DEFAULT);

    L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
        maxZoom: 19
    }).addTo(map);

    L.control.zoom({ position: 'bottomright' }).addTo(map);

    window.addEventListener('resize', () => {
        requestAnimationFrame(() => map.invalidateSize());
    });

}

function initControls() {
    // Populate Years
    const years = [2015, 2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025, 2026];
    years.forEach(year => {
        const option = document.createElement('option');
        option.value = year;
        option.text = year;
        if (year === currentYear) option.selected = true;
        yearSelect.appendChild(option);
    });

    // Event Listeners
    priceRange.addEventListener('input', (e) => {
        maxPrice = parseInt(e.target.value);
        priceDisplay.textContent = `£${maxPrice.toLocaleString()}+`;
        updateMapVisuals();
    });

    yearSelect.addEventListener('change', (e) => {
        currentYear = parseInt(e.target.value);
        updateMapVisuals();
    });

    typeSelect.addEventListener('change', (e) => {
        currentType = e.target.value;
        updateMapVisuals();
    });

    sizeSelect.addEventListener('change', (e) => {
        currentSize = e.target.value;
        updateMapVisuals();
    });

    const runPostcodeSearch = () => {
        if (!postcodeInput) return;
        const raw = postcodeInput.value || '';
        const query = raw.trim().toUpperCase();
        if (!query) {
            if (postcodeStatus) postcodeStatus.textContent = 'Enter a postcode.';
            return;
        }
        if (!postcodeLayer) {
            if (postcodeStatus) postcodeStatus.textContent = 'Postcodes not loaded yet.';
            return;
        }

        let matchedLayer = null;
        postcodeLayer.eachLayer(layer => {
            if (!layer?.feature?.properties?.name) return;
            const name = String(layer.feature.properties.name).toUpperCase();
            if (name === query) matchedLayer = layer;
        });

        if (!matchedLayer) {
            if (postcodeStatus) postcodeStatus.textContent = 'Postcode not found.';
            return;
        }

        if (postcodeStatus) postcodeStatus.textContent = '';
        map.fitBounds(matchedLayer.getBounds(), { padding: [20, 20] });
        handleZoomChange();
        updateSidebar(matchedLayer.feature.properties);
    };

    if (postcodeSearchBtn) {
        postcodeSearchBtn.addEventListener('click', runPostcodeSearch);
    }
    if (postcodeInput) {
        postcodeInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') runPostcodeSearch();
        });
    }

    modeButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            modeButtons.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentMode = btn.dataset.mode;
            updateMapVisuals();
            updateLegend();
        });
    });
}

// Layer Storage
let boroughLayer;
let postcodeLayer;
let currentZoom = MAP_ZOOM_DEFAULT;
let boroughOpacityMultiplier = 1;
let postcodeOpacityMultiplier = 0;
let lastSelected = null;
let boroughNameMap = {};

// Data Cache
let propertyData = { postcodes: {}, boroughs: {} };
let metricsData = { postcodes: {}, boroughs: {} };
const metricCache = { thresholds: new Map(), ranges: new Map() };

const MISSING_DATA_COLOR = '#9ca3af';

async function loadData() {
    try {
        const [boroughRes, postcodeRes, realDataRes, boroughDataRes, metricsRes] = await Promise.all([
            fetch('london_boroughs.geojson'),
            fetch('london_postcodes.geojson'),
            fetch('london_postcode_prices.json').then(res => res.ok ? res.json() : null).catch(() => null),
            fetch('london_borough_prices.json').then(res => res.ok ? res.json() : null).catch(() => null),
            fetch('london_metrics.json').then(res => res.ok ? res.json() : null).catch(() => null)
        ]);

        const boroughDataJson = await boroughRes.json();
        const postcodeDataJson = await postcodeRes.json();

        if (realDataRes) {
            propertyData.postcodes = realDataRes.postcodes || {};
            console.log("Loaded real data for", Object.keys(propertyData.postcodes || {}).length, "postcodes");
        }
        if (boroughDataRes) {
            propertyData.boroughs = boroughDataRes.boroughs || {};
        }
        if (metricsRes) {
            metricsData = {
                postcodes: metricsRes.postcodes || {},
                boroughs: metricsRes.boroughs || {}
            };
        }

        // Generate data for Boroughs
        boroughDataJson.features.forEach(feature => {
            const name = feature.properties.name;
            const key = normalizeKey(name);
            if (key && !boroughNameMap[key]) {
                boroughNameMap[key] = name;
            }
            if (key && !boroughData[key]) {
                boroughData[key] = getCombinedData(key, true);
            }
        });

        // Generate data for Postcodes
        postcodeDataJson.features.forEach(feature => {
            const name = feature.properties.name;
            const key = normalizeKey(name);
            if (key && !boroughData[key]) {
                boroughData[key] = getCombinedData(key, false);
            }
        });

        // Create Borough Layer (Default Visible)
        boroughLayer = L.geoJSON(boroughDataJson, {
            style: styleBorough,
            onEachFeature: onEachBorough
        }).addTo(map);

        // Add Borough Labels
        boroughDataJson.features.forEach(feature => {
            if (feature.properties && feature.properties.name) {
                const layer = L.geoJSON(feature);
                const center = layer.getBounds().getCenter();
                L.marker(center, {
                    icon: L.divIcon({
                        className: 'borough-label',
                        html: feature.properties.name,
                        iconSize: [80, 20],
                        iconAnchor: [40, 10]
                    }),
                    interactive: false
                }).addTo(boroughLayer);
            }
        });

        // Create Postcode Layer (Hidden initially)
        postcodeLayer = L.geoJSON(postcodeDataJson, {
            style: stylePostcode,
            onEachFeature: onEachPostcode
        });

        // Add zoom listener to toggle layers smoothly
        map.on('zoom', handleZoomChange);
        map.on('zoomend', handleZoomChange);
        handleZoomChange();

        updateLegend();
    } catch (error) {
        console.error('Error loading GeoJSON or Data:', error);
        alert('Failed to load map data. Please ensure you are running a local server.');
    }
}

function normalizeKey(name) {
    return name ? name.trim().toLowerCase() : '';
}

function getCombinedData(key, isBorough) {
    const source = isBorough ? (propertyData.boroughs || {}) : (propertyData.postcodes || {});
    const metricSource = isBorough ? (metricsData.boroughs || {}) : (metricsData.postcodes || {});
    if (source[key]) {
        const metrics = metricSource[key] || {};
        return {
            levelType: isBorough ? 'borough' : 'postcode',
            prices: source[key].prices || {},
            crime: metrics.crime || null,
            central: metrics.central ?? null,
            culture: metrics.culture ?? null,
            summary: 'Market Data'
        };
    }

    return {
        levelType: isBorough ? 'borough' : 'postcode',
        prices: {},
        crime: null,
        central: null,
        culture: null,
        summary: 'Market Data'
    };
}

function handleZoomChange() {
    const zoom = map.getZoom();
    currentZoom = zoom;

    const threshold = MAP_ZOOM_SELECTED - 1;

    if (zoom >= threshold) {
        boroughOpacityMultiplier = 0;
        postcodeOpacityMultiplier = 1;

        if (map.hasLayer(boroughLayer)) map.removeLayer(boroughLayer);
        if (!map.hasLayer(postcodeLayer)) {
            postcodeLayer.addTo(map);
        }
    } else {
        boroughOpacityMultiplier = 1;
        postcodeOpacityMultiplier = 0;

        if (map.hasLayer(postcodeLayer)) map.removeLayer(postcodeLayer);
        if (!map.hasLayer(boroughLayer)) boroughLayer.addTo(map);
    }

    if (postcodeLayer) {
        postcodeLayer.eachLayer(layer => {
            if (layer.feature.properties.labelMarker) {
                if (postcodeOpacityMultiplier > 0.5) {
                    layer.feature.properties.labelMarker.addTo(map);
                } else {
                    map.removeLayer(layer.feature.properties.labelMarker);
                }
            }
        });
    }

    if (zoom <= threshold && activeBoroughGeometry) {
        activeBoroughGeometry = null;
    }

    updateMapVisuals();
}

// Styling Functions
// Styling Functions
let activeBoroughGeometry = null;

function styleBorough(feature) {
    // Focus Mode: If a borough is active...
    if (activeBoroughGeometry) {
        // ...and this IS the active borough
        if (feature === activeBoroughGeometry) {
            // Make it transparent so postcodes show through strictly
            return applyOpacity({
                fillColor: 'transparent',
                weight: 2,
                opacity: 1,
                color: '#666', // Keep border visible? Or hide? Let's keep border for context
                fillOpacity: 0,
                interactive: false // Let clicks pass through to postcodes
            }, boroughOpacityMultiplier);
        }
        // ...and this is NOT the active borough
        else {
            // Make it "colorless" (Grey)
            return applyOpacity({
                fillColor: '#f5f5f5',
                weight: 1,
                opacity: 1,
                color: '#ddd',
                fillOpacity: 0.5, // Light grey background
                interactive: false // Disable interaction on faded areas? Or allow to switch focus? Let's disable for focus.
            }, boroughOpacityMultiplier);
        }
    }

    // Default Mode (No focus)
    return applyOpacity(getFeatureStyle(feature, 0.8, 2, 'white', 0.6), boroughOpacityMultiplier);
}

function stylePostcode(feature) {
    // Only used when zoomed in
    let opacity = 0.8;

    // Strict Focus Mode for Postcodes
    if (activeBoroughGeometry && typeof turf !== 'undefined') {
        const center = turf.center(feature);
        const isInside = turf.booleanPointInPolygon(center, activeBoroughGeometry);

        if (!isInside) {
            // Hide postcodes outside the selection
            return applyOpacity({
                fillColor: 'transparent',
                weight: 0,
                opacity: 0,
                color: 'transparent',
                fillOpacity: 0,
                interactive: false
            }, postcodeOpacityMultiplier);
        } else {
            // Show focused postcodes with thicker white borders
            return applyOpacity(getFeatureStyle(feature, 0.9, 1.5, '#fff', 0.9), postcodeOpacityMultiplier);
        }
    }

    // Fallback if no specific focus (should vary rarely happen if logic is tight)
    return applyOpacity(getFeatureStyle(feature, 0.9, 1, '#eee', 0.8), postcodeOpacityMultiplier);
}

function getFeatureStyle(feature, defaultOpacity, weight, borderColor, fillOp) {
    const name = feature.properties.name;
    const data = boroughData[normalizeKey(name)];

    if (!data) return {
        fillColor: MISSING_DATA_COLOR,
        weight: weight,
        opacity: 1,
        color: borderColor,
        fillOpacity: 0.4
    };

    let color = '#ccc';
    let opacity = fillOp;
    let value = 0;

    if (currentMode === 'price') {
        value = getPriceValue(data, currentYear, currentSize, currentType);

        if (value === null) {
            color = MISSING_DATA_COLOR;
        } else if (value > maxPrice) {
            color = '#431407'; // Max Dark Color
        } else {
            color = getPriceColor(value);
        }
    } else if (currentMode === 'crime') {
        const crimeValue = getCrimeValue(data, currentYear);
        const normalized = crimeValue == null
            ? null
            : normalizeMetric(crimeValue, 'crime', data.levelType, currentYear);
        color = normalized == null ? MISSING_DATA_COLOR : getCrimeColor(normalized);
    } else if (currentMode === 'central') {
        const normalized = data.central == null
            ? null
            : normalizeMetric(data.central, 'central', data.levelType);
        color = normalized == null ? MISSING_DATA_COLOR : getCentralColor(normalized);
    } else if (currentMode === 'culture') {
        const normalized = data.culture == null
            ? null
            : normalizeMetric(data.culture, 'culture', data.levelType);
        color = normalized == null ? MISSING_DATA_COLOR : getCultureColor(normalized);
    }

    return {
        fillColor: color,
        weight: weight,
        opacity: 1,
        color: borderColor,
        dashArray: '',
        fillOpacity: opacity
    };
}

function applyOpacity(style, multiplier) {
    if (!style) return style;
    const opacity = style.opacity ?? 1;
    const fillOpacity = style.fillOpacity ?? 1;
    const nextStyle = {
        ...style,
        opacity: opacity * multiplier,
        fillOpacity: fillOpacity * multiplier
    };
    if (typeof style.interactive !== 'undefined') {
        nextStyle.interactive = style.interactive;
    }
    return nextStyle;
}

function average(values) {
    if (!values.length) return null;
    const total = values.reduce((a, b) => a + b, 0);
    return total / values.length;
}

function getCrimeValue(data, year) {
    if (!data || !data.crime) return null;
    const yearKey = String(year);
    const value = data.crime[yearKey];
    return typeof value === 'number' ? value : null;
}

function getMetricValues(metric, levelType, year) {
    const levelKey = levelType === 'borough' ? 'boroughs' : 'postcodes';
    const source = metricsData[levelKey] || {};
    const values = [];
    const yearKey = year != null ? String(year) : null;

    Object.values(source).forEach(entry => {
        if (!entry) return;
        if (metric === 'crime') {
            if (!entry.crime || !yearKey) return;
            const value = entry.crime[yearKey];
            if (typeof value === 'number') values.push(value);
            return;
        }

        const value = entry[metric];
        if (typeof value === 'number') values.push(transformMetricValue(metric, value));
    });

    return values;
}

function transformMetricValue(metric, value) {
    if (metric === 'central') {
        return -value;
    }
    return value;
}

function quantile(values, p) {
    if (!values.length) return null;
    const sorted = values.slice().sort((a, b) => a - b);
    const index = (sorted.length - 1) * p;
    const lower = Math.floor(index);
    const upper = Math.ceil(index);
    if (lower === upper) return sorted[lower];
    const weight = index - lower;
    return sorted[lower] * (1 - weight) + sorted[upper] * weight;
}

function getMetricThresholds(metric, levelType, year) {
    const cacheKey = `${metric}:${levelType}:${year ?? 'all'}`;
    if (metricCache.thresholds.has(cacheKey)) {
        return metricCache.thresholds.get(cacheKey);
    }

    const values = getMetricValues(metric, levelType, year);
    if (!values.length) return null;
    const low = quantile(values, 1 / 3);
    const high = quantile(values, 2 / 3);
    const thresholds = { low, high };
    metricCache.thresholds.set(cacheKey, thresholds);
    return thresholds;
}

function getMetricRange(metric, levelType, year) {
    const cacheKey = `${metric}:${levelType}:${year ?? 'all'}`;
    if (metricCache.ranges.has(cacheKey)) {
        return metricCache.ranges.get(cacheKey);
    }
    const values = getMetricValues(metric, levelType, year);
    if (!values.length) return null;
    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = { min, max };
    metricCache.ranges.set(cacheKey, range);
    return range;
}

function normalizeMetric(value, metric, levelType, year) {
    const range = getMetricRange(metric, levelType, year);
    if (!range) return null;
    if (range.max === range.min) return 0.5;
    const transformed = transformMetricValue(metric, value);
    return (transformed - range.min) / (range.max - range.min);
}

function getPriceValue(data, year, size, type) {
    if (!data || !data.prices) return null;
    const yearKey = String(year);
    const yearData = data.prices[yearKey];
    if (!yearData) return null;

    const sizeKeys = size === 'all' ? Object.keys(yearData) : [size];
    const values = [];

    sizeKeys.forEach(sizeKey => {
        const sizeData = yearData[sizeKey];
        if (!sizeData) return;

        if (type === 'all') {
            Object.values(sizeData).forEach(val => {
                if (typeof val === 'number') values.push(val);
            });
        } else {
            const val = sizeData[type];
            if (typeof val === 'number') values.push(val);
        }
    });

    return average(values);
}

// Interactions
function onEachBorough(feature, layer) {
    layer.on({
        mouseover: highlightFeature,
        mouseout: resetBoroughHighlight,
        click: (e) => {
            // Keep borough colors static (no focus mode)
            activeBoroughGeometry = null;
            lastSelected = { key: normalizeKey(feature.properties.name), isBorough: true };
            updateSidebar(e.target.feature.properties);

            // Force redraw of postcodes
            if (postcodeLayer) postcodeLayer.setStyle(stylePostcode);
            updatePostcodeLabels();
        }
    });
}

function onEachPostcode(feature, layer) {
    layer.on({
        mouseover: highlightFeature,
        mouseout: resetPostcodeHighlight,
        click: (e) => {
            lastSelected = { key: normalizeKey(e.target.feature.properties.name), isBorough: false };
            updateSidebar(e.target.feature.properties);
        }
    });

    // Bind tooltip for postcode labels to show on hover (or permanent if desired)
    // For this request, we are using the 'map-label' markers added in loadData, 
    // but the previous loadData logic for labels needs to be adapted for the toggle.
    // Let's attach the label to the layer for easier management.
    const center = layer.getBounds().getCenter();
    const label = L.marker(center, {
        icon: L.divIcon({
            className: 'map-label',
            html: feature.properties.name,
            iconSize: [40, 20],
            iconAnchor: [20, 10]
        }),
        interactive: false
    });

    // Add label to layer group? No, Leaflet doesn't strictly support adding markers to a GeoJSON layer group easily like this.
    // We will stick to adding them to the map in the zoom handler.
    // Hack: Store label on the feature for easy access
    feature.properties.labelMarker = label;
}

function highlightFeature(e) {
    const layer = e.target;
    layer.setStyle({
        weight: 3,
        color: '#666',
        fillOpacity: 0.9
    });
    if (!L.Browser.ie && !L.Browser.opera && !L.Browser.edge) {
        layer.bringToFront();
    }
}

function resetBoroughHighlight(e) {
    boroughLayer.resetStyle(e.target);
}

function resetPostcodeHighlight(e) {
    postcodeLayer.resetStyle(e.target);
}

function getPriceColor(price) {
    // Scales: <300k to >1.5M - More distinct orange/red scale
    return price > 1500000 ? '#431407' : // Very Dark (almost black-brown)
        price > 1200000 ? '#7c2d12' : // Dark Brown/Red
            price > 1000000 ? '#c2410c' : // Deep Orange
                price > 800000 ? '#ea580c' : // Orange
                    price > 600000 ? '#f97316' : // Bright Orange
                        price > 450000 ? '#fb923c' : // Light Orange
                            price > 300000 ? '#fdba74' : // Very Light Orange
                                '#fed7aa';   // Pale Orange
}

function getCrimeColor(value) {
    return getScaleColor(value, [219, 234, 254], [29, 78, 216]); // Light to Dark Blue
}

function getCentralColor(value) {
    return getScaleColor(value, [220, 252, 231], [22, 163, 74]); // Light to Dark Green
}

function getCultureColor(value) {
    return getScaleColor(value, [254, 249, 195], [202, 138, 4]); // Light to Dark Yellow
}

function getScaleColor(value, startRGB, endRGB) {
    // value 0 to 1
    const r = Math.round(startRGB[0] + (endRGB[0] - startRGB[0]) * value);
    const g = Math.round(startRGB[1] + (endRGB[1] - startRGB[1]) * value);
    const b = Math.round(startRGB[2] + (endRGB[2] - startRGB[2]) * value);
    return `rgb(${r}, ${g}, ${b})`;
}

// Interactions
function onEachFeature(feature, layer) {
    layer.on({
        mouseover: highlightFeature,
        mouseout: resetHighlight,
        click: zoomToFeature
    });
}

function highlightFeature(e) {
    const layer = e.target;
    layer.setStyle({
        weight: 3,
        color: '#666',
        dashArray: '',
        fillOpacity: 0.9
    });

    if (!L.Browser.ie && !L.Browser.opera && !L.Browser.edge) {
        layer.bringToFront();
    }
}

function resetHighlight(e) {
    geoJsonLayer.resetStyle(e.target);
}

function zoomToFeature(e) {
    map.fitBounds(e.target.getBounds());
    updateSidebar(e.target.feature.properties);
}

function updateMapVisuals() {
    if (boroughLayer) boroughLayer.setStyle(styleBorough);
    if (postcodeLayer) postcodeLayer.setStyle(stylePostcode);
}

function updateSidebar(props) {
    const name = props.name;
    const data = boroughData[normalizeKey(name)];

    if (!data) return;

    const detailsPanel = document.getElementById('borough-details');

    // Calculate current price
    const currentPrice = getPriceValue(data, currentYear, currentSize, currentType);
    const priceText = currentPrice === null
        ? 'Data Not Available'
        : `£${Math.round(currentPrice).toLocaleString()}`;

    const crimeValue = getCrimeValue(data, currentYear);
    const centralValue = data.central;
    const cultureValue = data.culture;

    detailsPanel.innerHTML = `
        <h3>${name}</h3>
        <p class="summary">${data.summary}</p>
        
        <div class="detail-stat">
            <span>Avg Price (${currentYear})</span>
            <span class="${currentPrice === null ? 'stat-na' : ''}">${priceText}</span>
        </div>
    <div class="detail-stat">
        <span>Crime Rate</span>
        <span class="${getScoreClass('crime', crimeValue, data.levelType, currentYear)}">${getScoreText('crime', crimeValue, data.levelType, currentYear)}</span>
    </div>
    <div class="detail-stat">
        <span>Central Proximity</span>
        <span class="${getScoreClass('central', centralValue, data.levelType)}">${getScoreText('central', centralValue, data.levelType)}</span>
    </div>
    <div class="detail-stat">
        <span>Cultural Score</span>
        <span class="${getScoreClass('culture', cultureValue, data.levelType)}">${getScoreText('culture', cultureValue, data.levelType)}</span>
    </div>
`;
}

function getScoreClass(metric, val, levelType, year) {
    if (typeof val !== 'number') return 'stat-na';
    const thresholds = getMetricThresholds(metric, levelType, year);
    if (!thresholds) return 'stat-na';
    const transformed = transformMetricValue(metric, val);
    if (transformed > thresholds.high) return 'stat-high';
    if (transformed > thresholds.low) return 'stat-med';
    return 'stat-low';
}

function getScoreText(metric, val, levelType, year) {
    if (typeof val !== 'number') return 'Data Not Available';
    const thresholds = getMetricThresholds(metric, levelType, year);
    if (!thresholds) return 'Data Not Available';
    const transformed = transformMetricValue(metric, val);
    if (transformed > thresholds.high) return 'High';
    if (transformed > thresholds.low) return 'Medium';
    return 'Low';
}

function updateLegend() {
    let html = '';
    if (currentMode === 'price') {
        const grades = [0, 400000, 500000, 600000, 800000, 1000000, 1200000, 1500000];
        const labels = ['< £400k', '£400k+', '£500k+', '£600k+', '£800k+', '£1M+', '£1.2M+', '> £1.5M'];

        for (let i = 0; i < grades.length; i++) {
            const nextPrice = grades[i + 1] || 10000000;
            const price = grades[i] + 1;
            html += `
            <div class="legend-item">
                <div class="legend-color" style="background:${getPriceColor(price)}"></div>
                <span>${labels[i]}</span>
            </div>
        `;
        }

        html += `
            <div class="legend-item">
                <div class="legend-color" style="background:${MISSING_DATA_COLOR}"></div>
                <span>Data Not Available</span>
            </div>
        `;
    } else {
        const colors = currentMode === 'crime' ? ['#dbeafe', '#1d4ed8']
            : currentMode === 'central' ? ['#dcfce7', '#16a34a']
                : ['#fef9c3', '#ca8a04']; // culture

        html += `
        <div class="legend-item">
            <div class="legend-color" style="background:linear-gradient(to right, ${colors[0]}, ${colors[1]})"></div>
            <span>Low to High</span>
        </div>
        <div class="legend-item">
            <div class="legend-color" style="background:${MISSING_DATA_COLOR}"></div>
            <span>Data Not Available</span>
        </div>
    `;
    }
    legendContent.innerHTML = html;
}
