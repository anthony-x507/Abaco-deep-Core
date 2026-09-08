"""Session compactor.

The session compactor is in-memory: it takes a list of conversation
turns, keeps the last ``keep_recent`` turns verbatim, and produces a
deterministic summary of the older turns.  The result is a
:class:`~core.compaction.models.SessionWindowSummary` that callers can
inject back into the LLM prompt.

Because no I/O is involved, the compactor is also safe to run from a
FastAPI request handler.
"""

from __future__ import annotations

from typing import Iterable

from core.compaction.errors import InvalidPolicyError
from core.compaction.models import SessionTurn, SessionWindowSummary
from core.compaction.summary_generator import SummaryGenerator


def _approx_tokens(text: str) -> int:
    """Estimate the number of tokens in ``text``.

    The estimator is deliberately simple: words / 0.75 rounded up.
    It is only used as a coarse before/after metric for the summary.
    """

    if not text:
        return 0
    words = len(text.split())
    return max(1, int(round(words / 0.75)))


class SessionCompactor:
    """Compact a sequence of :class:`SessionTurn` objects."""

    def __init__(
        self,
        *,
        keep_recent: int = 10,
        summary_generator: SummaryGenerator | None = None,
    ) -> None:
        if keep_recent < 0:
            raise InvalidPolicyError("keep_recent must be >= 0")
        self.keep_recent = keep_recent
        self.summary_generator = summary_generator or SummaryGenerator()

    def compact(
        self,
        turns: Iterable[SessionTurn],
        *,
        session_name: str = "session",
    ) -> SessionWindowSummary:
        original = list(turns)
        if self.keep_recent == 0:
            kept: list[SessionTurn] = []
            summarized = list(original)
        else:
            kept = list(original[-self.keep_recent :])
            summarized = list(original[: -self.keep_recent if self.keep_recent else 0])

        summary_text = ""
        if summarized:
            summary_text = self.summary_generator.summarize_session(
                summarized, session_name=session_name
            )

        tokens_before = sum(_approx_tokens(t.content) for t in original)
        tokens_after = sum(_approx_tokens(t.content) for t in kept) + _approx_tokens(summary_text)

        return SessionWindowSummary(
            kept_turns=tuple(kept),
            summary_text=summary_text,
            summarized_turn_count=len(summarized),
            kept_turn_count=len(kept),
            original_turn_count=len(original),
            token_estimate_before=tokens_before,
            token_estimate_after=tokens_after,
        )
