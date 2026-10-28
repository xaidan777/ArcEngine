"""МГЛОТЕК. Облачный Blender-проход: самостоятельные 3D-окружения для 2.5D."""
import argparse
import math
import random
import sys
from pathlib import Path
import bpy
from mathutils import Vector
sys.path.insert(0, str(Path(__file__).resolve().parent))
from architectural_detail import decorate

THEMES = {
    "birch": ("Берёзовый двор", (.10,.16,.18), (.78,.48,.22)),
    "nursery": ("Забытая детская", (.10,.12,.20), (.77,.57,.34)),
    "bakery": ("Остывшая пекарня", (.20,.10,.075), (1.,.29,.06)),
    "kern": ("Сердце пекарни", (.24,.065,.045), (1.,.22,.04)),
    "station": ("Вокзал Немых", (.08,.15,.19), (.8,.57,.35)),
    "depot": ("Зал потерянных билетов", (.08,.14,.17), (.77,.53,.29)),
    "carriage": ("Вагон несбывшегося", (.075,.12,.17), (.70,.52,.33)),
    "conductor": ("Перрон последней ноты", (.14,.10,.19), (.65,.39,.82)),
    "archive": ("Архив чужих имён", (.09,.12,.17), (.57,.73,.85)),
    "cistern": ("Цистерна Мглы", (.06,.14,.16), (.50,.76,.73)),
    "vault": ("Зал Смотрителя", (.13,.10,.17), (.74,.64,.90)),
}

def mat(name, rgb, metallic=0., roughness=.85, emit=0.):
    m=bpy.data.materials.new(name);m.diffuse_color=(*rgb,1);m.use_nodes=True
    p=m.node_tree.nodes.get("Principled BSDF")
    p.inputs["Base Color"].default_value=(*rgb,1)
    p.inputs["Roughness"].default_value=roughness
    p.inputs["Metallic"].default_value=metallic
    if emit:
        v=p.inputs.get("Emission Color") or p.inputs.get("Emission")
        if v: v.default_value=(*rgb,1)
        v=p.inputs.get("Emission Strength")
        if v: v.default_value=emit
    return m

def cube(name, pos, scale, material, bevel=0.):
    bpy.ops.mesh.primitive_cube_add(size=1, location=pos)
    o=bpy.context.object;o.name=name;o.dimensions=scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    o.data.materials.append(material)
    if bevel:
        b=o.modifiers.new("Worn edges","BEVEL");b.width=bevel;b.segments=2
        # CPU pipeline keeps low-poly hard edges without heavyweight normals
    return o

def cylinder(name,pos,radius,depth,material,vertices=12):
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices,radius=radius,depth=depth,location=pos)
    o=bpy.context.object;o.name=name;o.data.materials.append(material)
    return o

def light(name,pos,color,energy,size):
    d=bpy.data.lights.new(name,"AREA");d.energy=energy;d.color=color;d.shape="DISK";d.size=size
    o=bpy.data.objects.new(name,d);bpy.context.collection.objects.link(o);o.location=pos
    o.rotation_euler=(Vector((17,0,2))-o.location).to_track_quat("-Z","Y").to_euler()

def face_window(x,z,glass,trim):
    cube("Window frame",(x,-1.73,z),(1.0,.1,1.45),trim,.07)
    cube("Lit remembered room",(x,-1.80,z),(.75,.09,1.16),glass,.02)
    cube("Window cross H",(x,-1.85,z),(.85,.07,.08),trim)
    cube("Window cross V",(x,-1.86,z),(.08,.08,1.29),trim)

def house(x,rng,stone,wood,roof,glass):
    h=rng.uniform(3.1,4.5);w=rng.uniform(3.4,5.8)
    cube("House / warped plaster",(x,0,h/2),(w,3.4,h),stone,.09)
    slab=cube("Collapsed roof",(x,-.04,h+.37),(w+1,3.9,.35),roof,.09)
    slab.rotation_euler[1]=rng.uniform(-.18,.16)
    for n in range(5):
        xx=x-w/2+.4+n*(w-.8)/4
        cube("Exposed joist",(xx,-2.0,h+.12),(.12,.25,.75),wood)
    for xx in (x-w*.27,x+w*.27):
        face_window(xx,h*.52,glass,wood)
    cube("Sealed door",(x,-1.76,.98),(1.,.1,1.95),wood,.05)
    for j in range(7):
        y=-1.9
        z=.2+j*.35
        cube("Weathered horizontal plank",(x+rng.uniform(-.1,.1),y,z),(w*.72,.07,.055),wood)

