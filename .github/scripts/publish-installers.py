"""Publish only the verified installers from one successful source build."""
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
from datetime import datetime, timezone


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def gh(*arguments, json_result=False):
    # Never interpolate workflow inputs into a shell command.
    result = subprocess.run(["gh", *map(str, arguments)], check=True, text=True, capture_output=True)
    return json.loads(result.stdout) if json_result else result.stdout


def sha256(file):
    with file.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def unique_file(directory, name):
    matches = list(directory.rglob(name))
    require(len(matches) == 1 and matches[0].is_file() and not matches[0].is_symlink(), f"Expected exactly one regular {name}")
    require(matches[0].resolve().is_relative_to(directory.resolve()), f"Artifact path escaped its directory: {name}")
    return matches[0]


def load_json(file):
    # Windows PowerShell can emit a UTF-8 BOM.
    return json.loads(file.read_text(encoding="utf-8-sig"))


def check_tag(repo, tag, source_sha, must_exist=False):
    refs = gh("api", f"repos/{repo}/git/matching-refs/tags/{tag}", json_result=True)
    matches = [entry for entry in refs if entry["ref"] == f"refs/tags/{tag}"]
    require(len(matches) <= 1, "Ambiguous tag reference")
    require(matches or not must_exist, "Published release has no tag reference")
    if not matches:
        return
    obj = matches[0]["object"]
    for _ in range(8):
        if obj["type"] == "commit":
            require(obj["sha"] == source_sha, "Tag points to a different source commit")
            return
        require(obj["type"] == "tag", "Tag does not resolve to a commit")
        obj = gh("api", f"repos/{repo}/git/tags/{obj['sha']}", json_result=True)["object"]
    raise RuntimeError("Tag nesting is too deep")


