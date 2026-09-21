// editor-panels.js — the DOM for the three specialist panels: the animation timeline, the model
// inspector and the rig editor.
//
// WHY this is one file rather than a render() inside each editor: the three share a dock, a
// visibility model and a tab strip, and splitting that plumbing three ways would have produced
// three near-identical DOM builders. The LOGIC stays where it belongs — AnimEditor, ModelEditor
// and RigEditor own the data and the maths, and are fully tested headlessly. This file only draws
// them and turns pointer and keyboard input into calls on them.
//
// Every panel is a tab in one bottom dock, so an editor never has two timelines on screen and the
// viewport keeps its height. `show(name)` is the single entry point the menu and the View header
// call.

/** @satisfies {Record<string, any>} */
const EditorPanels = {
    ROOT_ID: 'editor-panels',
    TABS_ID: 'editor-panel-tabs',
    /** Which panel is in front, or '' when the dock is closed. */
    active: '',
    /** @type {any} */
    host: null,
    /** The node whose tracks the timeline edits — set by the Hierarchy selection. */
    node: null,
    /** @type {any} the model root the model/rig panels inspect */
    modelRoot: null,

    init() {
        if (typeof document === 'undefined') return false;
        this.host = document.getElementById(this.ROOT_ID);
        if (!this.host) return false;
        this.build();
        this.show('anim');
        return true;
    },

    /** Build the dock once. Tabs on top, one panel body per type below. */
    build() {
        if (!this.host || this.host.dataset.built === '1') return;
        this.host.dataset.built = '1';
        this.host.innerHTML = '';
        this.host.className = 'editor-panels';

        const tabs = document.createElement('div');
        tabs.id = this.TABS_ID;
        tabs.className = 'dock-title panel-tabs';
        for (const [id, en] of [['anim', 'Animation'], ['model', 'Model'], ['rig', 'Rig']]) {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'panel-tab';
            button.dataset.panel = id;
            button.textContent = en;
            button.addEventListener('click', () => this.show(id));
            tabs.appendChild(button);
        }
        const spacer = document.createElement('div');
        spacer.className = 'toolbar-spacer';
        tabs.appendChild(spacer);
        const close = document.createElement('button');
        close.type = 'button';
        close.className = 'panel-tab panel-close';
        close.textContent = '✕';
        close.title = 'Close the dock';
        close.addEventListener('click', () => this.hide());
        tabs.appendChild(close);
        this.host.appendChild(tabs);

        for (const id of ['anim', 'model', 'rig']) {
            const body = document.createElement('div');
            body.id = 'editor-panel-' + id;
            body.className = 'panel-body';
            body.dataset.panel = id;
            this.host.appendChild(body);
        }
        this.buildAnim();
        this.buildModel();
        this.buildRig();
    },

    show(name) {
        if (['anim', 'model', 'rig'].indexOf(name) < 0) return false;
        this.active = name;
        if (!this.host) return false;
        this.host.hidden = false;
        for (const body of this.host.querySelectorAll('.panel-body')) {
            /** @type {HTMLElement} */ (body).hidden = body.dataset.panel !== name;
        }
        for (const tab of this.host.querySelectorAll('.panel-tab[data-panel]')) {
            tab.classList.toggle('active', tab.dataset.panel === name);
        }
        // A panel draws from the current state, so switching to it must refresh it.
        this.refresh();
        return true;
    },

    hide() {
        this.active = '';
        if (this.host) this.host.hidden = true;
    },

    /** Toggle by name — what the Window menu calls. */
    toggle(name) {
        if (this.active === name && this.host && !this.host.hidden) { this.hide(); return false; }
        return this.show(name);
    },

    // --- shared helpers -------------------------------------------------------

    /** A labelled row: label, control, optional hint. */
    row(label, control, hint) {
        const wrap = document.createElement('label');
        wrap.className = 'panel-row';
        const span = document.createElement('span');
        span.className = 'panel-label';
        span.textContent = label;
        wrap.appendChild(span);
        wrap.appendChild(control);
        if (hint) {
            const help = document.createElement('span');
            help.className = 'panel-hint';
            help.textContent = hint;
            wrap.appendChild(help);
        }
        return wrap;
    },

    /** A small button that calls back. */
    button(text, onClick, title) {
        const el = document.createElement('button');
        el.type = 'button';
        el.className = 'panel-button';
        el.textContent = text;
        if (title) el.title = title;
        el.addEventListener('click', onClick);
        return el;
    },

    /** Replace a container's content with a table of rows. */
    fillTable(container, headers, rows) {
        if (!container) return;
        container.innerHTML = '';
        const table = document.createElement('table');
        table.className = 'panel-table';
        const head = document.createElement('thead');
        const headRow = document.createElement('tr');
        for (const label of headers) {
            const th = document.createElement('th');
            th.textContent = label;
            headRow.appendChild(th);
        }
        head.appendChild(headRow);
        table.appendChild(head);
        const body = document.createElement('tbody');
        for (const row of rows) {
            const tr = document.createElement('tr');
            if (row.className) tr.className = row.className;
            for (const cell of row.cells) {
                const td = document.createElement('td');
                // A scene and a model are untrusted input: text, never markup.
                td.textContent = String(cell);
                tr.appendChild(td);
            }
            if (row.onClick) {
                tr.style.cursor = 'pointer';
                tr.addEventListener('click', row.onClick);
            }
            body.appendChild(tr);
        }
        table.appendChild(body);
        container.appendChild(table);
    },

    /** A findings list in the same shape the Console uses, so one reader handles both. */
    fillFindings(container, findings) {
        if (!container) return;
        container.innerHTML = '';
        if (!findings.length) {
            const ok = document.createElement('div');
            ok.className = 'panel-ok';
            ok.textContent = 'Никаких проблем не найдено / No problems found';
            container.appendChild(ok);
            return;
        }
        for (const finding of findings) {
            const line = document.createElement('div');
            line.className = 'console-row ' + finding.level;
            line.textContent = (finding.target ? finding.target + ': ' : '') + finding.message;
            container.appendChild(line);
        }
    },

    // --- animation timeline ---------------------------------------------------

    buildAnim() {
        const body = document.getElementById('editor-panel-anim');
        if (!body) return;
        body.innerHTML = '';

        const bar = document.createElement('div');
        bar.className = 'panel-toolbar';
        bar.appendChild(this.button('▶', () => { AnimEditor.play(); this.refreshAnim(); }, 'Play'));
        bar.appendChild(this.button('⏸', () => { AnimEditor.pause(); this.refreshAnim(); }, 'Pause'));
        bar.appendChild(this.button('◀|', () => { AnimEditor.stepFrame(-1); this.refreshAnim(); }, 'Previous frame'));
        bar.appendChild(this.button('|▶', () => { AnimEditor.stepFrame(1); this.refreshAnim(); }, 'Next frame'));
        
        const autoKeyBtn = this.button('⏺ AutoKey', () => {
            AnimEditor.autoKey = !AnimEditor.autoKey;
            autoKeyBtn.classList.toggle('active', AnimEditor.autoKey);
            if (typeof Toast !== 'undefined') Toast.show(AnimEditor.autoKey ? 'Auto-Key ON: moving bones records keyframes' : 'Auto-Key OFF', false);
        }, 'Toggle Auto-Keying when manipulating joints');
        if (AnimEditor.autoKey) autoKeyBtn.classList.add('active');
        bar.appendChild(autoKeyBtn);

        const onions = document.createElement('label');
        onions.className = 'panel-check';
        const onionsBox = document.createElement('input');
        onionsBox.type = 'checkbox';
        onionsBox.checked = AnimEditor.onionSkin;
        onionsBox.addEventListener('change', () => { AnimEditor.onionSkin = onionsBox.checked; this.refreshAnim(); });
        onions.appendChild(onionsBox);
        onions.appendChild(document.createTextNode(' Onion skin'));
        bar.appendChild(onions);

        const key = this.button('◆ Key', () => {
            if (!this.node) return;
            AnimEditor.keyAll(this.node);
            this.refreshAnim();
        }, 'Key every channel of the selected node at the playhead');
        bar.appendChild(key);

        const saveClipBtn = this.button('💾 Save Clip', async () => {
            const clip = AnimEditor.clip;
            if (!clip) {
                if (typeof Toast !== 'undefined') Toast.show('No clip to save! Add keys first.', true);
                return;
            }
            const name = prompt('Clip name (e.g. idle, walk, run, attack):', clip.name || 'custom_clip');
            if (!name) return;
            clip.name = name;
            try {
                const res = await fetch('/api/save-clip', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ name, clip })
                });
                const data = await res.json();
                if (data.ok) {
                    if (typeof Toast !== 'undefined') Toast.show(`Clip saved to ${data.path}!`, false);
                    if (typeof ObjectsPanel !== 'undefined' && ObjectsPanel.selected) {
                        ObjectsPanel.setClip(name);
                        ObjectsPanel.renderProps();
                    }
                } else {
                    if (typeof Toast !== 'undefined') Toast.show('Error saving clip: ' + data.error, true);
                }
            } catch (err) {
                console.error(err);
                alert('Error saving clip: ' + err.message);
            }
        }, 'Save current clip to assets/clips/ and bind to game object');
        bar.appendChild(saveClipBtn);

        body.appendChild(bar);

        const time = document.createElement('div');
        time.className = 'panel-toolbar panel-time';
        const clock = document.createElement('span');
        clock.id = 'anim-clock';
        clock.className = 'panel-clock';
        time.appendChild(clock);
        const range = document.createElement('input');
        range.id = 'anim-scrub';
        range.type = 'range';
        range.min = '0';
        range.max = '1';
        range.step = '0.001';
        range.className = 'panel-scrub';
        range.addEventListener('input', () => { AnimEditor.seek(Number(range.value)); this.refreshAnim(); });
        time.appendChild(range);
        body.appendChild(time);

        const canvas = document.createElement('canvas');
        canvas.id = 'anim-canvas';
        canvas.className = 'anim-canvas';
        canvas.width = 1200;
        canvas.height = 140;

        // Interactive timeline canvas scrub
        canvas.addEventListener('pointerdown', (e) => {
            const rect = canvas.getBoundingClientRect();
            const updatePlayhead = (ev) => {
                const x = Math.max(0, Math.min(canvas.width, (ev.clientX - rect.left) * (canvas.width / rect.width)));
                const timeSec = AnimEditor.xToFrame(x);
                AnimEditor.seek(timeSec);
                this.refreshAnim();
            };
            updatePlayhead(e);
            const onMove = (ev) => updatePlayhead(ev);
            const onUp = () => {
                window.removeEventListener('pointermove', onMove);
                window.removeEventListener('pointerup', onUp);
            };
            window.addEventListener('pointermove', onMove);
            window.addEventListener('pointerup', onUp);
        });

        body.appendChild(canvas);

        const tracks = document.createElement('div');
        tracks.id = 'anim-tracks';
        tracks.className = 'anim-tracks';
        body.appendChild(tracks);

        const findings = document.createElement('div');
        findings.id = 'anim-findings';
        findings.className = 'panel-findings';
        body.appendChild(findings);
    },

    refreshAnim() {
        const clip = typeof ClipDoc !== 'undefined' && AnimEditor.clip ? AnimEditor.clip : null;
        const clock = document.getElementById('anim-clock');
        const scrub = /** @type {HTMLInputElement|null} */ (document.getElementById('anim-scrub'));
        if (clock) {
            const fps = clip ? clip.fps : 30;
            clock.textContent = clip
                ? AnimEditor.time.toFixed(2) + 's / ' + clip.duration.toFixed(2) + 's  ·  frame ' + AnimEditor.timeToFrame(AnimEditor.time) + ' / ' + Math.round(clip.duration * fps)
                : 'no clip — select a node and press Key';
        }
        if (scrub && clip) {
            scrub.max = String(clip.duration);
            scrub.value = String(AnimEditor.time);
        }
        // The curve & dope sheet, drawn with timeline ruler
        const canvas = /** @type {HTMLCanvasElement|null} */ (document.getElementById('anim-canvas'));
        if (canvas && canvas.getContext) {
            const ctx = canvas.getContext('2d');
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.fillStyle = '#0e1217';
            ctx.fillRect(0, 0, canvas.width, canvas.height);

            // 1. Timeline Ruler Header (top 24px)
            ctx.fillStyle = '#161c24';
            ctx.fillRect(0, 0, canvas.width, 24);
            ctx.strokeStyle = 'rgba(255,255,255,0.08)';
            ctx.beginPath();
            ctx.moveTo(0, 24); ctx.lineTo(canvas.width, 24);
            ctx.stroke();

            const fps = clip ? clip.fps : 30;
            const maxFrame = clip ? Math.round(clip.duration * fps) : 60;

            ctx.fillStyle = '#7a889b';
            ctx.font = '10px ui-monospace, monospace';
            ctx.textAlign = 'center';

            for (let f = 0; f <= maxFrame; f += 5) {
                const x = AnimEditor.frameToX(AnimEditor.frameTime(f));
                if (x > canvas.width) break;
                const isMajor = (f % 10 === 0);
                ctx.strokeStyle = isMajor ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.08)';
                ctx.beginPath();
                ctx.moveTo(x, isMajor ? 6 : 14);
                ctx.lineTo(x, canvas.height);
                ctx.stroke();

                if (isMajor) {
                    ctx.fillText(String(f), x, 18);
                }
            }

            // 2. Channels and Curves
            if (clip && Object.keys(clip.tracks).length) {
                const tracks = ClipDoc.allTracks(clip);
                const colours = ['#38ef7d', '#fbcb60', '#4aa3ff', '#ff7a6b', '#c084fc'];

                tracks.forEach((track, i) => {
                    const points = AnimEditor.curvePoints(track, 80);
                    if (!points.length) return;
                    ctx.strokeStyle = colours[i % colours.length];
                    ctx.lineWidth = 1.5;
                    ctx.beginPath();
                    points.forEach((p, j) => {
                        const y = 24 + p.y * (canvas.height - 28) / canvas.height;
                        if (j === 0) ctx.moveTo(p.x, y); else ctx.lineTo(p.x, y);
                    });
                    ctx.stroke();

                    // Diamond keyframe markers
                    for (const k of track.keys) {
                        const pt = AnimEditor.keyPoint(track, k);
                        const ky = 24 + pt.y * (canvas.height - 28) / canvas.height;
                        const r = 5;
                        ctx.fillStyle = colours[i % colours.length];
                        ctx.beginPath();
                        ctx.moveTo(pt.x, ky - r);
                        ctx.lineTo(pt.x + r, ky);
                        ctx.lineTo(pt.x, ky + r);
                        ctx.lineTo(pt.x - r, ky);
                        ctx.closePath();
                        ctx.fill();
                        ctx.strokeStyle = '#ffffff';
                        ctx.lineWidth = 1;
                        ctx.stroke();
                    }
                });
            }

            // 3. Playhead Needle (Red line with triangular head on ruler)
            const px = AnimEditor.frameToX(AnimEditor.time);
            ctx.strokeStyle = '#ff3b30';
            ctx.lineWidth = 1.5;
            ctx.beginPath(); ctx.moveTo(px, 0); ctx.lineTo(px, canvas.height); ctx.stroke();

            // Playhead triangle on ruler
            ctx.fillStyle = '#ff3b30';
            ctx.beginPath();
            ctx.moveTo(px - 5, 0);
            ctx.lineTo(px + 5, 0);
            ctx.lineTo(px + 5, 12);
            ctx.lineTo(px, 18);
            ctx.lineTo(px - 5, 12);
            ctx.closePath();
            ctx.fill();
        }
        // Track list.
        const list = document.getElementById('anim-tracks');
        if (list) {
            const rows = clip ? ClipDoc.allTracks(clip).map(track => ({
                cells: [track.target + '.' + track.path, track.keys.length, track.keys.map(k => k.time.toFixed(2) + 's').join(' ')],
                className: AnimEditor.selectedTrack === track.id ? 'selected' : '',
                onClick: () => { AnimEditor.selectedTrack = track.id; this.refreshAnim(); },
            })) : [];
            this.fillTable(list, ['Channel', 'Keys', 'Times'], rows);
            if (!rows.length) {
                list.innerHTML = '';
                const empty = document.createElement('div');
                empty.className = 'panel-ok';
                empty.textContent = 'No tracks yet — select a node in the Hierarchy and press ◆ Key';
                list.appendChild(empty);
            }
        }
        this.fillFindings(document.getElementById('anim-findings'), AnimEditor.findings);
        // The findings drive the Console badge too, so the two never disagree.
        if (typeof ConsolePane !== 'undefined' && ConsolePane.setFindings) ConsolePane.setFindings('anim', AnimEditor.findings);
    },

    // --- model inspector ------------------------------------------------------

    buildModel() {
        const body = document.getElementById('editor-panel-model');
        if (!body) return;
        body.innerHTML = '';
        const bar = document.createElement('div');
        bar.className = 'panel-toolbar';
        bar.appendChild(this.button('Inspect selected', () => {
            this.inspectSelected();
        }, 'Inspect the model of the node selected in the Hierarchy'));
        const path = document.createElement('input');
        path.id = 'model-path';
        path.type = 'text';
        path.className = 'panel-input';
        path.placeholder = 'assets/models/character.glb';
        bar.appendChild(path);
        bar.appendChild(this.button('Load', () => this.loadModel(/** @type {HTMLInputElement}*/ (document.getElementById('model-path')).value)));
        body.appendChild(bar);

        const totals = document.createElement('div');
        totals.id = 'model-totals';
        totals.className = 'panel-totals';
        body.appendChild(totals);
        const meshes = document.createElement('div');
        meshes.id = 'model-meshes';
        meshes.className = 'panel-scroll';
        body.appendChild(meshes);
        const bones = document.createElement('div');
        bones.id = 'model-bones';
        bones.className = 'panel-scroll';
        body.appendChild(bones);
        const findings = document.createElement('div');
        findings.id = 'model-findings';
        findings.className = 'panel-findings';
        body.appendChild(findings);
    },

    /** Inspect the model behind the Hierarchy selection, if the scene has built it. */
    inspectSelected() {
        const mesh = (typeof SceneView !== 'undefined' && SceneView.selection.length)
            ? SceneView.meshOf(SceneView.selection[0]) : null;
        if (!mesh) {
            this.modelRoot = null;
            if (typeof ModelEditor !== 'undefined') ModelEditor.inspect(null);
            this.refreshModel();
            return false;
        }
        this.modelRoot = mesh;
        if (typeof ModelEditor !== 'undefined') ModelEditor.inspect(mesh);
        this.refreshModel();
        return true;
    },

    loadModel(path) {
        if (!path || typeof Model3D === 'undefined' || typeof World3D === 'undefined') return false;
        const scene = World3D.view && World3D.view.scene;
        if (!scene) return false;
        const self = this;
        Model3D.load(String(path), scene).then((model) => {
            const root = Model3D.build(model, scene, { name: 'inspect' });
            self.modelRoot = root;
            ModelEditor.inspect(root, Model3D.clips ? Model3D.clips(root) : null);
            self.refreshModel();
        }).catch(() => {
            // A missing file is a normal state while typing a path: report it, do not crash.
            self.modelRoot = null;
            ModelEditor.inspect(null);
            self.refreshModel('не удалось загрузить / could not load ' + path);
        });
        return true;
    },

    refreshModel(note) {
        const report = typeof ModelEditor !== 'undefined' ? ModelEditor.report : null;
        const totals = document.getElementById('model-totals');
        if (totals) {
            totals.textContent = note ? note
                : (report ? report.totals.meshes + ' meshes · ' + report.totals.triangles + ' tris · '
                    + report.totals.skinned + ' skinned · ' + report.totals.clips + ' clips · '
                    + report.skeleton.bones + ' bones' : 'nothing inspected yet');
        }
        this.fillTable(document.getElementById('model-meshes'), ['Mesh', 'Verts', 'Tris', 'Material', 'Skin'],
            report ? report.meshes.map(m => ({ cells: [m.name, m.vertices, m.triangles, m.material || '—', m.skinned ? (m.bound ? 'bound' : 'UNBOUND') : '—'] })) : []);
        // The bone hierarchy, so the Model panel answers "what joints does this file have" and not
        // only "how many" — the count alone cannot tell a designer whether the rig is right.
        this.fillTable(document.getElementById('model-bones'), ['Bone', 'Parent'],
            report && report.bones ? report.bones.map(b => ({ cells: [b.name, b.parent || '—'] })) : []);
        this.fillFindings(document.getElementById('model-findings'), report ? report.findings : []);
        if (typeof ConsolePane !== 'undefined' && ConsolePane.setFindings) ConsolePane.setFindings('model', report ? report.findings : []);
    },

    // --- rig editor -----------------------------------------------------------

    buildRig() {
        const body = document.getElementById('editor-panel-rig');
        if (!body) return;
        body.innerHTML = '';
        const bar = document.createElement('div');
        bar.className = 'panel-toolbar';
        bar.appendChild(this.button('+ Bone', () => {
            if (typeof RigEditor === 'undefined') return;
            // A rig has to be able to START FROM NOTHING: requiring a loaded model first made the
            // button silently do nothing on a fresh editor, which reads as a broken panel.
            if (!RigEditor.doc) RigEditor.setDocument(RigEditor.create('Rig'));
            const parent = RigEditor.selected || '';
            let name = 'bone';
            let n = 1;
            while (RigEditor.bone(name + n)) n++;
            name = name + n;
            if (RigEditor.addBone(name, parent)) { RigEditor.selected = name; this.refreshRig(); }
        }, 'Add a child bone under the selection'));
        bar.appendChild(this.button('− Bone', () => {
            if (typeof RigEditor === 'undefined' || !RigEditor.selected) return;
            if (RigEditor.removeBone(RigEditor.selected)) { RigEditor.selected = 'root'; this.refreshRig(); }
        }, 'Delete the selected bone (its children are re-parented)'));
        bar.appendChild(this.button('Load from scene', () => this.loadRigFromScene(), 'Build the rig from the inspected model skeleton'));
        bar.appendChild(this.button('Apply to skeleton', () => this.applyRig(), 'Write the bind positions onto the live skeleton'));
        body.appendChild(bar);

        const tree = document.createElement('div');
        tree.id = 'rig-tree';
        tree.className = 'panel-scroll rig-tree';
        body.appendChild(tree);
        const props = document.createElement('div');
        props.id = 'rig-props';
        props.className = 'panel-props';
        body.appendChild(props);
        const findings = document.createElement('div');
        findings.id = 'rig-findings';
        findings.className = 'panel-findings';
        body.appendChild(findings);
    },

    /** Read the skeleton of the inspected model into an editable rig. */
    loadRigFromScene() {
        if (typeof RigEditor === 'undefined' || !this.modelRoot) return false;
        let skeleton = this.modelRoot.skeleton;
        if (!skeleton && this.modelRoot.getChildMeshes) {
            for (const mesh of this.modelRoot.getChildMeshes(false)) { if (mesh.skeleton) { skeleton = mesh.skeleton; break; } }
        }
        if (!skeleton || !skeleton.bones) return false;
        const doc = RigEditor.create(skeleton.name || 'Skeleton');
        doc.bones = skeleton.bones.map(bone => ({
            name: bone.name,
            parent: (bone.getParent && bone.getParent() && bone.getParent().name) || '',
            position: { x: bone.position ? bone.position.x : 0, y: bone.position ? bone.position.y : 0, z: bone.position ? bone.position.z : 0 },
        }));
        RigEditor.setDocument(doc);
        this.refreshRig();
        return true;
    },

    applyRig() {
        if (typeof RigEditor === 'undefined' || !this.modelRoot) return 0;
        let skeleton = this.modelRoot.skeleton;
        if (!skeleton && this.modelRoot.getChildMeshes) {
            for (const mesh of this.modelRoot.getChildMeshes(false)) { if (mesh.skeleton) { skeleton = mesh.skeleton; break; } }
        }
        const applied = RigEditor.applyTo(skeleton);
        this.refreshRig();
        return applied;
    },

    refreshRig() {
        const doc = typeof RigEditor !== 'undefined' ? RigEditor.doc : null;
        const tree = document.getElementById('rig-tree');
        if (tree) {
            tree.innerHTML = '';
            const rows = doc ? RigEditor.flatten() : [];
            if (!rows.length) {
                const empty = document.createElement('div');
                empty.className = 'panel-ok';
                empty.textContent = 'No rig — inspect a model and press "Load from scene"';
                tree.appendChild(empty);
            }
            for (const row of rows) {
                const el = document.createElement('div');
                el.className = 'rig-row' + (RigEditor.selected === row.name ? ' selected' : '') + (row.orphan ? ' orphan' : '');
                el.style.paddingLeft = (6 + row.depth * 14) + 'px';
                el.textContent = (row.hasChildren ? '▾ ' : '· ') + row.name + (row.orphan ? '  ⚠' : '');
                el.addEventListener('click', () => { RigEditor.selected = row.name; this.refreshRig(); });
                tree.appendChild(el);
            }
        }
        // Properties of the selected bone.
        const props = document.getElementById('rig-props');
        if (props) {
            props.innerHTML = '';
            const bone = doc && RigEditor.selected ? RigEditor.bone(RigEditor.selected) : null;
            if (bone) {
                const nameInput = document.createElement('input');
                nameInput.type = 'text';
                nameInput.className = 'panel-input';
                nameInput.value = bone.name;
                nameInput.addEventListener('change', () => {
                    if (RigEditor.renameBone(RigEditor.selected, nameInput.value)) { RigEditor.selected = nameInput.value.trim(); this.refreshRig(); }
                });
                props.appendChild(this.row('Name', nameInput));
                const parentInput = document.createElement('input');
                parentInput.type = 'text';
                parentInput.className = 'panel-input';
                parentInput.value = bone.parent || '';
                parentInput.addEventListener('change', () => {
                    if (RigEditor.reparent(RigEditor.selected, parentInput.value.trim())) this.refreshRig();
                    else parentInput.value = bone.parent || '';
                });
                props.appendChild(this.row('Parent', parentInput));
                for (const axis of ['x', 'y', 'z']) {
                    const num = document.createElement('input');
                    num.type = 'number';
                    num.step = '0.01';
                    num.className = 'panel-input';
                    num.value = String((bone.position && bone.position[axis]) || 0);
                    num.addEventListener('change', () => {
                        const next = Object.assign({}, bone.position, { [axis]: Number(num.value) });
                        if (!RigEditor.setPosition(RigEditor.selected, next)) num.value = String((bone.position && bone.position[axis]) || 0);
                    });
                    props.appendChild(this.row('Bind ' + axis.toUpperCase(), num));
                }
            }
        }
        this.fillFindings(document.getElementById('rig-findings'), doc ? RigEditor.validate() : []);
        if (typeof ConsolePane !== 'undefined' && ConsolePane.setFindings) ConsolePane.setFindings('rig', doc ? RigEditor.validate() : []);
    },

    /** Redraw whichever panel is in front. */
    refresh() {
        if (this.active === 'anim') this.refreshAnim();
        else if (this.active === 'model') this.refreshModel();
        else if (this.active === 'rig') this.refreshRig();
    },
};

if (typeof module !== 'undefined' && module.exports) module.exports = EditorPanels;
if (typeof window !== 'undefined') /** @type {any} */ (window).EditorPanels = EditorPanels;
if (typeof globalThis !== 'undefined') /** @type {any} */ (globalThis).EditorPanels = EditorPanels;