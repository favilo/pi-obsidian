# ADR 0002: Add Obsidian Backend Adapter Interface

## Status

Accepted

## Context

The extension tools previously called filesystem helpers directly. That made future backend support harder and scattered file IO details through tool handlers.

## Decision

Introduce an `ObsidianBackendAdapter` boundary in `extensions/obsidian/index.ts`. Tool handlers call adapter methods for vault discovery/resolution, note path resolution, text IO, directory creation, markdown walking, and content search. Track 1 provides `FilesystemObsidianBackendAdapter`, which delegates to the existing helper logic.

## Consequences

- Tool names and external behavior stay stable.
- Filesystem implementation details are isolated behind a replaceable interface.
- The first refactor remains low risk because existing helper functions continue to provide the behavior.
- The Track 1 interface is intentionally conservative and still includes filesystem-shaped primitives such as path resolution and note walking. Before implementing REST mode, the interface should be reviewed and likely promoted to higher-level asynchronous note operations so REST backends do not need to emulate local filesystem details.
