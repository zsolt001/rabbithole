---
status: accepted
date: 2026-09-14
---

# System trace and simulation

Rabbithole separates systems modeling from playback. A strict `sim` v1 model
executes through a host-owned, seeded discrete-event engine and produces the
same strict `trace` v1 model that an agent can author directly. The UI only
plays traces; it does not execute agent code.

Simulation v1 is deliberately bounded to queues, resource pools, arrivals,
constant/uniform/exponential service times, capacity, failures, retry delays,
and retry limits. Parsers cap actors, events, model components, identifiers,
durations, and distribution parameters. The engine caps generated traces at
5,000 events and is deterministic for the same model and seed.

The trace player is paused by default and supports previous, next, play/pause,
and scrubbing. Captions provide a textual account of each event. Both trace and
simulation source remain canonical Markdown JSON; playback state is derived.

This boundary rejects arbitrary agent-authored JavaScript and avoids a new
executable-content trust boundary. Additional primitives require concrete
systems use cases and an extension of the versioned model rather than a generic
scene graph.
