import importlib.util
import contextlib
import io
import json
import os
from pathlib import Path
import shutil
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("publisher", Path(__file__).with_name("publish-installers.py"))
publisher = importlib.util.module_from_spec(spec)
spec.loader.exec_module(publisher)
SHA = "673365cd0e4b5e9372b03d954588cec22849b61f"
REPO = "Johnie198946/QuanDeck"


class PublishValidationTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.home = Path(self.temporary.name)
        self.previous = Path.cwd()
        os.chdir(self.home)
        self.fixtures = self.home / "fixtures"
        self.writes = []
        self.uploads = []
        self.published = False
        self.bad_digest = False
        self.wrong_tag = False
        self.run = {"status": "completed", "conclusion": "success", "head_sha": SHA,
                    "path": ".github/workflows/desktop-installers.yml", "head_repository": {"full_name": REPO}, "html_url": "https://example.test/build"}
        self.jobs = []
        for label, platform, arch, extension in [("mac", "darwin", "arm64", "dmg"), ("mac", "darwin", "x64", "dmg"), ("win", "win32", "x64", "exe")]:
            directory = self.fixtures / f"QuanDeck-{label}-{arch}"
            directory.mkdir(parents=True)
            name = f"QuanDeck-0.3.0-{label}-{arch}{'-Setup' if label == 'win' else ''}.{extension}"
            installer = directory / name
            installer.write_bytes(f"test installer {label} {arch}".encode())
            manifest = {"sourceCommit": SHA, "sourceDirty": False, "version": "0.3.0", "artifacts": [{"file": name, "sha256": publisher.sha256(installer), "platform": platform, "arch": arch, "version": "0.3.0"}]}
            (directory / f"installer-manifest-{platform}-{arch}.json").write_text(json.dumps(manifest))
            check = {"ok": True, "installer": name, "launch": {"ok": True, "rendered": True, "version": "0.3.0", "platform": platform, "arch": arch, "renderer": "quandeck://app/", "bridge": {"authorized": 200, "unauthorized": 401}}}
            flags = ["dmgVerified", "applicationsLink", "copiedInstallation", "signatureVerified", "removedApplication"] if label == "mac" else ["installed", "uninstalled", "userDataPreserved"]
            check.update({key: True for key in flags})
            check_name = f"mac-install-check-{arch}.json" if label == "mac" else "windows-install-check.json"
            (directory / check_name).write_text(json.dumps(check))
            step = "Install, launch and remove macOS app" if label == "mac" else "Install, launch and uninstall Windows app"
            self.jobs.append({"name": f"{label} {arch}", "conclusion": "success", "steps": [{"name": step, "conclusion": "success"}]})
        self.environment = patch.dict(os.environ, {"GITHUB_REPOSITORY": REPO, "BUILD_RUN_ID": "43771415769", "SOURCE_SHA": SHA, "RELEASE_TAG": "v0.3.0", "GITHUB_STEP_SUMMARY": ""})
        self.environment.start()

    def tearDown(self):
        self.environment.stop()
        os.chdir(self.previous)
        self.temporary.cleanup()

    def fake_gh(self, *arguments, json_result=False):
        args = list(map(str, arguments))
        if args[:2] == ["run", "download"]:
            shutil.copytree(self.fixtures, Path(args[args.index("--dir") + 1]), dirs_exist_ok=True)
            return ""
        if args[:2] == ["release", "upload"]:
            self.writes.append("upload")
            self.uploads = [Path(file) for file in args[3:args.index("--clobber")]]
            return ""
        if args[:2] == ["release", "edit"]:
            self.assertEqual(args[args.index("--target") + 1], SHA)
            self.writes.append("publish")
            self.published = True
            return ""
        endpoint = args[1]
        if endpoint.endswith("/actions/runs/43771415769"):
            return self.run
        if "/jobs?" in endpoint:
            return {"jobs": self.jobs}
        if "/git/matching-refs/" in endpoint:
            return [{"ref": "refs/tags/v0.3.0", "object": {"type": "commit", "sha": "a" * 40 if self.wrong_tag else SHA}}] if self.published or self.wrong_tag else []
        if "/assets?" in endpoint:
            return [{"name": file.name, "state": "uploaded", "size": file.stat().st_size, "digest": "sha256:" + ("0" * 64 if self.bad_digest else publisher.sha256(file))} for file in self.uploads]
        if "/releases?" in endpoint:
            return [[{"id": 123, "tag_name": "v0.3.0", "draft": True}]]
        if "/releases/" in endpoint:
            return {"id": 123, "tag_name": "v0.3.0", "draft": not self.published, "prerelease": self.published, "target_commitish": SHA, "html_url": "https://example.test/release"}
        raise AssertionError(f"Unexpected GitHub call: {args}")

    def run_publish(self):
        with patch.object(publisher, "gh", self.fake_gh), contextlib.redirect_stdout(io.StringIO()):
            publisher.main()

    def change_json(self, pattern, update):
        file = next(self.fixtures.rglob(pattern))
        value = json.loads(file.read_text())
        update(value)
        file.write_text(json.dumps(value))

    def assert_rejected_without_write(self):
        with self.assertRaises(RuntimeError):
            self.run_publish()
        self.assertEqual(self.writes, [])

    def test_success_publishes_three_installers_and_two_verification_files(self):
        self.run_publish()
        self.assertEqual(self.writes, ["upload", "publish"])
        self.assertEqual(len(self.uploads), 5)
        record = json.loads(Path("output/publish/verification.json").read_text())
        self.assertEqual(record["sourceCommit"], SHA)
        self.assertEqual(len(record["installers"]), 3)

    def test_wrong_build_sha_rejected(self):
        self.run["head_sha"] = "a" * 40
        self.assert_rejected_without_write()

    def test_failed_native_ci_step_rejected(self):
        self.jobs[2]["steps"][0]["conclusion"] = "failure"
        self.assert_rejected_without_write()

    def test_dirty_build_rejected(self):
        self.change_json("installer-manifest-darwin-arm64.json", lambda item: item.update(sourceDirty=True))
        self.assert_rejected_without_write()

    def test_corrupt_installer_rejected(self):
        next(self.fixtures.rglob("*.exe")).write_bytes(b"tampered")
        self.assert_rejected_without_write()

    def test_wrong_native_architecture_rejected(self):
        self.change_json("mac-install-check-arm64.json", lambda item: item["launch"].update(arch="x64"))
        self.assert_rejected_without_write()

    def test_missing_native_uninstall_check_rejected(self):
        self.change_json("windows-install-check.json", lambda item: item.update(uninstalled=False))
        self.assert_rejected_without_write()

    def test_existing_tag_at_other_commit_rejected(self):
        self.wrong_tag = True
        self.assert_rejected_without_write()

    def test_bad_uploaded_digest_prevents_publication(self):
        self.bad_digest = True
        with self.assertRaises(RuntimeError):
            self.run_publish()
        self.assertEqual(self.writes, ["upload"])

    def test_shell_metacharacters_rejected_before_github(self):
        with patch.dict(os.environ, {"BUILD_RUN_ID": "43771415769; echo unsafe"}), patch.object(publisher, "gh", side_effect=AssertionError("No GitHub call allowed")):
            with self.assertRaises(RuntimeError):
                publisher.main()


if __name__ == "__main__":
    unittest.main()
