"""In-repo event envelope contract for the deep-core modules.

:mod:`core.events.envelope` mirrors the envelope contract of the external
``abaco_core.events.envelope`` package so that deep-core modules (e.g.
:mod:`core.compaction`) can emit audit events from an isolated checkout of
``abaco-deep-core`` without importing the sibling ``abaco_core`` package.
The module is self-contained (Python stdlib only).
"""

from core.events.envelope import (
    EventEnvelope,
    EventValidationResult,
    create_event,
    event_from_dict,
    utc_now_iso,
    validate_event,
)

__all__ = [
    "EventEnvelope",
    "EventValidationResult",
    "create_event",
    "event_from_dict",
    "utc_now_iso",
    "validate_event",
]
