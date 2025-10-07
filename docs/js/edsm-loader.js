// js/edsm-loader.js
(function (global) {
  "use strict";

  const EDSM_ENDPOINT = "https://www.edsm.net/api-v1/systems";
  const INARA_BASE = "https://inara.cz/elite/starsystem/?search=";
  const SPANSH_SEARCH_BASE = "https://spansh.co.uk/search/";
  const RAVEN_COLONIAL_BASE = "https://ravencolonial.com/#sys=";

  async function readFileAsText(file) {
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onerror = () => reject(fr.error || new Error("Failed to read file"));
      fr.onload = () => resolve(String(fr.result || ""));
      fr.readAsText(file);
    });
  }

  function parseSystemNames(text) {
    return String(text || "")
      .split(/\r?\n/g)
      .map((s) => s.trim())
      .filter(Boolean);
  }

  function _stripQuotes(s) {
    if (s == null) return "";
    s = String(s).trim();
    if (s.startsWith('"') && s.endsWith('"'))
      return s.slice(1, -1).replace(/""/g, '"').trim();
    if (s.startsWith("'") && s.endsWith("'")) return s.slice(1, -1).trim();
    return s;
  }

  function _splitCsvRow(row) {
    row = String(row ?? "");
    const hasComma = row.indexOf(",") !== -1;
    const hasSemi = row.indexOf(";") !== -1;
    const splitter = hasComma
      ? /,(?=(?:[^"]*"[^"]*")*[^"]*$)/
      : hasSemi
      ? /;(?=(?:[^"]*"[^"]*")*[^"]*$)/
      : /,(?=(?:[^"]*"[^"]*")*[^"]*$)/;
    return row.split(splitter);
  }

  function parseSystemNamesFromCSV(text) {
    const lines = String(text || "").split(/\r?\n/g);
    const names = [];
    for (let i = 0; i < lines.length; i++) {
      const raw = lines[i].trim();
      if (!raw) continue;
      const cols = _splitCsvRow(raw);
      if (!cols.length) continue;
      const first = _stripQuotes(cols[0]).trim();
      if (!first) continue;
      if (i === 0 && /^(name|system|system\s*name)$/i.test(first)) continue;
      names.push(first);
    }
    const seen = new Set();
    return names.filter((n) => n && !seen.has(n) && seen.add(n));
  }

  function extractNamesFromText(filename, text) {
    const lower = String(filename || "").toLowerCase();
    return lower.endsWith(".csv")
      ? parseSystemNamesFromCSV(text)
      : parseSystemNames(text);
  }

  function chunk(arr, size) {
    const out = [];
    for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
    return out;
  }

  function buildBody(names) {
    const params = new URLSearchParams();
    for (const n of names) params.append("systemName[]", n);
    params.set("showCoordinates", "1");
    return params;
  }

  async function fetchBatch(names) {
    const res = await fetch(EDSM_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: buildBody(names),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(
        `EDSM request failed (${res.status}): ${text || res.statusText}`
      );
    }
    return res.json();
  }

  async function fetchSystemsFromEDSM(allNames, _options = {}, onProgress) {
    const BATCH = 100,
      pause = (ms) => new Promise((r) => setTimeout(r, ms));
    const groups = chunk(allNames, BATCH);
    const results = [];
    for (let i = 0; i < groups.length; i++) {
      const g = groups[i];
      onProgress &&
        onProgress(
          `Fetching ${i + 1}/${groups.length} (${g.length} ${
            g.length === 1 ? "name" : "names"
          })…`
        );
      const json = await fetchBatch(g);
      if (Array.isArray(json)) results.push(...json);
      await pause(200);
    }
    onProgress &&
      onProgress(
        `Fetched ${results.length} ${
          results.length === 1 ? "record" : "records"
        }.`
      );
    return results;
  }

  function toEd3dSystems(edsmSystems) {
    const out = [];
    for (const s of edsmSystems) {
      if (!s || !s.coords) continue;

      const nameEnc = encodeURIComponent(s.name);
      const inaraUrl = INARA_BASE + nameEnc;
      const spanshUrl = SPANSH_SEARCH_BASE + nameEnc;
      const ravenUrl = RAVEN_COLONIAL_BASE + nameEnc;

      const btn = (href, label) =>
        `<a href="${href}" target="_blank" rel="noopener" ` +
        `style="display:inline-block;margin:6px 6px 0 0;padding:6px 10px;` +
        `border-radius:8px;background:#1e2a38;color:#e6eef7;border:1px solid #355;` +
        `text-decoration:none;font-size:12px;line-height:1.1;">${label}</a>`;

      const infosHtml =
        `<div class="links">` +
        btn(inaraUrl, "Inara") +
        btn(spanshUrl, "Spansh") +
        btn(ravenUrl, "Raven Colonial") +
        `</div>`;

      out.push({
        name: s.name,
        coords: { x: +s.coords.x, y: +s.coords.y, z: +s.coords.z },
        infos: infosHtml,
      });
    }
    return out;
  }

  global.edsmLoader = {
    readFileAsText,
    parseSystemNames,
    parseSystemNamesFromCSV,
    extractNamesFromText,
    fetchSystemsFromEDSM,
    toEd3dSystems,
  };
})(window);
