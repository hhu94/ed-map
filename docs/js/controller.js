// --- Shared CSV import logic ---
async function importCsvText(text, catNameBase, catIdBase) {
  let addedCount = 0;
  let catNameToId = {};
  let systems = [];
  // Parse CSV
  const lines = text.split(/\r?\n/g).filter(Boolean);
  let hasHeader = false;
  if (lines.length && /name|system/i.test(lines[0])) hasHeader = true;
  for (let i = hasHeader ? 1 : 0; i < lines.length; i++) {
    const row = lines[i];
    const cols = row.split(/,(?=(?:[^"]*\"[^"]*\")*[^"]*$)/);
    if (cols.length < 1) continue;
    const name = (cols[0] || "").replace(/(^[\"']|[\"']$)/g, "").trim();
    if (!name) continue;
    let catId = catIdBase,
      catName = catNameBase;
    if (cols.length >= 2) {
      parsedCatName = cols[1].trim();
      if (parsedCatName) {
        catName = `${parsedCatName} (${catNameBase})`;
      }
      if (catNameToId[catName] === undefined) {
        catNameToId[catName] = nextFileCatId++;
      }
      catId = catNameToId[catName];
    }
    // Parse manual coordinates if present (cols 2,3,4)
    let coords = undefined;
    if (cols.length >= 5) {
      const x = parseFloat(cols[2]);
      const y = parseFloat(cols[3]);
      const z = parseFloat(cols[4]);
      if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)) {
        coords = { x, y, z };
      }
    }
    systems.push(
      coords
        ? { name, cat: [catId], catName, coords }
        : { name, cat: [catId], catName }
    );
  }
  // Query EDSM only for systems without manual coordinates
  const needCoords = systems.filter((s) => !s.coords);
  if (needCoords.length) {
    setStatus(`Querying EDSM for ${needCoords.length} systems…`);
    const names = needCoords.map((s) => s.name);
    const results = await edsmLoader.fetchSystemsFromEDSM(names, {}, (m) =>
      setStatus(m)
    );
    const batch = edsmLoader.toEd3dSystems(results);
    for (const o of batch) {
      const idx = systems.findIndex(
        (s) => !s.coords && s.name.toLowerCase() === o.name.toLowerCase()
      );
      if (idx >= 0 && o && o.name && hasFiniteCoords(o)) {
        systems[idx].coords = {
          x: +o.coords.x,
          y: +o.coords.y,
          z: +o.coords.z,
        };
        systems[idx].infos = o.infos;
        addedCount++;
      }
    }
  } else {
    // All systems had manual coordinates
    addedCount = systems.length;
  }
  // Add to global state (dedup by name)
  const existing = new Set(systemsState.map((s) => s.name.toLowerCase()));
  for (const s of systems) {
    if (!s.name) continue;
    const key = s.name.toLowerCase();
    if (existing.has(key)) continue;
    existing.add(key);
    systemsState.push(s);
  }
  // Return both addedCount and number of systems with missing coords
  const missingCoords = systems.filter((s) => !hasFiniteCoords(s)).length;
  return { addedCount, missingCoords };
}
const $status = document.getElementById("status");

let systemsState = []; // [{ name, coords:{x,y,z}, cat:[id], catName:string, infos:"" }]
let nextFileCatId = 10;
let pendingCenterLabel = null; // set when centering on a specific named system

function setStatus(msg) {
  $status.textContent = msg;
}

function hasFiniteCoords(s) {
  return (
    s &&
    s.coords &&
    Number.isFinite(+s.coords.x) &&
    Number.isFinite(+s.coords.y) &&
    Number.isFinite(+s.coords.z)
  );
}

// Ensure Sol is always present at (0,0,0)
// ed3d doesn't allow clicking on systems until there are at least 2 systems, so Sol helps avoid unclickable single-system states
function ensureSolAnchor() {
  // Always ensure Sol is present
  if (!systemsState.some((s) => s.name && s.name.toLowerCase() === "sol")) {
    systemsState.push({
      name: "Sol",
      coords: { x: 0, y: 0, z: 0 },
      cat: [3],
      catName: "Sol",
      infos: "",
    });
  }
}

function buildPayload() {
  ensureSolAnchor();

  const palette = [
    "4FC3F7",
    "A1887F",
    "81C784",
    "CE93D8",
    "FFB74D",
    "64B5F6",
    "E57373",
    "9575CD",
    "4DB6AC",
    "F06292",
  ];
  const categories = { Sources: {} };
  let hasSearchedCategory = false;
  const catIdToName = {};
  for (const s of systemsState) {
    if (!s || !Array.isArray(s.cat) || !s.cat.length) continue;
    const idNum = parseInt(s.cat[0], 10);
    if (isNaN(idNum)) continue;
    if (idNum === 3) continue;
    if (idNum === 4) {
      hasSearchedCategory = true;
      continue;
    }
    if (!catIdToName[idNum])
      catIdToName[idNum] = s.catName || `Category ${idNum}`;
  }
  // Now add categories to the legend
  Object.entries(catIdToName).forEach(([id, label], idx) => {
    if (!categories.Sources[id]) {
      const color = palette[idx % palette.length];
      categories.Sources[id] = { name: label, color };
    }
  });

  // Add Sol and Searched
  categories.Sources["3"] = { name: "Sol", color: "BBBBBB" };
  if (hasSearchedCategory)
    categories.Sources["4"] = { name: "Searched", color: "F7A14F" };

  // Return all systems (with valid coords)
  const systems = systemsState.filter(hasFiniteCoords);
  return { systems, categories };
}

function getCenterOfMass() {
  let sx = 0,
    sy = 0,
    sz = 0,
    n = 0;
  for (const s of systemsState) {
    if (!hasFiniteCoords(s)) continue;
    const catId = Array.isArray(s.cat) && s.cat.length ? +s.cat[0] : 1;
    if (catId === 3) continue;
    sx += +s.coords.x;
    sy += +s.coords.y;
    sz += +s.coords.z;
    n++;
  }
  if (n === 0) return null;
  return [sx / n, sy / n, sz / n];
}

function createFreshFrameAndBootstrap(payload, playerPos) {
  const old = document.getElementById("mapFrame");
  const fresh = old.cloneNode(false);
  fresh.id = "mapFrame";
  fresh.src = "frame.html?ts=" + Date.now();
  old.parentNode.replaceChild(fresh, old);

  fresh.addEventListener("load", () => {
    fresh.contentWindow.postMessage(
      {
        type: "bootstrap",
        payload,
        playerPos:
          Array.isArray(playerPos) && playerPos.length === 3 ? playerPos : null,
      },
      "*"
    );
  });
}

function plot(playerPos) {
  const payload = buildPayload();
  createFreshFrameAndBootstrap(payload, playerPos || null);
}

document
  .getElementById("fileInput")
  .addEventListener("change", async (event) => {
    const fileEl = event.target;
    const f = fileEl.files[0];
    if (!f) {
      setStatus("Choose a .csv file first.");
      return;
    }

    const catIdBase = nextFileCatId++;
    const catNameBase = f.name || `File ${catIdBase}`;

    try {
      setStatus(`Reading ${catNameBase}…`);
      const text = await edsmLoader.readFileAsText(f);
      const isCsv = String(f.name).toLowerCase().endsWith(".csv");
      let importResult = { addedCount: 0, missingCoords: 0 };
      if (isCsv) {
        importResult = await importCsvText(text, catNameBase, catIdBase);
      }
      const com = getCenterOfMass();
      pendingCenterLabel = null;
      let msg = `Imported ${importResult.addedCount} systems from ${catNameBase}. Centering & rendering…`;
      const rendered = systemsState.filter(hasFiniteCoords).length;
      const missing = importResult.missingCoords;
      msg =
        `Rendered ${rendered} systems.` +
        (missing > 0
          ? ` Could not find coordinates for ${missing} system${
              missing === 1 ? "" : "s"
            }.`
          : "");
      setStatus(msg);
      plot(com);
    } catch (e) {
      console.error(e);
      setStatus("Error: " + (e?.message || String(e)));
    } finally {
      fileEl.value = "";
    }
  });

document.getElementById("clearAllBtn").addEventListener("click", () => {
  systemsState = [];
  pendingCenterLabel = null;
  plot(getCenterOfMass());
  setStatus("Cleared.");
});

async function searchSystemAndCenter() {
  const input = document.getElementById("searchInput");
  const qRaw = (input.value || "").trim();
  if (!qRaw) {
    setStatus("Type a system name to search.");
    return;
  }

  const q = qRaw.toLowerCase();

  let hit =
    systemsState.find((s) => s.name.toLowerCase() === q) ||
    systemsState.find((s) => s.name.toLowerCase().startsWith(q)) ||
    systemsState.find((s) => s.name.toLowerCase().includes(q));

  if (hit && hasFiniteCoords(hit)) {
    const label = hit.name;
    const playerPos = [+hit.coords.x, +hit.coords.y, +hit.coords.z];
    pendingCenterLabel = label;
    setStatus(`Centering via playerPos: ${label} …`);
    plot(playerPos);
    return;
  }

  try {
    setStatus(`Not in memory. Querying EDSM for "${qRaw}"…`);
    const results = await edsmLoader.fetchSystemsFromEDSM([qRaw], {}, (m) =>
      setStatus(m)
    );
    const got = edsmLoader
      .toEd3dSystems(results)
      .find((o) => o && o.name && hasFiniteCoords(o));
    if (!got) {
      setStatus(`System "${qRaw}" not found on EDSM or has no coordinates.`);
      return;
    }

    if (
      !systemsState.some((s) => s.name.toLowerCase() === got.name.toLowerCase())
    ) {
      systemsState.push({
        name: got.name,
        coords: { x: +got.coords.x, y: +got.coords.y, z: +got.coords.z },
        cat: [4],
        catName: "Searched",
        infos: typeof got.infos === "string" ? got.infos : "",
      });
    }

    // center
    const label = got.name;
    const playerPos = [+got.coords.x, +got.coords.y, +got.coords.z];
    pendingCenterLabel = label;
    setStatus(`Centering via playerPos: ${label} …`);
    plot(playerPos);
  } catch (e) {
    console.error(e);
    setStatus("Error querying EDSM: " + (e?.message || String(e)));
  }
}

document
  .getElementById("searchBtn")
  .addEventListener("click", searchSystemAndCenter);
document.getElementById("searchInput").addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    searchSystemAndCenter();
  }
});

