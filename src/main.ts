// @deno-types="npm:@types/leaflet"
import leaflet from "leaflet";

// Style sheets
import "leaflet/dist/leaflet.css"; // supporting style for Leaflet
import "./style.css"; // student-controlled page style

// If the developer wants to temporarily hide the UI for mobile GPS testing
// they can append `?hide_ui=1` (or `?hide_ui=true`) to the page URL. This
// adds a class to the body that the stylesheet uses to hide UI chrome.
try {
  const loc = (globalThis as unknown as { location?: Location }).location;
  if (loc) {
    const params = new URLSearchParams(loc.search);
    const v = params.get("hide_ui");
    if (v === "1" || v === "true") {
      document.body.classList.add("hide-ui-testing");
    }
  }
} catch (_e) {
  // ignore if URLSearchParams/location not available in some environments
}

// Fix missing marker images
import "./_leafletWorkaround.ts"; // fixes for missing Leaflet images

// Import our luck function
import luck from "./_luck.ts";

// --------------------
// Config & Types
// --------------------
// Player/world origin (can be changed to move the world anchor)
const PLAYER_START = leaflet.latLng(0, 0);

//========== Tunable gameplay parameters=============
const GAMEPLAY_ZOOM_LEVEL = 19;
const TILE_DEGREES = 1e-4;
const CACHE_SPAWN_PROBABILITY = 0.1;
// When true, caches that move outside the rendered viewport will be removed
// from the map (unrendered) but kept in the cacheStore so they can be
// re-rendered later with their original state. When false, once a cache is
// rendered it will remain on the map forever.
const UNRENDER_FAR = true;
// Extra padding (in tiles) around viewport to render so panning looks smooth.
const RENDER_PADDING = 1;
// Gameplay: how far (in tiles) the player can act on caches
const INTERACT_RANGE = 3;

// CacheEntry type stores generated cache state. Kept simple so entries
// can be serialized later if desired.
type CacheEntry = {
  i: number;
  j: number;
  pointValue: number;
  rect?: leaflet.Rectangle;
  rendered: boolean;
};

// UI element references (created by `createUI()` below)
let controlPanelDiv: HTMLDivElement;
let mapDiv: HTMLDivElement;
let statusPanelDiv: HTMLDivElement;
let wBtn: HTMLButtonElement;
let aBtn: HTMLButtonElement;
let sBtn: HTMLButtonElement;
let dBtn: HTMLButtonElement;
let geoWatchId: number | null = null;
let gpsToggle: HTMLInputElement;

function createUI() {
  controlPanelDiv = document.createElement("div");
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
      <div class="hint">Click a square to open a cache, then use <strong>Collect</strong> to pick it up or <strong>Combine</strong> to merge matching values.</div>
      <div class="gps-toggle">
        <label><input id="gps-toggle" type="checkbox"> Use GPS</label>
      </div>
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

  // Create the map container and status panel
  mapDiv = document.createElement("div");
  mapDiv.id = "map";
  document.body.append(mapDiv);

  statusPanelDiv = document.createElement("div");
  statusPanelDiv.id = "statusPanel";
  // put the status panel inside the control panel so points appear to the right
  // of the WASD/map navigation controls instead of underneath.
  controlPanelDiv.appendChild(statusPanelDiv);

  // Hook up the control buttons to existing movement handlers
  wBtn = document.getElementById("w-btn") as HTMLButtonElement;
  aBtn = document.getElementById("a-btn") as HTMLButtonElement;
  sBtn = document.getElementById("s-btn") as HTMLButtonElement;
  dBtn = document.getElementById("d-btn") as HTMLButtonElement;

  wBtn.addEventListener("click", () => movePlayerBy(1, 0));
  aBtn.addEventListener("click", () => movePlayerBy(0, -1));
  sBtn.addEventListener("click", () => movePlayerBy(-1, 0));
  dBtn.addEventListener("click", () => movePlayerBy(0, 1));

  // Wire GPS toggle (if the device supports geolocation). The toggle lets
  // players choose between GPS-driven movement and manual on-screen keys.
  gpsToggle = document.getElementById("gps-toggle") as HTMLInputElement;
  const keysDiv = controlPanelDiv.querySelector<HTMLDivElement>(".keys");
  if ("geolocation" in navigator) {
    gpsToggle.disabled = false;
    // Default: enable GPS if available
    gpsToggle.checked = true;
    if (keysDiv) keysDiv.style.display = "none";
    startGeolocationControls();
  } else {
    // No GPS available: disable the toggle and keep keys visible
    gpsToggle.disabled = true;
    gpsToggle.checked = false;
    if (keysDiv) keysDiv.style.display = "block";
  }

  gpsToggle.addEventListener("change", () => {
    if (gpsToggle.checked) {
      // hide manual keys and start GPS
      if (keysDiv) keysDiv.style.display = "none";
      startGeolocationControls();
    } else {
      // show manual keys and stop GPS
      if (keysDiv) keysDiv.style.display = "block";
      _stopGeolocationControls();
    }
  });
}

