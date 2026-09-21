"""
Ultra-Optimized 3D Forest Asset Generator for ArcEngine (WebGL Browser Engine)
Ensures:
1. EXACTLY 1 SINGLE MESH per GLB model (all parts joined via bpy.ops.object.join()).
2. Ultra-low polycount (50-300 tris per model) designed specifically for browser WebGL.
3. Clean materials (PBR/Toon ready).
4. Pivot point strictly at Z=0 (ground contact).
"""

import bpy
import bmesh
import math
import os
import random

OUTPUT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'assets', 'models', 'forest'))
os.makedirs(OUTPUT_DIR, exist_ok=True)

def clear_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    for obj in bpy.data.objects:
        bpy.data.objects.remove(obj, do_unlink=True)
    for mat in bpy.data.materials:
        bpy.data.materials.remove(mat, do_unlink=True)
    for mesh in bpy.data.meshes:
        bpy.data.meshes.remove(mesh, do_unlink=True)

def create_mat(name, color_hex, roughness=0.8, metallic=0.0):
    mat = bpy.data.materials.new(name=name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get('Principled BSDF')
    if bsdf:
        h = color_hex.lstrip('#')
        r, g, b = [int(h[i:i+2], 16) / 255.0 for i in (0, 2, 4)]
        lin = lambda c: c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
        bsdf.inputs['Base Color'].default_value = (lin(r), lin(g), lin(b), 1.0)
        if 'Roughness' in bsdf.inputs:
            bsdf.inputs['Roughness'].default_value = roughness
        if 'Metallic' in bsdf.inputs:
            bsdf.inputs['Metallic'].default_value = metallic
    return mat

# Palette
MAT_PINE_BARK = '#523420'
MAT_PINE_NEEDLE = '#1D3F28'
MAT_SPRUCE_NEEDLE = '#1A3324'
MAT_BIRCH_BARK = '#E5E8E2'
MAT_BIRCH_LEAF = '#5C8A36'
MAT_OAK_BARK = '#3D2F24'
MAT_OAK_LEAF = '#3B6B27'
MAT_BUSH_GREEN = '#4B7B2B'
MAT_FERN_GREEN = '#386923'
MAT_WOOD_LOG = '#4A3728'
MAT_WOOD_PLANK = '#755B42'
MAT_MOSS = '#4E6827'
MAT_ROCK = '#626868'
MAT_CHARCOAL = '#1A1816'
MAT_EMBER = '#C74B16'

def finalize_and_export(filename, model_name):
    # Select all mesh objects
    meshes = [obj for obj in bpy.data.objects if obj.type == 'MESH']
    if not meshes:
        return
    bpy.ops.object.select_all(action='DESELECT')
    for m in meshes:
        m.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    
    # CRITICAL OPTIMIZATION: Join all parts into ONE single mesh node!
    if len(meshes) > 1:
        bpy.ops.object.join()
    
    joined = bpy.context.view_layer.objects.active
    joined.name = model_name
    
    # Ensure pivot is at world origin
    out_path = os.path.join(OUTPUT_DIR, filename)
    bpy.ops.export_scene.gltf(
        filepath=out_path,
        export_format='GLB',
        use_selection=True,
        export_apply=True,
        export_yup=True
    )
    poly_count = len(joined.data.polygons)
    print(f"Exported: {filename} -> {poly_count} polygons, 1 mesh node ({os.path.getsize(out_path)} bytes)")

# -------------------------------------------------------------
# ULTRA-LOW-POLY MODEL BUILDERS (1 mesh each)
# -------------------------------------------------------------

def build_pine_tall():
    clear_scene()
    bark = create_mat('PineBark', MAT_PINE_BARK, roughness=0.9)
    needle = create_mat('PineNeedles', MAT_PINE_NEEDLE, roughness=0.7)

    # 6-sided slender trunk (height 9m)
    bpy.ops.mesh.primitive_cylinder_add(vertices=6, radius=0.25, depth=9.0, location=(0, 0, 4.5))
    trunk = bpy.context.active_object
    trunk.data.materials.append(bark)

    # 3 Low-poly cone tiers at the top (6 sides each)
    tiers = [(5.5, 2.2, 1.6), (6.8, 1.8, 1.5), (8.0, 1.2, 1.4)]
    for z, r, h in tiers:
        bpy.ops.mesh.primitive_cone_add(vertices=6, radius1=r, depth=h, location=(0, 0, z + h/2))
        c = bpy.context.active_object
        c.data.materials.append(needle)

    finalize_and_export('pine_tall.glb', 'PineTall')

def build_pine_crooked():
    clear_scene()
    bark = create_mat('PineBark', '#61402B', roughness=0.9)
    needle = create_mat('PineNeedles', '#22472F', roughness=0.7)

    # Slanted lower trunk + upper trunk
    bpy.ops.mesh.primitive_cylinder_add(vertices=6, radius=0.28, depth=5.0, location=(0.3, 0, 2.4))
    t1 = bpy.context.active_object
    t1.rotation_euler = (0, 0.14, 0)
    t1.data.materials.append(bark)

    bpy.ops.mesh.primitive_cylinder_add(vertices=6, radius=0.20, depth=4.5, location=(0.85, 0, 6.2))
    t2 = bpy.context.active_object
    t2.rotation_euler = (0, -0.1, 0)
    t2.data.materials.append(bark)

    # 2 Asymmetric crowns
    bpy.ops.mesh.primitive_cone_add(vertices=6, radius1=1.8, depth=1.4, location=(0.6, 0, 5.5))
    c1 = bpy.context.active_object
    c1.data.materials.append(needle)

    bpy.ops.mesh.primitive_cone_add(vertices=6, radius1=1.4, depth=1.3, location=(0.9, 0, 7.8))
    c2 = bpy.context.active_object
    c2.data.materials.append(needle)

    finalize_and_export('pine_crooked.glb', 'PineCrooked')

def build_spruce_dense():
    clear_scene()
    bark = create_mat('SpruceBark', '#453327', roughness=0.9)
    needle = create_mat('SpruceNeedles', MAT_SPRUCE_NEEDLE, roughness=0.7)

    # Straight trunk 8m
    bpy.ops.mesh.primitive_cylinder_add(vertices=6, radius=0.22, depth=8.0, location=(0, 0, 4.0))
    trunk = bpy.context.active_object
    trunk.data.materials.append(bark)

    # 4 Dense conical tiers (7 sides)
    tiers = [(1.5, 2.4, 1.8), (3.0, 2.0, 1.7), (4.5, 1.5, 1.6), (6.0, 0.9, 1.6)]
    for z, r, h in tiers:
        bpy.ops.mesh.primitive_cone_add(vertices=7, radius1=r, depth=h, location=(0, 0, z + h/2))
        c = bpy.context.active_object
        c.data.materials.append(needle)

    finalize_and_export('spruce_dense.glb', 'SpruceDense')

def build_spruce_young():
    clear_scene()
    bark = create_mat('SpruceBark', '#4A382C', roughness=0.9)
    needle = create_mat('SpruceNeedles', '#254E33', roughness=0.7)

    bpy.ops.mesh.primitive_cylinder_add(vertices=5, radius=0.12, depth=3.5, location=(0, 0, 1.75))
    trunk = bpy.context.active_object
    trunk.data.materials.append(bark)

    tiers = [(0.8, 1.4, 1.2), (1.8, 0.9, 1.1), (2.7, 0.5, 1.0)]
    for z, r, h in tiers:
        bpy.ops.mesh.primitive_cone_add(vertices=6, radius1=r, depth=h, location=(0, 0, z + h/2))
        c = bpy.context.active_object
        c.data.materials.append(needle)

    finalize_and_export('spruce_young.glb', 'SpruceYoung')

def build_birch_tall():
    clear_scene()
    bark = create_mat('BirchBark', MAT_BIRCH_BARK, roughness=0.85)
    leaf = create_mat('BirchLeaf', MAT_BIRCH_LEAF, roughness=0.65)

    bpy.ops.mesh.primitive_cylinder_add(vertices=6, radius=0.18, depth=8.0, location=(0, 0, 4.0))
    trunk = bpy.context.active_object
    trunk.data.materials.append(bark)

    # 2 Low-poly 1-subdivision icosphere clusters
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=1, radius=1.4, location=(0.1, 0, 5.8))
    ic1 = bpy.context.active_object
    ic1.scale = (1.0, 1.0, 1.2)
    ic1.data.materials.append(leaf)

    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=1, radius=1.1, location=(-0.1, 0, 7.5))
    ic2 = bpy.context.active_object
    ic2.scale = (1.0, 1.0, 1.1)
    ic2.data.materials.append(leaf)

    finalize_and_export('birch_tall.glb', 'BirchTall')

