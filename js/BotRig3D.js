// Mechanical bot presentation. Gameplay still owns position, attacks and jump timing.
/** @satisfies {Record<string, any>} */
const BotRig3D = {
    attach(root, model, view, grounded) {
        const clips = Model3D.clips(model);
        if (!clips || !clips.has('idle')) return;
        if (grounded) {
            model.position.y = 0;
            model.computeWorldMatrix(true);
            const inverse = root.computeWorldMatrix(true).clone().invert();
            let floor = Infinity;
            for (const mesh of model.getChildMeshes()) {
                if (!mesh.getTotalVertices()) continue;
                mesh.computeWorldMatrix(true);
                for (const corner of mesh.getBoundingInfo().boundingBox.vectorsWorld) {
                    floor = Math.min(floor, BABYLON.Vector3.TransformCoordinates(corner, inverse).y);
                }
            }
            if (Number.isFinite(floor)) model.position.y -= floor;
        }
        root.metadata = Object.assign({}, root.metadata, {
            botRig: { clips, model, x: null, y: null, jumping: false, event: '', remaining: 0 }
        });
        World3D.addObject(view, model, 'actor', { ink: false, outline: false });
        clips.play('idle');
    },

    signal(root, event) {
        const rig = root && root.metadata && root.metadata.botRig;
        if (rig) { rig.event = event; rig.remaining = this.duration(rig.clips, event); }
    },

    duration(clips, name) {
        const track = clips.tracks.get(name);
        if (!track) return 0;
        const group = track.group;
        const fps = group.targetedAnimations[0]?.animation.framePerSecond || 60;
        return (group.to - group.from) / fps;
    },

    update(enemy, dt) {
        const rig = enemy.visual?.metadata?.botRig;
        if (!rig) return false;
        if (enemy.dead || enemy.dormant || dt <= 0) {
            rig.clips.paused = true;
            for (const track of rig.clips.tracks.values()) track.group.speedRatio = 0;
            return true;
        }
        rig.clips.paused = false;
        const speed = rig.x === null ? 0 : Math.hypot(enemy.x - rig.x, enemy.y - rig.y) / dt;
        rig.x = enemy.x; rig.y = enemy.y;
        const threshold = typeof MODEL_BOT_MOVE_THRESHOLD !== 'undefined' ? MODEL_BOT_MOVE_THRESHOLD : 2;
        const stride = (typeof MODEL_BOT_STRIDE !== 'undefined' ? MODEL_BOT_STRIDE : 16.8) * rig.model.scaling.x;
        const moving = speed > threshold;
        let clip = moving ? (enemy.archetype === 'spotter' ? 'fly' : 'walk') : 'idle';
        if (rig.jumping && !enemy.isLeaping) this.signal(enemy.visual, 'land');
        rig.jumping = !!enemy.isLeaping;
        rig.remaining = Math.max(0, rig.remaining - dt);
        if (rig.remaining > 0) clip = rig.event;
        if (enemy.archetype === 'spotter' && enemy.state === 'engage') clip = 'alert';
        if (enemy.isLeaping) clip = 'jump';
        const rate = clip === 'walk' ? Math.max(0.1, speed * this.duration(rig.clips, 'walk') / stride) : 1;
        rig.clips.play(clip, { loop: !['jump', 'land', 'scream'].includes(clip), speed: rate });
        if (clip === 'jump') {
            // Sample by gameplay progress: jumps and poses stay aligned at any frame rate.
            const group = rig.clips.tracks.get('jump').group;
            group.goToFrame(group.from + (group.to - group.from) * Math.min(1, enemy.leapProgress));
            group.speedRatio = 0;
        }
        return true;
    }
};
