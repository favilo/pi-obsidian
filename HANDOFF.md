# Handoff: obsidian_edit

Work in this directory. Do not edit `~/.pi/agent/npm/node_modules/pi-obsidian`. `pi update` replaces that copy.

## Source

This repository starts from the npm package `pi-obsidian` version 0.2.3. The npm page has no `repository` field. The maintainer is `boofpackdev`. The public GitHub account `boofpackdev` has no `pi-obsidian` repository. The files came from `https://registry.npmjs.org/pi-obsidian/-/pi-obsidian-0.2.3.tgz`.

GitHub: https://github.com/favilo/pi-obsidian

## Settings

`~/.pi/agent/settings.json` should list `../../git/agents/pi-obsidian` and should not also list `npm:pi-obsidian`. Two copies register the same tool names. Reload Pi after that change.

## Task

Add `obsidian_edit`. Use it to change an existing note. Keep `obsidian_write` for a new note or a full replacement.

The approval card shows the tool arguments. `obsidian_write` sends the whole note, so the card shows the whole note. `obsidian_edit` must send only the replacement, the same way Pi's `edit` tool sends `edits[].oldText` and `edits[].newText`.

`docs/adr/0004-add-surgical-patching-tools.md` already says a later track can add a targeted edit. This task is that tool. Call the backend adapter. Do not write the file around the adapter.

## Behavior

- Tool name: `obsidian_edit`.
- Parameters: `vault`, `note`, and `edits`. Each edit has `oldText` and `newText`.
- The note must already exist.
- Match every `oldText` against the current note, then apply the edits. Do not apply one edit before matching the next.
- `oldText` must match once, including whitespace and newlines. An empty `oldText` is an error. Overlapping edits are an error. A replacement that does not change the note is an error.
- Keep a leading BOM. Keep CRLF when the note uses CRLF.
- Refuse a result larger than 5MB, the same limit as `obsidian_write`.
- Return a short diff of the changed lines in the tool text and in `details.diff`. The diff is not the whole note.
- Update `skills/obsidian/SKILL.md` and the README tool list so a change to an existing note uses `obsidian_edit`.

## Check

Add a test for a unique replacement, missing text, duplicate text, an overlap, and two disjoint edits. Then edit a scratch note and confirm the approval payload is the `edits` array.

## Out of scope

The Obsidian Local REST API plugin already has `vault_patch`. That tool edits a heading, a block reference, or a frontmatter field. This task does not change that plugin.

The GroupV2 RFC in the Obsidian vault is a separate note.
