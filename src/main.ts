// @deno-types="npm:@types/leaflet"
import leaflet from "leaflet";

// Style sheets
import "leaflet/dist/leaflet.css"; // supporting style for Leaflet
import "./style.css"; // student-controlled page style

// Fix missing marker images
import "./_leafletWorkaround.ts"; // fixes for missing Leaflet images

// Import our luck function
import luck from "./_luck.ts";

// Create basic UI elements

const controlPanelDiv = document.createElement("div");
controlPanelDiv.id = "controlPanel";
document.body.append(controlPanelDiv);

// Populate the control panel with helpful instructions and on-screen buttons
controlPanelDiv.innerHTML = `
  <div id="controls">
    <div class="left">
      <h3>Controls</h3>
      <div class="keys">
        <button id="w-btn" class="key">W</button>
        <div>
          <button id="a-btn" class="key">A</button>
          <button id="s-btn" class="key">S</button>
          <button id="d-btn" class="key">D</button>
        </div>
      </div>
      <div class="hint">Click a square to open a cache, then press <strong>poke</strong> to collect points.</div>
    </div>
    <div class="right">
      <h3>Map Navigation</h3>
      <div class="scroll-info">
        <ul>
          <li>Pan: click + drag the map</li>
          <li>Scroll (wheel / two-finger): pans the map where you scroll</li>
          <li>Arrow keys: small pan steps</li>
          <li>PageUp / PageDown: larger pan steps</li>
        </ul>
      </div>
    </div>
  </div>
`;

// Hook up the control buttons to existing movement handlers
const wBtn = document.getElementById("w-btn") as HTMLButtonElement;
const aBtn = document.getElementById("a-btn") as HTMLButtonElement;
const sBtn = document.getElementById("s-btn") as HTMLButtonElement;
const dBtn = document.getElementById("d-btn") as HTMLButtonElement;

function movePlayerBy(di: number, dj: number) {
  playerTileI = playerTileI + di;
  playerTileJ = playerTileJ + dj;
  updatePlayerPosition();
  updateCachesInView();
}

wBtn.addEventListener("click", () => movePlayerBy(1, 0));
aBtn.addEventListener("click", () => movePlayerBy(0, -1));
sBtn.addEventListener("click", () => movePlayerBy(-1, 0));
dBtn.addEventListener("click", () => movePlayerBy(0, 1));

// (status panel will be moved into the control panel after it's created)

const mapDiv = document.createElement("div");
mapDiv.id = "map";
document.body.append(mapDiv);

const statusPanelDiv = document.createElement("div");
statusPanelDiv.id = "statusPanel";
// put the status panel inside the control panel so points appear to the right
// of the WASD/map navigation controls instead of underneath.
controlPanelDiv.appendChild(statusPanelDiv);

// Player Location
const PLAYER_START = leaflet.latLng(
  19.4326,
  -99.1332,
);

// Tunable gameplay parameters
const GAMEPLAY_ZOOM_LEVEL = 19;
const TILE_DEGREES = 1e-4;
const _NEIGHBORHOOD_SIZE = 10;
const CACHE_SPAWN_PROBABILITY = 0.1;
// When true, caches that move outside the rendered viewport will be removed
// from the map (unrendered) but kept in the cacheStore so they can be
// re-rendered later with their original state. When false, once a cache is
// rendered it will remain on the map forever.
const UNRENDER_FAR = true;
// Extra padding (in tiles) around viewport to render so panning looks smooth.
const RENDER_PADDING = 1;

// Create the map (element with id "map" is defined in index.html)
const map = leaflet.map(mapDiv, {
  center: PLAYER_START,
  zoom: GAMEPLAY_ZOOM_LEVEL,
  minZoom: GAMEPLAY_ZOOM_LEVEL,
  maxZoom: GAMEPLAY_ZOOM_LEVEL,
  zoomControl: false,
  scrollWheelZoom: false,
});

// Populate the map with a background tile layer
leaflet
  .tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution:
      '&copy; <a href="http://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  })
  .addTo(map);

// Add a marker to represent the player (we'll keep it centered in a tile)
const playerMarker = leaflet.marker(PLAYER_START);
playerMarker.addTo(map);

