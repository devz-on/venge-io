// ==UserScript==
// @name         Venge.io Internal Testing Client
// @version      2.1
// @description  Authorized testing client for internal QA/vulnerability assessment on Venge.io (by Disease)
// @author       Disease
// @match        https://venge.io/
// @grant        none
// @run-at       document-start
// ==/UserScript==

class Hack {
    constructor() {
        this.settings = {
            infAmmo: true,
            infJump: true,
            autoKill: true,
            speedMlt: 0,
            esp: true,
            aimbot: true,
            timeScale: 0
        };

        this.hooks = {
            network: null,
            movement: null,
            anticheat: true
        };

        window._hackInstance = this;

        this.waitForPC().then(() => {
            this.createUI();
            this.setupHooks();
            this.setupBinds();
        });
    }

    async waitForPC() {
        while (typeof pc === 'undefined' || !pc.app) {
            await new Promise(r => setTimeout(r, 100));
        }
        this.pc = pc;
    }

    createUI() {
        const uiContainer = document.createElement('div');
        Object.assign(uiContainer.style, {
            position: 'fixed',
            top: '10px',
            right: '10px',
            backgroundColor: 'rgba(0, 0, 0, 0.7)',
            color: 'white',
            padding: '10px',
            borderRadius: '5px',
            zIndex: 9999,
            fontFamily: 'Arial, sans-serif',
            fontSize: '14px',
            boxShadow: '0 0 10px rgba(0, 0, 0, 0.5)'
        });

        const title = document.createElement('h3');
        title.innerText = 'Hack Controls';
        title.style.margin = '0 0 10px 0';
        uiContainer.appendChild(title);

        const settings = [
            { name: 'Infinite Ammo', key: 'infAmmo' },
            { name: 'Infinite Jump', key: 'infJump' },
            { name: 'Auto Kill', key: 'autoKill' },
            { name: 'ESP', key: 'esp' },
            { name: 'Aimbot', key: 'aimbot' },
            { name: 'Speed Multiplier', key: 'speedMlt' },
            { name: 'Time Scale', key: 'timeScale' }
        ];

        settings.forEach(setting => {
            const label = document.createElement('label');
            label.style.display = 'block';
            label.style.marginBottom = '5px';

            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.checked = this.settings[setting.key];
            checkbox.name = setting.key;
            checkbox.style.marginRight = '5px';

            checkbox.addEventListener('change', () => {
                this.settings[setting.key] = checkbox.checked;
                this.updateUI();
            });

            label.appendChild(checkbox);
            label.appendChild(document.createTextNode(setting.name));
            uiContainer.appendChild(label);
        });

        const developerLabel = document.createElement('div');
        developerLabel.innerText = 'Developed by Disease';
        Object.assign(developerLabel.style, {
            position: 'absolute',
            bottom: '10px',
            right: '10px',
            color: 'lightgray',
            fontSize: '12px',
            opacity: '0.8'
        });
        uiContainer.appendChild(developerLabel);

        document.body.appendChild(uiContainer);
        this.uiContainer = uiContainer;
    }

    updateUI() {
        Object.keys(this.settings).forEach(key => {
            const checkbox = this.uiContainer.querySelector(`input[name="${key}"]`);
            if (checkbox) checkbox.checked = this.settings[key];
        });
    }

    async waitForProp(prop) {
        while (!window.hasOwnProperty(prop)) {
            await new Promise(resolve => setTimeout(resolve, 500));
        }
    }

    setupHooks() {
        const hooks = ['Movement', 'NetworkManager', 'VengeGuard', 'Label'];
        hooks.forEach(hook => {
            this.waitForProp(hook).then(() => {
                const fn = this[`hook${hook}`];
                if (typeof fn === 'function') fn.call(this);
            });
        });
    }

    setupBinds() {
        window.addEventListener("keydown", (e) => this.handleKeyPress(e));
    }

    handleKeyPress(e) {
        const keyActions = {
            190: () => this.toggleSetting('autoKill', "Kill on Respawn"),
            188: () => this.toggleSetting('infAmmo', "Infinite Ammo"),
            186: () => this.toggleSetting('aimbot', "Aimbot"),
            222: () => this.toggleSetting('infJump', "Infinite Jump"),
            191: () => this.changeSpeedMultiplier(),
            219: () => this.teleportToSafety(),
            221: () => this.toggleSetting('esp', "ESP"),
            220: () => this.changeTimeScale()
        };

        if (keyActions[e.keyCode]) keyActions[e.keyCode]();
    }

    toggleSetting(setting, message) {
        this.settings[setting] = !this.settings[setting];
        this.updateUI();
        this.hooks.network?.app?.fire("Chat:Message", "Hacks", `${message} - ${this.settings[setting] ? "Enabled" : "Disabled"}`, true);
    }

    changeSpeedMultiplier() {
        this.settings.speedMlt = (this.settings.speedMlt + 1) % 5;
        this.hooks.network?.app?.fire("Chat:Message", "Hacks", `Speed Multiplier - ${this.settings.speedMlt + 1}x`, true);
    }

    changeTimeScale() {
        this.settings.timeScale = (this.settings.timeScale + 1) % 5;
        this.pc.app.timeScale = this.settings.timeScale + 1;
        this.hooks.network?.app?.fire("Chat:Message", "Hacks", `Timescale - ${this.settings.timeScale + 1}x`, true);
    }

    teleportToSafety() {
        this.hooks.network?.app?.fire("Chat:Message", "Hacks", "Teleporting you to Safety", true);
        this.hooks.movement?.app?.fire("Player:Respawn", true);
    }

