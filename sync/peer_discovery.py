"""Tailscale status discovery with graceful offline fallback."""

import json
import logging
import shutil
import subprocess
from typing import Any

from .errors import DiscoveryError

logger = logging.getLogger(__name__)


def discover_tailscale_status() -> dict[str, Any]:
    """Return parsed ``tailscale status --json`` data or empty status."""
    executable = shutil.which("tailscale")
    if executable is None:
        logger.warning("Tailscale is not installed; peer discovery is offline")
        return {}
    try:
        completed = subprocess.run(
            [executable, "status", "--json"], capture_output=True, text=True,
            timeout=5, check=False,
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        logger.warning("Unable to run Tailscale status: %s", exc)
        return {}
    if completed.returncode != 0:
        logger.warning("Tailscale status failed: %s", completed.stderr.strip())
        return {}
    try:
        return json.loads(completed.stdout)
    except json.JSONDecodeError as exc:
        raise DiscoveryError("Tailscale returned invalid JSON") from exc


def discover_peers() -> list[dict[str, Any]]:
    """Extract peer dictionaries from JSON status, or parse text status."""
    status = discover_tailscale_status()
    if status:
        return list(status.get("Peer", {}).values())
    executable = shutil.which("tailscale")
    if executable is None:
        return []
    try:
        result = subprocess.run([executable, "status"], capture_output=True, text=True, timeout=5)
    except (OSError, subprocess.TimeoutExpired):
        return []
    peers: list[dict[str, Any]] = []
    for line in result.stdout.splitlines():
        fields = line.split()
        if len(fields) >= 2:
            peers.append({"HostName": fields[0], "TailscaleIPs": [fields[1]], "Online": "offline" not in line.lower()})
    return peers
