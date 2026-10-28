"""Cloud Blender: original MGLOTEK humanoids rendered to pygame 10x6 sprite sheets.
Blender 4.x CPU; all animation states are poses, not duplicated static images.
"""
import argparse
import math
import random
import sys
from pathlib import Path
import bpy
from mathutils import Vector
sys.path.insert(0, str(Path(__file__).resolve().parent))
import hero_concept

NAMES=("ash","baker","soldier","nanny")
STATES=("idle","walk","jump","dash","charge","attack","hurt","ritual","pursue","windup")
SIZES={"ash":(180,228),"baker":(180,228),"soldier":(180,228),"nanny":(180,228)}
PARTS={}

def material(name,color,metal=0,rough=.8,emission=0):
    m=bpy.data.materials.new(name);m.diffuse_color=(*color,1);m.use_nodes=True
    p=m.node_tree.nodes.get("Principled BSDF")
    p.inputs["Base Color"].default_value=(*color,1)
    p.inputs["Metallic"].default_value=metal
    p.inputs["Roughness"].default_value=rough
    if emission:
        p.inputs["Emission Color"].default_value=(*color,1)
        p.inputs["Emission Strength"].default_value=emission
    return m

def mesh(name,typ="cube",mat=None):
    if typ=="cube": bpy.ops.mesh.primitive_cube_add(size=1)
    elif typ=="sphere": bpy.ops.mesh.primitive_uv_sphere_add(segments=28,ring_count=20)
    else: bpy.ops.mesh.primitive_cylinder_add(vertices=20,radius=1,depth=2)
    o=bpy.context.object;o.name=name
    if typ!="cube":
        for polygon in o.data.polygons: polygon.use_smooth=True
    if mat:o.data.materials.append(mat)
    return o

def part(name,mat,typ="cube"):
    o=mesh(name,typ,mat);PARTS[name]=o
    return o

def shape(name,pos,scale,mat,typ="sphere"):
    o=part(name,mat,typ)
    o.location=pos;o.scale=scale
    return o

def segment(name,mat):
    return part(name,mat,"cylinder")

def place_line(name,a,b,radius):
    obj=PARTS[name]
    va,vb=Vector(a),Vector(b)
    vec=vb-va
    obj.location=(va+vb)*.5
    obj.rotation_euler=vec.to_track_quat("Z","Y").to_euler()
    obj.scale=(radius,radius,max(.001,vec.length/2))

def move(name,pos,rot=0):
    obj=PARTS[name];obj.location=pos;obj.rotation_euler=(0,rot,0)

