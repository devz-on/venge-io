// ==UserScript==
// @name         Venge.io Internal Testing Client — Improved ESP & Mini-map
// @version      2.6
// @description  ESP improvements: screen-space boxes, mini-map with player marker, crosshair, toggleable modes. Authorized test use only.
// @match        https://venge.io/*
// @grant        none
// @run-at       document-end
// ==/UserScript==

(function () {
  'use strict';

  /* --------------------------------------------------------------------------
     CONFIG & HELPERS
     -------------------------------------------------------------------------- */
  function waitFor(conditionFn, timeoutMs = 15000, intervalMs = 150) {
    return new Promise((resolve, reject) => {
      const start = Date.now();
      const iv = setInterval(() => {
        try {
          if (conditionFn()) {
            clearInterval(iv);
            resolve();
          } else if (Date.now() - start > timeoutMs) {
            clearInterval(iv);
            reject(new Error('waitFor timeout'));
          }
        } catch (err) {
          clearInterval(iv);
          reject(err);
        }
      }, intervalMs);
    });
  }

  /* --------------------------------------------------------------------------
     MAIN CLASS
     -------------------------------------------------------------------------- */
  class VengeHack {
    constructor() {
      this.settings = {
        esp: true,
        mapView: false,       // toggle mini-map (top-down) vs screen ESP
        showMeOnMap: true,    // show local player on mini-map
        showLines: true,      // draw lines from player to targets on screen
        aimbot: false,
        autokill: false,
        aimbotFov: 40,
        aimSmoothing: 0.35
      };

      this.hooks = {
        pc: null,
        movement: null,
        network: null,
        cameraEntity: null
      };

      this.overlay = null;
      this.octx = null;
      this.mapCanvas = null;      // mini-map canvas (optional)
      this.mapCtx = null;

      this.localPlayerId = null;
      this._lastTargetId = null;

      window._vengeHack = this;
      this.init();
    }

    async init() {
      // wait for canvas or timeout (non-fatal)
      await waitFor(() => !!document.querySelector('canvas'), 15000).catch(() => {});

      // try to capture pc.app (playcanvas)
      try { await waitFor(() => typeof pc !== 'undefined' && !!pc.app, 15000); this.hooks.pc = pc; } catch(e){}

      // try to capture Movement & NetworkManager if present
      try { await waitFor(() => typeof Movement !== 'undefined' && typeof NetworkManager !== 'undefined', 15000); } catch(e){}

      this.createUI();
      this.createOverlay();
      this.createMiniMap();

      this.setupHooks();
      this.loop();
      console.log('[VengeHack] Initialized improved ESP & map');
    }

    /* ----------------- UI ----------------- */
    createUI() {
      const existing = document.getElementById('vh-ui-v2');
      if (existing) existing.remove();

      const ui = document.createElement('div');
      ui.id = 'vh-ui-v2';
      ui.style.cssText = `
        position: fixed;
        right: 12px;
        top: 12px;
        z-index: 9999999;
        background: rgba(6,6,8,0.86);
        color: #dfe;
        padding: 10px;
        border-radius: 8px;
        font-family: Arial, sans-serif;
        font-size: 13px;
        min-width: 180px;
        box-shadow: 0 6px 20px rgba(0,0,0,0.6);
      `;
      ui.innerHTML = `
        <div style="font-weight:700;margin-bottom:6px">Venge Tools — ESP</div>
        <label style="display:block;margin:4px 0"><input type="checkbox" id="vh-esp" /> ESP (screen)</label>
        <label style="display:block;margin:4px 0"><input type="checkbox" id="vh-map" /> Mini-map (top-down)</label>
        <label style="display:block;margin:4px 0"><input type="checkbox" id="vh-me" /> Show Me on Map</label>
        <label style="display:block;margin:4px 0"><input type="checkbox" id="vh-lines" /> Lines to targets</label>
        <div style="margin-top:6px">
          <label style="font-size:12px;color:#bcd">Aimbot <input id="vh-aim" type="checkbox" /></label>
        </div>
        <div style="margin-top:6px;font-size:12px;color:#bcd">FOV <input id="vh-fov" type="range" min="10" max="120" value="${this.settings.aimbotFov}" style="width:90px"> <span id="vh-fov-val">${this.settings.aimbotFov}</span>°</div>
        <div style="margin-top:6px;font-size:12px;color:#bcd">Smoothing <input id="vh-smooth" type="range" min="0" max="100" value="${Math.round(this.settings.aimSmoothing*100)}" style="width:90px"> <span id="vh-smooth-val">${Math.round(this.settings.aimSmoothing*100)}%</span></div>
        <div style="margin-top:8px"><button id="vh-status">Status → Console</button></div>
      `;
      document.body.appendChild(ui);

      // elements
      const elEsp = document.getElementById('vh-esp');
      const elMap = document.getElementById('vh-map');
      const elMe = document.getElementById('vh-me');
      const elLines = document.getElementById('vh-lines');
      const elAim = document.getElementById('vh-aim');
      const elFov = document.getElementById('vh-fov');
      const elFovVal = document.getElementById('vh-fov-val');
      const elSmooth = document.getElementById('vh-smooth');
      const elSmoothVal = document.getElementById('vh-smooth-val');
      const elStatus = document.getElementById('vh-status');

      elEsp.checked = this.settings.esp;
      elMap.checked = this.settings.mapView;
      elMe.checked = this.settings.showMeOnMap;
      elLines.checked = this.settings.showLines;
      elAim.checked = this.settings.aimbot;

      elEsp.addEventListener('change', e => this.settings.esp = e.target.checked);
      elMap.addEventListener('change', e => this.settings.mapView = e.target.checked);
      elMe.addEventListener('change', e => this.settings.showMeOnMap = e.target.checked);
      elLines.addEventListener('change', e => this.settings.showLines = e.target.checked);
      elAim.addEventListener('change', e => this.settings.aimbot = e.target.checked);
      elFov.addEventListener('input', e => { this.settings.aimbotFov = Number(e.target.value); elFovVal.textContent = e.target.value; });
      elSmooth.addEventListener('input', e => { this.settings.aimSmoothing = Number(e.target.value) / 100; elSmoothVal.textContent = `${e.target.value}%`; });

      elStatus.addEventListener('click', () => {
        console.log('[VengeHack] STATUS', {
          settings: this.settings,
          hooks: {
            pc: !!this.hooks.pc,
            movement: !!this.hooks.movement,
            network: !!this.hooks.network,
            camera: !!this.hooks.cameraEntity
          },
          localPlayerId: this.localPlayerId
        });
        alert('Status printed to console');
      });
    }

    /* ----------------- Overlay (screen ESP) ----------------- */
    createOverlay() {
      const parentCanvas = document.querySelector('canvas');
      if (!parentCanvas) { console.warn('[VengeHack] game canvas not found for overlay'); return; }

      // remove old
      const old = document.getElementById('vh-overlay');
      if (old && old.parentElement) old.parentElement.removeChild(old);

      // overlay sits inside game canvas parent, covers full canvas
      const overlay = document.createElement('canvas');
      overlay.id = 'vh-overlay';
      overlay.style.position = 'absolute';
      overlay.style.left = '0';
      overlay.style.top = '0';
      overlay.style.width = '100%';
      overlay.style.height = '100%';
      overlay.style.pointerEvents = 'none';
      overlay.style.zIndex = 9999998;

      // ensure parent positioned
      parentCanvas.parentElement.style.position = 'relative';
      parentCanvas.parentElement.appendChild(overlay);

      // match initial size
      overlay.width = parentCanvas.width;
      overlay.height = parentCanvas.height;

      this.overlay = overlay;
      this.octx = overlay.getContext('2d');
      this.octx.font = '12px Arial';
      this.octx.textBaseline = 'top';
      console.log('[VengeHack] screen overlay created');
    }

    resizeOverlayIfNeeded() {
      try {
        const canvas = document.querySelector('canvas');
        if (!canvas || !this.overlay) return;
        const w = canvas.width, h = canvas.height;
        if (this.overlay.width !== w || this.overlay.height !== h) {
          this.overlay.width = w; this.overlay.height = h;
        }
      } catch (e) {}
    }

    /* ----------------- Mini-map (top-down) ----------------- */
    createMiniMap() {
      // small map at bottom-left corner
      const existing = document.getElementById('vh-map-canvas');
      if (existing) existing.remove();

      const map = document.createElement('canvas');
      map.id = 'vh-map-canvas';
      map.width = 240;
      map.height = 240;
      map.style.position = 'fixed';
      map.style.left = '12px';
      map.style.bottom = '12px';
      map.style.zIndex = 9999999;
      map.style.background = 'rgba(0,0,0,0.45)';
      map.style.border = '1px solid rgba(255,255,255,0.08)';
      map.style.borderRadius = '6px';
      map.style.pointerEvents = 'none';

      document.body.appendChild(map);
      this.mapCanvas = map;
      this.mapCtx = map.getContext('2d');
      this.mapCtx.font = '11px Arial';
      console.log('[VengeHack] mini-map created');
    }

    /* ----------------- Hooking Movement & Network ----------------- */
    setupHooks() {
      const hack = this;

      // Movement hook: capture movement instance & local player id
      if (typeof Movement !== 'undefined' && Movement.prototype && Movement.prototype.update) {
        const orig = Movement.prototype.update;
        Movement.prototype.update = function (dt) {
          try {
            if (!hack.hooks.movement) {
              hack.hooks.movement = this;
              // attempt to get camera entity reference
              try {
                hack.hooks.cameraEntity = this.currentCamera || (hack.hooks.pc && hack.hooks.pc.app && hack.hooks.pc.app.root && hack.hooks.pc.app.root.findByName && hack.hooks.pc.app.root.findByName('Camera'));
              } catch (e) {}
              console.log('[VengeHack] movement hooked, cameraEntity?', !!hack.hooks.cameraEntity);
            }
            // try to capture local player id
            try { if (!hack.localPlayerId && this.player && this.player.id) hack.localPlayerId = this.player.id; } catch (e){}

            // call original update
            const ret = orig.call(this, dt);

            // run aimbot tick after update (positions updated)
            try { hack.tickAimbot(); } catch (e) {}

            return ret;
          } catch (err) {
            return orig.call(this, dt);
          }
        };
        console.log('[VengeHack] Movement.prototype.update wrapped');
      } else {
        console.warn('[VengeHack] Movement not found — movement hook skipped');
      }

      // NetworkManager hook: capture network instance, players
      if (typeof NetworkManager !== 'undefined' && NetworkManager.prototype) {
        const origInit = NetworkManager.prototype.initialize || function () { };
        const hackRef = this;
        NetworkManager.prototype.initialize = function () {
          try {
            hackRef.hooks.network = this;
            try { hackRef.localPlayerId = this.player?.id || hackRef.localPlayerId; } catch (e) {}
            console.log('[VengeHack] NetworkManager initialized (hooked)');
          } catch (e) {}
          return origInit.apply(this, arguments);
        };

        // wrap respawn for optional autokill behaviour
        if (NetworkManager.prototype.respawn) {
          const origRespawn = NetworkManager.prototype.respawn;
          NetworkManager.prototype.respawn = function (e) {
            try {
              const rv = origRespawn.call(this, e);
              // If autokill on, attempt quick kill attempt for first respawned id array
              if (hackRef.settings.autokill && Array.isArray(e) && e.length) {
                const tid = e[0];
                const pl = hackRef.getPlayerByIdSafe(tid);
                if (pl && pl.position) {
                  setTimeout(() => {
                    try { this.send && this.send(["da", tid, 100, 1, pl.position.x, pl.position.y, pl.position.z]); } catch (err) {}
                  }, 1200);
                }
              }
              return rv;
            } catch (err) { return origRespawn.apply(this, arguments); }
          };
        }

        console.log('[VengeHack] NetworkManager hooks applied');
      } else {
        console.warn('[VengeHack] NetworkManager not found');
      }
    }

    /* ----------------- Utilities: players safe access ----------------- */
    getPlayersSafe() {
      try {
        if (this.hooks.network && Array.isArray(this.hooks.network.players)) return this.hooks.network.players;
        if (window.game && window.game.networkManager && Array.isArray(window.game.networkManager.players)) return window.game.networkManager.players;
      } catch (e) {}
      return [];
    }
    getPlayerByIdSafe(id) {
      return this.getPlayersSafe().find(x => x && x.id === id) || null;
    }

    /* ----------------- Projection: world->screen ----------------- */
    worldToScreen(pos) {
      try {
        // try camera.worldToScreen if available
        const cam = this.hooks.cameraEntity;
        if (cam && typeof cam.worldToScreen === 'function' && this.hooks.pc) {
          const tmp = new this.hooks.pc.Vec3();
          cam.worldToScreen(pos, tmp);
          // returned tmp.x/tmp.y are pixel coordinates (PlayCanvas behavior) — return them
          return { x: tmp.x, y: tmp.y, z: tmp.z };
        }
      } catch (e) {}
      // fallback to rough mapping: center of canvas + pos offset (top-down style)
      const canvas = document.querySelector('canvas');
      if (!canvas) return null;
      return { x: canvas.width / 2 + (pos.x || 0), y: canvas.height / 2 - (pos.y || 0), z: 1 };
    }

    /* ----------------- Aimbot tick (called from Movement wrapper) ----------------- */
    tickAimbot() {
      try {
        if (!this.settings.aimbot) return;
        const mv = this.hooks.movement;
        const net = this.hooks.network;
        if (!mv) return;

        const players = this.getPlayersSafe();
        if (!players || players.length === 0) return;

        const myPos = (mv.entity && typeof mv.entity.getPosition === 'function') ? mv.entity.getPosition() : null;
        if (!myPos) return;

        // pick best candidate by screen distance (FOV)
        let best = null, bestScore = Infinity;
        const canvas = document.querySelector('canvas');
        if (!canvas) return;
        const cx = canvas.width / 2, cy = canvas.height / 2;

        for (const p of players) {
          if (!p || !p.position) continue;
          if (p.id && this.localPlayerId && p.id === this.localPlayerId) continue;
          if (p.isDeath) continue;
          if (p.health !== undefined && p.health <= 0) continue;

          const screen = this.worldToScreen(p.position);
          if (!screen || screen.z <= 0) continue;
          const pdx = screen.x - cx, pdy = screen.y - cy;
          const pixDist = Math.sqrt(pdx * pdx + pdy * pdy);

          // FOV mapping to pixel radius (heuristic)
          const maxPx = (this.settings.aimbotFov / 90) * (Math.min(canvas.width, canvas.height) / 2);
          if (pixDist > maxPx) continue;

          if (pixDist < bestScore) { bestScore = pixDist; best = { p, screen, pixDist }; }
        }

        if (!best) {
          // clear firing
          mv.leftMouse = false;
          return;
        }

        // apply aim smoothing toward the desired screen point
        const desiredX = best.screen.x, desiredY = best.screen.y;
        // convert to approximate look angles — this remains heuristic and may need tuning
        const desiredLookX = ((desiredX - (canvas.width / 2)) / canvas.height) * 180; // rough
        const desiredLookY = ((desiredY - (canvas.height / 2)) / canvas.height) * 180;

        const curLookX = typeof mv.lookX === 'number' ? mv.lookX : 0;
        const curLookY = typeof mv.lookY === 'number' ? mv.lookY : 0;
        const s = this.settings.aimSmoothing;
        mv.lookX = curLookX + (desiredLookX - curLookX) * s;
        mv.lookY = curLookY + (desiredLookY - curLookY) * s;

        mv.leftMouse = true;
        try { mv.setShooting && mv.setShooting(mv.lastDelta); } catch (e) {}

        // optional autokill: send damage packet when aimbot locked
        if (this.settings.autokill && net && typeof net.send === 'function') {
          try {
            const t = best.p;
            const pos = t.position || { x: 0, y: 0, z: 0 };
            net.send(["da", t.id, 100, 1, pos.x, pos.y, pos.z]);
          } catch (err) {}
        }

      } catch (e) {
        // swallow aimbot errors
      }
    }

    /* ----------------- Draw ESP: screen-space and mini-map ----------------- */
    drawESP() {
      try {
        // screen overlay
        if (this.overlay && this.octx) {
          this.resizeOverlayIfNeeded();
          const ctx = this.octx;
          ctx.clearRect(0, 0, this.overlay.width, this.overlay.height);

          // draw center crosshair
          if (this.settings.esp) {
            const w = this.overlay.width, h = this.overlay.height;
            ctx.save();
            ctx.strokeStyle = 'rgba(255,255,255,0.7)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(w / 2 - 8, h / 2);
            ctx.lineTo(w / 2 + 8, h / 2);
            ctx.moveTo(w / 2, h / 2 - 8);
            ctx.lineTo(w / 2, h / 2 + 8);
            ctx.stroke();
            ctx.restore();
          }

          // draw players in screen-space mode if mapView off
          if (this.settings.esp && !this.settings.mapView) {
            const players = this.getPlayersSafe();
            const canvas = document.querySelector('canvas');
            const cx = canvas ? canvas.width / 2 : (this.overlay.width / 2);
            const cy = canvas ? canvas.height / 2 : (this.overlay.height / 2);

            for (const p of players) {
              try {
                if (!p || !p.position) continue;
                if (p.id && this.localPlayerId && p.id === this.localPlayerId) continue;
                if (p.isDeath || (p.health !== undefined && p.health <= 0)) continue;

                const scr = this.worldToScreen(p.position);
                if (!scr || scr.z <= 0) continue;

                // box size scales roughly with distance (heuristic)
                const dist = this.hooks.movement && this.hooks.movement.entity ? this.calculateDistance(this.hooks.movement.entity.getPosition(), p.position) : 0;
                const scale = Math.max(0.6, 100 / (10 + (dist || 1)));
                const boxW = 40 * scale, boxH = 60 * scale;

                // draw box
                ctx.save();
                ctx.strokeStyle = 'rgba(255,0,0,0.95)';
                ctx.lineWidth = 2;
                ctx.strokeRect(scr.x - boxW / 2, scr.y - boxH / 2, boxW, boxH);

                // name + distance
                ctx.fillStyle = 'rgba(255,255,255,0.95)';
                ctx.font = '12px Arial';
                const name = p.name || `id:${p.id || '?'}`;
                const distText = (dist ? `${Math.round(dist)}m` : '');
                ctx.fillText(`${name} ${distText}`, scr.x - boxW / 2, scr.y - boxH / 2 - 14);

                // draw line to center if requested
                if (this.settings.showLines) {
                  ctx.beginPath();
                  ctx.strokeStyle = 'rgba(255,255,0,0.6)';
                  ctx.lineWidth = 1;
                  ctx.moveTo(cx, cy);
                  ctx.lineTo(scr.x, scr.y);
                  ctx.stroke();
                }

                ctx.restore();

              } catch (e) { /* per-target ignore */ }
            }
          }
        }

        // mini-map drawing
        if (this.mapCanvas && this.mapCtx) {
          const mctx = this.mapCtx;
          const W = this.mapCanvas.width, H = this.mapCanvas.height;
          mctx.clearRect(0, 0, W, H);

          // background and center cross
          mctx.fillStyle = 'rgba(12,12,14,0.45)';
          mctx.fillRect(0, 0, W, H);
          mctx.strokeStyle = 'rgba(255,255,255,0.06)';
          mctx.strokeRect(0, 0, W, H);

          // get players and local position
          const players = this.getPlayersSafe();
          const myEntity = this.hooks.movement && this.hooks.movement.entity && typeof this.hooks.movement.entity.getPosition === 'function' ? this.hooks.movement.entity.getPosition() : null;

          // mini-map scaling: choose radius (meters) to show around player
          const mapRadius = 100; // world units radius shown around center (tweak)
          const scale = (W / 2) / mapRadius; // world units -> pixels

          // draw local player at center
          if (this.settings.showMeOnMap && myEntity) {
            mctx.save();
            // small filled circle
            mctx.fillStyle = 'rgba(0,200,255,0.95)';
            mctx.beginPath();
            mctx.arc(W/2, H/2, 6, 0, Math.PI*2);
            mctx.fill();
            mctx.fillStyle = 'rgba(255,255,255,0.85)';
            mctx.font = '11px Arial';
            mctx.fillText('You', W/2 + 8, H/2 - 6);
            mctx.restore();
          }

          // draw enemies as top-down dots/rects relative to local player
          if (players && players.length) {
            for (const p of players) {
              try {
                if (!p || !p.position) continue;
                if (p.id && this.localPlayerId && p.id === this.localPlayerId) continue;
                if (p.isDeath || (p.health !== undefined && p.health <= 0)) continue;

                // if no local position, skip mini-map placement (can't compute relative)
                if (!myEntity) continue;

                const dx = (p.position.x || 0) - (myEntity.x || 0);
                const dz = (p.position.z || 0) - (myEntity.z || 0); // using z as forward/back
                // top-down Y is -z, X is x; tweak if your world axes differ
                const mapX = W/2 + dx * scale;
                const mapY = H/2 - dz * scale;

                // only draw if inside map radius
                if (Math.abs(dx) > mapRadius || Math.abs(dz) > mapRadius) continue;

                // color based on distance
                const dist = Math.round(Math.sqrt(dx*dx + dz*dz));
                const col = dist < 20 ? 'rgba(255,100,100,0.95)' : 'rgba(255,140,80,0.9)';

                mctx.save();
                mctx.fillStyle = col;
                // small rectangle oriented as top-down marker
                mctx.fillRect(mapX - 4, mapY - 4, 8, 8);

                // name and distance
                mctx.fillStyle = 'rgba(255,255,255,0.9)';
                mctx.font = '11px Arial';
                const label = (p.name || `id:${p.id || '?'}`) + ` ${dist}m`;
                mctx.fillText(label, mapX + 6, mapY - 7);
                mctx.restore();
              } catch (e) {}
            }
          }

          // optional map border/cross
          mctx.save();
          mctx.strokeStyle = 'rgba(255,255,255,0.06)';
          mctx.beginPath();
          mctx.moveTo(W/2, 0); mctx.lineTo(W/2, H);
          mctx.moveTo(0, H/2); mctx.lineTo(W, H/2);
          mctx.stroke();
          mctx.restore();

          // hide or show mini-map based on setting
          this.mapCanvas.style.display = this.settings.mapView ? 'block' : 'none';
        }

      } catch (e) {
        // suppress drawing errors
      }
    }

    /* ----------------- Main frame loop ----------------- */
    loop() {
      const frame = () => {
        try { this.drawESP(); } catch (e) {}
        requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
    }

    /* ----------------- Simple distance utility ----------------- */
    calculateDistance(a, b) {
      try {
        const dx = (a.x || 0) - (b.x || 0);
        const dy = (a.y || 0) - (b.y || 0);
        const dz = (a.z || 0) - (b.z || 0);
        return Math.sqrt(dx*dx + dy*dy + dz*dz);
      } catch (e) { return Infinity; }
    }
  }

  // Start
  try {
    new VengeHack();
  } catch (e) {
    console.error('VengeHack start failed', e);
  }

})();
