"""ABACO Deep Core — self-contained core runtime subpackages.

This directory groups the deep-core modules (``compaction``, ``pairing``,
``uploads``, ``voice``, ``skills``, ``migrations`` and ``events``).  It is a
*regular* package on purpose: every subpackage imports only from within this
tree (``core.*``), so a plain checkout of ``abaco-deep-core`` is importable
without any sibling ``abaco_core`` package on ``sys.path``.
"""

__version__ = "0.1.0"