def body(name):
    bpy.ops.object.select_all(action="SELECT");bpy.ops.object.delete(use_global=False)
    PARTS.clear()
    palette={
        "ash":((.09,.15,.18),(.27,.30,.31),(.34,.18,.11),(.94,.50,.20)),
        "baker":((.24,.18,.14),(.40,.30,.23),(.34,.30,.26),(.95,.26,.08)),
        "soldier":((.12,.17,.19),(.27,.34,.36),(.37,.42,.40),(.76,.86,.91)),
        "nanny":((.14,.16,.20),(.28,.32,.34),(.38,.34,.30),(.72,.42,.68)),
    }
    dark,cloth,iron,light=palette[name]
    suit=material("Damp stitched cloth",cloth,0,.93)
    hood=material("Hood shadow",dark,0,.96)
    gear=material("Oxidized fittings",iron,.65,.51)
    skin=material("Gloved leather",tuple(min(1,x+.09) for x in dark),0,.86)
    lamp=material("Remembered amber",light,0,.38,1.5)
    blade=material("Hook scythe / steel",(.38,.43,.43),.8,.38)
    shape("Torso",(0,0,2.45),(.65,.42,.9),suit)
    shape("Waist",(0,0,1.74),(.48,.37,.37),gear)
    shape("Hood",(0,0,3.34),(.57,.46,.66),hood)
    shape("Faceless mask",(.10,-.35,3.37),(.38,.18,.42),skin)
    shape("Cowl collar",(0,.05,3.02),(.63,.45,.28),suit)
    shape("Cape / ragged back",(-.39,.25,2.15),(.30,.24,1.15),hood)
    shape("Chest lantern",(.47,-.43,2.50),(.19,.17,.25),lamp)
    shape("Belt buckle",(.23,-.36,1.76),(.19,.07,.13),gear,"cube")
    for which in ("l","r"):
        for piece in ("thigh","shin","upperarm","forearm"):
            segment(which+piece,suit if piece in ("thigh","upperarm") else gear)
        for joint in ("knee","elbow"):
            shape(which+joint,(0,0,0),(.135,.14,.135),gear)
        shape(which+"foot",(0,0,.1),(.28,.23,.11),skin,"cube")
        shape(which+"hand",(0,0,0),(.17,.16,.17),skin)
    for a in ("shaft","blade1","blade2"):
        segment(a,blade if a.startswith("blade") else gear)
    # Distinct silhouettes without copyrighted external character assets
    if name=="baker":
        shape("Apron",(0,-.24,1.65),(.51,.18,.82),suit,"cube")
        shape("Chef burned crown",(0,0,3.87),(.47,.41,.27),cloth and suit)
    elif name=="soldier":
        shape("Left pauldron",(-.52,0,2.86),(.29,.44,.30),gear)
        shape("Right pauldron",(.52,0,2.86),(.29,.44,.30),gear)
        shape("Half helm",(0,0,3.79),(.53,.45,.22),gear)
    elif name=="nanny":
        shape("Veil",(-.29,.22,3.08),(.34,.25,.91),hood)
        shape("Long tattered skirt",(0,0,1.49),(.55,.45,.71),suit)
    else:
        shape("Hook quiver",(-.45,.27,2.35),(.25,.23,.58),gear)
        hero_concept.dress(PARTS,shape)
    bpy.ops.object.camera_add(location=(4.0,-13.8,2.75))
    cam=bpy.context.object;cam.name="MGLOTEK_SIDE_ORTHO"
    target=Vector((0,0,1.95))
    cam.rotation_euler=(target-cam.location).to_track_quat("-Z","Y").to_euler()
    cam.data.type="ORTHO";cam.data.ortho_scale=5.15 if name=="ash" else 4.75
    scene=bpy.context.scene;scene.camera=cam
    bpy.ops.object.light_add(type="AREA",location=(-3,-5,7))
    bpy.context.object.data.energy=520;bpy.context.object.data.size=5.0
    bpy.ops.object.light_add(type="AREA",location=(2,3,5))
    bpy.context.object.data.energy=410;bpy.context.object.data.size=4.0
    scene.world.use_nodes=True;scene.world.node_tree.nodes["Background"].inputs["Strength"].default_value=.28
    scene.render.engine="CYCLES";scene.cycles.device="CPU"
    scene.cycles.samples=16 if name=="ash" else 7;scene.cycles.use_denoising=False
    scene.render.image_settings.file_format="PNG"
    scene.render.image_settings.color_mode="RGBA"
    scene.render.film_transparent=True
    scene.render.resolution_x,scene.render.resolution_y=SIZES[name]
    scene.render.resolution_percentage=100
    scene.view_settings.view_transform="Standard"
    scene.view_settings.look="Medium High Contrast"

