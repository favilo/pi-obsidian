# ADR 0001: Keep Filesystem Mode as Default

## Status

Accepted

## Context

`pi-obsidian` currently works by discovering Obsidian vaults from the local Obsidian configuration and reading/writing vault files directly. Existing users depend on this behavior and on the package registering the same 13 pi tools without extra setup.

## Decision

Filesystem-backed access remains the default and only active runtime mode for Track 1. The adapter refactor must not require a server, token, environment variable, or Obsidian plugin to preserve existing behavior.

## Consequences

- Current installation and usage remain unchanged.
- Existing direct filesystem semantics, path handling, and ripgrep fallback behavior are preserved.
- Future backends can be added behind the adapter boundary without changing tool names.
