"""Simple per-node synchronization cursors and state summaries."""

from dataclasses import dataclass, field


@dataclass
class StateVector:
    """Map node IDs to the last timestamp observed from that node."""

    values: dict[str, str] = field(default_factory=dict)

    def observe(self, node_id: str, timestamp: str) -> None:
        """Advance a node's cursor when a timestamp is newer."""
        if node_id not in self.values or timestamp > self.values[node_id]:
            self.values[node_id] = timestamp

    def needs(self, node_id: str, timestamp: str) -> bool:
        """Return whether a record should be requested from a node."""
        return timestamp > self.values.get(node_id, "")

    def as_dict(self) -> dict[str, str]:
        """Return a copy suitable for JSON serialization."""
        return dict(self.values)
