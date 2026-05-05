import argparse
import json
import sys
import urllib.error
import urllib.request


DEFAULT_BASE_URL = "http://127.0.0.1:7860"


def post_json(base_url, payload, timeout):
    url = base_url.rstrip("/") + "/api/agent/execute"
    body = json.dumps(payload).encode("utf-8")
    request = urllib.request.Request(
        url,
        data=body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )

    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return response.status, json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        return exc.code, json.loads(exc.read().decode("utf-8"))


def require(condition, message):
    if not condition:
        raise AssertionError(message)


def main():
    parser = argparse.ArgumentParser(description="Smoke-test the local Agent Tool Server API.")
    parser.add_argument("--base-url", default=DEFAULT_BASE_URL, help=f"Server base URL, default {DEFAULT_BASE_URL}")
    parser.add_argument("--timeout", type=float, default=30, help="Request timeout in seconds, default 30")
    args = parser.parse_args()

    success_status, success_body = post_json(
        args.base_url,
        {
            "device_name": "Gamma-Aegis-01",
            "command": "display interface brief",
            "question_number": "1",
        },
        args.timeout,
    )
    require(success_status == 200, f"Expected success HTTP 200, got {success_status}: {success_body}")
    require(success_body.get("status") == "success", f"Expected success body, got: {success_body}")
    print("[OK] normal command returned 200 success")

    no_perm_status, no_perm_body = post_json(
        args.base_url,
        {
            "device_name": "Gamma-Axis-02",
            "command": "display lldp neighbor brief",
            "question_number": "2",
        },
        args.timeout,
    )
    require(no_perm_status == 403, f"Expected no-permission HTTP 403, got {no_perm_status}: {no_perm_body}")
    require(
        no_perm_body.get("status") == "execution_failed",
        f"Expected execution_failed body, got: {no_perm_body}",
    )
    print("[OK] no-permission command returned 403 execution_failed")
    print("[OK] server smoke checks passed")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as exc:
        print(f"[ERROR] {exc}")
        sys.exit(1)
