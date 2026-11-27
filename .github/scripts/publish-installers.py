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


# Public release evidence is a small projection, never a raw diagnostic upload.
PUBLIC_CHECK_KEYS = set("ok installer launch rendered version platform arch renderer bridge authorized unauthorized cleanStartup dmgVerified applicationsLink copiedInstallation signatureVerified removedApplication installed uninstalled userDataPreserved collaboration storage humanTask reviewRequired contextPreserved immutableHistory sharedDecision intelligence rawInputPreserved manualBypassesAI noFakeTaskSession originalNavigation taskAttachments ipcUpload persisted reopenedBytes projectIsolation agentReadable detachPreservesBytes integration versionedMerge sourcePreserved casProtected taskLookup maintenance ipcExport ipcRepair ipcErasePreview ipcInvalidEraseRejected isolatedErasure restoredErasureReplay nativeConfirmationBypassed usesUserData goalDelivery projectDirection outlinePersisted partialAssembly candidateNotAccepted strictContract partialAcceptanceRejected contributionTasks assemblyTasks noSyntheticTask explicitEmptyPreserved partialTaskIncomplete declaredSlots dshDesktopLauncher".split())
PUBLIC_IDENTITY_KEYS = set("installer version platform arch renderer storage".split())

def public_checks(value):
    result = {}
    for key, item in value.items():
        if key not in PUBLIC_CHECK_KEYS:
            continue
        if isinstance(item, dict):
            result[key] = public_checks(item)
        elif type(item) in (bool, int):
            result[key] = item
        elif key in PUBLIC_IDENTITY_KEYS and isinstance(item, str) and re.fullmatch(r"(?:[0-9]+\.[0-9]+\.[0-9]+(?:-[A-Za-z0-9.-]+)?|darwin|win32|arm64|x64|sqlite|quandeck://app/|QuanDeck-[0-9]+\.[0-9]+\.[0-9]+(?:-[A-Za-z0-9.-]+)?-(?:mac-arm64\.dmg|win-x64-Setup\.exe))", item):
            result[key] = item
    return result


