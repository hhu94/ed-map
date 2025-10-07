(function () {
  "use strict";

  let booted = false;

  function clearEd3dPersistedState() {
    try {
      for (const k in localStorage) {
        if (!Object.prototype.hasOwnProperty.call(localStorage, k)) continue;
        const key = String(k).toLowerCase();
        if (key.includes("ed3d")) localStorage.removeItem(k);
      }
    } catch {}
  }

  function startEd3dOnce(payload, playerPos) {
    if (booted) return;
    booted = true;

    if (!payload || !Array.isArray(payload.systems)) {
      payload = { systems: [], categories: {} };
    }

    clearEd3dPersistedState();

    const host = document.getElementById("edmap");
    if (host) host.innerHTML = "";

    const opts = {
      container: "edmap",
      json: payload,
      withOptionsPanel: true,
      withHudPanel: true,
      showNameNear: true,
      startAnim: false,
    };
    if (Array.isArray(playerPos) && playerPos.length === 3) {
      opts.playerPos = playerPos;
    }

    Ed3d.init(opts);

    try {
      parent &&
        parent.postMessage(
          {
            type: "ed3d-bootstrapped",
            centered: !!opts.playerPos,
            systems: Array.isArray(payload.systems)
              ? payload.systems.length
              : 0,
          },
          "*"
        );
    } catch {}
  }

  window.addEventListener("message", (ev) => {
    const data = ev.data || {};
    if (data.type === "bootstrap") {
      startEd3dOnce(data.payload, data.playerPos || null);
    }
  });
})();
