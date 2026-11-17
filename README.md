# pi-obsidian

Pi package for reading, writing, visualizing, and managing projects in
[Obsidian](https://obsidian.md) vaults. Registers 13 tools that let pi
interact with your knowledge base.

## Features

### Core
- **Vault discovery** — auto-detects vaults from Obsidian's config
- **Read/write notes** — with YAML frontmatter parsing
- **Append to notes** — for journals, logs, and meeting notes
- **Search notes** — by filename and content (uses ripgrep when available)

### Knowledge Discovery
- **Tag analysis** — list all tags with usage counts across the vault
- **Backlinks** — find notes linking to a target via [[wikilinks]]

### Visualization
- **Mermaid diagrams** — flowchart, gantt, sequence, class, mindmap, pie, timeline
- **Canvas files** — create Obsidian Canvas files with nodes and edges

### Project Planning
- **Kanban boards** — create task boards with columns and tasks
- **Project dashboards** — goals, milestones, Gantt chart, Dataview queries
- **Daily notes** — default, meeting, and planning templates with frontmatter

## Installation

```bash
pi install npm:pi-obsidian
```

Or from git:

```bash
pi install git:github.com/boofpackdev/pi-obsidian
```

Or try without installing:

```bash
pi -e npm:pi-obsidian
```

## Prerequisites

- [Obsidian](https://obsidian.md) installed with at least one vault configured
- Node.js >= 20.6.0

## All 13 Tools

| Tool | Category | Purpose |
|------|----------|---------|
| `obsidian_list_vaults` | Core | List all discovered Obsidian vaults |
| `obsidian_list_notes` | Core | List .md notes in a vault (tree view) |
| `obsidian_read` | Core | Read a note with optional frontmatter parsing |
| `obsidian_write` | Core | Create or overwrite a note |
| `obsidian_append` | Core | Append content to a note |
| `obsidian_search` | Core | Search by filename and/or content |
| `obsidian_list_tags` | Discovery | List all tags with usage counts |
| `obsidian_list_backlinks` | Discovery | Find notes linking to a target |
| `obsidian_create_mermaid` | Visualization | Generate Mermaid diagrams (7 types) |
| `obsidian_create_canvas` | Visualization | Create Canvas files with nodes & edges |
| `obsidian_create_kanban` | Planning | Create Kanban board notes |
| `obsidian_create_project_dashboard` | Planning | Project overview with Gantt + Dataview |
| `obsidian_create_daily_note` | Planning | Structured daily notes (3 templates) |

## Quick Examples

```
> List my Obsidian vaults
> Show all tags in my Work vault
> Create a project dashboard for "API Redesign"
> Make a Kanban board for my sprint
> Create today's daily note with the planning template
> Generate a Gantt chart for my milestones
> Create a Canvas showing the system architecture
> Find all backlinks to "Architecture Decision"
```

## License

MIT
