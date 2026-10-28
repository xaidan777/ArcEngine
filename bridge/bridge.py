"""Мост МГЛОТЕК: проверка источников и контракт игрового экспорта."""
import argparse
import json
import re
import struct
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
MANIFEST = ROOT / "manifest.json"
ID_RE = re.compile(r"^[a-z][a-z0-9_]+$")
REPO_RE = re.compile(r"^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$")
BACKENDS = {"cpu", "gpu", "service", "docs-only", "windows-only", "host"}
STAGES = {"cutscene", "environment", "research", "model", "animation",
          "texture", "character", "render", "host"}


def manifest():
    return json.loads(MANIFEST.read_text(encoding="utf-8"))


def validate(data):
    assert data["schema_version"] == 1
    assert data["engine"] == "Python + pygame"
    ids = set()
    repos = set()
    for item in data["tools"]:
        assert ID_RE.fullmatch(item["id"]), item
        assert REPO_RE.fullmatch(item["repo"]), item
        assert item["backend"] in BACKENDS, item
        assert item["stage"] in STAGES, item
        assert item["ref"] and "/" not in item["ref"], item
        assert item["id"] not in ids and item["repo"] not in repos, item
        ids.add(item["id"])
        repos.add(item["repo"])
    assert len(ids) == 15, len(ids)
    return True


def select(data, name):
    if name == "all":
        return data["tools"]
    result = [x for x in data["tools"] if x["id"] == name]
    if not result:
        raise ValueError("Unknown id: " + name)
    return result


def execute(cmd, timeout=35):
    return subprocess.run(cmd, text=True, capture_output=True,
                          timeout=timeout, check=False)


def audit(items, output):
    report = []
    for item in items:
        target = "https://github.com/" + item["repo"] + ".git"
        result = {"id": item["id"], "repo": item["repo"],
                  "backend": item["backend"], "stage": item["stage"]}
        try:
            proc = execute(["git", "-c", "credential.helper=", "ls-remote",
                            "--exit-code", "--heads", target,
                            "refs/heads/" + item["ref"]], timeout=30)
            result["reachable"] = proc.returncode == 0
            result["sha"] = proc.stdout.strip().split()[0] if proc.returncode == 0 else None
            if proc.returncode:
                result["diagnostic"] = proc.stderr[-300:]
        except (OSError, subprocess.TimeoutExpired) as exc:
            result.update(reachable=False, diagnostic=str(exc))
        report.append(result)
        print(("OK" if result["reachable"] else "FAIL"), item["id"], flush=True)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps({"repos": report}, indent=2,
                                 ensure_ascii=False) + "\n", encoding="utf-8")
    return all(x["reachable"] for x in report)


def prepare(item, output):
    # Только получение публичных исходников: никакого исполнения чужих скриптов.
    if item["backend"] in ("host", "docs-only") or item["id"] == "blender":
        raise ValueError("Only a source reference is available for " + item["id"])
    dst = output / "sources" / item["id"]
    if dst.exists():
        raise FileExistsError(str(dst))
    dst.parent.mkdir(parents=True, exist_ok=True)
    proc = execute(["git", "-c", "credential.helper=", "clone", "--depth", "1",
                    "--single-branch", "--no-tags", "--branch", item["ref"],
                    "https://github.com/" + item["repo"] + ".git", str(dst)], timeout=240)
    if proc.returncode:
        raise RuntimeError(proc.stderr[-800:])
    revision = execute(["git", "-C", str(dst), "rev-parse", "HEAD"])
    (output / "source_receipt.json").write_text(json.dumps(
        {"tool_id": item["id"], "repo": item["repo"],
         "revision": revision.stdout.strip(), "executed": False}, indent=2) + "\n")


def inspect_asset(path):
    path = Path(path)
    if not path.is_file():
        raise ValueError("Missing " + str(path))
    data = path.read_bytes()
    if path.suffix.lower() == ".png":
        if len(data) < 33 or data[:8] != b"\x89PNG\r\n\x1a\n" or data[12:16] != b"IHDR":
            raise ValueError("Invalid PNG header")
        width, height = struct.unpack(">II", data[16:24])
        if width > 16000 or height > 16000 or width < 8 or height < 8:
            raise ValueError("Invalid PNG dimensions")
        return {"format": "png", "size": [width, height], "bytes": len(data)}
    if path.suffix.lower() == ".glb":
        if len(data) < 20 or data[:4] != b"glTF":
            raise ValueError("Invalid GLB header")
        version, size = struct.unpack("<II", data[4:12])
        if version != 2 or size != len(data):
            raise ValueError("Invalid GLB header length")
        return {"format": "glb", "version": version, "bytes": len(data)}
    if path.suffix.lower() == ".blend":
        if not data.startswith(b"BLENDER"):
            raise ValueError("Invalid Blender scene")
        return {"format": "blend", "bytes": len(data)}
    raise ValueError("Unsupported asset " + path.suffix)


def check_birch(folder, output):
    result = {}
    for name in ("birch_mid.png", "birch.glb", "birch.blend"):
        result[name] = inspect_asset(Path(folder) / name)
    if result["birch_mid.png"]["size"] != [1900, 470]:
        raise ValueError("Game layer must be 1900x470")
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(result, indent=2) + "\n")
    return result


def main():
    p = argparse.ArgumentParser()
    p.add_argument("operation", choices=["validate", "list", "audit", "prepare",
                                         "check-birch"])
    p.add_argument("--id", default="all")
    p.add_argument("--out", type=Path, default=Path("bridge_output"))
    p.add_argument("--input", type=Path)
    a = p.parse_args()
    data = manifest()
    validate(data)
    if a.operation == "validate":
        print("Manifest valid:", len(data["tools"]), "bridges")
    elif a.operation == "list":
        for item in data["tools"]:
            print(item["id"], item["repo"], item["stage"], item["backend"])
    elif a.operation == "audit":
        success = audit(select(data, a.id), a.out / "source_audit.json")
        if not success:
            sys.exit(2)
    elif a.operation == "prepare":
        if a.id == "all":
            p.error("prepare requires one id; never clone all repos by accident")
        prepare(select(data, a.id)[0], a.out)
    else:
        if not a.input:
            p.error("--input directory required")
        print(json.dumps(check_birch(a.input, a.out / "asset_receipt.json")))


if __name__ == "__main__":
    main()
