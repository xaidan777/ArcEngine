"""Rebuild mechanical bot rigs from untouched Tripo GLBs using Blender.
Run: blender --background --factory-startup --python tools/rig-bots.py
Coordinates below are landmarks measured on these specific source meshes.
"""
import bpy
import bmesh
import math
import sys
from pathlib import Path
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[1]
FPS = 30

def distance(p, a, b):
    a, b = Vector(a), Vector(b)
    d = b-a
    t = max(0, min(1, (p-a).dot(d)/d.length_squared))
    return (p-a-t*d).length

def setup(name):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(ROOT/'assets/models'/f'{name}.glb'))
    obj = next(o for o in bpy.context.scene.objects if o.type == 'MESH')
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    return obj

def configuration(name):
    bones = {'body': ((0,0,0), None)}
    legs = {}
    if name != 'spotter':
        for side in [-1,1]:
            for end in [-1,1]:
                key = ('front' if end>0 else 'rear') + ('.L' if side>0 else '.R')
                if name == 'cricket':
                    y = side*.225
                    if end<0: hip,knee,foot = (-.03,y,-.08),(-.29,y,.115),(-.445,y,-.268)
                    else: hip,knee,foot = (.15,y,-.025),(.245,y,-.16),(.335,y,-.268)
                else:
                    y = side*(.15 if end>0 else .26)
                    if end>0:hip,knee,foot = (.04,y,-.27),(.235,y,-.229),(.338,y,-.46)
                    else:hip,knee,foot = (-.115,y,-.27),(-.26,y,-.168),(-.35,y,-.46)
                legs[key] = [Vector(hip),Vector(knee),Vector(foot)]
                bones[key+'.upper'] = (hip,'body')
                bones[key+'.lower'] = (knee,key+'.upper')
                bones[key+'.foot'] = (foot,key+'.lower')
    if name == 'screamer':
        bones['radar'] = ((-.06,0,.075),'body')
        bones['siren'] = ((.18,0,.07),'body')
    if name == 'spotter':
        bones['sensor'] = ((.035,0,-.105),'body')
        for side in [-1,1]:
            bones['duct'+('.L' if side>0 else '.R')] = ((0,side*.15,.01),'body')
    return bones,legs

def classify(name,p,legs):
    x,y,z = p
    if name=='spotter':
        if abs(y)>.18: return 'duct'+('.L' if y>0 else '.R')
        if z<-.105: return 'sensor'
        return 'body'
    if name=='screamer':
        if z>.085: return 'radar' if x<.055 else 'siren'
        is_leg = z<-.12 and (abs(y)>.06 if x>.04 else abs(y)>.135)
    else:
        is_leg = abs(y)>.175 and (z<-.035 or (x<-.075 and z<.16))
    if not is_leg: return 'body'
    candidates=[]
    for key,(hip,knee,foot) in legs.items():
        if (y>0) != (hip.y>0): continue
        candidates.extend([(distance(p,hip,knee),key+'.upper'),(distance(p,knee,foot),key+'.lower')])
        if z<foot.z+.022:
            candidates.append(((p-foot).length*.7,key+'.foot'))
    best=min(candidates)
    return best[1]