window.addEventListener("message", (ev) => {
  const data = ev.data || {};
  if (data.type === "ed3d-bootstrapped") {
    // Find systems missing coordinates
    const missingSystems = systemsState.filter((s) => !hasFiniteCoords(s));
    const missing = missingSystems.length;
    let msg;
    if (data.centered && pendingCenterLabel) {
      msg = `Centered on ${pendingCenterLabel}. Rendered ${data.systems} ${
        data.systems === 1 ? "system" : "systems"
      }.`;
      pendingCenterLabel = null;
    } else {
      msg = `Rendered ${data.systems} ${
        data.systems === 1 ? "system" : "systems"
      }.`;
    }
    let tooltip = "";
    if (missing > 0) {
      msg += ` <span id='missing-coords-msg'>Could not find coordinates for ${missing} system${
        missing === 1 ? "" : "s"
      }.</span>`;
      // Build tooltip with missing system names
      tooltip = missingSystems
        .map((s) => s.name)
        .filter(Boolean)
        .join(", ");
    }
    $status.innerHTML = msg;
    // Set tooltip if needed
    if (missing > 0) {
      const el = document.getElementById("missing-coords-msg");
      if (el) el.title = tooltip;
    }
  }
});

// --- Auto-load CSV from ?load=FILENAME.csv query param ---
async function tryAutoLoadCsvFromQuery() {
  const params = new URLSearchParams(window.location.search);
  const csvFile = params.get("load");
  if (csvFile && /^[\w\-.]+\.csv$/i.test(csvFile)) {
    setStatus(`Loading CSV: ${csvFile}…`);
    try {
      // Only allow files from system-sets directory
      const url = `system-sets/${csvFile}`;
      const resp = await fetch(url);
      if (!resp.ok) throw new Error(`Failed to fetch ${csvFile}`);
      const text = await resp.text();
      const catIdBase = nextFileCatId++;
      const catNameBase = csvFile;
      const importResult = await importCsvText(text, catNameBase, catIdBase);
      const com = getCenterOfMass();
      pendingCenterLabel = null;
      let msg = `Imported ${importResult.addedCount} systems from ${catNameBase}. Centering & rendering…`;
      const rendered = systemsState.filter(hasFiniteCoords).length;
      const missing = importResult.missingCoords;
      msg =
        `Rendered ${rendered} systems.` +
        (missing > 0
          ? ` Could not find coordinates for ${missing} system${
              missing === 1 ? "" : "s"
            }.`
          : "");
      setStatus(msg);
      plot(com);
    } catch (e) {
      console.error(e);
      setStatus("Error loading CSV: " + (e?.message || String(e)));
    }
    return true;
  }
  return false;
}

(async () => {
  if (!(await tryAutoLoadCsvFromQuery())) {
    plot(getCenterOfMass());
  }
})();
