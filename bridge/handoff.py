"""Генерация заданий для 15 внешних инструментов (без исполнения чужого кода)."""
import argparse
import json
from pathlib import Path
from bridge import manifest, select, validate

OUTPUTS = {
    "wan_video": ["cutscenes/scene.mp4"],
    "comfy_manager": ["environment/comfy_inventory.json"],
    "rea": ["research/references.md"],
    "asset_furnace": ["models/character.glb"],
    "unimate": ["animation/character.fbx"],
    "ultratex": ["textures/object_albedo.png", "models/object_textured.glb"],
    "ultratex_modular": ["textures/object_pbr.zip", "models/object_textured.glb"],
    "comfy_easy_install": ["environment/comfy_install_report.json"],
    "motion2mixamo": ["animation/character_rigged.fbx"],
    "charakuru": ["models/character.vrm"],
    "partllm": ["models/object_segmented.glb"],
    "edenlive": ["cutscenes/scene.mp4"],
    "dirtymocap": ["research/mocap_availability.md"],
    "blender": ["locations/island/mid.png", "locations/island/scene.glb",
                "locations/island/scene.blend"],
    "arcengine": ["integration/bridge_status.json"],
}

REQUIREMENTS = {
    "gpu": "Requires cloud GPU and licensed model weights",
    "cpu": "CPU runner available subject to adapter readiness",
    "service": "Requires separate provider endpoint or account",
    "docs-only": "Research-only: no executable integration",
    "windows-only": "Requires Windows runner; no installation on user PC",
    "host": "Hosts GitHub Actions; not a pygame game engine",
}


def generate(tool_id, output):
    data = manifest()
    validate(data)
    item = select(data, tool_id)[0]
    spec = {
        "contract": "MGLOTEK-asset-handoff/v1",
        "tool_id": item["id"],
        "repository": "https://github.com/" + item["repo"],
        "branch": item["ref"],
        "stage": item["stage"],
        "backend": item["backend"],
        "execution_status": "NOT_EXECUTED",
        "requirements": REQUIREMENTS[item["backend"]],
        "expected_outputs": OUTPUTS[tool_id],
        "license_review_required": True,
    }
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(spec, ensure_ascii=False, indent=2) + "\n",
                      encoding="utf-8")
    return spec


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--id", required=True)
    p.add_argument("--out", type=Path, default=Path("bridge_output/handoff.json"))
    args = p.parse_args()
    print(generate(args.id, args.out)["tool_id"])