// Make the map div focusable so keyboard controls work
// and enable wheel-to-pan behavior (useful when zooming is fixed).
mapDiv.tabIndex = 0;
mapDiv.setAttribute("role", "application");

// When the user scrolls the mouse wheel over the map, pan instead of
// allowing the page to scroll. We prevent the default (so the page
// doesn't move) and pan the map by the wheel delta in pixels.
mapDiv.addEventListener(
  "wheel",
  (ev: WheelEvent) => {
    ev.preventDefault();
    // Use the wheel deltas directly as pixel offsets for panBy.
    // Positive deltaY -> pan down (show more northern content),
    // positive deltaX -> pan right.
    map.panBy([ev.deltaX, ev.deltaY], { animate: false });
  },
  { passive: false },
);

// Keyboard navigation when the map has focus. Arrow keys and
// PageUp/PageDown pan the map by fixed pixel amounts.
mapDiv.addEventListener("keydown", (ev: KeyboardEvent) => {
  const step = 120; // pixels per arrow press
  // globalThis is safe in Deno and browsers; fall back to 600px if unavailable
  const _global = globalThis as unknown as { innerHeight?: number };
  const large = Math.round((_global.innerHeight ?? 600) * 0.5); // page scroll size
  switch (ev.key) {
    case "ArrowUp":
      map.panBy([0, -step]);
      ev.preventDefault();
      break;
    case "ArrowDown":
      map.panBy([0, step]);
      ev.preventDefault();
      break;
    case "ArrowLeft":
      map.panBy([-step, 0]);
      ev.preventDefault();
      break;
    case "ArrowRight":
      map.panBy([step, 0]);
      ev.preventDefault();
      break;
    case "PageUp":
      map.panBy([0, -large]);
      ev.preventDefault();
      break;
    case "PageDown":
      map.panBy([0, large]);
      ev.preventDefault();
      break;
    // WASD controls to move the player tile-by-tile (no clamping)
    case "w":
    case "W":
      playerTileI = playerTileI + 1;
      updatePlayerPosition();
      updateCachesInView();
      ev.preventDefault();
      break;
    case "s":
    case "S":
      playerTileI = playerTileI - 1;
      updatePlayerPosition();
      updateCachesInView();
      ev.preventDefault();
      break;
    case "a":
    case "A":
      playerTileJ = playerTileJ - 1;
      updatePlayerPosition();
      updateCachesInView();
      ev.preventDefault();
      break;
    case "d":
    case "D":
      playerTileJ = playerTileJ + 1;
      updatePlayerPosition();
      updateCachesInView();
      ev.preventDefault();
      break;
  }
});

// Display the player's points and tile position
let playerPoints = 0;
// Player tile coordinates relative to CLASSROOM_LATLNG (i -> latitude, j -> longitude)
let playerTileI = 0;
let playerTileJ = 0;

function _clampTile(v: number) {
  // Allow free movement: return value unchanged. Kept as a noop so
  // existing calls that reference clampTile don't need to be rewritten.
  return v;
}

function updatePlayerPosition() {
  // center the player in the tile (use +0.5 to get tile center)
  const lat = PLAYER_START.lat + (playerTileI + 0.5) * TILE_DEGREES;
  const lng = PLAYER_START.lng + (playerTileJ + 0.5) * TILE_DEGREES;
  const latlng = leaflet.latLng(lat, lng);

  playerMarker.setLatLng(latlng);
  // update tooltip to show coords and optionally points
  const tip = `You (${playerTileI},${playerTileJ})`;
  // create or update tooltip content
  if (playerMarker.getTooltip()) {
    playerMarker.getTooltip()!.setContent(tip);
  } else {
    playerMarker.bindTooltip(tip, { permanent: false, direction: "top" });
  }

  // Ensure player is visible by centering the map on them
  map.panTo(latlng, { animate: false });

  statusPanelDiv.innerHTML =
    `${playerPoints} points — pos (${playerTileI},${playerTileJ})`;

  // Generate/update caches for the current view so tiles near the player exist
  // immediately after movement.
  updateCachesInView();
}
// CacheEntry type stores generated cache state. Kept simple so entries
// can be serialized later if desired.
type CacheEntry = {
  i: number;
  j: number;
  pointValue: number;
  rect?: leaflet.Rectangle;
  rendered: boolean;
};

