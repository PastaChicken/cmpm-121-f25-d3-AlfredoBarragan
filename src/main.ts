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

const mapDiv = document.createElement("div");
mapDiv.id = "map";
document.body.append(mapDiv);

const statusPanelDiv = document.createElement("div");
statusPanelDiv.id = "statusPanel";
document.body.append(statusPanelDiv);

// Our classroom location
const CLASSROOM_LATLNG = leaflet.latLng(
  36.997936938057016,
  -122.05703507501151,
);

// Tunable gameplay parameters
const GAMEPLAY_ZOOM_LEVEL = 19;
const TILE_DEGREES = 1e-4;
const NEIGHBORHOOD_SIZE = 8;
const CACHE_SPAWN_PROBABILITY = 0.1;

// Create the map (element with id "map" is defined in index.html)
const map = leaflet.map(mapDiv, {
  center: CLASSROOM_LATLNG,
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
const playerMarker = leaflet.marker(CLASSROOM_LATLNG);
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
    // WASD controls to move the player tile-by-tile
    case "w":
    case "W":
      playerTileI = clampTile(playerTileI + 1);
      updatePlayerPosition();
      ev.preventDefault();
      break;
    case "s":
    case "S":
      playerTileI = clampTile(playerTileI - 1);
      updatePlayerPosition();
      ev.preventDefault();
      break;
    case "a":
    case "A":
      playerTileJ = clampTile(playerTileJ - 1);
      updatePlayerPosition();
      ev.preventDefault();
      break;
    case "d":
    case "D":
      playerTileJ = clampTile(playerTileJ + 1);
      updatePlayerPosition();
      ev.preventDefault();
      break;
  }
});

// Display the player's points and tile position
let playerPoints = 0;
// Player tile coordinates relative to CLASSROOM_LATLNG (i -> latitude, j -> longitude)
let playerTileI = 0;
let playerTileJ = 0;

function clampTile(v: number) {
  // spawnCache uses i in [-NEIGHBORHOOD_SIZE, NEIGHBORHOOD_SIZE)
  return Math.max(-NEIGHBORHOOD_SIZE, Math.min(NEIGHBORHOOD_SIZE - 1, v));
}

function updatePlayerPosition() {
  // center the player in the tile (use +0.5 to get tile center)
  const lat = CLASSROOM_LATLNG.lat + (playerTileI + 0.5) * TILE_DEGREES;
  const lng = CLASSROOM_LATLNG.lng + (playerTileJ + 0.5) * TILE_DEGREES;
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
}

// initialize status and marker position
statusPanelDiv.innerHTML = "No points yet...";
updatePlayerPosition();

// Add caches to the map by cell numbers
function spawnCache(i: number, j: number) {
  // Convert cell numbers into lat/lng bounds
  const origin = CLASSROOM_LATLNG;
  const bounds = leaflet.latLngBounds([
    [origin.lat + i * TILE_DEGREES, origin.lng + j * TILE_DEGREES],
    [origin.lat + (i + 1) * TILE_DEGREES, origin.lng + (j + 1) * TILE_DEGREES],
  ]);

  // Add a rectangle to the map to represent the cache
  const rect = leaflet.rectangle(bounds);
  rect.addTo(map);

  // Each cache has a random point value, mutable by the player
  let pointValue = Math.floor(luck([i, j, "initialValue"].toString()) * 2);

  // Show the current point value on the rectangle
  rect.bindTooltip(pointValue.toString(), {
    permanent: true,
    direction: "center",
    className: "cacheLabel",
  });

  // Handle interactions with the cache
  rect.bindPopup(() => {
    // The popup offers a description and button
    const popupDiv = document.createElement("div");
    popupDiv.innerHTML = `
                <div>There is a cache here at "${i},${j}". It has value <span id="value">${pointValue}</span>.</div>
                <button id="poke">poke</button>`;

    const pokeButton = popupDiv.querySelector<HTMLButtonElement>("#poke")!;
    const valueSpan = popupDiv.querySelector<HTMLSpanElement>("#value")!;

    // Clicking the button decrements the cache's value and increments the player's points
    pokeButton.addEventListener("click", () => {
      pointValue--;
      valueSpan.innerHTML = pointValue.toString();

      rect.getTooltip()?.setContent(pointValue.toString());
      if (pointValue <= 0) {
        pokeButton.disabled = true;
      }
      playerPoints++;
      statusPanelDiv.innerHTML = `${playerPoints} points accumulated`;
    });

    return popupDiv;
  });
}

// Look around the player's neighborhood for caches to spawn
for (let i = -NEIGHBORHOOD_SIZE; i < NEIGHBORHOOD_SIZE; i++) {
  for (let j = -NEIGHBORHOOD_SIZE; j < NEIGHBORHOOD_SIZE; j++) {
    // If location i,j is lucky enough, spawn a cache!
    if (luck([i, j].toString()) < CACHE_SPAWN_PROBABILITY) {
      spawnCache(i, j);
    }
  }
}
