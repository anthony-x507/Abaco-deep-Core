"""Reusable in-process test fixtures."""

from tests.fixtures.fake_tailscale import (
    FakePeer,
    FakeTailscale,
    InMemoryMeshTransport,
)

__all__: list[str] = ["FakePeer", "FakeTailscale", "InMemoryMeshTransport"]
