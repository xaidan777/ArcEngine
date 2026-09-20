// Game.js — the sample game on top of the kit: the place where game logic starts.
// main.js creates it after the location and the camera (window.app.game) and calls update(dt)
// every frame BEFORE the render. The logic keeps its own state (energy, running) and only
// shows it: the model's clips — Model3D.clips, the HUD — UI.get(id) (elements and their layout
// live in UILayout.js, the editor's UI tab).
//
// The sample: the "Run" button switches the character between the idle and run clips; running
// spends energy and plays footsteps (Sound3D), standing restores it, at zero the character
// stops by itself. The character is found by its TAG, not by its name: the user may rename the
// object in the editor, but the tag is the contract between the scene and the code.

class Game {
    /** @param {{ location: Location3D, camera: CameraController }} app */
    constructor(app) {
        this.app = app;
        this.running = false;
        this.energy = 1;          // 0..1
        this._fpsTimer = 0;
        this._stepTimer = 0;
        /** @type {LocationObject | null} */
        this.hero = app.location.findByTag(Game.HERO_TAG)[0] || null;

        const button = UI.get('run');
        if (button) button.onClick(() => this.setRunning(!this.running));
        this.setRunning(false);
    }

    setRunning(on) {
        this.running = !!on && this.energy > 0.05;
        const button = UI.get('run');
        if (button) button.setText(this.running ? 'Stop' : 'Run');
    }

    update(dt) {
        const c = Game.cfg();
        this.energy = Math.max(0, Math.min(1, this.energy + (this.running ? -dt / c.runSec : dt / c.restSec)));
        if (this.running && this.energy <= 0) this.setRunning(false);

        // The model appears when its file has loaded; play() on the current clip costs nothing.
        const clips = this.hero && this.hero.mesh ? Model3D.clips(this.hero.mesh) : null;
        if (clips) clips.play(this.running ? 'run' : 'idle');

        // Footsteps: the sound stands where the character stands, so it fades with the distance.
        this._stepTimer -= this.running ? dt : this._stepTimer;
        if (this.running && this._stepTimer <= 0) {
            this._stepTimer = c.stepSec;
            if (this.hero) Sound3D.play('assets/sounds/step.wav', { at: this.hero.def, volume: 0.7 });
        }

        const bar = UI.get('energy');
        if (bar) bar.setValue(this.energy);
        this._fpsTimer -= dt;
        if (this._fpsTimer <= 0) {
            this._fpsTimer = 0.5;
            const fps = UI.get('fps');
            if (fps) fps.setText(Math.round(World3D.engine.getFps()) + ' fps');
        }
    }

    static cfg() {
        const U = 'undefined';
        return {
            runSec: typeof GAME_RUN_SEC !== U ? GAME_RUN_SEC : 8,
            restSec: typeof GAME_REST_SEC !== U ? GAME_REST_SEC : 4,
            stepSec: typeof GAME_STEP_SEC !== U ? GAME_STEP_SEC : 0.35
        };
    }
}

Game.HERO_TAG = 'player';   // the tag of the location object (Objects.js) the sample drives
