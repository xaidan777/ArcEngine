"""Контролируемая публикация реальных ZIP МГЛОТЕКА на GitHub Releases."""
import json
import hashlib
import urllib.request
from urllib.parse import urlsplit
import os
import re
import subprocess
import sys
import zipfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
REQUEST = HERE / "request.json"
SEMVER = re.compile(r"^[0-9]+\.[0-9]+\.[0-9]+$")
ARTIFACT = "MGLOTEK-Game-Windows"


def request():
    data = json.loads(REQUEST.read_text(encoding="utf-8"))
    mode = data.get("mode", "check")
    version = os.getenv("INPUT_VERSION") or data.get("version", "")
    run = os.getenv("INPUT_RUN") or data.get("source_run", "")
    url = data.get("source_url", "")
    digest = data.get("source_sha256", "")
    if mode not in ("check", "publish", "draft", "finalize"):
        raise ValueError("mode must be check, publish, draft, or finalize")
    if mode in ("draft","finalize"):
        if not SEMVER.fullmatch(str(version)):
            raise ValueError("version must be X.Y.Z")
        if not re.fullmatch(r"[0-9a-f]{64}", digest):
            raise ValueError("A 64-digit SHA256 checksum is required")
    elif mode == "publish" or version or run:
        if not SEMVER.fullmatch(str(version)):
            raise ValueError("version must be X.Y.Z")
        if url:
            validate_source_url(url)
            if not re.fullmatch(r"[0-9a-f]{64}", digest):
                raise ValueError("A 64-digit SHA256 checksum is required with a source URL")
        elif not str(run).isdigit() or int(run) <= 0:
            raise ValueError("source_run must be numeric unless a validated GitHub attachment URL is supplied")
    return {"mode": mode, "version": str(version), "source_run": str(run),
            "source_url": url, "source_sha256": digest}


def validate_source_url(url):
    parsed = urlsplit(url)
    if parsed.scheme != "https" or parsed.netloc != "github.com":
        raise ValueError("Only a public github.com user attachment is allowed")
    if parsed.query or parsed.fragment or not re.fullmatch(
        r"/user-attachments/files/[0-9]+/[A-Za-z0-9_.-]+[.]zip", parsed.path):
        raise ValueError("Invalid GitHub user-attachment path")
    return True


def download_attachment(url, digest, target):
    validate_source_url(url)
    total = 0
    checksum = hashlib.sha256()
    req = urllib.request.Request(url, headers={"User-Agent": "MGLOTEK-Release-Publisher/1.0"})
    with urllib.request.urlopen(req, timeout=180) as source, open(target, "wb") as out:
        while True:
            block = source.read(1024 * 256)
            if not block:
                break
            total += len(block)
            if total > 180_000_000:
                raise ValueError("Attachment too large")
            checksum.update(block)
            out.write(block)
    if checksum.hexdigest() != digest:
        raise ValueError("SHA256 mismatch; refusing publication")
    return target


def validate_game_zip(path):
    path = Path(path)
    if not path.is_file():
        raise ValueError("Missing game archive")
    if path.stat().st_size > 1_800_000_000:
        raise ValueError("Archive too large")
    with zipfile.ZipFile(path, "r") as z:
        if z.testzip() is not None:
            raise ValueError("Corrupted ZIP member")
        files = [i for i in z.infolist() if not i.is_dir()]
        if not files or len(files) > 20000:
            raise ValueError("Invalid number of files")
        if sum(i.file_size for i in files) > 2_500_000_000:
            raise ValueError("Excessive uncompressed size")
        names = set()
        for item in files:
            p = item.filename.replace("\\", "/")
            parts = p.split("/")
            if p.startswith("/") or ".." in parts or not p or ":" in p:
                raise ValueError("Unsafe ZIP path: " + p)
            if p in names:
                raise ValueError("Duplicate ZIP path: " + p)
            names.add(p)
        for required in ("main.py", "start_windows.bat", "requirements.txt"):
            if not any(n == required or n.endswith("/" + required) for n in names):
                raise ValueError("Missing required game file: " + required)
        if any(n.endswith("/data/meta.json") or n == "data/meta.json" for n in names):
            raise ValueError("Do not distribute a user's meta save")
    return len(files)


def gh(*args):
    proc = subprocess.run(["gh", *args], capture_output=True, text=True, check=False)
    if proc.returncode:
        raise RuntimeError("gh failed: " + (proc.stderr or proc.stdout)[-600:])
    return proc.stdout.strip()