def pose(state,i):
    t=i/6*2*math.pi
    walk=state in ("walk","pursue")
    cycle=math.sin(t) * (1.0 if state=="walk" else 1.25 if state=="pursue" else 0)
    bob=(.06*math.sin(t*2) if walk else .035*math.sin(t))
    lean=.28 if state=="dash" else -.25 if state=="hurt" else .10 if state=="attack" else 0
    tuck=.39 if state=="jump" else 0
    bob+=.19 if state=="jump" else -.10 if state=="dash" else 0
    move("Torso",(lean*.3,0,2.45+bob),lean*.28)
    move("Waist",(0,0,1.74+bob))
    move("Hood",(lean*.7,0,3.34+bob),lean*.16)
    move("Faceless mask",(.10+lean*.7,-.35,3.37+bob),lean*.15)
    move("Cowl collar",(lean*.45,.05,3.02+bob),lean*.10)
    move("Cape / ragged back",(-.39-lean*.6,.25,2.15+bob),-.16+lean*.6+.055*math.sin(t))
    move("Chest lantern",(.47+lean*.35,-.43,2.50+bob))
    move("Belt buckle",(.23,-.36,1.76+bob))
    if "Apron" in PARTS:move("Apron",(0,-.24,1.65+bob))
    if "Chef burned crown" in PARTS:move("Chef burned crown",(lean*.7,0,3.87+bob))
    for key in ("Left pauldron","Right pauldron","Half helm","Veil","Long tattered skirt","Hook quiver"):
        if key in PARTS:
            original={"Left pauldron":(-.52,0,2.86),"Right pauldron":(.52,0,2.86),
                      "Half helm":(0,0,3.79),"Veil":(-.29,.22,3.08),
                      "Long tattered skirt":(0,0,1.49),"Hook quiver":(-.45,.27,2.35)}[key]
            move(key,(original[0]+lean*.3,original[1],original[2]+bob),lean*.11)
    hands={}
    for s,which in ((1,"l"),(-1,"r")):
        hip=(s*.23,0,1.72+bob)
        knee=(s*.24+cycle*s*.23,0,.98+tuck*.35+bob)
        foot=(s*.25+cycle*s*.43,0,.15+tuck+bob)
        place_line(which+"thigh",hip,knee,.17)
        place_line(which+"shin",knee,foot,.125)
        move(which+"knee",knee)
        move(which+"foot",(foot[0]+.11,0,foot[2]-.07))
        shoulder=(s*.49,0,2.84+bob)
        swing=-cycle*s*.32
        if state=="attack":
            swing=(.78*math.sin((i/5)*math.pi*1.35)) if s==1 else -.14
        if state=="charge":swing=.45 if s==1 else -.23
        if state=="windup":swing=-.48 if s==1 else -.12
        if state=="ritual":swing=.30*s
        if state=="hurt":swing=-.45
        elbow=(s*.69+swing,0,2.35+bob)
        wrist=(s*.75+swing*1.5,0,1.94+bob+swing*.30)
        place_line(which+"upperarm",shoulder,elbow,.15)
        place_line(which+"forearm",elbow,wrist,.125)
        move(which+"elbow",elbow)
        move(which+"hand",wrist)
        hands[which]=wrist
    x,y,z=hands["l"]
    tip=(x+.24,0,z+.88)
    place_line("shaft",(x,0,z),tip,.065)
    place_line("blade1",tip,(tip[0]+.48,0,tip[2]+.17),.082)
    place_line("blade2",(tip[0]+.48,0,tip[2]+.17),(tip[0]+.63,0,tip[2]-.21),.065)
    if "Scarf collar" in PARTS:
        hero_concept.animate(PARTS,move,state,i,bob,lean,cycle)

def run(name,out):
    body(name);out.mkdir(parents=True,exist_ok=True)
    pose("idle",0)
    bpy.ops.wm.save_as_mainfile(filepath=str(out/(name+".blend")))
    bpy.ops.export_scene.gltf(filepath=str(out/(name+".glb")),export_format="GLB",
                               export_cameras=False,export_lights=False)
    frame_dir=out/(name+"_frames");frame_dir.mkdir(exist_ok=True)
    for row,state in enumerate(STATES):
        for col in range(6):
            pose(state,col)
            bpy.context.scene.render.filepath=str(frame_dir/("%02d_%02d.png"%(row,col)))
            bpy.ops.render.render(write_still=True)
        print("State",name,state,"rendered",flush=True)
    if name=="ash":
        pose("idle",0)
        scene=bpy.context.scene
        scene.render.resolution_x=720
        scene.render.resolution_y=912
        scene.cycles.samples=32
        scene.render.filepath=str(out/"ash_concept_portrait.png")
        bpy.ops.render.render(write_still=True)
    print("FINISHED",name,flush=True)

if __name__=="__main__":
    p=argparse.ArgumentParser()
    p.add_argument("--name",choices=NAMES,required=True)
    p.add_argument("--out",default="cloud_char_output")
    argv=sys.argv[sys.argv.index("--")+1:] if "--" in sys.argv else []
    a=p.parse_args(argv)
    run(a.name,Path(a.out).resolve())