def bridge(x,width,wood,iron,rng):
    cylinder("Suspended island root",(x,0,-.46),width*.18,.4,iron)
    cube("Walkable broken boards",(x,-1.4,.02),(width,2.8,.18),wood,.025)
    for n in range(int(width*2)):
        xx=x-width/2+n*.48
        piece=cube("Splintered walking board",(xx,-1.43,.16),(.42,2.73,.13),wood,.025)
        piece.rotation_euler[2]=rng.uniform(-.04,.04)
    for xx in (x-width/2+.15,x+width/2-.15):
        cylinder("Bridge support",(xx,-1.6,-.72),.09,1.4,iron)
    for zz in (1.0,1.6):
        cube("Railing",(x,-2.8,zz),(width,.07,.07),iron)

def tree(x,rng,bark,leaves):
    trunk=cylinder("Silver birch trunk",(x,-.15,2.75),.22,5.5,bark)
    trunk.rotation_euler[1]=rng.uniform(-.13,.13)
    for dx,z,angle in [(-1.1,4.2,-.38),(1.1,4.6,.40),(-.8,5.4,-.22)]:
        limb=cylinder("Dead limb",(x+dx/2,-.15,z),.10,abs(dx)*2.4,bark,8)
        limb.rotation_euler[1]=angle
    for k in range(11):
        a=k*2.39996
        cylinder("Autumn canopy",(x+math.sin(a)*1.35,math.cos(a)*.75,5.5+math.sin(k*1.6)*.75),
                 rng.uniform(.16,.30),.15,leaves,7)


def age_surface(material, scale=18., strength=.24):
    """Procedural surface breakup on actual Blender material nodes."""
    nodes=material.node_tree.nodes;links=material.node_tree.links
    bsdf=nodes.get("Principled BSDF")
    tex=nodes.new("ShaderNodeTexNoise");tex.inputs["Scale"].default_value=scale
    tex.inputs["Roughness"].default_value=.78
    bump=nodes.new("ShaderNodeBump");bump.inputs["Strength"].default_value=strength
    bump.inputs["Distance"].default_value=.065
    links.new(tex.outputs["Fac"],bump.inputs["Height"])
    links.new(bump.outputs["Normal"],bsdf.inputs["Normal"])
    cr=nodes.new("ShaderNodeValToRGB")
    cr.color_ramp.elements[0].position=.13
    cr.color_ramp.elements[0].color=(*tuple(v*.48 for v in material.diffuse_color[:3]),1)
    cr.color_ramp.elements[1].position=.87
    cr.color_ramp.elements[1].color=(*material.diffuse_color[:3],1)
    links.new(tex.outputs["Fac"],cr.inputs["Fac"])
    links.new(cr.outputs["Color"],bsdf.inputs["Base Color"])


def detail_scene(theme, rng, wood, iron, stone, glow):
    """Rotted beams, stained masonry, hanging chains, roof tiles, interior glow."""
    patina=mat("Copper roof patina",(.09,.19,.17),.52,.39)
    moss=mat("Wet moss / memory growth",(.055,.15,.10),.0,.98)
    glass=mat("Old lamp glass",(.76,.43,.18),.08,.21,1.0)
    for i,x in enumerate((2.5,9.2,16.4,24.5,32.)):
        h=4.9
        for z in (.9,1.7,2.5,3.35):
            for dx in (-1.6,1.6):
                cube("Rib / cracked corner",(x+dx,-1.83,z),(.18,.23,.85),stone,.03)
        for n in range(8):
            xx=x-2.9+n*.8
            o=cube("Uneven patinated roof shingle",(xx,-.8,4.85+rng.uniform(-.1,.1)),(.74,2.7,.12),patina,.028)
            o.rotation_euler[1]=rng.uniform(-.12,.12)
        for q in range(3):
            xx=x+rng.uniform(-2.0,2.0)
            cube("Rain-spoiled masonry / moss",(xx,-1.89,rng.uniform(.6,3.5)),
                 (rng.uniform(.1,.25),.09,rng.uniform(.25,.7)),moss,.02)
        cylinder("Chimney / broken flue",(x+1.8,.6,5.35),.27,1.35,iron,9)
        cylinder("Flue opening",(x+1.8,.6,6.03),.29,.075,patina,9)
        if i%2==0:
            cube("Hanging lamp bracket",(x-.8,-2.2,3.3),(.10,.9,.10),iron)
            cylinder("Amber lamp",(x-.8,-2.7,2.85),.15,.5,glass,8)
    for x in (5.,14.,22.,30.):
        for xx in (x-2.4,x+2.4):
            for n in range(2):
                cylinder("Rusted chains",(xx,-2.5,.8+n*.75),.032,.62,iron,7)
    if theme in ("station","depot","carriage","conductor"):
        for x in (7,17,27):
            cube("Platform clock support",(x,-2.1,3.8),(.12,.1,1.6),iron)
            cylinder("Hanging clock",(x,-2.22,4.5),.55,.18,stone,24)
    if theme in ("archive","vault","cistern"):
        for x in (4.,12.,20.,29.):
            for z in (1.0,2.4,3.8):
                cube("Archive panel",(x,-2.0,z),(1.2,.15,1.05),iron,.05)
                cube("Inscribed memory",(x,-2.10,z),(.82,.04,.45),glow,.01)