def clean_release_proof(manifest):
    proof = manifest.get("cleanRelease", {})
    require(proof.get("schema") == 1 and proof.get("policyVersion") == 1 and proof.get("ok") is True
            and proof.get("packagedApplication") is True, "Clean release gate missing or failed")
    cleaned = {"schema": 1, "policyVersion": 1, "ok": True, "packagedApplication": True}
    for scope in ("repository", "application"):
        entry = proof.get(scope, {})
        require(entry.get("ok") is True and type(entry.get("checkedFiles")) is int and entry["checkedFiles"] > 0,
                f"Clean release {scope} evidence missing or failed")
        cleaned[scope] = {"ok": True, "checkedFiles": entry["checkedFiles"]}
    return cleaned


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
    requires_clean_release = tuple(map(int, version.split('-')[0].split('.'))) >= (0, 17, 0)
    requires_clean_startup = tuple(map(int, version.split('-')[0].split('.'))) >= (0, 4, 0)
    requires_dsh_launcher = tuple(map(int, version.split('-')[0].split('.'))) >= (0, 6, 1)
    run = gh("api", f"repos/{repo}/actions/runs/{run_id}", json_result=True)
    require(run["status"] == "completed" and run["conclusion"] == "success", "Build run did not complete successfully")
    require(run["head_sha"] == source_sha, "Build run belongs to a different source SHA")
    require(run["path"].split("@")[0] == ".github/workflows/desktop-installers.yml", "Unexpected build workflow")
    require(run["head_repository"]["full_name"].lower() == repo.lower(), "Build originated in another repository")

    expected = [("mac", "darwin", "arm64", "dmg"), ("win", "win32", "x64", "exe")]
    jobs = gh("api", f"repos/{repo}/actions/runs/{run_id}/jobs?per_page=100", json_result=True)["jobs"]
    for label, platform, arch, extension in expected:
        matches = [job for job in jobs if job["name"] == f"{label} {arch}"]
        require(len(matches) == 1 and matches[0]["conclusion"] == "success", f"Native job {label} {arch} did not succeed")
        if requires_clean_release:
            require(any(step["name"] == "Clean release audit" and step["conclusion"] == "success" for step in matches[0]["steps"]), "Missing clean release audit")
        native_step = "Install, launch and remove macOS app" if label == "mac" else "Install, launch and uninstall Windows app"
        require(any(step["name"] == native_step and step["conclusion"] == "success" for step in matches[0]["steps"]), f"Missing native installation test: {label} {arch}")
        if requires_dsh_launcher and label == "win":
            require(any(step["name"] == "Verify Windows DSH Desktop launcher" and step["conclusion"] == "success" for step in matches[0]["steps"]), "Missing Windows DSH launcher test")

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
            clean_proof = clean_release_proof(manifest) if requires_clean_release else None
            artifact = manifest["artifacts"][0]
            suffix = "-Setup" if label == "win" else ""
            name = f"QuanDeck-{version}-{label}-{arch}{suffix}.{extension}"
            require(artifact["file"] == name and artifact["platform"] == platform and artifact["arch"] == arch and artifact["version"] == version, f"Installer identity mismatch in {directory.name}")
            require(re.fullmatch(r"[0-9a-f]{64}", artifact["sha256"]), f"Invalid SHA-256 for {name}")
            installer = unique_file(directory, name)
            require(sha256(installer) == artifact["sha256"], f"SHA-256 mismatch for {name}")
            check_name = f"mac-install-check-{arch}.json" if label == "mac" else "windows-install-check.json"
            check = load_json(unique_file(directory, check_name))
            if requires_dsh_launcher and label == "win":
                dsh_check = load_json(unique_file(directory, "dsh-launcher-install-check.json"))
                require(dsh_check.get("ok") is True and len(dsh_check.get("checks", [])) >= 2, "Windows DSH launcher validation failed")
                check["dshDesktopLauncher"] = dsh_check
            require(check["ok"] is True and check["installer"] == name, f"Installation check mismatch for {name}")
            required_checks = ["dmgVerified", "applicationsLink", "copiedInstallation", "signatureVerified", "removedApplication"] if label == "mac" else ["installed", "uninstalled", "userDataPreserved"]
            require(all(check.get(key) is True for key in required_checks), f"Incomplete native validation for {name}")
            launch = check["launch"]
            require(launch["ok"] is True and launch["rendered"] is True and launch["version"] == version and launch["platform"] == platform and launch["arch"] == arch, f"Native launch identity mismatch for {name}")
            require(not requires_clean_startup or launch.get("cleanStartup") is True, f"Fresh installation check missing or failed for {name}")
            if tuple(map(int, version.split('-')[0].split('.'))) >= (0, 6, 0):
                collaboration = launch.get("collaboration", {})
                require(collaboration.get("storage") == "sqlite" and all(collaboration.get(key) is True for key in ["ok", "humanTask", "reviewRequired", "contextPreserved", "immutableHistory", "rendered"]), f"Collaboration validation missing or failed for {name}")
                require(all(launch.get("intelligence", {}).get(key) is True for key in ["ok", "rawInputPreserved", "manualBypassesAI", "noFakeTaskSession", "originalNavigation"]), f"Intelligence regression missing or failed for {name}")
            if tuple(map(int, version.split('-')[0].split('.'))) >= (0, 7, 1):
                require(all(launch.get("taskAttachments", {}).get(key) is True for key in ["ok", "ipcUpload", "persisted", "reopenedBytes", "projectIsolation", "agentReadable", "detachPreservesBytes", "rendered"]), f"Task attachment validation missing or failed for {name}")

            if tuple(map(int, version.split('-')[0].split('.'))) >= (0, 7, 0):
                require(all(launch.get("integration", {}).get(key) is True for key in ["ok", "versionedMerge", "sourcePreserved", "casProtected", "taskLookup", "rendered", "immutableHistory"]), f"Result integration validation missing or failed for {name}")
            require(launch["renderer"] == "quandeck://app/" and launch["bridge"] == {"authorized": 200, "unauthorized": 401}, f"Renderer or bridge check failed for {name}")
            if tuple(map(int, version.split('-')[0].split('.'))) >= (0, 8, 0):
                maintenance = launch.get("maintenance", {})
                require(all(maintenance.get(key) is True for key in ["ok", "ipcExport", "ipcRepair", "ipcErasePreview", "ipcInvalidEraseRejected", "isolatedErasure", "restoredErasureReplay"]), f"Maintenance validation missing or failed for {name}")
                require(maintenance.get("nativeConfirmationBypassed") is False and maintenance.get("usesUserData") is False, f"Unsafe maintenance validation for {name}")
            if tuple(map(int, version.split('-')[0].split('.'))) >= (0, 11, 0):
                goal = launch.get("goalDelivery", {})
                goal_checks = ["ok", "projectDirection", "outlinePersisted", "partialAssembly", "candidateNotAccepted", "rendered"]
                strict_delivery = tuple(map(int, version.split('-')[0].split('.'))) >= (0, 14, 0)
                if strict_delivery:
                    # System assembly responsibilities are now real ledger tasks.
                    # Check the new native scenario, never invent the obsolete flag.
                    goal_checks.extend(["strictContract", "partialAcceptanceRejected"])
                    require(type(goal.get("contributionTasks")) is int and goal["contributionTasks"] == 2
                            and type(goal.get("assemblyTasks")) is int and goal["assemblyTasks"] == 3,
                            f"Strict goal delivery task evidence missing or failed for {name}")
                else:
                    goal_checks.append("noSyntheticTask")
                # 0.11.1 adds a second required output for one task. Its native smoke
                # proves empty submissions and partial tasks cannot fill the map or
                # complete the task. Keep 0.11.0's historical two-slot contract only.
                expected_slots = 2
                if tuple(map(int, version.split('-')[0].split('.'))) >= (0, 11, 1):
                    expected_slots = 3
                    goal_checks.extend(["explicitEmptyPreserved", "partialTaskIncomplete"])
                require(all(goal.get(key) is True for key in goal_checks)
                        and type(goal.get("declaredSlots")) is int
                        and goal["declaredSlots"] == expected_slots,
                        f"Goal delivery validation missing or failed for {name}")
            destination = output / name
            shutil.copyfile(installer, destination)
            uploads.append(destination)
            public_manifest = {"sourceCommit": source_sha, "sourceDirty": False, "version": version,
                               "artifacts": [{key: artifact[key] for key in ("file", "sha256", "platform", "arch", "version")}]}
            if clean_proof:
                public_manifest["cleanRelease"] = clean_proof
            records.append({"file": name, "sha256": artifact["sha256"], "bytes": destination.stat().st_size,
                            "manifest": public_manifest, "nativeCheck": public_checks(check)})

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
    summary = f"Published {tag}: two native installers verified against `{source_sha}`.\n\n{published['html_url']}\n"
    if os.environ.get("GITHUB_STEP_SUMMARY"):
        with open(os.environ["GITHUB_STEP_SUMMARY"], "a", encoding="utf-8") as stream:
            stream.write(summary)
    print(summary)


if __name__ == "__main__":
    main()
