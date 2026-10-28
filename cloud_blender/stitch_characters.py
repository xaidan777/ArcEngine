"""Pack Blender-rendered sprites: 10 states x 6 frames, exact pygame manifest size."""
import argparse
import json
from pathlib import Path
from PIL import Image, ImageChops

STATES=("idle","walk","jump","dash","charge","attack","hurt","ritual","pursue","windup")
def assemble(folder,character):
    frames=Path(folder)/(character+"_frames")
    pictures=[]
    for row in range(10):
        line=[]
        for col in range(6):
            img=Image.open(frames/("%02d_%02d.png"%(row,col))).convert("RGBA")
            if img.size!=(180,228):
                raise ValueError("wrong frame size "+str(img.size))
            line.append(img)
        if not any(ImageChops.difference(line[0],x).getbbox() for x in line[1:]):
            raise ValueError("All six frames identical in state "+STATES[row])
        pictures.append(line)
    sheet=Image.new("RGBA",(1080,2280),(0,0,0,0))
    for row,line in enumerate(pictures):
        for col,frame in enumerate(line):
            sheet.paste(frame,(col*180,row*228))
    if not sheet.getchannel("A").getextrema()[1]:
        raise ValueError("empty alpha channel")
    dest=Path(folder)/(character+".png")
    sheet.save(dest,optimize=True)
    meta={"character":character,"states":STATES,"frames":6,"tile":[180,228],
          "sheet":list(sheet.size),"producer":"Blender Cycles CPU"}
    (Path(folder)/(character+"_sprite_metadata.json")).write_text(
        json.dumps(meta,indent=2)+"\n",encoding="utf-8")
    print("Sprite sheet",dest, dest.stat().st_size,"bytes")
    return dest
if __name__=="__main__":
    p=argparse.ArgumentParser()
    p.add_argument("--name",required=True)
    p.add_argument("--folder",required=True)
    x=p.parse_args()
    assemble(x.folder,x.name)