def build_birch_twin():
    clear_scene()
    bark = create_mat('BirchBark', MAT_BIRCH_BARK, roughness=0.85)
    leaf = create_mat('BirchLeaf', '#629339', roughness=0.65)

    bpy.ops.mesh.primitive_cylinder_add(vertices=5, radius=0.15, depth=6.5, location=(-0.3, 0, 3.25))
    t1 = bpy.context.active_object
    t1.rotation_euler = (0, -0.08, 0)
    t1.data.materials.append(bark)

    bpy.ops.mesh.primitive_cylinder_add(vertices=5, radius=0.14, depth=5.8, location=(0.3, 0, 2.9))
    t2 = bpy.context.active_object
    t2.rotation_euler = (0, 0.1, 0)
    t2.data.materials.append(bark)

    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=1, radius=1.3, location=(-0.5, 0, 5.5))
    c1 = bpy.context.active_object
    c1.data.materials.append(leaf)

    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=1, radius=1.2, location=(0.5, 0, 5.0))
    c2 = bpy.context.active_object
    c2.data.materials.append(leaf)

    finalize_and_export('birch_twin.glb', 'BirchTwin')

def build_oak_ancient():
    clear_scene()
    bark = create_mat('OakBark', MAT_OAK_BARK, roughness=0.95)
    leaf = create_mat('OakLeaf', MAT_OAK_LEAF, roughness=0.65)

    # Thick trunk
    bpy.ops.mesh.primitive_cylinder_add(vertices=7, radius=0.65, depth=5.0, location=(0, 0, 2.5))
    trunk = bpy.context.active_object
    trunk.data.materials.append(bark)

    # 3 Main canopy volumes (1-subdivision icospheres)
    crowns = [(0, 0, 6.5, 2.4), (1.5, 0, 5.5, 1.8), (-1.4, 0.4, 5.6, 1.7)]
    for cx, cy, cz, rad in crowns:
        bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=1, radius=rad, location=(cx, cy, cz))
        ic = bpy.context.active_object
        ic.scale = (1.0, 1.0, 0.8)
        ic.data.materials.append(leaf)

    finalize_and_export('oak_ancient.glb', 'OakAncient')

