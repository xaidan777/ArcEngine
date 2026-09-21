import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { loadScripts } from './browser-scripts.mjs';
const require=createRequire(import.meta.url);
const BABYLON=require('../libs/babylon.js');
const {get}=loadScripts(['js/World3D.js','js/Gltf3D.js'],{BABYLON});

test('chamfered boxes are closed, outward-facing and retain their dimensions',()=>{
 const engine=new BABYLON.NullEngine(),scene=new BABYLON.Scene(engine);
 for(const size of [[10,20,30],[0.18,0.14,0.46]]) {
  const mesh=get('World3D').createBeveledBox('test',size,scene);
  const p=mesh.getVerticesData('position'),n=mesh.getVerticesData('normal');
  const bb=mesh.getBoundingInfo().boundingBox;
  for(let axis=0;axis<3;axis++)assert.ok(Math.abs(bb.extendSize.asArray()[axis]*2-size[axis])<1e-5);
  for(let i=0;i<p.length;i+=3)assert.ok(p[i]*n[i]+p[i+1]*n[i+1]+p[i+2]*n[i+2]>0,'normals point outside the solid');
  const edges=new Map(),key=i=>p.slice(i*3,i*3+3).join(',');
  const indices=mesh.getIndices();
  for(let i=0;i<indices.length;i+=3)for(let j=0;j<3;j++){
   const edge=[key(indices[i+j]),key(indices[i+(j+1)%3])].sort().join('|');
   edges.set(edge,(edges.get(edge)||0)+1);
  }
  assert.ok([...edges.values()].every(count=>count===2),'every edge belongs to exactly two faces');
 }
 scene.dispose();engine.dispose();
});

test('PBR ↔ toon switching preserves source surface properties without accumulating materials',()=>{
 const engine=new BABYLON.NullEngine(),scene=new BABYLON.Scene(engine);
 const src=new BABYLON.PBRMaterial('source',scene);
 src.metallic=0.83;src.roughness=0.27;src.alpha=0.72;src.invertNormalMapY=true;
 src.sideOrientation=BABYLON.Material.CounterClockWiseSideOrientation;
 const mesh=BABYLON.MeshBuilder.CreateBox('model',{},scene);mesh.material=src;
 const binding={source:src,name:'model',meshes:[mesh],pbr:null,toon:null};
 const gltf=get('Gltf3D');gltf._renders.set(scene,new Set([binding]));
 gltf.applyMaterialMode(scene,false);
 assert.notEqual(mesh.material,src);assert.equal(mesh.material.metallic,0.83);assert.equal(mesh.material.roughness,0.27);
 gltf.applyMaterialMode(scene,true);
 assert.ok(mesh.material instanceof BABYLON.StandardMaterial);assert.equal(mesh.material.alpha,0.72);
 assert.equal(mesh.material.sideOrientation,src.sideOrientation);
 const count=scene.materials.length;
 for(let i=0;i<20;i++)gltf.applyMaterialMode(scene,i%2===0);
 assert.equal(scene.materials.length,count);
 gltf.applyMaterialMode(scene,false);assert.equal(mesh.material.invertNormalMapY,true);
 assert.equal(src.metallic,0.83);assert.equal(src.roughness,0.27);
 scene.dispose();engine.dispose();
});
