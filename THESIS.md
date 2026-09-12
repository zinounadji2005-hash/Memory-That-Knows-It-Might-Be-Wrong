# Thesis — On Agent Memory Done Right

Agent memory today fails in two directions at once. It is too thin to be
useful — a chat window that remembers nothing past the scroll — or too greedy
to be safe: an unbounded store that never doubts itself and never lets you
delete.

Good memory is not storage. It is a **relationship with uncertainty**.

A memory's most important property is not that it is stored, but that it knows
whether it is still true. Facts arrive with different sources and certainty.
They age, conflict, and the user outgrows them. A system that cannot say "I
might be wrong" is not more confident — it is more dangerous, because it
converts assumptions into assertions.

So we do three things ordinary RAG never does.

**We hold a number.** Every fact carries source, base confidence, freshness,
and scope. Confidence is never static: it decays with time since confirmation
and is repaid when the user corroborates — recomputed on every read, not
stamped at write time.

**We refuse to guess.** When two facts conflict, we never let the newest one
win. Both are demoted to "contested," both are shown, and recall answers "I
might be wrong" instead of picking a side. Uncertainty is surfaced, not
smoothed over.

**We forget for real.** Three distinct paths: time decay demotes stale facts; a
resolved conflict kills the loser; an explicit revoke wipes the content — not
the log, but the fact itself. The audit trail records that a memory was
forgotten and what kind it was, never what it contained.

Confidence, contradiction, and consent are the product — not a search index
with a friendly veneer. Memory that knows it might be wrong is the only memory
worth trusting.