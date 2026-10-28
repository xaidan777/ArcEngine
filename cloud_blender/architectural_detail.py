"""Differentiated architectural foregrounds for 11 MGLOTEK islands."""
import math

def decorate(theme,r,cube,cylinder,mat,wood,iron,stone,glow):
    moss=mat("Wet moss / memory root",(.05,.16,.12),.0,.95)
    bone=mat("Pale age worn stone",(.46,.49,.43),.0,.8)
    teal=mat("Weathered enamel",(.09,.31,.32),.48,.49)
    bronze=mat("Old dark bronze",(.33,.29,.20),.71,.39)
    ember=mat("Kiln fire glow",(.83,.19,.055),.08,.48,1.8)
    ink=mat("Memory lettering",(.43,.64,.70),.05,.28,1.2)
    if theme in ("birch","nursery"):
        for x in (3,12,21,31):
            if theme=="birch":
                for level in (1.15,2.1):
                    cube("Abandoned garden rail",(x,-3.1,level),(3.8,.15,.07),wood,.02)
                for dx in (-1.7,1.7):
                    cylinder("White birch fence",(x+dx,-3.13,1.6),.12,3.1,bone,11)
                cylinder("Memorial lantern",(x,-3.4,2.42),.26,.38,glow,8)
            else:
                cube("Abandoned nursery lintel",(x,-3.3,4.05),(3.5,.42,.32),bone,.07)
                for dx in (-1.54,1.54):
                    cube("Orphanage door arch",(x+dx,-3.35,2.14),(.3,.52,3.8),bone,.07)
                for i in range(5):
                    xx=x-1.2+i*.6
                    cylinder("Hanging clockwork mobile",(xx,-3.75,3.2),.06,1.3,bronze,8)
                    cylinder("Toy shadow",(xx,-3.7,2.45),.22,.18,ink,10)
    elif theme in ("bakery","kern"):
        for x in (3,12,21,31):
            cylinder("Old industrial kiln",(x,-3.35,2.05),1.25,3.7,stone,16)
            cube("Kiln hearth",(x,-4.65,1.25),(1.48,.12,1.82),iron,.20)
            cube("Lit coals",(x,-4.76,1.20),(1.08,.09,1.22),ember if theme=="kern" else glow,.15)
            cylinder("Smoke chimney",(x+1.0,-3.5,5.0),.39,3.1,bronze,12)
            if theme=="kern":
                for a in range(5):
                    v=a*math.tau/5
                    cylinder("Cog of the endless oven",(x+1.2*math.sin(v),-3.15,
                                3.2+math.cos(v)*1.1),.22,.17,bronze,10)
            else:
                cube("Mouldering flour sacks",(x-1.4,-3.9,.8),(.65,.55,1.1),bone,.25)
    elif theme in ("station","depot","carriage","conductor"):
        if theme=="carriage":
            for x in (6,18,30):
                cube("Abandoned ghost train hull",(x,-3.45,2.2),(11.2,1.15,3.2),teal,.2)
                for i in range(5):
                    cube("Silent carriage window",(x-3.9+i*1.8,-4.12,2.73),
                         (1.2,.1,1.05),glow,.075)
                for dx in (-3.9,3.9):
                    cylinder("Wagon iron wheel",(x+dx,-3.75,.43),.46,.18,iron,16)
        else:
            for x in (3.5,13,23,33):
                for dx in (-1.3,1.3):
                    cube("Steel platform arcade",(x+dx,-3.3,2.45),(.26,.38,4.7),iron,.05)
                cube("Rain-worn station canopy",(x,-3.35,4.85),(3.5,.65,.24),bronze,.03)
                if theme=="station":
                    cylinder("Platform clock",(x,-3.92,3.3),.65,.15,bone,20)
                elif theme=="depot":
                    cube("Empty ticket booth",(x,-4.04,1.95),(2.35,.2,1.45),bone,.08)
                    cube("Ticket counter",(x,-4.27,1.25),(2.55,.48,.2),wood,.03)
                else:
                    for n in range(6):
                        cylinder("The Conductor's organ pipe",(x-1.2+n*.48,-4.02,
                                   3.7+n*.16),.12,1.6+n*.28,teal,9)
    elif theme in ("archive","cistern","vault"):
        for x in (3,11,20,30):
            if theme=="archive":
                cube("Shelf of forgotten lives",(x,-3.45,2.55),(3.35,.9,4.9),wood,.04)
                for z in (.9,1.75,2.6,3.45,4.3):
                    cube("Book ledge",(x,-4.05,z),(3.26,.17,.08),bronze,.015)
                    for q in range(7):
                        cube("Spine of a vanished name",(x-1.35+q*.45,-4.16,z+.4),
                             (.30,.13,.66),ink if q%3==0 else bone,.014)
            if theme=="cistern":
                cylinder("Massive sunken fluid tank",(x,-3.2,2.65),1.3,5.1,teal,18)
                for z in (.7,1.8,3.3,4.65):
                    cylinder("Tank oxidized ring",(x,-3.2,z),1.39,.14,bronze,18)
                cylinder("Tangled pressure pipe",(x+1.0,-4.1,3.6),.18,4,iron,10)
                cube("Fluid leak",(x,-4.57,2.1),(.7,.12,1.0),ink,.1)
            if theme=="vault":
                for dx in (-1.14,1.14):
                    cube("Keeper's huge pillar",(x+dx,-3.34,2.6),(.44,.7,5.2),stone,.1)
                cube("Memory vault monolith",(x,-3.85,2.7),(1.5,.72,4.05),bronze,.22)
                for z in (1.1,1.8,2.5,3.2,3.9):
                    cube("Keeper's erased inscription",(x,-4.25,z),
                         (.85,.08,.08),ink,.01)
