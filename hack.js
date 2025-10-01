// ==UserScript==
// @name         Venge.io Internal Testing Client (ESP + Aimbot + AutoKill)
// @version      2.5
// @description  Internal QA/testing userscript — ESP, aimbot, autokill. Authorized use only.
// @match        https://venge.io/*
// @grant        none
// @run-at       document-end
// ==/UserScript==

(function () {
  'use strict';

  /**************************************************************************
   * Helper waiters
   **************************************************************************/
  function waitFor(conditionFn, timeoutMs = 30000, intervalMs = 100) {
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

  /**************************************************************************
   * Main Hack Class
   **************************************************************************/
  class VengeHack {
    constructor() {
      this.settings = {
        esp: true,
        aimbot: false,
        autokill: false,
        aimbotMaxDist: 1000,
        aimbotFov: 40, // degrees
        aimSmoothing: 0.35, // 0..1, higher = snappier
      };

      this.hooks = {
        movement: null,
        network: null,
        pc: null,
        cameraEntity: null,
      };

      // overlay canvas for ESP (separate from game canvas)
      this.overlay = null;
      this.octx = null;

      // runtime state
      this.targets = []; // array of players
      this.localPlayerId = null;

      // expose instance for debug
      window._vengeHack = this;

      // boot
      this.init();
    }

    async init() {
      console.log('[VengeHack] init: waiting for DOM & PlayCanvas...');
      // wait DOM ready
      if (document.readyState !== 'complete') {
        await new Promise(r => window.addEventListener('load', r, { once: true }));
      }

      // wait for playcanvas "pc" and main app if possible (graceful)
      try {
        await waitFor(() => typeof pc !== 'undefined' && !!pc.app, 15000, 200);
        this.hooks.pc = pc;
        console.log('[VengeHack] playcanvas (pc) available');
      } catch (e) {
        // not fatal — we'll try to pick camera from movement later
        console.warn('[VengeHack] pc.app not found within timeout; will try fallbacks');
      }

      // wait for Movement and NetworkManager constructors to exist
      try {
        await waitFor(() => typeof Movement !== 'undefined' && typeof NetworkManager !== 'undefined', 20000, 200);
        console.log('[VengeHack] Movement & NetworkManager found');
      } catch (e) {
        console.warn('[VengeHack] Movement or NetworkManager not found in time — hooks may not apply.');
      }

      // create UI & overlay
      this.createUI();
      this.createOverlay();

      // attempt to setup hooks (they guard for undefined objects)
      this.setupHooks();
      // start render loop for ESP + aimbot tick
      this.loop();
    }

    /**************************************************************************
     * UI
     **************************************************************************/
    createUI() {
      // remove if exists
      const existing = document.getElementById('venge-hack-ui');
      if (existing) existing.remove();

      const ui = document.createElement('div');
      ui.id = 'venge-hack-ui';
      ui.style.cssText = `
        position: fixed;
        right: 12px;
        top: 12px;
        z-index: 9999999;
        background: rgba(10,10,10,0.8);
        color: #dfe;
        padding: 10px;
        border-radius: 6px;
        font-family: Arial, sans-serif;
        font-size: 13px;
        min-width: 160px;
        box-shadow: 0 4px 14px rgba(0,0,0,0.5);
      `;

      ui.innerHTML = `
        <div style="font-weight:700;margin-bottom:6px">Venge Test Tools</div>
        <label style="display:block;margin:4px 0"><input type="checkbox" id="vh-esp"> ESP</label>
        <label style="display:block;margin:4px 0"><input type="checkbox" id="vh-aim"> Aimbot</label>
        <label style="display:block;margin:4px 0"><input type="checkbox" id="vh-kill"> Auto-kill</label>
        <div style="margin-top:8px;font-size:12px;color:#bcd">Aimbot FOV <input id="vh-fov" type="range" min="10" max="120" value="${this.settings.aimbotFov}" style="width:70px"> <span id="vh-fov-val">${this.settings.aimbotFov}</span>°</div>
        <div style="margin-top:6px;font-size:12px;color:#bcd">Smoothing <input id="vh-smooth" type="range" min="0" max="100" value="${Math.round(this.settings.aimSmoothing*100)}" style="width:70px"> <span id="vh-smooth-val">${Math.round(this.settings.aimSmoothing*100)}%</span></div>
        <div style="margin-top:8px"><button id="vh-logs">Show Status</button></div>
      `;

      document.body.appendChild(ui);

      // init elements
      const espBox = document.getElementById('vh-esp');
      const aimBox = document.getElementById('vh-aim');
      const killBox = document.getElementById('vh-kill');
      const fovRange = document.getElementById('vh-fov');
      const fovVal = document.getElementById('vh-fov-val');
      const smoothRange = document.getElementById('vh-smooth');
      const smoothVal = document.getElementById('vh-smooth-val');
      const logsBtn = document.getElementById('vh-logs');

      // sync initial values
      espBox.checked = this.settings.esp;
      aimBox.checked = this.settings.aimbot;
      killBox.checked = this.settings.autokill;

      // attach listeners
      espBox.addEventListener('change', (e) => { this.settings.esp = e.target.checked; });
      aimBox.addEventListener('change', (e) => { this.settings.aimbot = e.target.checked; });
      killBox.addEventListener('change', (e) => { this.settings.autokill = e.target.checked; });

      fovRange.addEventListener('input', (e) => {
        const v = Number(e.target.value);
        this.settings.aimbotFov = v;
        fovVal.textContent = v;
      });

      smoothRange.addEventListener('input', (e) => {
        const p = Number(e.target.value) / 100;
        this.settings.aimSmoothing = p;
        smoothVal.textContent = `${Math.round(p * 100)}%`;
      });

      logsBtn.addEventListener('click', () => {
        console.log('[VengeHack] STATUS', {
          settings: this.settings,
          hooks: {
            pc: !!this.hooks.pc,
            movement: !!this.hooks.movement,
            network: !!this.hooks.network,
            cameraEntity: !!this.hooks.cameraEntity,
          },
          localPlayerId: this.localPlayerId
        });
        alert('Status printed to console');
      });
    }

    /**************************************************************************
     * Overlay (separate canvas on top of the game's canvas)
     **************************************************************************/
    createOverlay() {
      // remove old overlay if present
      const old = document.getElementById('venge-hack-overlay');
      if (old) old.remove();

      const gameCanvas = document.querySelector('canvas');
      if (!gameCanvas) {
        console.warn('[VengeHack] game canvas not found — overlay delayed');
        return;
      }

      const overlay = document.createElement('canvas');
      overlay.id = 'venge-hack-overlay';
      overlay.style.position = 'absolute';
      overlay.style.left = gameCanvas.style.left || gameCanvas.getBoundingClientRect().left + 'px';
      overlay.style.top = gameCanvas.style.top || gameCanvas.getBoundingClientRect().top + 'px';
      overlay.width = gameCanvas.width;
      overlay.height = gameCanvas.height;
      overlay.style.pointerEvents = 'none';
      overlay.style.zIndex = 9999998;
      overlay.style.mixBlendMode = 'normal';
      overlay.style.imageRendering = 'pixelated';

      // position overlay above the canvas element visually
      gameCanvas.parentElement.style.position = 'relative';
      overlay.style.left = '0';
      overlay.style.top = '0';
      overlay.style.width = '100%';
      overlay.style.height = '100%';

      gameCanvas.parentElement.appendChild(overlay);

      this.overlay = overlay;
      this.octx = overlay.getContext('2d');
      // choose font/line smoothing
      this.octx.font = '12px Arial';
      this.octx.textBaseline = 'top';
      console.log('[VengeHack] overlay created');
    }

    resizeOverlayIfNeeded() {
      try {
        const gameCanvas = document.querySelector('canvas');
        if (!gameCanvas || !this.overlay) return;
        const w = gameCanvas.width, h = gameCanvas.height;
        if (this.overlay.width !== w || this.overlay.height !== h) {
          this.overlay.width = w;
          this.overlay.height = h;
        }
      } catch (e) { /* ignore */ }
    }

    /**************************************************************************
     * Hooks into Movement & NetworkManager
     **************************************************************************/
    setupHooks() {
      // capture hack instance
      const hack = this;

      // Movement hook: wrap update to ensure we have movement instance and camera
      if (typeof Movement !== 'undefined' && Movement.prototype && Movement.prototype.update) {
        const originalUpdate = Movement.prototype.update;
        Movement.prototype.update = function (dt) {
          try {
            // first time setup for movement/camera references
            if (!hack.hooks.movement) {
              hack.hooks.movement = this;
              // try to find camera entity in movement or global pc.app
              try {
                hack.hooks.cameraEntity = this.currentCamera || (hack.hooks.pc && hack.hooks.pc.app && hack.hooks.pc.app.root && hack.hooks.pc.app.root.findByName && hack.hooks.pc.app.root.findByName('Camera'));
              } catch (err) { }
              console.log('[VengeHack] movement hooked, cameraEntity:', !!hack.hooks.cameraEntity);
            }

            // keep localPlayerId if movement has player id reference
            try {
              if (!hack.localPlayerId && this.player && this.player.id) hack.localPlayerId = this.player.id;
            } catch (e) { }

            // call original update
            const rv = originalUpdate.call(this, dt);

            // allow hack aimbot tick after original update to ensure positions are up-to-date
            try { hack.tickAimbot(); } catch (e) { /* don't break game */ }

            return rv;
          } catch (err) {
            // safety: if anything goes wrong, call original and continue
            console.error('[VengeHack] Movement wrapper error:', err);
            return originalUpdate.call(this, dt);
          }
        };
        console.log('[VengeHack] Movement.prototype.update wrapped');
      } else {
        console.warn('[VengeHack] Movement not found — movement hook skipped');
      }

      // NetworkManager hook: capture network instance & players list
      if (typeof NetworkManager !== 'undefined' && NetworkManager.prototype) {
        const origInit = NetworkManager.prototype.initialize || function () { };
        const hackRef = this;
        NetworkManager.prototype.initialize = function () {
          try {
            hackRef.hooks.network = this;
            // attempt to get local player id from network
            try { hackRef.localPlayerId = this.player?.id || hackRef.localPlayerId; } catch (e) { }
            console.log('[VengeHack] NetworkManager initialized (hooked)');
          } catch (e) {
            console.error('[VengeHack] NetworkManager init wrapper error:', e);
          }
          return origInit.apply(this, arguments);
        };

        // wrap respawn to support autoKill trigger (if server sends spawn list)
        if (NetworkManager.prototype.respawn) {
          const origRespawn = NetworkManager.prototype.respawn;
          NetworkManager.prototype.respawn = function (e) {
            try {
              const rv = origRespawn.call(this, e);
              // "e" may be an array of spawned players ids — attempt autoKill workflow
              if (hackRef.settings.autokill && Array.isArray(e) && e.length > 0) {
                // choose first id as example
                const targetId = e[0];
                // try to find target player
                const player = hackRef.getPlayerByIdSafe(targetId);
                if (player && player.id !== hackRef.localPlayerId) {
                  // schedule a delayed kill command (matches earlier logic)
                  setTimeout(() => {
                    try {
                      if (typeof this.send === 'function') {
                        // old script used ["da", id, 100, 1, x, y, z]
                        if (player.position) {
                          this.send && this.send(["da", targetId, 100, 1, player.position.x, player.position.y, player.position.z]);
                          console.log('[VengeHack][AutoKill] attempted send for', targetId);
                        } else {
                          // fallback: send minimal
                          this.send && this.send(["da", targetId, 100, 1]);
                          console.log('[VengeHack][AutoKill] attempted send minimal for', targetId);
                        }
                      }
                    } catch (err) { console.warn('[VengeHack][AutoKill] send failed', err); }
                  }, 1200);
                }
              }
              return rv;
            } catch (err) {
              console.error('[VengeHack] respawn wrapper error', err);
              return origRespawn.apply(this, arguments);
            }
          };
        }

        console.log('[VengeHack] NetworkManager hooks applied');
      } else {
        console.warn('[VengeHack] NetworkManager not found — network hook skipped');
      }

      // Label hook is optional (we rely on camera.worldToScreen for projection)
      if (typeof Label !== 'undefined' && Label.prototype && Label.prototype.update) {
        // we won't override it, but it's available if needed
        console.log('[VengeHack] Label present (optional)');
      }
    } // end setupHooks

    /**************************************************************************
     * Utility to safely get players from network
     **************************************************************************/
    getPlayersSafe() {
      try {
        if (this.hooks.network && Array.isArray(this.hooks.network.players)) {
          return this.hooks.network.players;
        }
        // try alternative paths: window.game.networkManager players etc.
        if (window.game && window.game.networkManager && Array.isArray(window.game.networkManager.players)) {
          return window.game.networkManager.players;
        }
      } catch (e) { /* ignore */ }
      return [];
    }

    getPlayerByIdSafe(id) {
      const p = this.getPlayersSafe();
      return p.find(x => x && x.id === id) || null;
    }

    /**************************************************************************
     * Projection: use PlayCanvas camera.worldToScreen if available,
     * otherwise fall back to naive projection.
     **************************************************************************/
    worldToScreen(positionVec3) {
      try {
        // prefer cameraEntity.worldToScreen / pc.camera
        const cam = this.hooks.cameraEntity || (this.hooks.pc && this.hooks.pc.app && this.hooks.pc.app.root && this.hooks.pc.app.root.findByName && this.hooks.pc.app.root.findByName('Camera'));
        if (cam && typeof cam.worldToScreen === 'function') {
          const tmp = new this.hooks.pc.Vec3();
          cam.worldToScreen(positionVec3, tmp);
          // tmp.x/y will be normalized to pixel coords multiplied by devicePixelRatio maybe; adjust as needed
          return { x: tmp.x, y: tmp.y, z: tmp.z };
        }
      } catch (e) {
        // fall through to fallback
      }

      // fallback: assume positionVec3 in world space centered at screen center (very rough)
      const canvas = document.querySelector('canvas');
      if (!canvas) return null;
      const w = canvas.width, h = canvas.height;
      return { x: w / 2 + (positionVec3.x || 0), y: h / 2 - (positionVec3.y || 0), z: 1 };
    }

    /**************************************************************************
     * Aimbot tick: selects target and aims/fires
     **************************************************************************/
    tickAimbot() {
      try {
        // update players list
        const players = this.getPlayersSafe();
        if (!players || players.length === 0) return;

        // obtain my movement instance to set look values and firing
        const mv = this.hooks.movement;
        if (!mv) return;

        // find local player's position (entity)
        const myPos = mv.entity && typeof mv.entity.getPosition === 'function' ? mv.entity.getPosition() : null;
        if (!myPos) return;

        // choose closest visible target within FOV and distance
        let best = null, bestScore = Infinity;
        for (const p of players) {
          if (!p || !p.position) continue;
          // skip local player (match by id if available)
          if (p.id && this.localPlayerId && p.id === this.localPlayerId) continue;

          // basic alive check if available
          if (typeof p.isDeath !== 'undefined' && p.isDeath) continue;
          if (p.health !== undefined && p.health <= 0) continue;

          // distance
          const dx = (p.position.x || 0) - (myPos.x || 0);
          const dy = (p.position.y || 0) - (myPos.y || 0);
          const dz = (p.position.z || 0) - (myPos.z || 0);
          const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
          if (dist > this.settings.aimbotMaxDist) continue;

          // projection / angle check
          const screen = this.worldToScreen(p.position);
          if (!screen || screen.z <= 0) continue;

          // compute 2D distance from screen center (approx FOV filter)
          const canvas = document.querySelector('canvas');
          if (!canvas) continue;
          const cx = canvas.width / 2, cy = canvas.height / 2;
          const dx2 = screen.x - cx, dy2 = screen.y - cy;
          const pixelDist = Math.sqrt(dx2 * dx2 + dy2 * dy2);

          // map aimbotFov degrees to pixels roughly using canvas size — this is heuristic
          const fovPx = (this.settings.aimbotFov / 90) * (Math.min(canvas.width, canvas.height) / 2);
          if (pixelDist > fovPx) continue;

          // lower pixelDist => better target
          if (pixelDist < bestScore) { bestScore = pixelDist; best = { player: p, screen, dist }; }
        }

        if (!best) {
          // no target in FOV
          mv.leftMouse = false;
          return;
        }

        if (this.settings.aimbot) {
          // calculate aiming — use screen target and move mv.lookX/Y gradually
          const canvas = document.querySelector('canvas');
          const cx = canvas.width / 2, cy = canvas.height / 2;
          const tx = best.screen.x, ty = best.screen.y;

          // compute delta in pixels
          const dxp = tx - cx, dyp = ty - cy;

          // convert pixel delta to approximate look angles; this is heuristic and depends on game's sensitivities
          // We'll apply smoothing so aim is not instant (aimSmoothing from 0..1)
          const sensitivityFactor = 0.15; // tweak if needed
          const desiredLookX = (Math.atan2(dxp, canvas.height) * (180 / Math.PI)); // approximate
          const desiredLookY = (Math.atan2(dyp, canvas.height) * (180 / Math.PI));

          // current look values
          const curLookX = typeof mv.lookX === 'number' ? mv.lookX : 0;
          const curLookY = typeof mv.lookY === 'number' ? mv.lookY : 0;

          // interpolate
          const s = this.settings.aimSmoothing;
          const newLookX = curLookX + (desiredLookX - curLookX) * s;
          const newLookY = curLookY + (desiredLookY - curLookY) * s;

          // apply
          mv.lookX = newLookX;
          mv.lookY = newLookY;

          // set firing flag
          mv.leftMouse = true;
          try {
            mv.setShooting && mv.setShooting(mv.lastDelta);
          } catch (e) { /* ignore */ }

          // autokill: send damage request when aimbot is locked and autokill enabled
          if (this.settings.autokill) {
            // ensure target has id and position
            try {
              const target = best.player;
              if (target && typeof target.id !== 'undefined') {
                // send damage packet (old format used previously)
                const net = this.hooks.network;
                if (net && typeof net.send === 'function') {
                  // best.player.position might not be populated at this exact frame; check
                  const pos = target.position || { x: 0, y: 0, z: 0 };
                  try {
                    net.send(["da", target.id, 100, 1, pos.x, pos.y, pos.z]);
                    // logging (throttled by console spam risk)
                    // console.log('[VengeHack][AutoKill] send attempt for id', target.id);
                  } catch (err) { console.warn('[VengeHack][AutoKill] send failed', err); }
                }
              }
            } catch (err) { /* ignore */ }
          }
        } else {
          // if aimbot disabled, ensure not firing
          mv.leftMouse = false;
        }
      } catch (err) {
        // do not let exceptions break game loop
        // console.error('[VengeHack] tickAimbot error:', err);
      }
    }

    /**************************************************************************
     * Draw ESP overlay on overlay canvas
     **************************************************************************/
    drawESP() {
      try {
        if (!this.overlay || !this.octx) return;
        this.resizeOverlayIfNeeded();

        const ctx = this.octx;
        ctx.clearRect(0, 0, this.overlay.width, this.overlay.height);

        if (!this.settings.esp) return;

        const players = this.getPlayersSafe();
        if (!players || players.length === 0) return;

        // find canvas center for bounds
        const canvas = document.querySelector('canvas');
        if (!canvas) return;

        for (const p of players) {
          try {
            if (!p || !p.position) continue;
            // skip local player
            if (p.id && this.localPlayerId && p.id === this.localPlayerId) continue;
            if (typeof p.isDeath !== 'undefined' && p.isDeath) continue;
            if (p.health !== undefined && p.health <= 0) continue;

            const scr = this.worldToScreen(p.position);
            if (!scr || scr.z <= 0) continue;

            // draw box and name
            const x = scr.x, y = scr.y;
            // scale with distance (approx)
            const scale = Math.max(8, 200 / (1 + (p.position && p.position.z ? Math.abs(p.position.z) : 1)));
            const w = 40 * (scale / 20), h = 60 * (scale / 20);

            // box outline
            ctx.save();
            ctx.lineWidth = 2;
            ctx.strokeStyle = 'rgba(255, 0, 0, 0.9)';
            ctx.strokeRect(x - w / 2, y - h / 2, w, h);

            // name and distance
            const name = p.name || `id:${p.id || '?'}`;
            const dist = (p.position && this.hooks.movement && this.hooks.movement.entity) ? Math.round(this.calculateDistance(this.hooks.movement.entity.getPosition(), p.position)) : 0;
            ctx.fillStyle = 'rgba(255,255,255,0.95)';
            ctx.font = '12px Arial';
            ctx.fillText(`${name} ${dist}m`, x - w / 2, y - h / 2 - 14);

            ctx.restore();
          } catch (e) {
            // ignore per-target exceptions
          }
        }
      } catch (err) {
        // don't spam console
      }
    }

    /**************************************************************************
     * Main loop: drawESP frequently; aimbot triggered from Movement wrapper tick
     **************************************************************************/
    loop() {
      const frame = () => {
        try { this.drawESP(); } catch (e) { /* ignore */ }
        requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
    }

    /**************************************************************************
     * Small utility
     **************************************************************************/
    calculateDistance(a, b) {
      try {
        const dx = (a.x || 0) - (b.x || 0);
        const dy = (a.y || 0) - (b.y || 0);
        const dz = (a.z || 0) - (b.z || 0);
        return Math.sqrt(dx * dx + dy * dy + dz * dz);
      } catch (e) { return Infinity; }
    }
  } // end class

  // start instance
  try {
    new VengeHack();
    console.log('[VengeHack] started');
  } catch (e) {
    console.error('[VengeHack] failed to start', e);
  }
})();
