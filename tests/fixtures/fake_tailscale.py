"""In-process simulation of a Tailscale mesh used by the integration tests.

The production ``sync/`` layer talks to peers over Tailscale, which means
that the only external dependency a test needs in order to exercise the
full sync protocol is a transport. ``FakeTailscale`` provides that transport
entirely in memory:

*   Each "node" the suite wants to simulate is registered with
    ``FakeTailscale.register(node_id)`` and gets back a :class:`FakePeer`
    handle.
*   All peers share one :class:`InMemoryMeshTransport`, so a ``send`` from
    peer A is delivered to every other registered peer synchronously.
*   No real sockets are opened; the simulation is fully deterministic and
    lives inside the test process.

The classes in this module deliberately expose only the small surface that
the ``sync/`` package needs (publish / subscribe / peer enumeration). If
``sync/`` grows new transport hooks the fixtures can be extended without
touching the tests.
"""

from __future__ import annotations

import threading
from dataclasses import dataclass, field
from typing import Callable, Iterable, Iterator, Protocol


class MeshMessage(Protocol):
    """Minimal interface every message must satisfy to traverse the mesh."""

    sender: str
    topic: str
    payload: bytes


@dataclass
class Envelope:
    """A concrete message that wraps an opaque payload across the mesh."""

    sender: str
    topic: str
    payload: bytes

    def __repr__(self) -> str:  # pragma: no cover - debug aid only
        return (
            f"Envelope(sender={self.sender!r}, topic={self.topic!r}, "
            f"size={len(self.payload)})"
        )


SubscriberCallback = Callable[[Envelope], None]


@dataclass
class FakePeer:
    """A simulated node connected to the fake Tailscale mesh."""

    node_id: str
    transport: "InMemoryMeshTransport"
    _subscriptions: dict[str, list[SubscriberCallback]] = field(default_factory=dict)
    inbox: list[Envelope] = field(default_factory=list)
    _lock: threading.Lock = field(default_factory=threading.Lock)

    def subscribe(self, topic: str, callback: SubscriberCallback) -> None:
        """Register ``callback`` for any incoming envelope on ``topic``."""

        with self._lock:
            self._subscriptions.setdefault(topic, []).append(callback)

    def publish(self, topic: str, payload: bytes) -> None:
        """Send ``payload`` to every other peer subscribed to ``topic``."""

        env = Envelope(sender=self.node_id, topic=topic, payload=payload)
        self.transport.deliver(env, exclude=self.node_id)

    def drain_inbox(self) -> list[Envelope]:
        """Return and clear everything delivered to this peer so far."""

        with self._lock:
            items = self.inbox[:]
            self.inbox.clear()
        return items

    def _receive(self, env: Envelope) -> None:
        """Internal: invoked by the transport when an envelope arrives."""

        with self._lock:
            self.inbox.append(env)
            callbacks = list(self._subscriptions.get(env.topic, []))
        for cb in callbacks:
            cb(env)


class InMemoryMeshTransport:
    """Thread-safe in-memory mesh shared between fake peers."""

    def __init__(self) -> None:
        self._peers: dict[str, FakePeer] = {}
        self._lock = threading.Lock()

    def register(self, node_id: str) -> FakePeer:
        with self._lock:
            if node_id in self._peers:
                raise ValueError(f"peer {node_id!r} is already registered")
            peer = FakePeer(node_id=node_id, transport=self)
            self._peers[node_id] = peer
            return peer

    def unregister(self, node_id: str) -> None:
        with self._lock:
            self._peers.pop(node_id, None)

    def peers(self) -> Iterable[FakePeer]:
        with self._lock:
            return list(self._peers.values())

    def deliver(self, env: Envelope, *, exclude: str) -> None:
        with self._lock:
            recipients = [
                peer for nid, peer in self._peers.items() if nid != exclude
            ]
        for peer in recipients:
            peer._receive(env)

    def broadcast(self, env: Envelope) -> None:
        """Send to *every* peer including the sender (useful for tests)."""

        with self._lock:
            recipients = list(self._peers.values())
        for peer in recipients:
            peer._receive(env)


@dataclass
class FakeTailscale:
    """High-level wrapper that mimics the bits of Tailscale the tests use.

    A test instantiates ``FakeTailscale``, calls ``register`` to spawn peers,
    and then drives them however the production ``sync/`` layer expects to
    be driven. ``shutdown`` tears the mesh down and is safe to call from a
    ``finally`` block.
    """

    transport: InMemoryMeshTransport = field(default_factory=InMemoryMeshTransport)

    def register(self, node_id: str) -> FakePeer:
        return self.transport.register(node_id)

    def peers(self) -> list[FakePeer]:
        return list(self.transport.peers())

    def shutdown(self) -> None:
        for peer in self.transport.peers():
            self.transport.unregister(peer.node_id)

    def __iter__(self) -> Iterator[FakePeer]:
        return iter(self.peers())


__all__ = [
    "Envelope",
    "FakePeer",
    "FakeTailscale",
    "InMemoryMeshTransport",
    "MeshMessage",
    "SubscriberCallback",
]