// Build UI now
createUI();

// Start/stop geolocation-based player movement
function startGeolocationControls() {
  if (!("geolocation" in navigator)) return;
  // Request high-accuracy position updates; map them to tile indices.
  try {
    geoWatchId = navigator.geolocation.watchPosition(
      (pos: GeolocationPosition) => {
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        // Place player exactly at the reported coordinates and persist.
        placePlayerAtLatLng(lat, lng);
      },
      (_err: GeolocationPositionError) => {
        // If permission denied or other error, reveal controls so the user
        // can still move manually.
        const keysDiv = controlPanelDiv.querySelector<HTMLDivElement>(
          ".keys",
        );
        if (keysDiv) keysDiv.style.display = "block";
        const hint = controlPanelDiv.querySelector<HTMLDivElement>(
          ".hint",
        );
        if (hint) {
          hint.textContent =
            "Geolocation unavailable — use on-screen controls or keyboard.";
        }
        // Stop watching if there's an unrecoverable error
        if (geoWatchId !== null) {
          navigator.geolocation.clearWatch(geoWatchId);
          geoWatchId = null;
        }
      },
      { enableHighAccuracy: true, maximumAge: 1000, timeout: 10000 },
    );
  } catch (_e) {
    // If the API throws, fall back to on-screen controls
    const keysDiv = controlPanelDiv.querySelector<HTMLDivElement>(
      ".keys",
    );
    if (keysDiv) keysDiv.style.display = "block";
  }
}

function _stopGeolocationControls() {
  if (geoWatchId !== null) {
    navigator.geolocation.clearWatch(geoWatchId);
    geoWatchId = null;
  }
}

// Place the player marker at the exact latitude/longitude reported by GPS.
// This sets the tile indices (used for interaction range) but keeps the
// marker at the real-world location instead of snapping to a tile center.
function placePlayerAtLatLng(lat: number, lng: number) {
  const latlng = leaflet.latLng(lat, lng);
  // Compute the tile indices corresponding to this lat/lng
  const newI = Math.floor((lat - PLAYER_START.lat) / TILE_DEGREES);
  const newJ = Math.floor((lng - PLAYER_START.lng) / TILE_DEGREES);
  playerTileI = newI;
  playerTileJ = newJ;

  // Place marker at the exact coordinates and update UI
  playerMarker.setLatLng(latlng);
  // update tooltip text
  const tip = `You (${playerTileI},${playerTileJ})`;
  if (playerMarker.getTooltip()) {
    playerMarker.getTooltip()!.setContent(tip);
  } else {
    playerMarker.bindTooltip(tip, { permanent: false, direction: "top" });
  }
  // Keep player visible
  map.panTo(latlng, { animate: false });

  statusPanelDiv.innerHTML = `Held: ${
    heldValue ?? "None"
  } — pos (${playerTileI},${playerTileJ})`;

  // Update caches based on the player's tile location
  updateCachesInView();
  refreshAllCacheStyles();
  // persist location/state
  saveState();
}

// Simple `player` object that centralizes player actions while keeping the
// existing global tile and held-value state for compatibility with the
// rest of the module.

