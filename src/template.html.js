export const uiTemplate = `
<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Walker Tracker</title>
<link rel="stylesheet" href="https://unpkg.com/leaflet/dist/leaflet.css" />
<link rel="icon" type="image/png" sizes="512x512" href="/icon.png">
<link rel="apple-touch-icon" href="/icon.png">
<style>
  html, body { height: 100%; margin: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
  #map { height: 100%; }
  #info {
    position: absolute;
    top: 10px;
    right: 10px;
    z-index: 1000;
    background: white;
    padding: 15px;
    border-radius: 8px;
    box-shadow: 0 2px 10px rgba(0,0,0,0.15);
    width: 170px;
  }
  .status-item { margin-bottom: 6px; font-size: 13px; color: #333; display: flex; align-items: center; }
  .status-label { font-weight: bold; color: #555; margin-right: 4px; }
  .toggle-container { margin: 10px 0; font-size: 13px; display: flex; align-items: center; gap: 5px; }
  
  /* Pure CSS LED Indicators */
  .led-indicator { display: inline-block; width: 10px; height: 10px; border-radius: 50%; margin-right: 6px; }
  .led-green { background-color: #22c55e; box-shadow: 0 0 6px #22c55e; }
  .led-yellow { background-color: #eab308; box-shadow: 0 0 6px #eab308; }
  .led-red { background-color: #ef4444; box-shadow: 0 0 6px #ef4444; }

  button {
    width: 100%;
    padding: 8px;
    background: #e11d48;
    color: white;
    border: none;
    border-radius: 4px;
    font-weight: bold;
    cursor: pointer;
    margin-top: 5px;
  }
  button:hover { background: #be123c; }
</style>
</head>
<body>

<div id="map"></div>

<div id="info">
  <div style="font-size: 16px; font-weight: bold; margin-bottom: 10px; border-bottom: 1px solid #eee; padding-bottom: 5px;">Walker Tracker</div>
  
  <div class="status-item"><span class="status-label">Status:</span> <span id="connection">Loading...</span></div>
  <div class="status-item"><span class="status-label">Last GPS:</span> <span id="last-update">-</span></div>
  <div class="status-item"><span class="status-label">Distance:</span> <span id="distance">-</span></div>
  <div class="status-item"><span class="status-label">Battery:</span> <span id="battery">-</span></div>
  <div class="status-item"><span class="status-label">Web Sync:</span> <span id="web-sync">-</span></div>
  
  <div class="toggle-container">
    <input type="checkbox" id="autoCentre" checked>
    <label for="autoCentre">Centre on track</label>
  </div>
  
  <button onclick="clearWalk()">Clear walk</button>
</div>

<script src="https://unpkg.com/leaflet/dist/leaflet.js"></script>
<script>
const map = L.map('map', {
    doubleClickZoom: false // Stops double-taps from violently jumping zoom levels
});
L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19,
  attribution: '© OpenStreetMap contributors'
}).addTo(map);

let marker;
let trail;
let globalPoints = []; // Keep a reference to calculate the nearest coordinate on click
let firstFix = true;
let lastWebSyncTime = null;

// Helper to format timestamps gracefully into local wall-clock time
function formatTime(isoString) {
  const date = new Date(isoString);
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

async function update() {
  try {
    const response = await fetch('/history');
    const points = await response.json();
    globalPoints = points; // Update cache
    lastWebSyncTime = new Date();
    document.getElementById("web-sync").innerText = "Just now";

    if (points.length === 0) return;

    const latest = points[points.length - 1];
    const coords = points.map(p => [Number(p.lat), Number(p.lon)]);

    // Draw or update the visual path lines
    // Clear old trail layers to handle re-drawing cleanly
    if (trail) {
      map.removeLayer(trail);
    }
    
    // We create a feature group to act as our single trail handle
    trail = L.layerGroup().addTo(map);

    // Loop through points and draw individual segments colour-coded by network health
    for (let i = 1; i < points.length; i++) {
      const p1 = points[i - 1];
      const p2 = points[i];
      
      // Use the target point's lag to determine if it was uploaded as a delayed buffer
      const isDelayed = p2.serverLagSec && p2.serverLagSec > 60; 

      const segmentOptions = isDelayed ? {
        color: '#f97316',      // Orange warning colour
        weight: 4,
        dashArray: '5, 8',     // Dotted/Dashed line indicating disconnected buffer dump
        interactive: false     // Handled globally by map-click detection instead
      } : {
        color: '#2563eb',      // Clean live blue line
        weight: 4,
        interactive: false     // Handled globally by map-click detection instead
      };

      const polySegment = L.polyline([[p1.lat, p1.lon], [p2.lat, p2.lon]], segmentOptions);
      polySegment.addTo(trail);
    }

    // Draw or update the pinpoint current location marker
    if (!marker) {
      marker = L.marker([latest.lat, latest.lon]).addTo(map);
    } else {
      marker.setLatLng([latest.lat, latest.lon]);
    }

    const shouldCentre = document.getElementById("autoCentre").checked;
    if (firstFix || shouldCentre) {
      map.setView([latest.lat, latest.lon], firstFix ? 16 : map.getZoom());
      firstFix = false;
    }
  } catch (err) {
    console.error("Sync error:", err);
  }
}

// Global "Magnetic" Click Handler on Map Layer
map.on('click', function(e) {
  if (globalPoints.length === 0) return;

  let closestPoint = null;
  let minDistance = Infinity;

  // e.latlng contains exactly where the user tapped on the screen
  const clickLatLng = e.latlng;

  // We loop through all recorded points to find the mathematically closest one to the tap
  globalPoints.forEach(p => {
    // Standard flat-plane distance approximation (perfect for zoomed-in micro-clicks)
    const dLat = clickLatLng.lat - p.lat;
    const dLon = clickLatLng.lng - p.lon;
    const distanceSq = (dLat * dLat) + (dLon * dLon);

    if (distanceSq < distanceSq && distanceSq < minDistance) {
      minDistance = distanceSq;
      closestPoint = p;
    }
    // 0.0001 degrees latitude/longitude is approx 11 metres lat (always), 7 metres long (Dorchester).
    // Allowing a square distance cap of up to 0.0000025 allows clicks within approx 15-20 metres.
    const touchRadiusSq = 0.0000025; 
    
    if (distanceSq < touchRadiusSq && distanceSq < minDistance) {
      minDistance = distanceSq;
      closestPoint = p;
    }
  });

  // If the closest point is within a reasonable screen distance, snap and open the popup
  if (closestPoint) {
    L.popup()
      .setLatLng([closestPoint.lat, closestPoint.lon]) // Anchor popup to the exact GPS coordinate
      .setContent("<b>Passed here at:</b><br>" + formatTime(closestPoint.timestamp) + 
                  (closestPoint.serverLagSec > 60 ? "<br><span style='color:#f97316;'>⚠️ Saved offline in dead-zone</span>" : "") +
                  ("<br>Altitude: " + closestPoint.altitude.toFixed(0) +"m"))
      .openOn(map);
  }
});

async function updateStatus() {
  try {
    const response = await fetch('/status');
    const data = await response.json();

    if (lastWebSyncTime) {
      const secSinceSync = Math.round((new Date() - lastWebSyncTime) / 1000);
      document.getElementById("web-sync").innerText = secSinceSync + "s ago";
    }

    if (data.points === 0) {
      document.getElementById("connection").innerHTML = "No data";
      return;
    }

    // Determine Status based on Time Elapsed and Speed
    let connectionHTML = '';
    
    if (data.secondsAgo >= 120) {
      // Hasn't pinged in over 2 minutes -> Out of signal / Offline
      connectionHTML = '<span class="led-indicator led-red"></span> Offline';
    } else if (data.speed && data.speed > 0.3) {
      // Active pings and speed is above ~1 km/h -> Moving
      connectionHTML = '<span class="led-indicator led-green"></span> Moving';
    } else {
      // Active pings but speed is near 0 -> Stopped/Stationary
      connectionHTML = '<span class="led-indicator led-yellow"></span> Stationary';
    }

    document.getElementById("connection").innerHTML = connectionHTML;
    document.getElementById("last-update").innerText = data.secondsAgo + "s ago";
    document.getElementById("battery").innerText = data.battery ? data.battery + "%" : "N/A";
    document.getElementById("distance").innerText = (data.distance / 1000).toFixed(2) + " km";
  } catch (err) {
    console.error("Status check failed", err);
  }
}

async function clearWalk() {
  if (!confirm("Clear current walk?")) return;
  await fetch('/clear');
  location.reload();
}

update();
updateStatus();
setInterval(update, 10000);
setInterval(updateStatus, 10000);
</script>
</body>
</html>
`;