def main():
    repo = os.environ.get("GITHUB_REPOSITORY", "")
    run_id = os.environ.get("BUILD_RUN_ID", "")
    source_sha = os.environ.get("SOURCE_SHA", "")
    tag = os.environ.get("RELEASE_TAG", "")
    require(re.fullmatch(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+", repo), "Invalid repository")
    require(re.fullmatch(r"[1-9][0-9]{0,19}", run_id), "Invalid build run ID")
    require(re.fullmatch(r"[0-9a-f]{40}", source_sha), "Source SHA must be an exact lowercase 40-character commit")
    require(re.fullmatch(r"v[0-9]+\.[0-9]+\.[0-9]+(?:-[A-Za-z0-9.-]+)?", tag) and len(tag) <= 80, "Invalid release tag")
    version = tag[1:]
    requires_clean_startup = tuple(map(int, version.split('-')[0].split('.'))) >= (0, 4, 0)
    run = gh("api", f"repos/{repo}/actions/runs/{run_id}", json_result=True)
    require(run["status"] == "completed" and run["conclusion"] == "success", "Build run did not complete successfully")
    require(run["head_sha"] == source_sha, "Build run belongs to a different source SHA")
    require(run["path"].split("@")[0] == ".github/workflows/desktop-installers.yml", "Unexpected build workflow")
    require(run["head_repository"]["full_name"].lower() == repo.lower(), "Build originated in another repository")

    expected = [("mac", "darwin", "arm64", "dmg"), ("mac", "darwin", "x64", "dmg"), ("win", "win32", "x64", "exe")]
    jobs = gh("api", f"repos/{repo}/actions/runs/{run_id}/jobs?per_page=100", json_result=True)["jobs"]
    for label, platform, arch, extension in expected:
        matches = [job for job in jobs if job["name"] == f"{label} {arch}"]
        require(len(matches) == 1 and matches[0]["conclusion"] == "success", f"Native job {label} {arch} did not succeed")
        native_step = "Install, launch and remove macOS app" if label == "mac" else "Install, launch and uninstall Windows app"
        require(any(step["name"] == native_step and step["conclusion"] == "success" for step in matches[0]["steps"]), f"Missing native installation test: {label} {arch}")

    # The tag endpoint can return 404 for a draft whose Git tag does not exist yet.
    pages = gh("api", f"repos/{repo}/releases?per_page=100", "--paginate", "--slurp", json_result=True)
    releases = [release for page in pages for release in page if release["tag_name"] == tag]
    require(len(releases) == 1 and releases[0]["draft"] is True, "Exactly one existing draft release with this tag is required")
    release = releases[0]
    check_tag(repo, tag, source_sha)
    output = Path("output/publish").resolve()
    output.mkdir(parents=True, exist_ok=True)
    records = []
    uploads = []
    with tempfile.TemporaryDirectory(prefix="quandeck-publish-") as temporary:
        downloads = Path(temporary)
        gh("run", "download", run_id, "--repo", repo, "--dir", downloads)
        expected_directories = {f"QuanDeck-{label}-{arch}" for label, _, arch, _ in expected}
        require({directory.name for directory in downloads.iterdir()} == expected_directories, "Unexpected or missing installer artifacts")
        for label, platform, arch, extension in expected:
            directory = downloads / f"QuanDeck-{label}-{arch}"
            manifest = load_json(unique_file(directory, f"installer-manifest-{platform}-{arch}.json"))
            require(manifest["sourceCommit"] == source_sha and manifest["sourceDirty"] is False, f"Wrong or dirty source in {directory.name}")
            require(manifest["version"] == version and len(manifest["artifacts"]) == 1, f"Unexpected version or installer count in {directory.name}")
            artifact = manifest["artifacts"][0]
            suffix = "-Setup" if label == "win" else ""
            name = f"QuanDeck-{version}-{label}-{arch}{suffix}.{extension}"
            require(artifact["file"] == name and artifact["platform"] == platform and artifact["arch"] == arch and artifact["version"] == version, f"Installer identity mismatch in {directory.name}")
            require(re.fullmatch(r"[0-9a-f]{64}", artifact["sha256"]), f"Invalid SHA-256 for {name}")
            installer = unique_file(directory, name)
            require(sha256(installer) == artifact["sha256"], f"SHA-256 mismatch for {name}")
            check_name = f"mac-install-check-{arch}.json" if label == "mac" else "windows-install-check.json"
            check = load_json(unique_file(directory, check_name))
            require(check["ok"] is True and check["installer"] == name, f"Installation check mismatch for {name}")
            required_checks = ["dmgVerified", "applicationsLink", "copiedInstallation", "signatureVerified", "removedApplication"] if label == "mac" else ["installed", "uninstalled", "userDataPreserved"]
            require(all(check.get(key) is True for key in required_checks), f"Incomplete native validation for {name}")
            launch = check["launch"]
            require(launch["ok"] is True and launch["rendered"] is True and launch["version"] == version and launch["platform"] == platform and launch["arch"] == arch, f"Native launch identity mismatch for {name}")
            require(not requires_clean_startup or launch.get("cleanStartup") is True, f"Fresh installation check missing or failed for {name}")
            require(launch["renderer"] == "quandeck://app/" and launch["bridge"] == {"authorized": 200, "unauthorized": 401}, f"Renderer or bridge check failed for {name}")
            destination = output / name
            shutil.copyfile(installer, destination)
            uploads.append(destination)
            records.append({"file": name, "sha256": artifact["sha256"], "bytes": destination.stat().st_size, "manifest": manifest, "nativeCheck": check})

    verification = {"verified": True, "verifiedAt": datetime.now(timezone.utc).isoformat(), "repository": repo, "buildRunId": run_id,
                    "buildUrl": run["html_url"], "sourceCommit": source_sha, "releaseTag": tag, "version": version, "installers": records}
    verification_file = output / "verification.json"
    verification_file.write_text(json.dumps(verification, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    sums = output / "SHA256SUMS.txt"
    sums.write_text("".join(f"{sha256(file)}  {file.name}\n" for file in [*uploads, verification_file]), encoding="utf-8")
    uploads.extend([verification_file, sums])
    # Re-read the draft immediately before the first remote write.
    require(gh("api", f"repos/{repo}/releases/{release['id']}", json_result=True)["draft"] is True, "Draft was already published")
    gh("release", "upload", tag, *uploads, "--clobber", "--repo", repo)
    uploaded = gh("api", f"repos/{repo}/releases/{release['id']}/assets?per_page=100", json_result=True)
    for file in uploads:
        matches = [asset for asset in uploaded if asset["name"] == file.name]
        require(len(matches) == 1 and matches[0]["state"] == "uploaded" and matches[0]["size"] == file.stat().st_size, f"Release upload incomplete: {file.name}")
        require(matches[0].get("digest") == f"sha256:{sha256(file)}", f"Release asset digest mismatch: {file.name}")
    check_tag(repo, tag, source_sha)
    gh("release", "edit", tag, "--repo", repo, "--target", source_sha, "--prerelease", "--draft=false")
    published = gh("api", f"repos/{repo}/releases/{release['id']}", json_result=True)
    require(published["draft"] is False and published["prerelease"] is True and published["target_commitish"] == source_sha, "Published release metadata does not match the verified source")
    check_tag(repo, tag, source_sha, must_exist=True)
    summary = f"Published {tag}: three native installers verified against `{source_sha}`.\n\n{published['html_url']}\n"
    if os.environ.get("GITHUB_STEP_SUMMARY"):
        with open(os.environ["GITHUB_STEP_SUMMARY"], "a", encoding="utf-8") as stream:
            stream.write(summary)
    print(summary)


if __name__ == "__main__":
    main()
