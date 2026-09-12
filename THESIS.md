# Thesis — On Agent Memory Done Right

Agent memory today fails in two directions at once. It is either too thin to be
useful — a chat window that remembers nothing past the scroll — or too greedy
to be safe: an unbounded store that never doubts itself, never questions its
own certainty, and never lets you delete.

Good memory is not storage. It is a **relationship with uncertainty**.

The most important property a memory can have is not that it is stored, but
that it knows whether it is still true. Facts arrive at different times with
different sources and different degrees of certainty. They age. They conflict.
And the user outgrows them. A memory system that cannot express "I might be
wrong" is not more confident — it is more dangerous, because it converts
assumptions into assertions.

So we do three things that ordinary RAG never does.

**We hold a number.** Every fact carries source, base confidence, freshness,
and scope. Confidence is never static: it decays with time since confirmation
and it is paid back when the user corroborates. On every read the effective
confidence is recomputed — the number is alive, not a stamp from write time.

**We refuse to guess.** When two facts conflict we do not let the newest one
silently win. We collide them: both are demoted to "contested," both are shown
to the user, and recall answers "I might be wrong" instead of picking a side.
Overconfidence is the failure mode we fear most, so uncertainty is surfaced,
not smoothed over.

**We forget for real.** Three distinct paths: time decay demotes stale facts; a
resolved conflict kills the loser; and an explicit revoke wipes the content —
not the log, but the fact itself. The audit trail records that a memory was
forgotten and what kind it was, never what it contained.

Confidence, contradiction, and consent are the product — not a search index
with a friendly veneer. Memory that knows it might be wrong is the only memory
worth trusting.