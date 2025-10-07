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
  const idx = systemsState.findIndex((s) => s?.name?.toLowerCase() === "sol");
  if (idx >= 0) {
    systemsState[idx].name = "Sol";
    systemsState[idx].coords = { x: 0, y: 0, z: 0 };
    systemsState[idx].cat = [3];
    systemsState[idx].catName = "Sol";
    systemsState[idx].infos = systemsState[idx].infos || "";
  } else {
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

  const seen = new Set();
  const systems = [];
  for (const s of systemsState) {
    if (!s || !s.name || !hasFiniteCoords(s)) continue;
    const key = s.name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    systems.push({
      name: s.name,
      coords: { x: +s.coords.x, y: +s.coords.y, z: +s.coords.z },
      cat: [Array.isArray(s.cat) && s.cat.length ? +s.cat[0] : 1],
      infos: typeof s.infos === "string" ? s.infos : "",
    });
  }

  const categories = { Sources: {} };
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
  let hasSearchedCategory = false;

  for (const s of systemsState) {
    if (!s || !Array.isArray(s.cat) || !s.cat.length) continue;
    const idNum = +s.cat[0];
    const id = String(idNum);

    if (idNum === 3) continue;
    if (idNum === 4) {
      hasSearchedCategory = true;
      continue;
    }

    if (!categories.Sources[id]) {
      const label = s.catName || `Category ${id}`;
      const color = palette[idNum % palette.length];
      categories.Sources[id] = { name: label, color };
    }
  }

  categories.Sources["3"] = { name: "Sol", color: "BBBBBB" };
  if (hasSearchedCategory)
    categories.Sources["4"] = { name: "Searched", color: "F7A14F" };

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
      setStatus("Choose a .txt or .csv file first.");
      return;
    }

    const catId = nextFileCatId++;
    const catName = f.name || `File ${catId}`;

    try {
      setStatus(`Reading ${catName}…`);
      const text = await edsmLoader.readFileAsText(f);
      const names = edsmLoader.extractNamesFromText(f.name, text);
      if (!names.length) {
        setStatus(`No system names found in ${catName}.`);
        return;
      }

      setStatus(
        `Querying EDSM for ${names.length} ${
          names.length === 1 ? "system" : "systems"
        }…`
      );
      const results = await edsmLoader.fetchSystemsFromEDSM(names, {}, (m) =>
        setStatus(m)
      );
      const batch = edsmLoader.toEd3dSystems(results);

      const existing = new Set(systemsState.map((s) => s.name.toLowerCase()));
      let addedCount = 0;
      for (const o of batch) {
        if (!o || !o.name || !hasFiniteCoords(o)) continue;
        const key = o.name.toLowerCase();
        if (existing.has(key)) continue;
        existing.add(key);
        systemsState.push({
          name: o.name,
          coords: { x: +o.coords.x, y: +o.coords.y, z: +o.coords.z },
          cat: [catId],
          catName,
          infos: typeof o.infos === "string" ? o.infos : "",
        });
        addedCount++;
      }

      const com = getCenterOfMass();
      pendingCenterLabel = null;
      setStatus(
        `Imported ${addedCount} ${
          addedCount === 1 ? "system" : "systems"
        } from ${catName}. Centering & rendering…`
      );
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
    if (data.centered && pendingCenterLabel) {
      setStatus(
        `Centered on ${pendingCenterLabel}. Rendered ${data.systems} ${
          data.systems === 1 ? "system" : "systems"
        }.`
      );
      pendingCenterLabel = null;
    } else {
      setStatus(
        `Rendered ${data.systems} ${data.systems === 1 ? "system" : "systems"}.`
      );
    }
  }
});

plot(getCenterOfMass());
