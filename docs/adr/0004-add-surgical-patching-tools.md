# ADR 0004: Add Surgical Patching Tools

## Status

Proposed

## Context

Current write operations support full note overwrite and append. Users may eventually need safer targeted edits to notes, such as replacing a section, applying a small diff, or inserting content relative to a heading.

## Decision

Treat surgical patching tools as a future track, not part of Track 1. When added, they should use the backend adapter rather than bypassing it, should include clear precondition checks, and should avoid destructive updates unless the target text or structural anchor is unambiguous.

## Consequences

- Track 1 remains limited to the adapter refactor and formal docs.
- Future patching tools can be designed with filesystem and REST parity in mind.
- Targeted edit operations should include validation and error reporting to prevent accidental note corruption.
