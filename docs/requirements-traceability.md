# Requirements Traceability: Optional Local REST API Mode

## Scope

This document traces requirements for adding optional Obsidian Local REST API support to `pi-obsidian` while preserving the current filesystem-backed behavior.

Track 1 scope is intentionally limited to:

- creating formal spec artifacts;
- preserving filesystem mode as the default;
- introducing an adapter seam with zero intentional external tool behavior change;
- keeping all 13 existing tools registered under the same names.

Future tracks will implement the Local REST API client, surgical patching, active-file tools, command execution, and Dataview/search integrations.

## Functional Requirements

| ID | Requirement | Track | Status | Evidence / Planned Evidence |
|---|---|---:|---|---|
| REQ-API-001 | Filesystem mode remains the default behavior with no new server, token, plugin, or env-var requirement. | 1 | Implemented | `createObsidianBackendAdapter()` returns `FilesystemObsidianBackendAdapter`; ADR-0001. |
| REQ-API-002 | Preserve the current 13 public `obsidian_*` tool names and registration behavior. | 1 | Implemented | JITI smoke check registered 13 expected tools. |
| REQ-API-003 | Introduce an internal adapter seam so tool handlers are no longer tightly coupled to raw filesystem calls. | 1 | Implemented | `ObsidianBackendAdapter` and `FilesystemObsidianBackendAdapter` in `extensions/obsidian/index.ts`; ADR-0002. |
| REQ-API-004 | Do not activate Local REST API behavior during Track 1. | 1 | Implemented | Only the reserved `local-rest-api` mode string exists; no config switch or REST client is active. |
| REQ-API-005 | Publish the new formal specification docs with the npm package. | 1 | Implemented | `package.json` `files` includes `docs`. |
| REQ-API-006 | Add explicit Local REST API mode selection (`filesystem`, `local-rest-api`, `auto`). | 2 | Planned | Future config parser + backend factory tests. |
| REQ-API-007 | Support API-backed read, write, append, search, and tag-list operations with tool output parity where feasible. | 3 | Planned | Mocked API parity tests. |
| REQ-API-008 | Add surgical note patching by heading, block reference, or frontmatter key. | 4 | Planned | `obsidian_patch` using Local REST API PATCH or filesystem structural patching. |
| REQ-API-009 | Add document-map discovery for headings, block refs, and frontmatter fields. | 4 | Planned | `obsidian_get_document_map`. |
| REQ-API-010 | Add active-file operations for the currently open Obsidian note. | 5 | Planned | `obsidian_active_read`, `obsidian_active_write`, `obsidian_active_append`. |
| REQ-API-011 | Add UI integration tools for opening files in Obsidian. | 5 | Planned | `obsidian_open_file`. |
| REQ-API-012 | Add command listing/execution tools for Obsidian commands. | 5 | Planned | `obsidian_command_list`, `obsidian_command_execute` with safety guidance. |
| REQ-API-013 | Add structured search/Dataview query support in API mode. | 5 | Planned | `obsidian_query_dataview` or an extended search tool. |

## Non-Functional Requirements

| ID | Requirement | Track | Status | Evidence / Planned Evidence |
|---|---|---:|---|---|
| NFR-COMPAT-001 | Existing filesystem workflows must remain backward-compatible. | 1 | Implemented | No tool name changes; smoke registration check passed. |
| NFR-COMPAT-002 | Future API mode must define clear fallback/error semantics and must not silently change vault selection behavior. | 2 | Planned | Config and error-mapping tests. |
| NFR-SEC-001 | API mode must require explicit opt-in unless `auto` is configured. | 2 | Planned | Factory tests. |
| NFR-SEC-002 | API keys and authorization headers must never be logged or returned in tool details. | 2 | Planned | Redaction unit tests. |
| NFR-SEC-003 | Default REST URL must be loopback-only; non-loopback URLs require explicit user configuration. | 2 | Planned | URL validation tests. |
| NFR-SEC-004 | All REST requests must use bounded timeouts and abort signals. | 2 | Planned | Client timeout tests. |
| NFR-SEC-005 | Destructive or command-execution tools need explicit descriptions, safe defaults, and confirmation guidance. | 5 | Planned | Tool schema/docs review. |
| NFR-TEST-001 | CI tests must not require a running Obsidian instance. | 2+ | Planned | Mocked `fetch`/client tests. |
| NFR-DOC-001 | README and skill docs must document filesystem vs API mode tradeoffs and setup. | 2 | Planned | Docs update. |

## Track 1 Validation Matrix

| Requirement | Validation Performed | Result |
|---|---|---|
| REQ-API-001 | Read `extensions/obsidian/index.ts`; backend factory returns filesystem adapter. | Pass |
| REQ-API-002 | Imported extension through JITI with mock `pi.registerTool`; counted names. | Pass: 13 tools, 13 unique, expected names present. |
| REQ-API-003 | Inspected tool handlers for `backend.resolveVault`, `backend.resolveNotePath`, `backend.readText`, `backend.writeText`, `backend.walkNotes`, and `backend.searchContent` usage. | Pass for current Track 1 seam. |
| REQ-API-004 | Grep for `local-rest-api`; confirmed no REST client/config switch exists. | Pass |
| REQ-API-005 | Read `package.json` `files`; confirmed `docs` is included. | Pass |

## Known Design Follow-Up

The Track 1 adapter intentionally remains a conservative compatibility seam around existing filesystem helper functions. Before implementing Track 2, evaluate whether the adapter should be promoted to higher-level asynchronous note operations (`readNote`, `writeNote`, `appendNote`, `searchNotes`, `listTags`) so a REST backend does not need to emulate local filesystem primitives such as `resolveNotePath` or `walkNotes`.

## Current Tool Inventory

1. `obsidian_list_vaults`
2. `obsidian_list_notes`
3. `obsidian_read`
4. `obsidian_write`
5. `obsidian_append`
6. `obsidian_search`
7. `obsidian_list_tags`
8. `obsidian_list_backlinks`
9. `obsidian_create_mermaid`
10. `obsidian_create_canvas`
11. `obsidian_create_kanban`
12. `obsidian_create_project_dashboard`
13. `obsidian_create_daily_note`