    hookMovement() {
        const originalUpdate = Movement.prototype.update;
        let defaultSpeeds = [];

        Movement.prototype.update = function (t) {
            const result = originalUpdate.call(this, t);

            if (!window._hackInstance.hooks.movement) {
                window._hackInstance.hooks.movement = this;
                defaultSpeeds = [this.defaultSpeed, this.strafingSpeed];
            }

            window._hackInstance.applyMovementSettings(defaultSpeeds);
            window._hackInstance.onTick();

            return result;
        };

        console.log("✅ Movement Hooked");
    }

    applyMovementSettings(defaultSpeeds) {
        const m = this.hooks.movement;
        if (!m) return;

        if (this.settings.infAmmo) {
            m.setAmmoFull?.();
            m.isHitting = false;
        }

        if (this.settings.infJump) {
            m.isLanded = true;
            m.bounceJumpTime = 0;
            m.isJumping = false;
        }

        m.defaultSpeed = defaultSpeeds[0] * (this.settings.speedMlt + 1);
        m.strafingSpeed = defaultSpeeds[1] * (this.settings.speedMlt + 1);
    }

    hookNetwork() {
        const originalInitialize = NetworkManager.prototype.initialize;
        NetworkManager.prototype.initialize = function () {
            if (!window._hackInstance.hooks.network) {
                window._hackInstance.hooks.network = this;
                window._hackInstance.playerid = this.player?.id;
            }
            originalInitialize.call(this);
        };

        const originalRespawn = NetworkManager.prototype.respawn;
        NetworkManager.prototype.respawn = function (e) {
            originalRespawn.call(this, e);
            if (e?.length && window._hackInstance.settings.autoKill) {
                const id = e[0];
                const player = this.getPlayerById(id);
                if (player && id !== window._hackInstance.playerid) {
                    setTimeout(() => {
                        this.send(["da", id, 100, 1, player.position.x, player.position.y, player.position.z]);
                    }, 3500);
                }
            }
        };

        console.log("✅ Network Hooked");
    }

    hookAnticheat() {
        VengeGuard.prototype.onCheck = function () {
            this.app.fire("Network:Guard", 1);
        };
        console.log("✅ Anticheat Hooked");
    }

    hookLabel() {
        Label.prototype.update = function (t) {
            const h = window._hackInstance;
            if (!pc.isSpectator) {
                if (this.player.isDeath || (Date.now() - this.player.lastDamage > 1800 && !h.settings.esp)) {
                    this.labelEntity.enabled = false;
                    return false;
                }
            }
            h.updateLabelPosition(this);
        };
        console.log("✅ Label Hooked");
    }

    updateLabelPosition(labelContext) {
        const movement = this.hooks.movement;
        if (!movement || !movement.headPoint || !movement.currentCamera) return;

        const position = new pc.Vec3();
        const camera = movement.currentCamera;
        const pixelRatio = this.pc.app.graphicsDevice.maxPixelRatio;

        const screenEntity = movement.screenEntity;
        const scale = screenEntity?.screen?.scale || 1;

        camera.worldToScreen(movement.headPoint.getPosition(), position);
        position.x *= pixelRatio;
        position.y *= pixelRatio;

        const inBounds =
            position.x > 0 &&
            position.x < this.pc.app.graphicsDevice.width &&
            position.y > 0 &&
            position.y < this.pc.app.graphicsDevice.height &&
            position.z > 0;

        labelContext.labelEntity.setLocalPosition(
            position.x / scale,
            (this.pc.app.graphicsDevice.height - position.y) / scale,
            0
        );

        labelContext.labelEntity.enabled = inBounds;
    }

    onTick() {
        if (this.settings.aimbot && this.hooks.network?.players && this.hooks.movement) {
            this.aimAtClosestPlayer();
        }
    }

    aimAtClosestPlayer() {
        const players = this.hooks.network?.players;
        if (!players || !Array.isArray(players) || players.length === 0) return;

        let closest = null;
        let closestDistance = Infinity;
        const pos = this.hooks.movement?.entity?.getPosition?.();
        if (!pos) return;

        for (const p of players) {
            if (!p || !p.position) continue;
            const d = this.calculateDistance(p.position, pos);
            if (d < closestDistance) {
                closest = p;
                closestDistance = d;
            }
        }

        if (closest) this.adjustAim(closest, pos);
    }

    calculateDistance(a, b) {
        return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2);
    }

    adjustAim(target, fromPos) {
        const rayHits = this.pc.app.systems.rigidbody.raycastAll(fromPos, target.getPosition());
        const valid = rayHits.length === 1 && rayHits[0].entity.tags.has('Player');
        const m = this.hooks.movement;

        if (valid) {
            const angle = Hack.lookAt(target.position.x, target.position.z, fromPos.x, fromPos.z);
            m.lookX = angle * (180 / Math.PI);
            m.lookY = -1 * this.getXDirection(target.position, fromPos) * (180 / Math.PI);
            m.leftMouse = true;
            m.setShooting(m.lastDelta);
        } else {
            m.leftMouse = false;
        }
    }

    static lookAt(x1, z1, x2, z2) {
        return Math.atan2(x2 - x1, z2 - z1);
    }

    getXDirection(target, from) {
        const dy = Math.abs(target.y - from.y);
        const d = this.calculateDistance(target, from);
        return Math.asin(dy / d) * (target.y > from.y ? -1 : 1);
    }
}

// 🟢 Start the script
new Hack();
