# ADR 0003: Support Local REST API Mode

## Status

Proposed

## Context

Some users may prefer interacting with a running Obsidian instance through a local REST API plugin rather than direct filesystem access. That can enable app-mediated behavior and reduce assumptions about local paths, but it introduces availability, authentication, and compatibility concerns.

## Decision

Reserve a `local-rest-api` backend mode type as a future extension point, but do not implement or activate Local REST API behavior in Track 1. Any future REST mode should use the adapter boundary and must preserve the 13 existing tool contracts unless an explicit migration is accepted.

## Consequences

- Track 1 stays behavior-preserving.
- Future REST work has a named architecture target.
- A later implementation must address endpoint discovery, token handling, error mapping, and parity tests against filesystem mode.
