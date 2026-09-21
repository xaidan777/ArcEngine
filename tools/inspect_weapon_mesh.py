import bpy
import bmesh
import mathutils
import sys

print("=== Starting Weapon Mesh Inspection & Segmentation ===")

# Reset scene
bpy.ops.wm.read_factory_settings(use_empty=True)

# Import GLB
input_path = "/home/aggregate/Desktop/ArcEngine/assets/models/weapon_rubezh76.glb"
bpy.ops.import_scene.gltf(filepath=input_path)

mesh_objs = [o for o in bpy.context.scene.objects if o.type == 'MESH']
if not mesh_objs:
    print("ERROR: No mesh found!")
    sys.exit(1)

main_obj = mesh_objs[0]
print(f"Loaded mesh: {main_obj.name}")
print(f"Dimensions: {main_obj.dimensions}")
print(f"Location: {main_obj.location}")

# Apply all transforms so vertices are in absolute world coordinates
bpy.context.view_layer.objects.active = main_obj
bpy.ops.object.select_all(action='DESELECT')
main_obj.select_set(True)
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

# Find bounding box
bbox_corners = [main_obj.matrix_world @ mathutils.Vector(corner) for corner in main_obj.bound_box]
min_x = min(v.x for v in bbox_corners)
max_x = max(v.x for v in bbox_corners)
min_y = min(v.y for v in bbox_corners)
max_y = max(v.y for v in bbox_corners)
min_z = min(v.z for v in bbox_corners)
max_z = max(v.z for v in bbox_corners)

print(f"BBox X: [{min_x:.4f}, {max_x:.4f}] (width: {max_x - min_x:.4f})")
print(f"BBox Y: [{min_y:.4f}, {max_y:.4f}] (length: {max_y - min_y:.4f})")
print(f"BBox Z: [{min_z:.4f}, {max_z:.4f}] (height: {max_z - min_z:.4f})")

# Let's inspect mesh islands via bmesh
bm = bmesh.new()
bm.from_mesh(main_obj.data)
bm.faces.ensure_lookup_table()
bm.verts.ensure_lookup_table()

# Find connected face components (islands)
visited_faces = set()
islands = []

for f in bm.faces:
    if f.index not in visited_faces:
        island_faces = []
        stack = [f]
        visited_faces.add(f.index)
        while stack:
            curr = stack.pop()
            island_faces.append(curr)
            for edge in curr.edges:
                for linked_face in edge.link_faces:
                    if linked_face.index not in visited_faces:
                        visited_faces.add(linked_face.index)
                        stack.append(linked_face)
        islands.append(island_faces)

print(f"Found {len(islands)} face islands in mesh!")
# Sort islands by face count descending
islands.sort(key=len, reverse=True)

for i, island in enumerate(islands[:10]):
    # Get bounding box of this island
    iv_y = [v.co.y for face in island for v in face.verts]
    iv_z = [v.co.z for face in island for v in face.verts]
    print(f"Island {i}: {len(island)} faces, Y range: [{min(iv_y):.3f}, {max(iv_y):.3f}], Z range: [{min(iv_z):.3f}, {max(iv_z):.3f}]")

bm.free()
print("=== Inspection complete ===")