def segment(obj,name,bones,legs):
    # Split boundaries before weighting: metal panels never stretch across joints.
    bm=bmesh.new(); bm.from_mesh(obj.data)
    bmesh.ops.remove_doubles(bm,verts=list(bm.verts),dist=0.000001)
    region=bm.faces.layers.int.new('rig_region')
    names=list(bones)
    for f in bm.faces: f[region]=names.index(classify(name,f.calc_center_median(),legs))
    if name=='screamer':
        # Remove trailing generated wire fragments below the chassis, outside the limbs.
        wires=[f for f in bm.faces if names[f[region]]=='body' and f.calc_center_median().z<-.28]
        bmesh.ops.delete(bm,geom=wires,context='FACES')
    cut=bm.edges.layers.int.new('joint_cut')
    edges=[e for e in bm.edges if len({f[region] for f in e.link_faces})>1]
    for e in edges:e[cut]=1
    bmesh.ops.split_edges(bm,edges=edges)
    if name=='screamer':
        # Tripo omitted most of the far front support. Rebuild from the intact one.
        missing=[f for f in bm.faces if names[f[region]].startswith('front.L')]
        bmesh.ops.delete(bm,geom=missing,context='FACES')
        source=[f for f in bm.faces if names[f[region]].startswith('front.R')]
        copied=bmesh.ops.duplicate(bm,geom=source)['geom']
        for v in copied:
            if isinstance(v,bmesh.types.BMVert):v.co.y=-v.co.y
        faces=[f for f in copied if isinstance(f,bmesh.types.BMFace)]
        for f in faces:f[region]=names.index(names[f[region]].replace('.R','.L'))
        bmesh.ops.reverse_faces(bm,faces=faces)
    metal=bpy.data.materials.new('Joint interiors');metal.diffuse_color=(.055,.065,.07,1)
    metal.use_nodes=True
    shader=metal.node_tree.nodes.get('Principled BSDF');shader.inputs['Base Color'].default_value=metal.diffuse_color;shader.inputs['Metallic'].default_value=.7;shader.inputs['Roughness'].default_value=.65
    obj.data.materials.append(metal)
    cap_index=len(obj.data.materials)-1
    for i in range(len(names)):
        boundary=[e for e in bm.edges if e.is_boundary and e[cut] and e.link_faces[0][region]==i]
        if boundary:
            caps=bmesh.ops.holes_fill(bm,edges=boundary,sides=0)['faces']
            for f in caps:f[region]=i;f.material_index=cap_index
    bm.verts.index_update()
    groups={n:[] for n in names}
    for v in bm.verts:
        if v.link_faces: groups[names[v.link_faces[0][region]]].append(v.index)
    bm.to_mesh(obj.data); bm.free()
    for n,indices in groups.items():
        if indices: obj.vertex_groups.new(name=n).add(indices,1,'REPLACE')
    print(name,'RIG GROUPS', {n:len(v) for n,v in groups.items()},flush=True)
    return groups

def repair_support_links(obj,name,legs):
    if name!='screamer':return
    # Replace ambiguous generated cable/strut connections with rigid mechanical links.
    parts=[obj]
    material=obj.data.materials[-1]
    for key,(hip,knee,foot) in legs.items():
        mount=Vector((hip.x,0,-.13))
        for label,a,b,bone,radius in [('mount',mount,hip,'body',.014),('link',hip,knee,key+'.upper',.012)]:
            direction=b-a
            bpy.ops.mesh.primitive_cylinder_add(vertices=12,radius=radius,depth=direction.length,location=(a+b)/2)
            part=bpy.context.object;part.name=key+'_'+label
            part.rotation_euler=direction.to_track_quat('Z','Y').to_euler()
            part.data.materials.append(material)
            for polygon in part.data.polygons:polygon.use_smooth=True
            part.vertex_groups.new(name=bone).add(list(range(len(part.data.vertices))),1,'REPLACE')
            parts.append(part)
    bpy.ops.object.select_all(action='DESELECT')
    for part in parts:part.select_set(True)
    bpy.context.view_layer.objects.active=obj;bpy.ops.object.join()

def armature(obj,name,bones):
    data=bpy.data.armatures.new(name+'_skeleton'); rig=bpy.data.objects.new(name+'_rig',data)
    bpy.context.collection.objects.link(rig)
    bpy.context.view_layer.objects.active=rig; obj.select_set(False);rig.select_set(True)
    bpy.ops.object.mode_set(mode='EDIT')
    for n,(pivot,parent) in bones.items():
        b=data.edit_bones.new(n);b.head=pivot;b.tail=Vector(pivot)+Vector((0,.06,0))
        if parent:b.parent=data.edit_bones[parent]
    bpy.ops.object.mode_set(mode='OBJECT')
    obj.parent=rig;mod=obj.modifiers.new('Rigid mechanical skin','ARMATURE');mod.object=rig
    for p in rig.pose.bones:p.rotation_mode='XYZ'
    rig.show_in_front=True
    return rig