def configure(cam_target,sky,scene):
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.samples = 12
    scene.cycles.use_denoising = False
    scene.render.image_settings.file_format="PNG";scene.render.image_settings.color_mode="RGBA"
    scene.render.film_transparent=True
    scene.render.resolution_x=1900;scene.render.resolution_y=470
    scene.render.resolution_percentage=100
    bpy.ops.object.camera_add(location=(17.3,-39.0,7.6))
    camera=bpy.context.object;camera.name="MGLOTEK_2_5D_ORTHO"
    camera.rotation_euler=(Vector(cam_target)-camera.location).to_track_quat("-Z","Y").to_euler()
    camera.data.type="ORTHO";camera.data.ortho_scale=35.5;scene.camera=camera
    scene.world.use_nodes=True
    worldbg=scene.world.node_tree.nodes.get("Background")
    worldbg.inputs["Color"].default_value=(*sky,1)
    worldbg.inputs["Strength"].default_value=.55
    light("Moon rim",(9,-7,13),(.57,.75,1),1800,12)
    light("Remembered fire",(25,-1,7),(1.,.46,.18),1300,10)
    scene.camera.data.lens=35

def build(theme,out):
    bpy.ops.object.select_all(action="SELECT");bpy.ops.object.delete(use_global=False)
    label,sky,warm=THEMES[theme]
    r=random.Random(173+list(THEMES).index(theme))
    stone=mat("Wet chipped masonry",tuple(x*.76 for x in sky),.08)
    roof=mat("Dark ruined roof",(.08,.095,.105),.10)
    wood=mat("Rain-soaked timber",(.23,.19,.15),.02)
    iron=mat("Oxidized metal",(.075,.13,.15),.68,.5)
    bark=mat("Pale peeling birch bark",(.65,.63,.56),.0)
    leaf=mat("Dead leaves",(.49,.26,.105))
    glow=mat("Lamp / memory light",warm,0.,.42,2.2)
    for x in (2.5,9.2,16.4,24.5,32):
        house(x,r,stone,wood,roof,glow)
    for x in (5.,14.,22.,30.):
        bridge(x,5.6,wood,iron,r)
    if theme in ("birch","nursery"):
        for x in (6.,17.3,28.):tree(x,r,bark,leaf)
    else:
        for x in (6.,15.,26.):
            cylinder("Ancient rusted column",(x,1.3,2.9),.22,5.8,iron)
            cube("Luminous sign",(x,-1.3,4.25),(.5,.13,1.0),glow,.05)
    for surface in (stone,roof,wood,iron,bark):
        age_surface(surface)
    detail_scene(theme,r,wood,iron,stone,glow)
    decorate(theme,r,cube,cylinder,mat,wood,iron,stone,glow)
    configure((17,0,2.1),sky,bpy.context.scene)
    out.mkdir(parents=True,exist_ok=True)
    blend=out/(theme+".blend");bpy.ops.wm.save_as_mainfile(filepath=str(blend))
    bpy.context.scene.render.filepath=str(out/(theme+"_mid.png"))
    bpy.ops.render.render(write_still=True)
    glb=out/(theme+".glb")
    bpy.ops.export_scene.gltf(filepath=str(glb),export_format="GLB")
    print("Rendered",label,flush=True)

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument("--scene",default="birch",choices=[*THEMES,"all"])
    ap.add_argument("--out",default="cloud_output")
    argv=sys.argv[sys.argv.index("--")+1:] if "--" in sys.argv else []
    args=ap.parse_args(argv)
    for t in (THEMES if args.scene=="all" else [args.scene]):
        build(t,Path(args.out).resolve())
if __name__=="__main__":main()
