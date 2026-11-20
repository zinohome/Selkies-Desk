import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import py_compile
import shlex
import shutil
import subprocess
import sys


ORIGINAL_SHA256 = "7f894276415922c8c34746755385d918fe76b5c92bd209ee214a40237c1852ab"
PATCHED_SHA256 = "e29253e618129dc004c73a46ed6e2bc42c4a271a5a46380364658597786647c1"
DIRECTORY = Path(__file__).resolve().parent
STAGE = Path.home() / ".local/share/selkies-gnome-clipboard-r1"
OVERRIDE = Path.home() / ".config/systemd/user/selkies.service.d/90-clipboard-xwayland.conf"


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def install(activate):
    spec = importlib.util.find_spec("selkies")
    if spec is None or spec.origin is None:
        raise RuntimeError("Run with the Python interpreter used by selkies.service.")
    package = Path(spec.origin).resolve().parent
    original = package / "input_handler.py"
    if digest(original) != ORIGINAL_SHA256:
        raise RuntimeError("This Selkies source differs from the tested 2.2.1 build; installation stopped.")
    if STAGE.exists() or OVERRIDE.exists():
        raise RuntimeError("A compatibility installation already exists; inspect or roll it back first.")
    if activate:
        environment = subprocess.check_output([
            "systemctl", "--user", "show", "selkies.service",
            "--property=Environment", "--value",
        ], text=True)
        if any(entry.startswith("PYTHONPATH=") for entry in shlex.split(environment)):
            raise RuntimeError("selkies.service already sets PYTHONPATH; review it before installing.")
    destination = STAGE / "selkies"
    destination.mkdir(parents=True)
    for entry in package.iterdir():
        target = destination / entry.name
        if entry.name == "input_handler.py":
            shutil.copy2(entry, target)
        elif entry.name != "__pycache__":
            target.symlink_to(entry, target_is_directory=entry.is_dir())
    subprocess.run([
        "patch", "--batch", "--fuzz=0", "-p1",
        "-i", str(DIRECTORY / "input-handler.patch"),
    ], cwd=STAGE, check=True)
    patched = destination / "input_handler.py"
    if digest(patched) != PATCHED_SHA256:
        raise RuntimeError("Patched source checksum did not match; service was not changed.")
    py_compile.compile(str(patched), doraise=True)
    subprocess.run([
        sys.executable, str(DIRECTORY / "test_clipboard.py"),
    ], env={**os.environ, "SELKIES_CLIPBOARD_TEST_SOURCE": str(patched)}, check=True)
    (STAGE / "manifest.json").write_text(json.dumps({
        "original": str(original), "original_sha256": ORIGINAL_SHA256,
        "patched_sha256": PATCHED_SHA256, "service": "selkies.service",
    }, indent=2) + "\n", encoding="utf-8")
    if activate:
        OVERRIDE.parent.mkdir(parents=True, exist_ok=True)
        OVERRIDE.write_text(
            '[Service]\n'
            f'Environment="PYTHONPATH={STAGE}"\n'
            'Environment="SELKIES_CLIPBOARD_XWAYLAND=1"\n',
            encoding="utf-8",
        )
        subprocess.run(["systemctl", "--user", "daemon-reload"], check=True)
        print("Compatibility override installed. Restart selkies.service to activate.")
    else:
        print("Staging and regression tests passed. Service configuration was not changed.")


def rollback():
    expected = (
        '[Service]\n'
        f'Environment="PYTHONPATH={STAGE}"\n'
        'Environment="SELKIES_CLIPBOARD_XWAYLAND=1"\n'
    )
    if not OVERRIDE.exists() or OVERRIDE.read_text(encoding="utf-8") != expected:
        raise RuntimeError("The installed override is missing or has changed; nothing was removed.")
    OVERRIDE.unlink()
    subprocess.run(["systemctl", "--user", "daemon-reload"], check=True)
    print("Override removed. Restart selkies.service to use the original package.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--activate", action="store_true")
    parser.add_argument("--rollback", action="store_true")
    arguments = parser.parse_args()
    if arguments.activate and arguments.rollback:
        parser.error("--activate and --rollback are mutually exclusive")
    try:
        rollback() if arguments.rollback else install(arguments.activate)
    except (OSError, RuntimeError, subprocess.CalledProcessError) as error:
        raise SystemExit(str(error))