def solve_leg(rig,key,points,dx,dz):
    hip,knee,foot=points
    a=math.hypot(knee.x-hip.x,knee.z-hip.z);b=math.hypot(foot.x-knee.x,foot.z-knee.z)
    tx=foot.x+dx-hip.x;tz=foot.z+dz-hip.z
    d=min(a+b-.0001,max(abs(a-b)+.0001,math.hypot(tx,tz)))
    rest_a=math.atan2(knee.z-hip.z,knee.x-hip.x)
    rest_b=math.atan2(foot.z-knee.z,foot.x-knee.x)
    bend=(rest_b-rest_a+math.pi)%(2*math.pi)-math.pi
    beta=math.acos(max(-1,min(1,(d*d-a*a-b*b)/(2*a*b))))*(1 if bend>=0 else -1)
    alpha=math.atan2(tz,tx)-math.atan2(b*math.sin(beta),a+b*math.cos(beta))
    upper=-(alpha-rest_a)
    lower=-(beta-bend)
    # Wrap rotations so interpolation cannot spin through a full revolution.
    upper=(upper+math.pi)%(2*math.pi)-math.pi
    lower=(lower+math.pi)%(2*math.pi)-math.pi
    rig.pose.bones[key+'.upper'].rotation_euler.y=upper
    rig.pose.bones[key+'.lower'].rotation_euler.y=lower
    rig.pose.bones[key+'.foot'].rotation_euler.y=-upper-lower

def animate(rig,name,legs):
    scene=bpy.context.scene;scene.render.fps=FPS
    clips={'idle':2.4,'walk':1.0,'jump':.7,'land':.3} if name=='cricket' else {'idle':3.0,'walk':1.6,'scream':1.0} if name=='screamer' else {'idle':3.0,'fly':1.2,'alert':1.0}
    rig.animation_data_create()
    for clip,duration in clips.items():
        action=bpy.data.actions.new(clip);rig.animation_data.action=action
        frames=round(duration*FPS)
        for f in range(frames+1):
            t=f/frames;phase=2*math.pi*t
            for p in rig.pose.bones:p.rotation_euler=(0,0,0);p.location=(0,0,0)
            if legs:
                for i,(key,points) in enumerate(legs.items()):
                    dx=dz=0
                    if clip=='walk':
                        offset=math.pi if (key.startswith('front') != key.endswith('.L')) else 0
                        q=phase+offset
                        dx=.042*math.cos(q);dz=.038*max(0,math.sin(q))
                    elif clip=='jump':
                        dz=.075*math.sin(math.pi*t);dx=(-.025 if key.startswith('front') else .025)*math.sin(math.pi*t)
                    elif clip=='land':
                        dz=.025*math.sin(math.pi*t)
                    solve_leg(rig,key,points,dx,dz)
            if name=='screamer':
                rig.pose.bones['radar'].rotation_euler.z=.32*math.sin(phase)
                rig.pose.bones['siren'].rotation_euler.z=(.18 if clip=='scream' else .07)*math.sin(phase)
                if clip=='scream':rig.pose.bones['siren'].rotation_euler.y=.035*math.sin(phase*4)
            if name=='spotter':
                rig.pose.bones['sensor'].rotation_euler.z=(.08 if clip=='alert' else .30)*math.sin(phase)
                rig.pose.bones['sensor'].rotation_euler.y=.07*math.sin(phase)
                for side in [-1,1]:rig.pose.bones['duct'+('.L' if side>0 else '.R')].rotation_euler.y=(.14 if clip=='fly' else .045)*math.sin(phase)
            for p in rig.pose.bones:
                p.keyframe_insert(data_path='rotation_euler',frame=f)
                p.keyframe_insert(data_path='location',frame=f)
        track=rig.animation_data.nla_tracks.new();track.name=clip
        strip=track.strips.new(clip,0,action);strip.action_frame_start=0;strip.action_frame_end=frames
        track.mute=True
    rig.animation_data.action=None
    for p in rig.pose.bones:p.rotation_euler=(0,0,0);p.location=(0,0,0)
    scene.frame_set(0)

def run(name):
    obj=setup(name);obj.name=name+'_shell'
    bones,legs=configuration(name);segment(obj,name,bones,legs);repair_support_links(obj,name,legs);rig=armature(obj,name,bones);animate(rig,name,legs)
    bpy.ops.object.select_all(action='DESELECT');obj.select_set(True);rig.select_set(True)
    bpy.context.view_layer.objects.active=rig
    bpy.context.preferences.filepaths.save_version=0
    bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'docs/models'/f'{name}_rig.blend'))
    bpy.ops.export_scene.gltf(filepath=str(ROOT/'assets/models/rigged'/f'{name}.glb'),export_format='GLB',use_selection=True,export_animations=True,export_animation_mode='ACTIONS',export_nla_strips=True,export_force_sampling=True)

if __name__=='__main__':
    names=sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else ['cricket','screamer','spotter']
    for name in names:run(name)
