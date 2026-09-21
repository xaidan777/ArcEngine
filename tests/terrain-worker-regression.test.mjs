import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {loadScripts} from './browser-scripts.mjs';
const B=createRequire(import.meta.url)('../libs/babylon.js');

test('worker normals match Babylon on unequal-area slopes and degenerate faces',()=>{
 const {get}=loadScripts(['js/engine/workers/ArcJobWorker.js']);
 const positions=new Float32Array([0,0,0,10,0,0,10,4,10,0,30,10,100,0,100]);
 const indices=new Uint32Array([0,1,2,0,2,3,4,4,4]);const expected=new Float32Array(positions.length);
 B.VertexData.ComputeNormals(positions,indices,expected);
 const {result}=get('ArcJobWorker').handleComputeNormals({positions,indices});
 expected.forEach((v,i)=>assert.ok(Math.abs(v-result.normals[i])<1e-6,`normal ${i}`));
});

test('terrain transfers copies and ignores out-of-order normal replies',async()=>{
 const pending=[];
 const jobs={stats:{backend:'sync'},dispatch(type,payload,transfer){
  const copy=structuredClone(payload,{transfer});
  return new Promise(resolve=>pending.push({resolve,payload:copy}));
 }};
 const engine=new B.NullEngine(),scene=new B.Scene(engine);
 const {get}=loadScripts(['js/Constants.js','libs/simplex-noise.js','js/Terrain3D.js'],{BABYLON:B,World3D:{applyMaterialConstants(){}},ArcJobSystem:jobs});
 const terrain=new (get('Terrain3D'))({scene},{worldW:64,worldH:64,cell:16});await terrain.ready;
 jobs.stats.backend='workers';
 const indices=terrain.mesh.getIndices();const count=indices.length;
 const first=terrain.updateHeights();terrain.hgrid[0]+=20;const second=terrain.updateHeights();
 assert.equal(indices.length,count,'mesh indices are not detached');
 pending[1].resolve({normals:new Float32Array(terrain.hgrid.length*3).fill(0.5)});await second;
 pending[0].resolve({normals:new Float32Array(terrain.hgrid.length*3).fill(-1)});await first;
 assert.equal(terrain.mesh.getVerticesData('normal')[0],0.5);
 const last=terrain.updateHeights();terrain.dispose();pending[2].resolve({normals:new Float32Array(3)});await last;
 scene.dispose();engine.dispose();
});

test('spot helper follows angle, keeps its tip at the light and preserves saved height',()=>{
 const engine=new B.NullEngine(),scene=new B.Scene(engine);
 const {get}=loadScripts(['_utils/editor/light-manager.js'],{BABYLON:B,structuredClone});const manager=get('LightManager');manager.init(scene);
 const def=manager.createLight('spot',0,0,10,{direction:[1,-1,0],angle:30});const rec=manager.lights.get(def.id);
 const oldRadius=rec.cone.getBoundingInfo().boundingBox.extendSize.x;
 manager.updateLight(def.id,{angle:100});assert.ok(rec.cone.getBoundingInfo().boundingBox.extendSize.x>oldRadius);
 rec.cone.computeWorldMatrix(true);
 const tip=B.Vector3.TransformCoordinates(new B.Vector3(0,50,0),rec.cone.getWorldMatrix());assert.ok(B.Vector3.Distance(tip,rec.light.position)<1e-4);
 const dir=rec.light.direction.clone();rec.helper.position.x+=5;manager.onTransform(def.id);assert.ok(B.Vector3.Distance(dir,rec.light.direction)<1e-5);
 const saved=manager.exportDefs();scene._terrain={heightAt:()=>200};manager.importDefs(saved);assert.equal(manager.exportDefs()[0].h,10);
 manager.clear();assert.equal(scene.materials.filter(m=>m.name.startsWith('mat_')).length,0);scene.dispose();engine.dispose();
});

test('worker errors and shutdown settle pending jobs; clone errors leave no pending entry',async()=>{
 const workers=[];class Worker {constructor(){workers.push(this);}postMessage(){if(this.fail)throw new Error('clone');}terminate(){}}
 const {get}=loadScripts(['js/engine/ArcJobSystem.js'],{Worker});const jobs=new (get('ArcJobSystemCore'))();jobs.init({threads:1});
 const first=jobs.dispatch('TEST',{});const rejected=assert.rejects(first,/Worker failed/);workers[0].onerror({message:'crashed'});await rejected;assert.equal(jobs.pending.size,0);assert.equal(jobs.stats.backend,'sync');
 jobs.terminate();jobs.init({threads:1});workers[1].fail=true;await assert.rejects(jobs.dispatch('TEST',{}),/clone/);assert.equal(jobs.pending.size,0);
 workers[1].fail=false;const last=jobs.dispatch('TEST',{});const stopped=assert.rejects(last,/terminated/);jobs.terminate();await stopped;
});

test('foliage samples the rendered terrain triangles including zero heights',()=>{
 const {get}=loadScripts(['js/engine/workers/ArcJobWorker.js']);
 const result=get('ArcJobWorker').handleFoliageScatter({count:1,bounds:{minX:2,maxX:2,minY:1,maxY:1},clearanceDist:0,baseHeight:99,heightmap:{nx:2,ny:2,cell:4,data:new Float32Array([0,4,20,8])}}).result;
 // tx=.5, ty=.25, triangle 00-10-11: 0 + 4*.5 + 4*.25 = 3.
 assert.equal(result.buffer[13],3);
});

test('a delayed navigation build cannot replace a newer synchronous obstacle grid',async()=>{
 let resolve;const jobs={dispatch:()=>new Promise(r=>{resolve=r;})};
 const {get}=loadScripts(['js/NavGrid.js'],{ArcJobSystem:jobs});const grid=new (get('NavGrid'))({width:128,height:128},32);
 const pending=grid.buildAsync([]);grid.build([{x:16,y:16,radius:20}],0);assert.equal(grid.grid[0],1);
 resolve({grid:new Uint8Array(16)});await pending;assert.equal(grid.grid[0],1);
});

test('location loading does not wait for unrelated live-scene effect readiness',async()=>{
 const view={scene:{executeWhenReady(){throw new Error('Global scene readiness must not gate location assets');}}};
 const {get}=loadScripts(['js/Location3D.js'],{World3D:{createView:()=>view}});const Location=get('Location3D');
 let terrainReady;const terrainPromise=new Promise(resolve=>{terrainReady=resolve;});
 Location.prototype.buildTerrain=function(){this.terrain={ready:terrainPromise};};
 Location.prototype.loadGround=()=>Promise.resolve();Location.prototype.placeObjects=function(){this.placed=true;};
 const location=new Location({isEditor:true});terrainReady();await location.ready;assert.equal(location.placed,true);
});