interface Player {
  tileI: number;
  tileJ: number;
  heldValue: number | null;
  moveBy(di: number, dj: number): void;
  updatePosition(): void;
  setHeld(value: number | null): void;
  updateUI(): void;
}

const player: Player = {
  tileI: 0,
  tileJ: 0,
  heldValue: null,
  moveBy(di: number, dj: number) {
    playerTileI = playerTileI + di;
    playerTileJ = playerTileJ + dj;
    updatePlayerPosition();
    updateCachesInView();
    saveState();
  },
  updatePosition() {
    updatePlayerPosition();
  },
  setHeld(value: number | null) {
    heldValue = value;
    updatePlayerPosition();
    saveState();
  },
  updateUI() {
    statusPanelDiv.innerHTML = `Held: ${
      heldValue ?? "None"
    } — pos (${playerTileI},${playerTileJ})`;
  },
};

// Interface describing the cache manager API. We forward-declare the
// `CacheManager` variable so earlier code can call its methods; the actual
// implementation will be attached after the existing cache helper functions.
interface CacheManagerInterface {
  cacheStore: Map<string, CacheEntry>;
  cellKey(i: number, j: number): string;
  renderCacheEntry(entry: CacheEntry): void;
  ensureCacheRendered(i: number, j: number): void;
  unrenderFarCaches(visibleKeys: Set<string>): void;
  updateCachesInView(): void;
  refreshAllCacheStyles(): void;
  updateCacheVisual(entry: CacheEntry): void;
  canInteract(entry: CacheEntry): boolean;
}

function movePlayerBy(di: number, dj: number) {
  // Delegate to the player object's move method. The player object is
  // declared later in the file but that's fine: the event listeners won't
  // invoke this until after the page has loaded and the player is created.
  if (typeof player !== "undefined" && player) {
    player.moveBy(di, dj);
  }
}

// UI elements are created by `createUI()` above.

// (Moved configuration and CacheEntry type to the top 'Config & Types' section.)

