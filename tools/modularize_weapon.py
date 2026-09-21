import bpy
import bmesh
import mathutils
import sys
import os

print("=== Starting Modular Weapon Generation ===")

# Reset scene
bpy.ops.wm.read_factory_settings(use_empty=True)

# Import GLB
input_path = "/home/aggregate/Desktop/ArcEngine/assets/models/weapon_rubezh76.glb"
bpy.ops.import_scene.gltf(filepath=input_path)

mesh_objs = [o for o in bpy.context.scene.objects if o.type == 'MESH']
if not mesh_objs:
    print("ERROR: No mesh found!")
    sys.exit(1)

base_obj = mesh_objs[0]
base_obj.name = "Weapon_Raw"
bpy.context.view_layer.objects.active = base_obj
bpy.ops.object.select_all(action='DESELECT')
base_obj.select_set(True)
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

mat = base_obj.data.materials[0] if base_obj.data.materials else None

# Helper to duplicate object
def duplicate_obj(source, new_name):
    new_data = source.data.copy()
    new_obj = bpy.data.objects.new(new_name, new_data)
    bpy.context.scene.collection.objects.link(new_obj)
    new_obj.matrix_world = source.matrix_world.copy()
    return new_obj

# Helper to cap open boundaries on a mesh
def cap_holes(obj):
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.mode_set(mode='EDIT')
    bm = bmesh.from_edit_mesh(obj.data)
    
    # Find boundary edges
    boundary_edges = [e for e in bm.edges if e.is_boundary]
    if boundary_edges:
        bmesh.ops.edgeloop_fill(bm, edges=boundary_edges)
        bmesh.ops.triangulate(bm, faces=[f for f in bm.faces if len(f.verts) > 4])
        
    bmesh.update_edit_mesh(obj.data)
    bpy.ops.object.mode_set(mode='OBJECT')

# Function to extract a part based on bounding condition
def extract_part(source, name, filter_func):
    part = duplicate_obj(source, name)
    bm = bmesh.new()
    bm.from_mesh(part.data)
    bm.faces.ensure_lookup_table()
    bm.verts.ensure_lookup_table()
    
    # Delete faces not matching filter_func
    faces_to_delete = []
    for f in bm.faces:
        center = f.calc_center_median()
        if not filter_func(center):
            faces_to_delete.append(f)
            
    bmesh.ops.delete(bm, geom=faces_to_delete, context='FACES')
    
    # Clean up unlinked verts
    lone_verts = [v for v in bm.verts if not v.link_faces]
    bmesh.ops.delete(bm, geom=lone_verts, context='VERTS')
    
    # Cap holes on boundary
    boundary_edges = [e for e in bm.edges if e.is_boundary]
    if boundary_edges:
        try:
            bmesh.ops.edgeloop_fill(bm, edges=boundary_edges)
        except Exception as e:
            pass
            
    bm.to_mesh(part.data)
    bm.free()
    part.data.update()
    return part

# Filter conditions based on coordinates:
# Y: [-0.50, 0.50]
# Z: [-0.18, 0.18]
# X: [-0.06, 0.06]

# 1. Muzzle (Suppressor): Y > 0.33
def is_muzzle(c):
    return c.y > 0.33

# 2. Handguard / Shroud: Y in [0.07, 0.33], and Z in [-0.06, 0.10]
def is_handguard(c):
    return 0.07 <= c.y <= 0.33 and c.z > -0.06

# 3. Stock: Y < -0.22
def is_stock(c):
    return c.y < -0.22

# 4. Optic / Arc Scanner: Y in [-0.16, 0.07] and Z > 0.065
def is_optic(c):
    return -0.16 <= c.y <= 0.07 and c.z > 0.065

# 5. Magazine: Y in [-0.09, 0.07] and Z < -0.045
def is_magazine(c):
    return -0.09 <= c.y <= 0.07 and c.z < -0.045

# 6. Receiver (Base Core): everything else!
def is_receiver(c):
    return not (is_muzzle(c) or is_handguard(c) or is_stock(c) or is_optic(c) or is_magazine(c))

print("Extracting modular parts...")
part_muzzle = extract_part(base_obj, "Weapon_Muzzle_T3", is_muzzle)
part_handguard = extract_part(base_obj, "Weapon_Handguard_T2", is_handguard)
part_stock = extract_part(base_obj, "Weapon_Stock_T3", is_stock)
part_optic = extract_part(base_obj, "Weapon_Optic_T4", is_optic)
part_mag = extract_part(base_obj, "Weapon_Magazine_T1", is_magazine)
part_receiver = extract_part(base_obj, "Weapon_Receiver_Base", is_receiver)

# Delete raw base
bpy.data.objects.remove(base_obj, do_unlink=True)

parts = [part_receiver, part_stock, part_mag, part_optic, part_handguard, part_muzzle]

# Create root empty object
root = bpy.data.objects.new("Weapon_Rubezh76_Root", None)
bpy.context.scene.collection.objects.link(root)

for p in parts:
    p.parent = root
    v_count = len(p.data.vertices)
    f_count = len(p.data.polygons)
    print(f"Created part: {p.name} | Verts: {v_count}, Faces: {f_count}")

# Export modular GLB
output_path = "/home/aggregate/Desktop/ArcEngine/assets/models/weapon_rubezh76_modular.glb"
bpy.ops.object.select_all(action='DESELECT')
root.select_set(True)
for p in parts:
    p.select_set(True)

bpy.ops.export_scene.gltf(
    filepath=output_path,
    export_format='GLB',
    use_selection=True,
    export_apply=False,
    export_yup=True
)

file_size_kb = round(os.path.getsize(output_path) / 1024, 1)
print(f"=== Successfully exported {output_path} ({file_size_kb} KB) ===")

# Also create an exploded render for visualization!
# Explode parts along their primary attachment axes
part_stock.location.y -= 0.15
part_muzzle.location.y += 0.20
part_handguard.location.y += 0.08
part_mag.location.z -= 0.15
part_mag.location.y -= 0.03
part_optic.location.z += 0.12

# Setup camera for exploded render
cam_data = bpy.data.cameras.new(name="ExplodedCam")
cam = bpy.data.objects.new("ExplodedCam", cam_data)
bpy.context.scene.collection.objects.link(cam)
cam.location = (-2.5, 0.0, 0.1)
cam.rotation_euler = (1.5708, 0, -1.5708)
bpy.context.scene.camera = cam

# Setup lighting
light_data = bpy.data.lights.new(name="KeyLight", type='SUN')
light_data.energy = 3.5
light = bpy.data.objects.new("KeyLight", light_data)
bpy.context.scene.collection.objects.link(light)
light.location = (-2, -2, 3)
light.rotation_euler = (0.785, 0.2, -0.5)

bpy.context.scene.render.resolution_x = 1024
bpy.context.scene.render.resolution_y = 600
bpy.context.scene.render.image_settings.file_format = 'PNG'
exploded_img_path = "/home/aggregate/.gemini/antigravity/brain/2103e23d-0820-4323-ae80-c4e416ec99b3/weapon_exploded_view.png"
bpy.context.scene.render.filepath = exploded_img_path

_avail = [e.identifier for e in bpy.types.RenderSettings.bl_rna.properties['engine'].enum_items]
bpy.context.scene.render.engine = 'BLENDER_EEVEE' if 'BLENDER_EEVEE' in _avail else 'BLENDER_WORKBENCH'

bpy.ops.render.render(write_still=True)
print(f"=== Rendered exploded view to {exploded_img_path} ===")