const cacheStore = new Map<string, CacheEntry>();

function cellKey(i: number, j: number) {
  return `${i},${j}`;
}

function renderCacheEntry(entry: CacheEntry) {
  if (entry.rendered) return;

  const origin = PLAYER_START;
  const bounds = leaflet.latLngBounds([
    [origin.lat + entry.i * TILE_DEGREES, origin.lng + entry.j * TILE_DEGREES],
    [
      origin.lat + (entry.i + 1) * TILE_DEGREES,
      origin.lng + (entry.j + 1) * TILE_DEGREES,
    ],
  ]);

  const rect = leaflet.rectangle(bounds);
  rect.addTo(map);

  // Show the current point value on the rectangle
  rect.bindTooltip(entry.pointValue.toString(), {
    permanent: true,
    direction: "center",
    className: "cacheLabel",
  });

  // Use class selectors to avoid duplicate ID issues when multiple popups exist
  rect.bindPopup(() => {
    const popupDiv = document.createElement("div");
    popupDiv.innerHTML = `
        <div>There is a cache here at "${entry.i},${entry.j}". It has value <span class="value">${entry.pointValue}</span>.</div>
        <button class="poke">poke</button>`;

    const pokeButton = popupDiv.querySelector<HTMLButtonElement>(".poke")!;
    const valueSpan = popupDiv.querySelector<HTMLSpanElement>(".value")!;

    pokeButton.addEventListener("click", () => {
      if (entry.pointValue <= 0) return;
      entry.pointValue -= 1;
      valueSpan.innerHTML = entry.pointValue.toString();
      rect.getTooltip()?.setContent(entry.pointValue.toString());
      if (entry.pointValue <= 0) pokeButton.disabled = true;
      playerPoints++;
      statusPanelDiv.innerHTML = `${playerPoints} points accumulated`;
    });

    return popupDiv;
  });

  entry.rect = rect;
  entry.rendered = true;
}

function ensureCacheRendered(i: number, j: number) {
  const key = cellKey(i, j);
  const existing = cacheStore.get(key);
  if (existing) {
    // If it exists but is currently unrendered, render it again
    if (!existing.rendered) renderCacheEntry(existing);
    return;
  }

  // If no cache entry exists for this cell, decide whether to spawn one
  if (luck([i, j].toString()) < CACHE_SPAWN_PROBABILITY) {
    const pointValue = Math.floor(luck([i, j, "initialValue"].toString()) * 2);
    const entry: CacheEntry = { i, j, pointValue, rendered: false };
    cacheStore.set(key, entry);
    renderCacheEntry(entry);
  }
}

function unrenderFarCaches(visibleKeys: Set<string>) {
  if (!UNRENDER_FAR) return;
  for (const [key, entry] of cacheStore.entries()) {
    if (!visibleKeys.has(key) && entry.rendered) {
      // remove rectangle from map but keep the entry in cacheStore
      entry.rect?.remove();
      // delete property so its type remains compatible with strict options
      delete entry.rect;
      entry.rendered = false;
    }
  }
}

function updateCachesInView() {
  const bounds = map.getBounds();
  const sw = bounds.getSouthWest();
  const ne = bounds.getNorthEast();

  const minI = Math.floor((sw.lat - PLAYER_START.lat) / TILE_DEGREES) -
    RENDER_PADDING;
  const maxI = Math.floor((ne.lat - PLAYER_START.lat) / TILE_DEGREES) +
    RENDER_PADDING;
  const minJ = Math.floor((sw.lng - PLAYER_START.lng) / TILE_DEGREES) -
    RENDER_PADDING;
  const maxJ = Math.floor((ne.lng - PLAYER_START.lng) / TILE_DEGREES) +
    RENDER_PADDING;

  const visible = new Set<string>();
  for (let i = minI; i <= maxI; i++) {
    for (let j = minJ; j <= maxJ; j++) {
      visible.add(cellKey(i, j));
      ensureCacheRendered(i, j);
    }
  }

  unrenderFarCaches(visible);
}

// Update caches initially and whenever the map finishes panning.
updateCachesInView();
map.on("moveend", () => updateCachesInView());