// Create the map (element with id "map" is defined in index.html)
const map = leaflet.map(mapDiv!, {
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

// If geolocation is available, try to place the player where they actually
// are in the world when the app starts. We convert the real-world
// coordinates to tile indices (relative to PLAYER_START) so the player is
// positioned at the center of the corresponding tile.
if ("geolocation" in navigator) {
  try {
    navigator.geolocation.getCurrentPosition(
      (pos: GeolocationPosition) => {
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        placePlayerAtLatLng(lat, lng);
      },
      () => {
        // Ignore: leave player at default start if permission denied.
      },
      { maximumAge: 60000, timeout: 5000 },
    );
  } catch {
    // ignore errors and keep default location
  }
}

// Make the map div focusable so keyboard controls work
// and enable wheel-to-pan behavior (useful when zooming is fixed).
mapDiv!.tabIndex = 0;
mapDiv!.setAttribute("role", "application");

// When the user scrolls the mouse wheel over the map, pan instead of
// allowing the page to scroll. We prevent the default (so the page
// doesn't move) and pan the map by the wheel delta in pixels.
mapDiv!.addEventListener(
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
mapDiv!.addEventListener("keydown", (ev: KeyboardEvent) => {
  const step = 120; // pixels per arrow press

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
      player.moveBy(1, 0);
      ev.preventDefault();
      break;
    case "s":
    case "S":
      player.moveBy(-1, 0);
      ev.preventDefault();
      break;
    case "a":
    case "A":
      player.moveBy(0, -1);
      ev.preventDefault();
      break;
    case "d":
    case "D":
      player.moveBy(0, 1);
      ev.preventDefault();
      break;
  }
});

// Display the player's points and tile position
// Player tile coordinates relative to CLASSROOM_LATLNG (i -> latitude, j -> longitude)
let playerTileI = 0;
let playerTileJ = 0;
// The player can hold a single token (value) at a time
let heldValue: number | null = null;

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

  statusPanelDiv.innerHTML = `Held: ${
    heldValue ?? "None"
  } — pos (${playerTileI},${playerTileJ})`;

  // Generate/update caches for the current view so tiles near the player exist
  // immediately after movement.
  updateCachesInView();
  // Refresh visual state of caches so pokable ones are highlighted
  refreshAllCacheStyles();
}
// Cache store (type defined in Config & Types section)
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
        <div>Value: <span class="value">${entry.pointValue}</span></div>
        <div class="popup-actions">
          <button class="collect">Collect</button>
          <button class="combine">Combine</button>
        </div>`;

    const collectButton = popupDiv.querySelector<HTMLButtonElement>(
      ".collect",
    )!;
    const combineButton = popupDiv.querySelector<HTMLButtonElement>(
      ".combine",
    )!;
    const valueSpan = popupDiv.querySelector<HTMLSpanElement>(".value")!;

    // initial enabled/disabled states
    collectButton.disabled = !canInteract(entry) || entry.pointValue <= 0 ||
      heldValue !== null;
    // combine enabled when in range, player holds a value, and either the square is empty or it matches heldValue
    combineButton.disabled = !(canInteract(entry) && heldValue !== null &&
      (entry.pointValue === 0 || heldValue === entry.pointValue));

    // Collect: pick up the cache's value if player holds nothing — cache becomes empty
    collectButton.addEventListener("click", () => {
      if (!canInteract(entry) || entry.pointValue <= 0 || heldValue !== null) {
        return;
      }
      heldValue = entry.pointValue;
      entry.pointValue = 0;
      valueSpan.innerHTML = entry.pointValue.toString();
      rect.getTooltip()?.setContent(entry.pointValue.toString());
      // update status
      statusPanelDiv.innerHTML =
        `Held: ${heldValue} — pos (${playerTileI},${playerTileJ})`;
      // refresh visuals so combine availability updates
      refreshAllCacheStyles();
      // persist state after a change
      saveState();
    });

    // Combine: place held value into empty square, or combine when values match
    combineButton.addEventListener("click", () => {
      if (!canInteract(entry) || heldValue === null) return;
      // If square is empty, place held value into it
      if (entry.pointValue === 0) {
        entry.pointValue = heldValue;
        heldValue = null;
        valueSpan.innerHTML = entry.pointValue.toString();
        rect.getTooltip()?.setContent(entry.pointValue.toString());
        statusPanelDiv.innerHTML = `Held: ${
          heldValue ?? "None"
        } — pos (${playerTileI},${playerTileJ})`;
        refreshAllCacheStyles();
        // persist state after a change
        saveState();
        return;
      }

      // Otherwise only allow combining when held value equals square value
      if (heldValue !== entry.pointValue) return;
      const newVal = heldValue + entry.pointValue;
      entry.pointValue = newVal;
      // clear player's held token
      heldValue = null;
      valueSpan.innerHTML = entry.pointValue.toString();
      rect.getTooltip()?.setContent(entry.pointValue.toString());
      statusPanelDiv.innerHTML = `Held: ${
        heldValue ?? "None"
      } — pos (${playerTileI},${playerTileJ})`;
      refreshAllCacheStyles();
      // persist state after a change
      saveState();
    });

    return popupDiv;
  });

  entry.rect = rect;
  entry.rendered = true;

  // Apply initial visual state depending on whether the player can Interact with this cache
  updateCacheVisual(entry);
}

function canInteract(entry: CacheEntry) {
  // Use Chebyshev distance so the player can interact in a square radius
  const di = Math.abs(entry.i - playerTileI);
  const dj = Math.abs(entry.j - playerTileJ);
  return Math.max(di, dj) <= INTERACT_RANGE;
}

function updateCacheVisual(entry: CacheEntry) {
  if (!entry.rendered || !entry.rect) return;

  const Interactable = canInteract(entry);
  // style for pokable vs non-pokable caches
  const InteractableStyle = {
    color: "#2b8a3e",
    fillColor: "#dff8e6",
    weight: 2,
  };
  const normalStyle = { color: "#3388ff", fillColor: "#cfe6ff", weight: 1 };
  entry.rect.setStyle(Interactable ? InteractableStyle : normalStyle);

  // If the popup for this rect is currently open, update the collect/combine button states
  const popup = entry.rect.getPopup && entry.rect.getPopup();
  if (popup && entry.rect.isPopupOpen && entry.rect.isPopupOpen()) {
    const popupEl = popup.getElement && popup.getElement();
    if (popupEl) {
      const collectButton = popupEl.querySelector<HTMLButtonElement>(
        ".collect",
      );
      const combineButton = popupEl.querySelector<HTMLButtonElement>(
        ".combine",
      );
      if (collectButton) {
        collectButton.disabled = !Interactable || entry.pointValue <= 0 ||
          heldValue !== null;
      }
      if (combineButton) {
        // combine allowed when pokable and player holds a value and (square empty OR values match)
        combineButton.disabled = !(Interactable && heldValue !== null &&
          (entry.pointValue === 0 || heldValue === entry.pointValue));
      }
    }
  }
}

function refreshAllCacheStyles() {
  for (const entry of cacheStore.values()) {
    updateCacheVisual(entry);
  }
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

// Expose the existing cache functions via a CacheManager object so other
// modules (or later refactors) can call a single interface. We attach the
// implementation to `globalThis` to match the earlier `declare` usage.
const _cacheManagerImpl: CacheManagerInterface = {
  cacheStore,
  cellKey,
  renderCacheEntry,
  ensureCacheRendered,
  unrenderFarCaches,
  updateCachesInView,
  refreshAllCacheStyles,
  updateCacheVisual,
  canInteract,
};

(globalThis as unknown as { CacheManager?: CacheManagerInterface })
  .CacheManager = _cacheManagerImpl;

// Helper typed accessor to the manager we just attached.
const _g = globalThis as unknown as { CacheManager?: CacheManagerInterface };

// --- Save / Load State (localStorage) ---------------------------------
const STATE_KEY = "cachegame_state_v1";

function saveState() {
  try {
    const caches: Array<{ i: number; j: number; pointValue: number }> = [];
    for (const entry of cacheStore.values()) {
      caches.push({ i: entry.i, j: entry.j, pointValue: entry.pointValue });
    }
    const payload = {
      playerTileI,
      playerTileJ,
      heldValue,
      caches,
      ts: Date.now(),
    };
    localStorage.setItem(STATE_KEY, JSON.stringify(payload));
  } catch {
    // ignore storage errors
  }
}

function loadState() {
  try {
    const raw = localStorage.getItem(STATE_KEY);
    if (!raw) return false;
    const parsed = JSON.parse(raw) as {
      playerTileI?: number;
      playerTileJ?: number;
      heldValue?: number | null;
      caches?: Array<{ i: number; j: number; pointValue: number }>;
    };
    if (typeof parsed.playerTileI === "number") {
      playerTileI = parsed.playerTileI;
    }
    if (typeof parsed.playerTileJ === "number") {
      playerTileJ = parsed.playerTileJ;
    }
    if (typeof parsed.heldValue !== "undefined") heldValue = parsed.heldValue;

    if (parsed.caches && Array.isArray(parsed.caches)) {
      for (const c of parsed.caches) {
        const key = cellKey(c.i, c.j);
        // preserve existing entries but overwrite if saved
        cacheStore.set(key, {
          i: c.i,
          j: c.j,
          pointValue: c.pointValue,
          rendered: false,
        });
      }
    }

    // update UI to reflect loaded player state
    statusPanelDiv.innerHTML = `Held: ${
      heldValue ?? "None"
    } — pos (${playerTileI},${playerTileJ})`;
    return true;
  } catch {
    return false;
  }
}

function _clearSavedState() {
  try {
    localStorage.removeItem(STATE_KEY);
  } catch {
    // ignore
  }
}

// Load saved state (if present) before the initial render so caches are
// available immediately. If geolocation overwrites player position later,
// that's expected.
loadState();

// Update caches initially and whenever the map finishes panning.
_g.CacheManager!.updateCachesInView();
map.on("moveend", () => _g.CacheManager!.updateCachesInView());

// Autosave on unload so progress isn't lost when the tab closes.
globalThis.addEventListener("beforeunload", () => {
  try {
    saveState();
  } catch {
    // ignore
  }
});
