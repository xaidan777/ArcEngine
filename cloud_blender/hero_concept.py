"""МГЛОТЕК: original concept-inspired hero costume, not a generic hooded placeholder.

Long weathered duster, crimson flying scarf, dark tousled hair,
asymmetric plated shoulders, strapped satchel and an amber lantern.
Pure Blender mesh parts so the exported scene remains editable.
"""
import math
import bpy

COLORS = {}
def ma(name, color, metal=0.0, rough=.8, emiss=0):
    m=bpy.data.materials.new(name); m.diffuse_color=(*color,1)
    m.use_nodes=True; p=m.node_tree.nodes.get("Principled BSDF")
    p.inputs["Base Color"].default_value=(*color,1)
    p.inputs["Metallic"].default_value=metal
    p.inputs["Roughness"].default_value=rough
    if emiss:
        p.inputs["Emission Color"].default_value=(*color,1)
        p.inputs["Emission Strength"].default_value=emiss
    return m

def dress(PARTS, shape):
    C={}
    C["red"]=ma("Crimson travel scarf / dyed wool",(.47,.018,.027),rough=.94)
    C["rededge"]=ma("Scarlet scarf folds",(.72,.041,.057),rough=.86)
    C["coat"]=ma("Black weathered duster leather",(.055,.052,.060),rough=.77)
    C["coatedge"]=ma("Duster stitched hems",(.18,.135,.115),rough=.79)
    C["shirt"]=ma("Inner charcoal vest",(.13,.137,.16),rough=.88)
    C["bronze"]=ma("Tarnished ornate bronze buttons",(.47,.28,.105),metal=.83,rough=.41)
    C["steel"]=ma("Worn asymmetrical shoulder armor",(.20,.22,.23),metal=.70,rough=.53)
    C["skin"]=ma("Human face / rain-lit pale skin",(.48,.32,.26),rough=.8)
    C["hair"]=ma("Tangled black hair",(.022,.020,.026),rough=.77)
    C["eyes"]=ma("Tired dark eyes",(.022,.023,.034),rough=.50)
    C["light"]=ma("Lantern memory amber",(.96,.35,.08),rough=.37,emiss=3)
    # Replace the face and hood of previous prototype with actual human head and hair.
    face=PARTS["Faceless mask"]; face.data.materials.clear()
    face.data.materials.append(C["skin"])
    face.scale=(.325,.24,.375)
    hood=PARTS["Hood"]; hood.data.materials.clear();hood.data.materials.append(C["hair"])
    hood.scale=(.41,.27,.28)
    body=PARTS["Torso"];body.data.materials.clear();body.data.materials.append(C["coat"])
    body.scale=(.54,.34,.81)
    cape=PARTS["Cape / ragged back"];cape.data.materials.clear()
    cape.data.materials.append(C["coat"])
    cape.scale=(.22,.22,1.01)
    # Deep, ragged coattails, distinct front flap and overlapping back flap.
    for side in (-1,1):
        s="L" if side==-1 else "R"
        shape("Duster hem "+s,(side*.31,.16,1.13),(.31,.24,.83),C["coat"],"cube")
        shape("Scuffed coat panel "+s,(side*.31,-.32,1.09),(.32,.13,.69),C["coat"],"cube")
        shape("Coat edge piping "+s,(side*.5,-.42,1.15),(.052,.07,.71),C["coatedge"],"cube")
        shape("Armored shoulder "+s,(side*.56,-.02,2.85),(.245,.32,.22),C["steel"])
        shape("Brass epaulet stud "+s,(side*.60,-.39,2.87),(.066,.07,.073),C["bronze"])
        shape("Leather vambrace "+s,(side*.75,-.03,2.19),(.15,.15,.34),C["coat"])
        shape("Boot top "+s,(side*.28,-.02,.60),(.20,.23,.23),C["steel"])
    shape("Waistcoat front",(.01,-.395,2.53),(.41,.135,.65),C["shirt"],"cube")
    shape("Black collar",(0,-.05,3.00),(.58,.44,.18),C["coat"])
    # Conceal identity but preserve a visible human expression.
    shape("Angular jaw",(.13,-.57,3.17),(.20,.13,.12),C["skin"])
    shape("Nose bridge",(.18,-.63,3.43),(.052,.08,.12),C["skin"])
    for xx in (-.065,.25):
        shape("Eye shadow "+str(xx),(xx,-.655,3.46),(.075,.04,.040),C["eyes"])
        shape("Brow "+str(xx),(xx,-.66,3.56),(.12,.05,.045),C["hair"],"cube")
    shape("Mouth line",(.11,-.72,3.20),(.14,.024,.025),C["eyes"],"cube")
    # Hair locks are short, tapered, irregular. Shapes are real editable cones.
    for i in range(18):
        a=(i/18)*math.tau
        x=.07+.37*math.cos(a)
        y=-.18+.25*math.sin(a)
        z=3.68+(i%3)*.058
        o=shape("Hair lock %02d"%i,(x,y,z),(.055,.053,.125),C["hair"],"sphere")
        o.rotation_euler[1]=(i%5-2)*.36
    for i in range(4):
        shape("Fringe strand %d"%i,(-.19+i*.16,-.53,3.72-i*.045),
              (.057,.047,.12),C["hair"])
    # Bright red layered scarf, loosely wrapped over both shoulders.
    shape("Scarf collar",(0,-.12,3.02),(.67,.46,.23),C["red"])
    shape("Scarf highlight",(.05,-.48,3.00),(.53,.105,.095),C["rededge"],"cube")
    shape("Scarf tail upper",(-.72,.12,2.99),(.87,.15,.18),C["red"],"cube")
    shape("Scarf tail free",(-1.23,.16,2.79),(.64,.13,.25),C["rededge"],"cube")
    shape("Scarf frayed end",(-1.57,.19,2.66),(.25,.13,.18),C["red"],"cube")
    # Brass closures, crossing harness, gun/lantern on belt.
    shape("Belt",(0,-.40,1.83),(.62,.17,.16),C["coatedge"],"cube")
    shape("Belt clasp",(0,-.51,1.83),(.145,.095,.17),C["bronze"],"cube")
    shape("Crossbelt",(.045,-.53,2.50),(.12,.09,.76),C["coatedge"],"cube")
    for i in range(5):
        shape("Coat brass button %d"%i,(.30,-.54,2.64-i*.19),
              (.065,.06,.062),C["bronze"])
    shape("Belt holster",(.50,-.16,1.57),(.29,.25,.39),C["coat"])
    shape("Amber belt lamp",(-.54,-.34,1.82),(.20,.19,.32),C["light"])
    shape("Lantern steel frame",(-.54,-.48,1.82),(.23,.07,.38),C["steel"],"cube")
    # Weapon with original hook-scythe silhouette, recognisable in gameplay.
    for part in ("blade1","blade2"):
        PARTS[part].data.materials.clear()
        PARTS[part].data.materials.append(C["steel"])
    COLORS.clear();COLORS.update(C)