def publish(spec):
    tag = "mglotek-v" + spec["version"]
    run = spec["source_run"]
    dst = Path("release_staging")
    dst.mkdir(exist_ok=True)
    if spec["source_url"]:
        attachment = dst / "MGLOTEK-source-upload.zip"
        download_attachment(spec["source_url"], spec["source_sha256"], attachment)
        found = [attachment]
    else:
        meta = json.loads(gh("api", "repos/" + os.environ["GH_REPO"] + "/actions/runs/" + run))
        if meta.get("conclusion") != "success":
            raise RuntimeError("Refusing an unverified or failed Actions run")
        if meta.get("repository", {}).get("full_name") != os.environ["GH_REPO"]:
            raise RuntimeError("Actions run belongs to a different repository")
        if meta.get("head_branch") != "mglotek-cloud-render":
            raise RuntimeError("Unexpected workflow branch")
        gh("run", "download", run, "--repo", os.environ["GH_REPO"],
           "--name", ARTIFACT, "--dir", str(dst))
        found = list(dst.glob("*.zip"))
        if len(found) != 1:
            raise ValueError("Expected exactly one Windows game ZIP in the Actions artifact")
    count = validate_game_zip(found[0])
    output = dst / ("MGLOTEK_v" + spec["version"] + "_Windows.zip")
    if found[0] != output:
        found[0].rename(output)
    import hashlib
    checksum = hashlib.sha256(output.read_bytes()).hexdigest()
    checksums = dst / "SHA256SUMS.txt"
    checksums.write_text(checksum + "  " + output.name + "\n", encoding="ascii")
    # No accidental overwrite of an existing public release.
    exists = subprocess.run(["gh", "release", "view", tag, "--repo", os.environ["GH_REPO"]],
                            capture_output=True, text=True)
    if exists.returncode == 0:
        raise ValueError("Release already exists: " + tag)
    notes = dst / "RELEASE_NOTES.md"
    notes.write_text(
        "# МГЛОТЕК " + spec["version"] +
        "\n\nWindows ZIP. Python 3.11 + pygame.\n\n"
        + "Game files verified: " + str(count) + ".\n"
        + "Source: " + (spec["source_url"] or "GitHub Actions run " + run) + ".\n"
        + "This package does not install Blender or ComfyUI on the player's PC.\n",
        encoding="utf-8",
    )
    gh("release", "create", tag, str(output), str(checksums), "--repo",
       os.environ["GH_REPO"], "--target", os.environ["GITHUB_SHA"],
       "--title", "МГЛОТЕК v" + spec["version"] + " — Windows",
       "--notes-file", str(notes), "--latest")
    print("Release verified:", "https://github.com/" + os.environ["GH_REPO"] +
          "/releases/tag/" + tag)


def draft(spec):
    tag = "mglotek-v" + spec["version"]
    check = subprocess.run(["gh", "release", "view", tag, "--repo", os.environ["GH_REPO"]],
                           capture_output=True, text=True)
    if check.returncode == 0:
        print("Draft already exists:", tag)
        return
    notes = Path("release_draft_notes.md")
    notes.write_text(
        "# МГЛОТЕК v" + spec["version"] + " — Windows\\n\\n"
        "Черновик: ZIP еще не загружен или не прошел проверку SHA-256.\\n\\n"
        "Финальная публикация проводится только после проверки игрового архива.\\n",
        encoding="utf-8")
    gh("release", "create", tag, "--repo", os.environ["GH_REPO"],
       "--target", os.environ["GITHUB_SHA"], "--draft",
       "--title", "МГЛОТЕК v" + spec["version"] + " — Windows",
       "--notes-file", str(notes))
    print("Prepared draft:", tag)


def finalize(spec):
    tag = "mglotek-v" + spec["version"]
    dst = Path("release_staging")
    dst.mkdir(exist_ok=True)
    gh("release", "download", tag, "--repo", os.environ["GH_REPO"],
       "--dir", str(dst))
    files = list(dst.glob("*.zip"))
    if len(files) != 1:
        raise ValueError("Draft must have exactly one ZIP asset before publication")
    game = files[0]
    if hashlib.sha256(game.read_bytes()).hexdigest() != spec["source_sha256"]:
        raise ValueError("ZIP digest mismatch — publication blocked")
    count = validate_game_zip(game)
    sums = dst / "SHA256SUMS.txt"
    sums.write_text(spec["source_sha256"] + "  " + game.name + "\\n", encoding="ascii")
    gh("release", "upload", tag, str(sums), "--repo", os.environ["GH_REPO"], "--clobber")
    gh("release", "edit", tag, "--repo", os.environ["GH_REPO"],
       "--draft=false", "--latest")
    print("Published:", tag, "files validated:", count)


if __name__ == "__main__":
    spec = request()
    print("Release request:", spec)
    if sys.argv[1:] == ["check"]:
        print("Validation OK; no release is created in check mode.")
    elif sys.argv[1:] == ["publish"]:
        if spec["mode"] == "draft":
            draft(spec)
        elif spec["mode"] == "finalize":
            finalize(spec)
        elif spec["mode"] == "publish" or os.getenv("INPUT_VERSION"):
            publish(spec)
        else:
            print("No publish request: setup checked only.")
    else:
        raise SystemExit("Usage: publish.py check|publish")