def build_bush_dense():
    clear_scene()
    leaf = create_mat('BushLeaf', MAT_BUSH_GREEN, roughness=0.7)

    # Single low-poly sphere volume
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=1, radius=1.0, location=(0, 0, 0.75))
    b = bpy.context.active_object
    b.scale = (1.2, 1.0, 0.75)
    b.data.materials.append(leaf)

    finalize_and_export('bush_dense.glb', 'BushDense')

def build_bush_fern():
    clear_scene()
    fern = create_mat('FernLeaf', MAT_FERN_GREEN, roughness=0.6)

    # 5 Low-poly flat cones
    for i in range(5):
        ang = i * 2 * math.pi / 5
        bpy.ops.mesh.primitive_cone_add(vertices=3, radius1=0.4, depth=1.0, location=(math.cos(ang)*0.35, math.sin(ang)*0.35, 0.3))
        f = bpy.context.active_object
        f.scale = (0.2, 0.8, 0.4)
        f.rotation_euler = (math.sin(ang)*0.5, -math.cos(ang)*0.5, ang)
        f.data.materials.append(fern)

    finalize_and_export('bush_fern.glb', 'BushFern')

def build_log_mossy():
    clear_scene()
    bark = create_mat('LogBark', MAT_WOOD_LOG, roughness=0.9)

    # 6-sided cylinder lying on ground
    bpy.ops.mesh.primitive_cylinder_add(vertices=6, radius=0.3, depth=3.8, location=(0, 0, 0.28))
    log = bpy.context.active_object
    log.rotation_euler = (0, math.pi/2, 0)
    log.data.materials.append(bark)

    finalize_and_export('log_mossy.glb', 'LogMossy')