def animate(PARTS,move,state,index,bob,lean,cycle):
    wave=math.sin(index/6*math.tau)
    scarf=.20*wave+(.54 if state=="dash" else .37 if state=="attack" else .09)
    for side in (-1,1):
        s="L" if side==-1 else "R"
        off=side*.05*cycle
        move("Duster hem "+s,(side*.31+off-.19*lean,.16,1.13+bob),-.14*wave+lean*.6)
        move("Scuffed coat panel "+s,(side*.31+off-.11*lean,-.32,1.09+bob),.10*wave+lean*.55)
        move("Coat edge piping "+s,(side*.50+off-.16*lean,-.42,1.15+bob),-.08*wave+lean*.5)
        move("Armored shoulder "+s,(side*.56+lean*.15,-.02,2.85+bob),lean*.16)
        move("Brass epaulet stud "+s,(side*.60+lean*.15,-.39,2.87+bob))
        move("Leather vambrace "+s,(side*.75+lean*.15,-.03,2.19+bob))
        move("Boot top "+s,(side*.28+side*.14*cycle,-.02,.60+bob))
    for name,pos in (
        ("Waistcoat front",(.01+lean*.23,-.395,2.53+bob)),
        ("Black collar",(lean*.44,-.05,3+bob)),
        ("Angular jaw",(.13+lean*.7,-.57,3.17+bob)),
        ("Nose bridge",(.18+lean*.7,-.63,3.43+bob)),
        ("Mouth line",(.11+lean*.7,-.72,3.20+bob)),
        ("Scarf collar",(lean*.40,-.12,3.02+bob)),
        ("Scarf highlight",(.05+lean*.40,-.48,3+bob)),
        ("Scarf tail upper",(-.72-scarf,.12,2.99+bob)),
        ("Scarf tail free",(-1.23-scarf*1.3,.16,2.79+bob+.13*wave)),
        ("Scarf frayed end",(-1.57-scarf*1.8,.19,2.66+bob+.19*wave)),
        ("Belt",(0,-.40,1.83+bob)),
        ("Belt clasp",(0,-.51,1.83+bob)),
        ("Crossbelt",(.045+lean*.16,-.53,2.50+bob)),
        ("Belt holster",(.50,-.16,1.57+bob)),
        ("Amber belt lamp",(-.54,-.34,1.82+bob)),
        ("Lantern steel frame",(-.54,-.48,1.82+bob))
    ):
        move(name,pos)
    for xx in (-.065,.25):
        move("Eye shadow "+str(xx),(xx+lean*.7,-.655,3.46+bob))
        move("Brow "+str(xx),(xx+lean*.7,-.66,3.56+bob))
    for i in range(18):
        a=i/18*math.tau
        move("Hair lock %02d"%i,(.07+.37*math.cos(a)+lean*.7,
             -.18+.25*math.sin(a),3.68+(i%3)*.058+bob))
    for i in range(4):
        move("Fringe strand %d"%i,(-.19+i*.16+lean*.7,-.53,3.72-i*.045+bob))
    for i in range(5):
        move("Coat brass button %d"%i,(.30+lean*.18,-.54,2.64-i*.19+bob))
