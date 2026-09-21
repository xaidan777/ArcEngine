import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { loadScripts } from './browser-scripts.mjs';

for (const [name, clips] of Object.entries({ cricket: ['idle','jump','land','walk'], screamer: ['idle','scream','walk'], spotter: ['alert','fly','idle'] })) {
    test(`${name}: embedded textures, rigid skin and complete animation clips`, () => {
        const bytes = readFileSync(new URL(`../assets/models/rigged/${name}.glb`, import.meta.url));
        const length = bytes.readUInt32LE(12);
        const doc = JSON.parse(bytes.toString('utf8', 20, 20 + length));
        const bin = bytes.subarray(28 + length);
        assert.equal(bytes.readUInt32LE(8), bytes.length);
        assert.deepEqual(doc.animations.map(a => a.name).sort(), clips);
        assert.equal(doc.skins.length, 1);
        assert.ok(doc.images.every(i => i.bufferView !== undefined));
        for (const view of doc.bufferViews) assert.ok((view.byteOffset || 0) + view.byteLength <= bin.length);
        const used = new Set();
        for (const mesh of doc.meshes) for (const p of mesh.primitives) {
            const weights = doc.accessors[p.attributes.WEIGHTS_0];
            const joints = doc.accessors[p.attributes.JOINTS_0];
            assert.equal(weights.count, doc.accessors[p.attributes.POSITION].count);
            const wv = doc.bufferViews[weights.bufferView], jv = doc.bufferViews[joints.bufferView];
            for (let i = 0; i < weights.count; i++) {
                const offset = (wv.byteOffset || 0) + (weights.byteOffset || 0) + i * (wv.byteStride || 16);
                const w = Array.from({length:4}, (_, j) => bin.readFloatLE(offset + j * 4));
                assert.equal(w.filter(v => v === 1).length, 1, 'metal must have a single rigid bone influence');
                assert.equal(w.reduce((a,b)=>a+b,0), 1);
                const width = joints.componentType === 5121 ? 1 : 2;
                const jointOffset = (jv.byteOffset || 0) + (joints.byteOffset || 0) + i * (jv.byteStride || width * 4) + w.indexOf(1) * width;
                const joint = width === 1 ? bin.readUInt8(jointOffset) : bin.readUInt16LE(jointOffset);
                assert.ok(joint < doc.skins[0].joints.length);
                used.add(doc.nodes[doc.skins[0].joints[joint]].name);
            }
        }
        if (name !== 'spotter') for (const limb of ['front.L','front.R','rear.L','rear.R']) {
            assert.ok(used.has(limb+'.upper'), limb);
            assert.ok(used.has(limb+'.lower'), limb);
            assert.ok(used.has(limb+'.foot'), limb);
        }
    });
}

function controller(archetype='cricket') {
    const ctx=loadScripts(['js/Constants.js','js/BotRig3D.js']);
    const tracks=new Map(['idle','walk','jump','land','scream','fly','alert'].map(name=>[name,{group:{from:0,to:60,targetedAnimations:[{animation:{framePerSecond:60}}],speedRatio:1,goToFrame(f){this.frame=f;}}}]));
    const clips={tracks,play(name,opts){this.current=name;this.options=opts;tracks.get(name).group.speedRatio=opts.speed;}};
    const rig={clips,model:{scaling:{x:1}},x:null,y:null,jumping:false,event:'',remaining:0};
    const enemy={x:0,y:0,archetype,state:'patrol',visual:{metadata:{botRig:rig}}};
    return {api:ctx.get('BotRig3D'),enemy,rig,clips};
}
test('bot locomotion follows distance, stays idle when blocked and freezes on death',()=>{
    const {api,enemy,clips}=controller();
    api.update(enemy,.1);assert.equal(clips.current,'idle');
    enemy.x+=1.68;api.update(enemy,.1);assert.equal(clips.current,'walk');assert.ok(Math.abs(clips.options.speed-1)<1e-9);
    api.update(enemy,.1);assert.equal(clips.current,'idle');
    enemy.dead=true;api.update(enemy,.1);assert.ok([...clips.tracks.values()].every(t=>t.group.speedRatio===0));
});
test('jump samples gameplay progress and triggers a finite landing recovery',()=>{
    const {api,enemy,clips}=controller();
    enemy.isLeaping=true;enemy.leapProgress=.5;api.update(enemy,.1);
    assert.equal(clips.current,'jump');assert.equal(clips.tracks.get('jump').group.frame,30);
    enemy.isLeaping=false;api.update(enemy,.1);assert.equal(clips.current,'land');
    api.update(enemy,1);assert.equal(clips.current,'idle');assert.equal(clips.paused,false);
});
test('scream interrupts walking; paused bot does not advance its attack timer',()=>{
    const {api,enemy,clips,rig}=controller('screamer');
    api.signal(enemy.visual,'scream');api.update(enemy,.1);assert.equal(clips.current,'scream');
    const remaining=rig.remaining;api.update(enemy,0);assert.equal(rig.remaining,remaining);assert.equal(clips.paused,true);
    api.update(enemy,1);assert.equal(clips.current,'idle');assert.equal(clips.paused,false);
});