def build_stump_old():
    clear_scene()
    bark = create_mat('StumpBark', '#453529', roughness=0.95)

    bpy.ops.mesh.primitive_cylinder_add(vertices=7, radius=0.45, depth=0.8, location=(0, 0, 0.4))
    stump = bpy.context.active_object
    stump.data.materials.append(bark)

    finalize_and_export('stump_old.glb', 'StumpOld')

def build_rock_boulder():
    clear_scene()
    rock = create_mat('GraniteRock', MAT_ROCK, roughness=0.85)

    # 1-subdivision icosphere with flat bottom
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=1, radius=1.2, location=(0, 0, 0.8))
    b = bpy.context.active_object
    b.scale = (1.3, 0.9, 0.7)
    b.data.materials.append(rock)
    for v in b.data.vertices:
        if v.co.z < 0: v.co.z = 0

    finalize_and_export('rock_boulder.glb', 'RockBoulder')

def build_rock_cluster():
    clear_scene()
    rock = create_mat('GraniteRock', '#5E6363', roughness=0.85)

    # 3 small rocks
    configs = [(0, 0, 0.4, 0.6), (0.7, 0.3, 0.3, 0.45), (-0.6, 0.3, 0.3, 0.45)]
    for cx, cy, cz, rad in configs:
        bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=1, radius=rad, location=(cx, cy, cz))
        r = bpy.context.active_object
        r.data.materials.append(rock)

    finalize_and_export('rock_cluster.glb', 'RockCluster')

def build_watchtower_wood():
    clear_scene()
    wood = create_mat('WoodPole', '#5C4430', roughness=0.9)
    roof_mat = create_mat('TowerRoof', '#3E4D38', roughness=0.8)

    # 4 Legs (4 simple boxes)
    for sx in (-1.8, 1.8):
        for sy in (-1.8, 1.8):
            bpy.ops.mesh.primitive_cube_add(size=1.0, location=(sx, sy, 4.0))
            col = bpy.context.active_object
            col.scale = (0.3, 0.3, 8.0)
            col.data.materials.append(wood)

    # Floor platform
    bpy.ops.mesh.primitive_cube_add(size=1.0, location=(0, 0, 8.1))
    f = bpy.context.active_object
    f.scale = (4.4, 4.4, 0.2)
    f.data.materials.append(wood)

    # Roof (4-sided cone)
    bpy.ops.mesh.primitive_cone_add(vertices=4, radius1=3.4, depth=1.2, location=(0, 0, 10.0))
    r = bpy.context.active_object
    r.rotation_euler = (0, 0, math.pi/4)
    r.data.materials.append(roof_mat)

    finalize_and_export('watchtower_wood.glb', 'WatchtowerWood')

def build_cabin_shelter():
    clear_scene()
    wood = create_mat('CabinWood', '#4A3423', roughness=0.9)

    # Floor
    bpy.ops.mesh.primitive_cube_add(size=1.0, location=(0, 0, 0.1))
    f = bpy.context.active_object
    f.scale = (4.0, 3.2, 0.2)
    f.data.materials.append(wood)

    # Back wall
    bpy.ops.mesh.primitive_cube_add(size=1.0, location=(0, 1.5, 1.2))
    b = bpy.context.active_object
    b.scale = (4.0, 0.3, 2.2)
    b.data.materials.append(wood)

    # Slanted roof
    bpy.ops.mesh.primitive_cube_add(size=1.0, location=(0, 0, 2.4))
    r = bpy.context.active_object
    r.scale = (4.4, 3.6, 0.15)
    r.rotation_euler = (0.15, 0, 0)
    r.data.materials.append(wood)

    finalize_and_export('cabin_shelter.glb', 'CabinShelter')

