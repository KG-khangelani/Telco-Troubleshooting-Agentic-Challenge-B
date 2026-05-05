import json
import subprocess
import sys
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]

REQUIRED_FILES = [
    ".gitignore",
    "README.md",
    "requirements.txt",
    "server.py",
    "data/SampleSubmission.csv",
    "data/phase_1/test_p1.json",
    "data/phase_2/test_p2.json",
    "data/question_limits_config.json",
    "documentation/phase_1_doc.md",
    "documentation/phase_2_doc.md",
    "agent/mock_agent/evaluate_openclaw.py",
    "agent/mock_agent/evaluate_openclaw_guideline.md",
    "agent/mock_agent/openclaw_config/TOOLS.md",
]

GENERATED_TRACKED_PREFIXES = (
    "devices_outputs/",
    "agent/mock_agent/eval_results/",
    "__pycache__/",
    ".pytest_cache/",
)

GENERATED_TRACKED_SUFFIXES = (
    ".zip",
    ".pyc",
)


def ok(message):
    print(f"[OK] {message}")


def error(message):
    print(f"[ERROR] {message}")


def load_json(relative_path):
    path = REPO_ROOT / relative_path
    with path.open("r", encoding="utf-8") as f:
        return json.load(f)


def looks_like_outputs_root(path):
    if not path.is_dir():
        return False
    for child in path.iterdir():
        if child.is_dir() and (child.name == "others" or child.name.isdigit()):
            return True
    return False


def resolve_device_outputs_dir():
    base = REPO_ROOT / "devices_outputs"
    nested = base / "devices_outputs"
    if looks_like_outputs_root(base):
        return base
    if looks_like_outputs_root(nested):
        return nested
    return None


def git_ls_files():
    result = subprocess.run(
        ["git", "ls-files"],
        cwd=REPO_ROOT,
        text=True,
        capture_output=True,
        check=True,
    )
    return [line.strip().replace("\\", "/") for line in result.stdout.splitlines() if line.strip()]


def check_required_files(errors):
    missing = [path for path in REQUIRED_FILES if not (REPO_ROOT / path).is_file()]
    if missing:
        errors.extend(f"Missing required file: {path}" for path in missing)
        return
    ok("required tracked files are present")


def check_question_data(errors):
    local_errors = []
    try:
        phase_1 = load_json("data/phase_1/test_p1.json")
        phase_2 = load_json("data/phase_2/test_p2.json")
        limits = load_json("data/question_limits_config.json")
    except Exception as exc:
        errors.append(f"Could not read required JSON data: {exc}")
        return

    if len(phase_1) != 50:
        local_errors.append(f"Expected 50 Phase 1 questions, found {len(phase_1)}")
    if len(phase_2) != 100:
        local_errors.append(f"Expected 100 Phase 2 questions, found {len(phase_2)}")
    if not isinstance(limits, dict):
        local_errors.append("data/question_limits_config.json must contain a JSON object")

    if local_errors:
        errors.extend(local_errors)
    else:
        ok("question JSON files and question limits are readable")


def check_device_outputs(errors):
    resolved = resolve_device_outputs_dir()
    if resolved is None:
        errors.append(
            "devices_outputs is missing or has an unsupported shape. "
            "Unzip devices_outputs.zip at the repo root and ensure question folders exist under devices_outputs/."
        )
        return

    sample_files = list(resolved.glob("*/*/*.txt"))
    if not sample_files:
        errors.append(f"No command output .txt files found under {resolved}")
        return

    ok(f"device outputs found at {resolved.relative_to(REPO_ROOT)}")


def check_tracked_artifacts(errors):
    if not (REPO_ROOT / ".git").exists():
        ok("git metadata is not present; tracked-artifact check skipped inside container")
        return

    try:
        tracked = git_ls_files()
    except Exception as exc:
        errors.append(f"Could not inspect tracked files with git ls-files: {exc}")
        return

    bad = []
    for path in tracked:
        if path.startswith(GENERATED_TRACKED_PREFIXES) or path.endswith(GENERATED_TRACKED_SUFFIXES):
            bad.append(path)

    if bad:
        errors.append("Generated or large artifacts are tracked: " + ", ".join(bad[:20]))
        return

    ok("generated output folders and zip artifacts are not tracked")


def main():
    errors = []
    check_required_files(errors)
    check_question_data(errors)
    check_device_outputs(errors)
    check_tracked_artifacts(errors)

    if errors:
        print("")
        for message in errors:
            error(message)
        return 1

    print("")
    ok("repo readiness checks passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