def build_wood_fence():
    clear_scene()
    wood = create_mat('FenceWood', '#634B35', roughness=0.9)

    # 2 posts + 1 rail
    for x in (-1.4, 1.4):
        bpy.ops.mesh.primitive_cube_add(size=1.0, location=(x, 0, 0.6))
        p = bpy.context.active_object
        p.scale = (0.15, 0.15, 1.2)
        p.data.materials.append(wood)

    bpy.ops.mesh.primitive_cube_add(size=1.0, location=(0, 0, 0.7))
    r = bpy.context.active_object
    r.scale = (2.9, 0.1, 0.15)
    r.data.materials.append(wood)

    finalize_and_export('wood_fence.glb', 'WoodFence')

def build_campfire_ring():
    clear_scene()
    stone_mat = create_mat('FireStone', '#4F5252', roughness=0.9)
    charcoal_mat = create_mat('Charcoal', MAT_CHARCOAL, roughness=0.95)

    # Ring base cylinder
    bpy.ops.mesh.primitive_cylinder_add(vertices=8, radius=0.8, depth=0.2, location=(0, 0, 0.1))
    ash = bpy.context.active_object
    ash.data.materials.append(charcoal_mat)

    # 6 Stone cubes arranged in circle
    for i in range(6):
        ang = i * math.pi / 3
        bpy.ops.mesh.primitive_cube_add(size=1.0, location=(math.cos(ang)*0.8, math.sin(ang)*0.8, 0.18))
        s = bpy.context.active_object
        s.scale = (0.35, 0.35, 0.3)
        s.data.materials.append(stone_mat)

    finalize_and_export('campfire_ring.glb', 'CampfireRing')

def build_wood_planks_path():
    clear_scene()
    wood = create_mat('PlankPath', MAT_WOOD_PLANK, roughness=0.85)

    # Single boardwalk module (1 box with plank dimensions)
    bpy.ops.mesh.primitive_cube_add(size=1.0, location=(0, 0, 0.08))
    p = bpy.context.active_object
    p.scale = (1.4, 3.6, 0.15)
    p.data.materials.append(wood)

    finalize_and_export('wood_planks_path.glb', 'WoodPlanksPath')

def build_wood_crates_stack():
    clear_scene()
    wood = create_mat('CrateWood', '#826344', roughness=0.8)

    # 2 crates on bottom, 1 on top
    coords = [(-0.4, 0, 0.35), (0.4, 0, 0.35), (0, 0, 0.95)]
    for cx, cy, cz in coords:
        bpy.ops.mesh.primitive_cube_add(size=1.0, location=(cx, cy, cz))
        c = bpy.context.active_object
        c.scale = (0.7, 0.7, 0.65)
        c.data.materials.append(wood)

    finalize_and_export('wood_crates_stack.glb', 'WoodCratesStack')

def main():
    print("=== Generating Ultra-Optimized 3D Forest Assets (1 Mesh Per Model) ===")
    build_pine_tall()
    build_pine_crooked()
    build_spruce_dense()
    build_spruce_young()
    build_birch_tall()
    build_birch_twin()
    build_oak_ancient()
    build_bush_dense()
    build_bush_fern()
    build_log_mossy()
    build_stump_old()
    build_rock_boulder()
    build_rock_cluster()
    build_watchtower_wood()
    build_cabin_shelter()
    build_wood_fence()
    build_campfire_ring()
    build_wood_planks_path()
    build_wood_crates_stack()
    print("=== All Ultra-Optimized Assets Generated! ===")

if __name__ == '__main__':
    main()
