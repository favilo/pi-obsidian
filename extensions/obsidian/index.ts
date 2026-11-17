/**
 * Pi Obsidian Extension
 *
 * Registers tools for reading, writing, searching, and managing
 * notes in Obsidian vaults. Includes visualization (Canvas, Mermaid)
 * and project planning (Kanban, dashboards, daily notes) capabilities.
 *
 * Auto-discovers vaults from Obsidian's config file across
 * Windows, macOS, and Linux.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ObsidianVault {
  path: string;
  name: string;
}

interface VaultEntry {
  path: string;
  ts?: number;
  open?: boolean;
}

interface ObsidianConfig {
  vaults?: Record<string, VaultEntry>;
}

interface FrontmatterResult {
  frontmatter: Record<string, unknown> | null;
  body: string;
}

interface TagCount {
  tag: string;
  count: number;
}

type ObsidianBackendMode = "filesystem" | "local-rest-api";

interface ObsidianBackendAdapter {
  readonly mode: ObsidianBackendMode;
  listVaults(): ObsidianVault[];
  resolveVault(vault: string | undefined): { vaults: ObsidianVault[]; error?: string };
  resolveNotePath(vaultDir: string, note: string, ext: string): string;
  resolvePath(...segments: string[]): string;
  joinPath(...segments: string[]): string;
  dirname(filePath: string): string;
  relativePath(from: string, to: string): string;
  exists(filePath: string): boolean;
  isDirectory(filePath: string): boolean;
  ensureDirectory(dirPath: string): void;
  readText(filePath: string, encoding?: BufferEncoding): string;
  writeText(filePath: string, content: string, encoding?: BufferEncoding): void;
  appendText(filePath: string, content: string, encoding?: BufferEncoding): void;
  walkNotes(
    vaultDir: string,
    callback: (filePath: string, content: string) => void,
    subdirectory?: string,
  ): void;
  searchContent(dir: string, pattern: string, glob: string): Promise<string[]>;
}

class FilesystemObsidianBackendAdapter implements ObsidianBackendAdapter {
  readonly mode = "filesystem" as const;

  listVaults(): ObsidianVault[] {
    return discoverVaults();
  }

  resolveVault(vault: string | undefined): { vaults: ObsidianVault[]; error?: string } {
    return resolveVault(vault);
  }

  resolveNotePath(vaultDir: string, note: string, ext: string): string {
    return notePath(vaultDir, note, ext);
  }

  resolvePath(...segments: string[]): string {
    return path.resolve(...segments);
  }

  joinPath(...segments: string[]): string {
    return path.join(...segments);
  }

  dirname(filePath: string): string {
    return path.dirname(filePath);
  }

  relativePath(from: string, to: string): string {
    return path.relative(from, to);
  }

  exists(filePath: string): boolean {
    return fs.existsSync(filePath);
  }

  isDirectory(filePath: string): boolean {
    return fs.statSync(filePath).isDirectory();
  }

  ensureDirectory(dirPath: string): void {
    fs.mkdirSync(dirPath, { recursive: true });
  }

  readText(filePath: string, encoding: BufferEncoding = "utf-8"): string {
    return fs.readFileSync(filePath, encoding);
  }

  writeText(filePath: string, content: string, encoding: BufferEncoding = "utf-8"): void {
    fs.writeFileSync(filePath, content, encoding);
  }

  appendText(filePath: string, content: string, encoding: BufferEncoding = "utf-8"): void {
    fs.appendFileSync(filePath, content, encoding);
  }

  walkNotes(
    vaultDir: string,
    callback: (filePath: string, content: string) => void,
    subdirectory?: string,
  ): void {
    walkNotes(vaultDir, callback, subdirectory);
  }

  searchContent(dir: string, pattern: string, glob: string): Promise<string[]> {
    return grepFiles(dir, pattern, glob);
  }
}

function createObsidianBackendAdapter(): ObsidianBackendAdapter {
  return new FilesystemObsidianBackendAdapter();
}

// ---------------------------------------------------------------------------
// Obsidian config path lookup (cross-platform)
// ---------------------------------------------------------------------------

function getObsidianConfigPaths(): string[] {
  switch (process.platform) {
    case "win32": {
      const paths: string[] = [];
      // Primary: APPDATA (C:\Users\<user>\AppData\Roaming)
      if (process.env.APPDATA) {
        paths.push(path.join(process.env.APPDATA, "obsidian", "obsidian.json"));
      }
      // Fallback: LOCALAPPDATA (rare, but possible in some contexts)
      if (process.env.LOCALAPPDATA) {
        paths.push(path.join(process.env.LOCALAPPDATA, "obsidian", "obsidian.json"));
      }
      // Fallback: construct from USERPROFILE
      if (process.env.USERPROFILE) {
        paths.push(
          path.join(
            process.env.USERPROFILE,
            "AppData",
            "Roaming",
            "obsidian",
            "obsidian.json",
          ),
        );
      }
      // Fallback: construct from homedir
      paths.push(
        path.join(
          os.homedir(),
          "AppData",
          "Roaming",
          "obsidian",
          "obsidian.json",
        ),
      );
      return paths;
    }
    case "darwin":
      return [
        path.join(
          os.homedir(),
          "Library",
          "Application Support",
          "obsidian",
          "obsidian.json",
        ),
      ];
    case "linux":
      return [
        path.join(os.homedir(), ".config", "obsidian", "obsidian.json"),
      ];
    default:
      return [];
  }
}

// ---------------------------------------------------------------------------
// Vault discovery
// ---------------------------------------------------------------------------

function discoverVaults(): ObsidianVault[] {
  const configPaths = getObsidianConfigPaths();

  for (const configPath of configPaths) {
    try {
      if (!fs.existsSync(configPath)) continue;
      const raw = fs.readFileSync(configPath, "utf-8");
      const config: ObsidianConfig = JSON.parse(raw);
      if (!config.vaults) continue;

      const vaults = Object.entries(config.vaults).map(([_id, entry]) => ({
        name: path.basename(entry.path),
        path: path.resolve(entry.path),
      }));

      if (vaults.length > 0) return vaults;
    } catch (err) {
      // Log the error for diagnostics, then try next path
      console.error(
        `[pi-obsidian] Failed to read config at "${configPath}":`,
        (err as Error).message,
      );
    }
  }

  return [];
}

function resolveVault(
  vault: string | undefined,
): { vaults: ObsidianVault[]; error?: string } {
  const all = discoverVaults();

  if (!vault) {
    return { vaults: all };
  }

  const byName = all.filter(
    (v) => v.name.toLowerCase() === vault.toLowerCase(),
  );
  if (byName.length === 1) return { vaults: byName };
  if (byName.length > 1) {
    return {
      vaults: byName,
      error: `Multiple vaults named "${vault}". Use the full path instead.`,
    };
  }

  const resolved = path.resolve(vault);
  if (fs.existsSync(resolved) && fs.statSync(resolved).isDirectory()) {
    const name = path.basename(resolved);
    return { vaults: [{ name, path: resolved }] };
  }

  const fuzzy = all.filter((v) =>
    v.name.toLowerCase().includes(vault.toLowerCase()),
  );
  if (fuzzy.length > 0) {
    return {
      vaults: fuzzy,
      error: `Vault "${vault}" not found. Did you mean: ${fuzzy
        .map((v) => v.name)
        .join(", ")}?`,
    };
  }

  return {
    vaults: [],
    error:
      all.length === 0
        ? "No Obsidian vaults found. Make sure Obsidian is installed and has vaults configured."
        : `Vault "${vault}" not found. Available vaults: ${all
            .map((v) => v.name)
            .join(", ")}`,
  };
}

// ---------------------------------------------------------------------------
// Note path helpers
// ---------------------------------------------------------------------------

function notePath(vaultDir: string, note: string, ext: string): string {
  let clean = note.replace(/^[/\\]+|[/\\]+$/g, "");
  const extLower = ext.toLowerCase();

  const hasMd = clean.toLowerCase().endsWith(".md");
  if (extLower === ".md" || extLower === "md") {
    if (!hasMd) clean += ".md";
  } else if (extLower && !hasMd && !clean.includes(".")) {
    clean += ext;
  }

  const resolved = path.resolve(vaultDir, clean);

  // Prevent path traversal: resolved path must stay within the vault
  const vaultResolved = path.resolve(vaultDir) + path.sep;
  if (!resolved.startsWith(vaultResolved) && resolved !== path.resolve(vaultDir)) {
    throw new Error(`Path traversal blocked: "${clean}"`);
  }

  return resolved;
}

// ---------------------------------------------------------------------------
// Content helpers
// ---------------------------------------------------------------------------

function parseFrontmatter(raw: string): FrontmatterResult {
  const lines = raw.split("\n");
  if (lines[0]?.trim() !== "---") {
    return { frontmatter: null, body: raw };
  }

  const endIdx = lines.findIndex((line, i) => i > 0 && line.trim() === "---");
  if (endIdx === -1) return { frontmatter: null, body: raw };

  const fmLines = lines.slice(1, endIdx);
  const body = lines.slice(endIdx + 1).join("\n");

  const fm: Record<string, unknown> = {};
  for (const line of fmLines) {
    const colonIdx = line.indexOf(":");
    if (colonIdx > 0) {
      const key = line.slice(0, colonIdx).trim();
      let value: string | string[] = line.slice(colonIdx + 1).trim();

      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }

      if (value.startsWith("[") && value.endsWith("]")) {
        const inner = value.slice(1, -1);
        fm[key] = inner
          .split(",")
          .map((s) => s.trim().replace(/^["']|["']$/g, ""));
      } else {
        fm[key] = value;
      }
    }
  }

  return { frontmatter: Object.keys(fm).length > 0 ? fm : null, body };
}

// ---------------------------------------------------------------------------
// Search helpers
// ---------------------------------------------------------------------------

async function grepFiles(
  dir: string,
  pattern: string,
  glob: string,
): Promise<string[]> {
  const results: string[] = [];

  try {
    const args = ["-l", "--glob", `!${glob}`, pattern, dir];
    const { stdout } = await execFileAsync("rg", args, {
      timeout: 30_000,
      maxBuffer: 10 * 1024 * 1024,
    });
    results.push(
      ...stdout
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((p) => path.relative(dir, p)),
    );
  } catch (err: any) {
    if (err?.code !== "ENOENT" && err?.stderr) return [];
  }

  if (results.length > 0) return results;

  // Node.js fallback
  const contentResults: string[] = [];
  walkNotes(dir, (filePath, content) => {
    if (content.toLowerCase().includes(pattern.toLowerCase())) {
      contentResults.push(path.relative(dir, filePath));
    }
  });
  return contentResults;
}

// ---------------------------------------------------------------------------
// Vault walker (used by tags, backlinks, search, list_notes)
// ---------------------------------------------------------------------------

function walkNotes(
  vaultDir: string,
  callback: (filePath: string, content: string) => void,
  subdirectory?: string,
): void {
  const scanDir = subdirectory ? path.resolve(vaultDir, subdirectory) : vaultDir;

  const walk = (current: string): void => {
    try {
      const entries = fs.readdirSync(current, { withFileTypes: true });
      for (const entry of entries) {
        const full = path.join(current, entry.name);
        if (entry.isDirectory()) {
          if (entry.name.startsWith(".")) continue;
          walk(full);
        } else if (entry.isFile() && entry.name.endsWith(".md")) {
          try {
            const content = fs.readFileSync(full, "utf-8");
            callback(full, content);
          } catch {
            // skip unreadable files
          }
        }
      }
    } catch {
      // skip unreadable dirs
    }
  };

  walk(scanDir);
}

// ---------------------------------------------------------------------------
// Tag extraction
// ---------------------------------------------------------------------------

function extractTags(raw: string): string[] {
  const tags = new Set<string>();

  // Inline tags: #tag, #nested/tag
  // Match hashtags not preceded by word char, not inside code blocks or URLs
  const inlineRe = /(?<!\w)(?<!`)(?<!\[)#([a-zA-Z][\w/-]*[\w])/g;
  let match: RegExpExecArray | null;
  while ((match = inlineRe.exec(raw)) !== null) {
    tags.add(match[1].toLowerCase());
  }

  // Frontmatter tags: tags: [a, b] or tags:\n  - a\n  - b
  const fmMatch = raw.match(/^---\n([\s\S]*?)\n---/);
  if (fmMatch) {
    const fm = fmMatch[1];
    // YAML list: tags:\n  - tag1\n  - tag2
    const yamlListRe = /^\s*tags:\s*\n((?:\s+-\s+.+\n?)+)/m;
    const yamlListMatch = fm.match(yamlListRe);
    if (yamlListMatch) {
      const itemRe = /^\s+-\s+(.+)$/gm;
      let itemMatch: RegExpExecArray | null;
      while ((itemMatch = itemRe.exec(yamlListMatch[1])) !== null) {
        tags.add(itemMatch[1].trim().toLowerCase());
      }
    }

    // Inline list: tags: [a, b, c]
    const inlineListRe = /^\s*tags:\s*\[(.+)\]\s*$/m;
    const inlineMatch = fm.match(inlineListRe);
    if (inlineMatch) {
      inlineMatch[1]
        .split(",")
        .map((t) => t.trim().replace(/^["']|["']$/g, ""))
        .filter(Boolean)
        .forEach((t) => tags.add(t.toLowerCase()));
    }
  }

  return Array.from(tags);
}

// ---------------------------------------------------------------------------
// Diagram generation
// ---------------------------------------------------------------------------

type DiagramType =
  | "flowchart"
  | "gantt"
  | "sequence"
  | "class"
  | "mindmap"
  | "pie"
  | "timeline";

function generateMermaid(
  diagramType: DiagramType,
  description: string,
): string {
  const desc = description.trim();

  switch (diagramType) {
    case "gantt":
      return [
        "```mermaid",
        "gantt",
        `    title ${desc || "Project Timeline"}`,
        `    dateFormat  YYYY-MM-DD`,
        "    axisFormat  %b %d",
        "",
        "    %% Define sections",
        "    section Planning",
        "    Requirements gathering :done, req, 2026-01-01, 2026-01-14",
        "    Architecture design     :done, arch, after req, 7d",
        "",
        "    section Development",
        "    Sprint 1               :active, s1, after arch, 14d",
        "    Sprint 2               :s2, after s1, 14d",
        "",
        "    section Testing",
        "    Integration testing    :it, after s2, 7d",
        "    UAT                    :uat, after it, 5d",
        "",
        "    section Launch",
        "    Release prep           :rp, after uat, 3d",
        "    Go live                :milestone, gl, after rp, 0d",
        "```",
      ].join("\n");

    case "flowchart":
      return [
        "```mermaid",
        "flowchart TD",
        `    %% ${desc || "Flowchart"}`,
        "    Start([Start]) --> Decide{Decision?}",
        "    Decide -->|Yes| Action1[Take Action A]",
        "    Decide -->|No| Action2[Take Action B]",
        "    Action1 --> Result1[Outcome 1]",
        "    Action2 --> Result2[Outcome 2]",
        "    Result1 --> End([End])",
        "    Result2 --> End",
        "```",
      ].join("\n");

    case "sequence":
      return [
        "```mermaid",
        "sequenceDiagram",
        `    %% ${desc || "Sequence Diagram"}`,
        "    participant U as User",
        "    participant F as Frontend",
        "    participant B as Backend",
        "    participant D as Database",
        "",
        "    U->>F: Action request",
        "    F->>B: POST /api/action",
        "    B->>D: Query data",
        "    D-->>B: Return results",
        "    B-->>F: JSON response",
        "    F-->>U: Display result",
        "```",
      ].join("\n");

    case "class":
      return [
        "```mermaid",
        "classDiagram",
        `    %% ${desc || "Class Diagram"}`,
        "    class BaseEntity {",
        '        +String id',
        `        +Date createdAt`,
        `        +Date updatedAt`,
        "    }",
        "",
        "    class User {",
        `        +String name`,
        `        +String email`,
        `        +login()`,
        `        +logout()`,
        "    }",
        "",
        "    class Order {",
        `        +String orderNumber`,
        `        +Float total`,
        `        +place()`,
        `        +cancel()`,
        "    }",
        "",
        "    BaseEntity <|-- User",
        "    BaseEntity <|-- Order",
        '    User "1" --> "*" Order : places',
        "```",
      ].join("\n");

    case "mindmap":
      return [
        "```mermaid",
        "mindmap",
        `  root((${desc || "Central Topic"}))`,
        "    Branch A",
        "      Sub-topic A1",
        "      Sub-topic A2",
        "    Branch B",
        "      Sub-topic B1",
        "      Sub-topic B2",
        "    Branch C",
        "      Sub-topic C1",
        "      Sub-topic C2",
        "```",
      ].join("\n");

    case "pie":
      return [
        "```mermaid",
        "pie",
        `    title ${desc || "Distribution"}`,
        '    "Category A" : 35',
        '    "Category B" : 25',
        '    "Category C" : 20',
        '    "Category D" : 15',
        '    "Category E" : 5',
        "```",
      ].join("\n");

    case "timeline":
      return [
        "```mermaid",
        "timeline",
        `    title ${desc || "Timeline"}`,
        "    Q1 2026 : Milestone 1",
        "            : Milestone 2",
        "    Q2 2026 : Milestone 3",
        "            : Milestone 4",
        "    Q3 2026 : Milestone 5",
        "    Q4 2026 : Milestone 6",
        "```",
      ].join("\n");

    default:
      return `\`\`\`mermaid\ngraph TD\n    %% ${desc}\n    A[Start] --> B[Process]\n    B --> C[End]\n\`\`\``;
  }
}

// ---------------------------------------------------------------------------
// Daily note generation
// ---------------------------------------------------------------------------

function generateDailyNote(
  date: string,
  template: "default" | "meeting" | "planning",
): string {
  const d = date === "today" ? new Date() : new Date(date);
  if (isNaN(d.getTime())) throw new Error(`Invalid date: ${date}`);

  const iso = d.toISOString().split("T")[0];
  const display = d.toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  switch (template) {
    case "meeting":
      return [
        "---",
        `date: ${iso}`,
        "tags:",
        "  - daily",
        "  - meeting",
        "---",
        "",
        `# ${display}`,
        "",
        "## Agenda",
        "- [ ] Item 1",
        "- [ ] Item 2",
        "- [ ] Item 3",
        "",
        "## Attendees",
        "- ",
        "",
        "## Notes",
        "",
        "",
        "## Action Items",
        "- [ ] ",
        "- [ ] ",
        "",
        "## Follow-up",
        "- ",
        "",
      ].join("\n");

    case "planning":
      return [
        "---",
        `date: ${iso}`,
        "tags:",
        "  - daily",
        "  - planning",
        "---",
        "",
        `# ${display}`,
        "",
        "## 🎯 Today's Focus",
        "1. ",
        "2. ",
        "3. ",
        "",
        "## 📋 Tasks",
        "### Must Do",
        "- [ ] ",
        "- [ ] ",
        "",
        "### Should Do",
        "- [ ] ",
        "- [ ] ",
        "",
        "### Could Do",
        "- [ ] ",
        "- [ ] ",
        "",
        "## 📝 Notes",
        "",
        "",
        "## 🔄 Review",
        "- What went well: ",
        "- What to improve: ",
        "- Blockers: ",
        "",
      ].join("\n");

    default: // "default"
      return [
        "---",
        `date: ${iso}`,
        "tags:",
        "  - daily",
        "---",
        "",
        `# ${display}`,
        "",
        "## 📋 Tasks",
        "- [ ] ",
        "- [ ] ",
        "- [ ] ",
        "",
        "## 📝 Notes",
        "",
        "",
        "## 🤝 Meetings",
        "- ",
        "",
        "## 🙏 Gratitude",
        "- ",
        "- ",
        "",
      ].join("\n");
  }
}

// ---------------------------------------------------------------------------
// Extension entry point
// ---------------------------------------------------------------------------

export default function obsidianExtension(pi: ExtensionAPI) {
  const backend = createObsidianBackendAdapter();

  // =========================================================================
  // Vault Management Tools
  // =========================================================================

  // --- obsidian_list_vaults ---
  pi.registerTool({
    name: "obsidian_list_vaults",
    label: "List Obsidian Vaults",
    description:
      "List all Obsidian vaults discovered from the Obsidian config file. " +
      "Returns vault names and their filesystem paths.",
    promptSnippet: "List all discovered Obsidian vaults with their paths",
    parameters: Type.Object({}),
    async execute() {
      const vaults = backend.listVaults();
      if (vaults.length === 0) {
        return {
          content: [
            {
              type: "text",
              text: "No Obsidian vaults found. Ensure Obsidian is installed and has vaults configured.",
            },
          ],
          details: { vaults: [] },
        };
      }
      const lines = vaults.map((v) => `- **${v.name}** → \`${v.path}\``);
      return {
        content: [
          {
            type: "text",
            text: `Found ${vaults.length} Obsidian vault${
              vaults.length === 1 ? "" : "s"
            }:\n\n${lines.join("\n")}`,
          },
        ],
        details: { vaults },
      };
    },
  });

  // --- obsidian_list_notes ---
  pi.registerTool({
    name: "obsidian_list_notes",
    label: "List Obsidian Notes",
    description:
      "List all markdown notes in an Obsidian vault. " +
      "Optionally filter by subdirectory.",
    promptSnippet:
      "List all markdown notes in a vault with a tree view by directory",
    parameters: Type.Object({
      vault: Type.String({
        description:
          "Vault name (as shown in Obsidian) or absolute path to the vault directory.",
      }),
      subdirectory: Type.Optional(
        Type.String({
          description: "Optional subdirectory within the vault to list.",
        }),
      ),
    }),
    async execute(_toolCallId, params) {
      const { vaults, error } = backend.resolveVault(params.vault);
      if (error || vaults.length === 0) {
        return {
          content: [{ type: "text", text: error ?? "Vault not found." }],
          details: { error },
          isError: true,
        };
      }
      const vaultDir = vaults[0].path;
      const scanDir = params.subdirectory
        ? backend.resolvePath(vaultDir, params.subdirectory)
        : vaultDir;
      if (!backend.exists(scanDir)) {
        return {
          content: [
            {
              type: "text",
              text: `Directory not found: ${params.subdirectory ?? vaultDir}`,
            },
          ],
          details: { error: "Directory not found" },
          isError: true,
        };
      }

      const notes: string[] = [];
      backend.walkNotes(vaultDir, (filePath) => {
        const rel = backend.relativePath(vaultDir, filePath);
        if (params.subdirectory && !rel.startsWith(params.subdirectory)) return;
        notes.push(rel);
      }, params.subdirectory);

      if (notes.length === 0) {
        const loc = params.subdirectory
          ? `subdirectory "${params.subdirectory}"`
          : "vault";
        return {
          content: [
            { type: "text", text: `No markdown notes found in ${loc}.` },
          ],
          details: { notes: [], vault: vaultDir },
        };
      }
      const sorted = notes.sort();
      return {
        content: [
          {
            type: "text",
            text: `**${vaults[0].name}** — ${notes.length} note${
              notes.length === 1 ? "" : "s"
            }:\n\n${formatNoteTree(sorted)}`,
          },
        ],
        details: { notes: sorted, vault: vaultDir },
      };
    },
  });

  // =========================================================================
  // Read/Write Tools
  // =========================================================================

  // --- obsidian_read ---
  pi.registerTool({
    name: "obsidian_read",
    label: "Read Obsidian Note",
    description:
      "Read a markdown note from an Obsidian vault. Optionally parses YAML frontmatter.",
    promptSnippet:
      "Read a note from an Obsidian vault with optional frontmatter parsing",
    parameters: Type.Object({
      vault: Type.String({
        description: "Vault name or absolute path to the vault directory.",
      }),
      note: Type.String({
        description:
          "Note path relative to vault root (e.g., 'folder/My Note').",
      }),
      parse_frontmatter: Type.Optional(
        Type.Boolean({
          description:
            "If true, parse and return YAML frontmatter separately. Default: false.",
          default: false,
        }),
      ),
    }),
    async execute(_toolCallId, params) {
      const { vaults, error } = backend.resolveVault(params.vault);
      if (error || vaults.length === 0) {
        return {
          content: [{ type: "text", text: error ?? "Vault not found." }],
          details: { error },
          isError: true,
        };
      }
      const fullPath = backend.resolveNotePath(vaults[0].path, params.note, ".md");
      if (!backend.exists(fullPath)) {
        return {
          content: [
            {
              type: "text",
              text: `Note not found: ${backend.relativePath(vaults[0].path, fullPath)}`,
            },
          ],
          details: { error: "Note not found", path: fullPath },
          isError: true,
        };
      }
      try {
        const raw = backend.readText(fullPath, "utf-8");
        if (params.parse_frontmatter) {
          const { frontmatter, body } = parseFrontmatter(raw);
          const fmText = frontmatter
            ? Object.entries(frontmatter)
                .map(
                  ([k, v]) =>
                    `- **${k}**: ${Array.isArray(v) ? v.join(", ") : v}`,
                )
                .join("\n")
            : "_(none)_";
          return {
            content: [
              {
                type: "text",
                text: `## Frontmatter\n\n${fmText}\n\n## Content\n\n${body}`,
              },
            ],
            details: { frontmatter, body, path: fullPath },
          };
        }
        return {
          content: [{ type: "text", text: raw }],
          details: { content: raw, path: fullPath },
        };
      } catch (err: any) {
        return {
          content: [
            { type: "text", text: `Error reading note: ${err.message}` },
          ],
          details: { error: err.message },
          isError: true,
        };
      }
    },
  });

  // --- obsidian_write ---
  pi.registerTool({
    name: "obsidian_write",
    label: "Write Obsidian Note",
    description:
      "Create or overwrite a markdown note in an Obsidian vault.",
    promptSnippet:
      "Create or overwrite a note in an Obsidian vault",
    promptGuidelines: [
      "Use obsidian_write when the user asks to create a new note or update an existing note with full replacement content.",
      "Before overwriting, use obsidian_read first to check if the note exists and confirm with the user.",
    ],
    parameters: Type.Object({
      vault: Type.String({
        description: "Vault name or absolute path to the vault directory.",
      }),
      note: Type.String({
        description:
          "Note path relative to vault root. .md extension added if missing.",
      }),
      content: Type.String({
        description:
          "Markdown content. Use Obsidian conventions: YAML frontmatter (---), wikilinks [[note]], tags #tag.",
      }),
    }),
    async execute(_toolCallId, params) {
      const { vaults, error } = backend.resolveVault(params.vault);
      if (error || vaults.length === 0) {
        return {
          content: [{ type: "text", text: error ?? "Vault not found." }],
          details: { error },
          isError: true,
        };
      }
      const fullPath = backend.resolveNotePath(vaults[0].path, params.note, ".md");
      try {
        const MAX_SIZE = 5 * 1024 * 1024; // 5MB
        if (Buffer.byteLength(params.content, "utf-8") > MAX_SIZE) {
          return {
            content: [{ type: "text", text: "Content exceeds maximum note size (5MB)." }],
            details: { error: "Content too large" },
            isError: true,
          };
        }
        backend.ensureDirectory(backend.dirname(fullPath));
        const existed = backend.exists(fullPath);
        backend.writeText(fullPath, params.content, "utf-8");
        const relPath = backend.relativePath(vaults[0].path, fullPath);
        return {
          content: [
            {
              type: "text",
              text: `✅ ${existed ? "Updated" : "Created"} note: \`${relPath}\` in vault **${vaults[0].name}**`,
            },
          ],
          details: { path: fullPath, relativePath: relPath },
        };
      } catch (err: any) {
        return {
          content: [
            { type: "text", text: `Error writing note: ${err.message}` },
          ],
          details: { error: err.message },
          isError: true,
        };
      }
    },
  });

  // --- obsidian_append ---
  pi.registerTool({
    name: "obsidian_append",
    label: "Append to Obsidian Note",
    description:
      "Append content to an existing markdown note. Creates the note if it doesn't exist.",
    promptSnippet:
      "Append content to an existing note (creates if missing)",
    promptGuidelines: [
      "Use obsidian_append for journals, daily notes, logs, and meeting notes where you want to add content without overwriting.",
    ],
    parameters: Type.Object({
      vault: Type.String({
        description: "Vault name or absolute path to the vault directory.",
      }),
      note: Type.String({
        description: "Note path relative to vault root.",
      }),
      content: Type.String({
        description: "Markdown content to append to the note.",
      }),
    }),
    async execute(_toolCallId, params) {
      const { vaults, error } = backend.resolveVault(params.vault);
      if (error || vaults.length === 0) {
        return {
          content: [{ type: "text", text: error ?? "Vault not found." }],
          details: { error },
          isError: true,
        };
      }
      const fullPath = backend.resolveNotePath(vaults[0].path, params.note, ".md");
      const dir = backend.dirname(fullPath);
      const existed = backend.exists(fullPath);
      try {
        const MAX_SIZE = 5 * 1024 * 1024; // 5MB
        if (Buffer.byteLength(params.content, "utf-8") > MAX_SIZE) {
          return {
            content: [{ type: "text", text: "Content exceeds maximum note size (5MB)." }],
            details: { error: "Content too large" },
            isError: true,
          };
        }
        backend.ensureDirectory(dir);
        if (existed) {
          const existing = backend.readText(fullPath, "utf-8");
          const separator = existing.endsWith("\n") ? "\n" : "\n\n";
          backend.appendText(
            fullPath,
            separator + params.content + "\n",
            "utf-8",
          );
        } else {
          backend.writeText(fullPath, params.content + "\n", "utf-8");
        }
        const relPath = backend.relativePath(vaults[0].path, fullPath);
        return {
          content: [
            {
              type: "text",
              text: `✅ Appended to ${existed ? "existing" : "new"} note: \`${relPath}\` in vault **${vaults[0].name}**`,
            },
          ],
          details: { path: fullPath, relativePath: relPath, existed },
        };
      } catch (err: any) {
        return {
          content: [
            { type: "text", text: `Error appending: ${err.message}` },
          ],
          details: { error: err.message },
          isError: true,
        };
      }
    },
  });

  // --- obsidian_search ---
  pi.registerTool({
    name: "obsidian_search",
    label: "Search Obsidian Notes",
    description:
      "Search notes in an Obsidian vault by filename pattern or content. " +
      "Uses ripgrep if available for fast content search.",
    promptSnippet:
      "Search notes by filename and/or content in a vault",
    promptGuidelines: [
      "Use obsidian_search when the user wants to find notes related to a topic, keyword, or filename.",
      "For tag-based queries, use obsidian_list_tags first, then search for specific tags.",
    ],
    parameters: Type.Object({
      vault: Type.String({
        description: "Vault name or absolute path to the vault directory.",
      }),
      query: Type.String({
        description:
          "Search query. Matches against note filenames and optionally contents.",
      }),
      search_content: Type.Optional(
        Type.Boolean({
          description:
            "If true, search inside note contents as well. Default: true.",
          default: true,
        }),
      ),
    }),
    async execute(_toolCallId, params) {
      const { vaults, error } = backend.resolveVault(params.vault);
      if (error || vaults.length === 0) {
        return {
          content: [{ type: "text", text: error ?? "Vault not found." }],
          details: { error },
          isError: true,
        };
      }
      const vaultDir = vaults[0].path;
      const query = params.query.toLowerCase();
      const results = new Set<string>();

      const allNotes: string[] = [];
      backend.walkNotes(vaultDir, (filePath) => {
        allNotes.push(backend.relativePath(vaultDir, filePath));
      });

      for (const rel of allNotes) {
        if (rel.toLowerCase().includes(query)) results.add(rel);
      }

      if (params.search_content !== false) {
        const contentMatches = await backend.searchContent(vaultDir, params.query, "*.md");
        for (const match of contentMatches) results.add(match);
      }

      const sorted = Array.from(results).sort();
      if (sorted.length === 0) {
        return {
          content: [
            {
              type: "text",
              text: `No notes matching "${params.query}" found in **${vaults[0].name}**.`,
            },
          ],
          details: { results: [], vault: vaultDir, query: params.query },
        };
      }
      return {
        content: [
          {
            type: "text",
            text: `Found ${sorted.length} note${
              sorted.length === 1 ? "" : "s"
            } matching "${params.query}" in **${vaults[0].name}**:\n\n${sorted
              .map((n) => `- ${n}`)
              .join("\n")}`,
          },
        ],
        details: { results: sorted, vault: vaultDir, query: params.query },
      };
    },
  });

  // =========================================================================
  // Knowledge Discovery Tools
  // =========================================================================

  // --- obsidian_list_tags ---
  pi.registerTool({
    name: "obsidian_list_tags",
    label: "List Tags in Vault",
    description:
      "List all tags used across a vault with usage counts. Scans frontmatter `tags:` and inline #tags in all .md files.",
    promptSnippet:
      "List all tags in a vault sorted by usage frequency",
    promptGuidelines: [
      "Use obsidian_list_tags to understand the tag taxonomy of a vault before creating new notes or restructuring.",
      "When the user asks about tag conventions or wants to see what tags exist, this is the right tool.",
    ],
    parameters: Type.Object({
      vault: Type.String({
        description: "Vault name or absolute path to the vault directory.",
      }),
    }),
    async execute(_toolCallId, params) {
      const { vaults, error } = backend.resolveVault(params.vault);
      if (error || vaults.length === 0) {
        return {
          content: [{ type: "text", text: error ?? "Vault not found." }],
          details: { error },
          isError: true,
        };
      }
      const vaultDir = vaults[0].path;
      const tagCounts = new Map<string, number>();
      let noteCount = 0;

      backend.walkNotes(vaultDir, (_filePath, content) => {
        noteCount++;
        const tags = extractTags(content);
        for (const tag of tags) {
          tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
        }
      });

      if (tagCounts.size === 0) {
        return {
          content: [
            {
              type: "text",
              text: `No tags found in vault **${vaults[0].name}** (scanned ${noteCount} notes).`,
            },
          ],
          details: { tags: [], noteCount, vault: vaultDir },
        };
      }

      const sorted: TagCount[] = Array.from(tagCounts.entries())
        .map(([tag, count]) => ({ tag, count }))
        .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));

      const top20 = sorted.slice(0, 20);
      const lines = top20.map((t) => `- \`#${t.tag}\` — ${t.count} note${t.count === 1 ? "" : "s"}`);
      const remaining = sorted.length > 20
        ? `\n\n_... and ${sorted.length - 20} more tags_`
        : "";

      return {
        content: [
          {
            type: "text",
            text:
              `**${vaults[0].name}** — ${sorted.length} unique tags across ${noteCount} note${
                noteCount === 1 ? "" : "s"
              }:\n\n${lines.join("\n")}${remaining}`,
          },
        ],
        details: { tags: sorted, noteCount, vault: vaultDir },
      };
    },
  });

  // --- obsidian_list_backlinks ---
  pi.registerTool({
    name: "obsidian_list_backlinks",
    label: "List Backlinks",
    description:
      "Find all notes that link to a target note via [[wikilinks]]. Useful for understanding note relationships.",
    promptSnippet:
      "Find notes linking to a target note (backlinks)",
    promptGuidelines: [
      "Use obsidian_list_backlinks when the user wants to see what notes reference a specific note.",
      "This is how Obsidian's built-in backlinks panel works — this tool does the same thing via the filesystem.",
    ],
    parameters: Type.Object({
      vault: Type.String({
        description: "Vault name or absolute path to the vault directory.",
      }),
      target_note: Type.String({
        description:
          "Target note name (without .md extension, e.g., 'My Note'). Searches for [[My Note]] wikilinks.",
      }),
    }),
    async execute(_toolCallId, params) {
      const { vaults, error } = backend.resolveVault(params.vault);
      if (error || vaults.length === 0) {
        return {
          content: [{ type: "text", text: error ?? "Vault not found." }],
          details: { error },
          isError: true,
        };
      }
      const vaultDir = vaults[0].path;
      const target = params.target_note.replace(/\.md$/i, "");
      const backlinks: string[] = [];

      // Match [[Target]] and [[Target|alias]] and [[Target#heading]]
      const linkPatterns = [
        new RegExp(
          `\\[\\[${escapeRegex(target)}(?:\\|[^\\]]+)?(?:#[^\\]]+)?\\]\\]`,
          "gi",
        ),
      ];

      backend.walkNotes(vaultDir, (filePath, content) => {
        const rel = backend.relativePath(vaultDir, filePath);
        // Don't match the target note linking to itself
        const relNoExt = rel.replace(/\.md$/i, "");
        if (relNoExt.toLowerCase() === target.toLowerCase()) return;

        for (const pattern of linkPatterns) {
          if (pattern.test(content)) {
            backlinks.push(rel);
            return;
          }
        }
      });

      if (backlinks.length === 0) {
        return {
          content: [
            {
              type: "text",
              text: `No backlinks to **${target}** found in vault **${vaults[0].name}**.`,
            },
          ],
          details: { backlinks: [], target, vault: vaultDir },
        };
      }

      const sorted = backlinks.sort();
      return {
        content: [
          {
            type: "text",
            text:
              `${backlinks.length} note${
                backlinks.length === 1 ? "" : "s"
              } linking to **${target}** in **${vaults[0].name}**:\n\n${sorted
                .map((n) => `- [[${n.replace(/\.md$/, "")}]]`)
                .join("\n")}`,
          },
        ],
        details: { backlinks: sorted, target, vault: vaultDir },
      };
    },
  });

  // =========================================================================
  // Visualization Tools
  // =========================================================================

  // --- obsidian_create_mermaid ---
  pi.registerTool({
    name: "obsidian_create_mermaid",
    label: "Create Mermaid Diagram",
    description:
      "Generate a Mermaid diagram code block for Obsidian. " +
      "Supports flowchart, gantt, sequence, class, mindmap, pie, and timeline. " +
      "Optionally inserts the diagram into a specific note.",
    promptSnippet:
      "Generate a Mermaid diagram (flowchart, gantt, sequence, class, mindmap, pie, timeline) and optionally insert into a note",
    promptGuidelines: [
      "Use obsidian_create_mermaid when the user asks for a visual diagram, chart, or flowchart.",
      "The tool creates Mermaid boilerplate — you (the LLM) should edit the generated snippet with the user's specific content.",
      "For Gantt charts, fill in the actual task names, dates, and dependencies. For flowcharts, describe the actual decision points.",
    ],
    parameters: Type.Object({
      vault: Type.Optional(
        Type.String({
          description:
            "Optional vault name or path. Needed if inserting into a note.",
        }),
      ),
      diagram_type: Type.String({
        description:
          "Type of diagram: flowchart, gantt, sequence, class, mindmap, pie, or timeline.",
      }),
      content_description: Type.String({
        description:
          "Plain text description of what the diagram should represent.",
      }),
      note: Type.Optional(
        Type.String({
          description:
            "Optional note path to insert the diagram into. If omitted, returns the diagram code only.",
        }),
      ),
    }),
    async execute(_toolCallId, params) {
      const validTypes: DiagramType[] = [
        "flowchart",
        "gantt",
        "sequence",
        "class",
        "mindmap",
        "pie",
        "timeline",
      ];
      const dType = params.diagram_type.toLowerCase() as DiagramType;

      if (!validTypes.includes(dType)) {
        return {
          content: [
            {
              type: "text",
              text: `Invalid diagram type: "${params.diagram_type}". Valid types: ${validTypes.join(", ")}`,
            },
          ],
          details: { error: "Invalid diagram type" },
          isError: true,
        };
      }

      const mermaidCode = generateMermaid(dType, params.content_description);

      if (!params.note) {
        return {
          content: [
            {
              type: "text",
              text:
                `## ${dType.charAt(0).toUpperCase() + dType.slice(1)} Diagram\n\n` +
                `_Description: ${params.content_description}_\n\n${mermaidCode}\n\n` +
                `> 💡 Edit the placeholder content in the diagram to match your specific scenario.`,
            },
          ],
          details: {
            diagram_type: dType,
            mermaid: mermaidCode,
          },
        };
      }

      // Insert into a note
      if (!params.vault) {
        return {
          content: [
            {
              type: "text",
              text: "Vault is required when inserting a diagram into a note.",
            },
          ],
          details: { error: "Vault required" },
          isError: true,
        };
      }

      const { vaults, error } = backend.resolveVault(params.vault);
      if (error || vaults.length === 0) {
        return {
          content: [{ type: "text", text: error ?? "Vault not found." }],
          details: { error },
          isError: true,
        };
      }

      const fullPath = backend.resolveNotePath(vaults[0].path, params.note, ".md");
      try {
        backend.ensureDirectory(backend.dirname(fullPath));
        const insertBlock = [
          "",
          `## ${dType.charAt(0).toUpperCase() + dType.slice(1)}: ${params.content_description}`,
          "",
          mermaidCode,
          "",
        ].join("\n");

        if (backend.exists(fullPath)) {
          backend.appendText(fullPath, insertBlock, "utf-8");
        } else {
          backend.writeText(fullPath, insertBlock, "utf-8");
        }

        const relPath = backend.relativePath(vaults[0].path, fullPath);
        return {
          content: [
            {
              type: "text",
              text: `✅ Inserted ${dType} diagram into \`${relPath}\` in vault **${vaults[0].name}**`,
            },
          ],
          details: {
            diagram_type: dType,
            path: fullPath,
            relativePath: relPath,
          },
        };
      } catch (err: any) {
        return {
          content: [
            {
              type: "text",
              text: `Error inserting diagram: ${err.message}`,
            },
          ],
          details: { error: err.message },
          isError: true,
        };
      }
    },
  });

  // --- obsidian_create_canvas ---
  pi.registerTool({
    name: "obsidian_create_canvas",
    label: "Create Obsidian Canvas",
    description:
      "Create or update an Obsidian Canvas file (.canvas.json) for visual note organization. " +
      "Canvas files are JSON with nodes (text, file, group) and edges connecting them.",
    promptSnippet:
      "Create an Obsidian Canvas file with nodes and edges for visual knowledge organization",
    promptGuidelines: [
      "Use obsidian_create_canvas for visual layouts: mind maps, project overviews, research boards, architecture diagrams.",
      "Canvas is great for spatial organization — place related notes near each other with labeled connections.",
      "For linear content, use a regular note. Canvas excels at non-linear, spatial relationships.",
    ],
    parameters: Type.Object({
      vault: Type.String({
        description: "Vault name or absolute path to the vault directory.",
      }),
      canvas_name: Type.String({
        description:
          "Canvas file name (without extension). Saved as 'name.canvas' in the vault root.",
      }),
      nodes: Type.Array(
        Type.Object({
          id: Type.String({ description: "Unique node ID (e.g., 'n1', 'n2')." }),
          type: Type.String({
            description: "Node type: 'text', 'file', or 'group'.",
          }),
          text: Type.Optional(
            Type.String({
              description: "Markdown content for 'text' nodes.",
            }),
          ),
          file: Type.Optional(
            Type.String({
              description: "Relative path to a note for 'file' nodes.",
            }),
          ),
          x: Type.Number({ description: "X position (pixels)." }),
          y: Type.Number({ description: "Y position (pixels)." }),
          width: Type.Number({ description: "Node width (pixels)." }),
          height: Type.Number({ description: "Node height (pixels)." }),
          color: Type.Optional(
            Type.String({
              description:
                "Color preset: '1' (red), '2' (orange), '3' (yellow), '4' (green), '5' (cyan), '6' (purple).",
            }),
          ),
        }),
        { description: "Array of nodes to place on the canvas." },
      ),
      edges: Type.Array(
        Type.Object({
          id: Type.String({
            description: "Unique edge ID (e.g., 'e1', 'e2').",
          }),
          fromNode: Type.String({ description: "Source node ID." }),
          fromSide: Type.Optional(
            Type.String({
              description:
                "Source side: 'top', 'right', 'bottom', 'left'. Default: auto.",
            }),
          ),
          toNode: Type.String({ description: "Target node ID." }),
          toSide: Type.Optional(
            Type.String({
              description:
                "Target side: 'top', 'right', 'bottom', 'left'. Default: auto.",
            }),
          ),
          label: Type.Optional(
            Type.String({
              description: "Optional edge label text.",
            }),
          ),
        }),
        { description: "Array of edges connecting nodes." },
      ),
    }),
    async execute(_toolCallId, params) {
      const { vaults, error } = backend.resolveVault(params.vault);
      if (error || vaults.length === 0) {
        return {
          content: [{ type: "text", text: error ?? "Vault not found." }],
          details: { error },
          isError: true,
        };
      }

      const vaultDir = vaults[0].path;
      const canvasPath = backend.joinPath(
        vaultDir,
        `${params.canvas_name.replace(/\.canvas$/i, "")}.canvas`,
      );

      try {
        // Build Obsidian Canvas JSON structure
        const canvasData = {
          nodes: params.nodes.map((n) => {
            const node: Record<string, unknown> = {
              id: n.id,
              type: n.type,
              x: n.x,
              y: n.y,
              width: n.width,
              height: n.height,
            };
            if (n.type === "text" && n.text !== undefined) node.text = n.text;
            if (n.type === "file" && n.file !== undefined) node.file = n.file;
            if (n.type === "group") {
              node.label = n.text ?? "";
            }
            if (n.color) node.color = n.color;
            return node;
          }),
          edges: params.edges.map((e) => {
            const edge: Record<string, unknown> = {
              id: e.id,
              fromNode: e.fromNode,
              toNode: e.toNode,
            };
            if (e.fromSide) edge.fromSide = e.fromSide;
            if (e.toSide) edge.toSide = e.toSide;
            if (e.label) edge.label = e.label;
            return edge;
          }),
        };

        backend.writeText(canvasPath, JSON.stringify(canvasData, null, 2), "utf-8");

        const relPath = backend.relativePath(vaultDir, canvasPath);
        return {
          content: [
            {
              type: "text",
              text:
                `✅ Created Canvas: \`${relPath}\`\n\n` +
                `**${params.nodes.length} node${params.nodes.length === 1 ? "" : "s"}**, ` +
                `**${params.edges.length} edge${params.edges.length === 1 ? "" : "s"}**\n\n` +
                `Open in Obsidian to view and arrange the canvas visually.`,
            },
          ],
          details: {
            path: canvasPath,
            relativePath: relPath,
            nodeCount: params.nodes.length,
            edgeCount: params.edges.length,
          },
        };
      } catch (err: any) {
        return {
          content: [
            {
              type: "text",
              text: `Error creating canvas: ${err.message}`,
            },
          ],
          details: { error: err.message },
          isError: true,
        };
      }
    },
  });

  // =========================================================================
  // Project Planning Tools
  // =========================================================================

  // --- obsidian_create_kanban ---
  pi.registerTool({
    name: "obsidian_create_kanban",
    label: "Create Kanban Board",
    description:
      "Create a Kanban board note with columns and tasks. " +
      "Compatible with the Obsidian Kanban plugin.",
    promptSnippet:
      "Create a Kanban board note with columns (e.g., Backlog, Todo, In Progress, Done) and tasks",
    promptGuidelines: [
      "Use obsidian_create_kanban when the user wants to set up task tracking, sprint boards, or project workflows.",
      "Kanban boards work best with 4-6 columns. Standard flow: Backlog → Todo → In Progress → Review → Done.",
      "Each task can be a simple text item or a [[wikilink]] to a detailed note. Use wikilinks for complex tasks.",
    ],
    parameters: Type.Object({
      vault: Type.String({
        description: "Vault name or absolute path to the vault directory.",
      }),
      note: Type.String({
        description:
          "Path for the Kanban board note (e.g., 'projects/My Project Kanban').",
      }),
      title: Type.String({
        description: "Board title displayed at the top of the note.",
      }),
      columns: Type.Array(
        Type.Object({
          name: Type.String({
            description: "Column name (e.g., 'Backlog', 'In Progress').",
          }),
          tasks: Type.Array(
            Type.Object({
              text: Type.String({ description: "Task description." }),
              completed: Type.Optional(
                Type.Boolean({
                  description: "Whether the task is completed. Default: false.",
                  default: false,
                }),
              ),
            }),
            { description: "Tasks in this column." },
          ),
        }),
        { description: "Kanban columns with their tasks." },
      ),
    }),
    async execute(_toolCallId, params) {
      const { vaults, error } = backend.resolveVault(params.vault);
      if (error || vaults.length === 0) {
        return {
          content: [{ type: "text", text: error ?? "Vault not found." }],
          details: { error },
          isError: true,
        };
      }

      const vaultDir = vaults[0].path;
      const fullPath = backend.resolveNotePath(vaultDir, params.note, ".md");
      const now = new Date().toISOString().split("T")[0];

      // Build Kanban note content
      const lines: string[] = [
        "---",
        "kanban-plugin: basic",
        `title: "${escapeYaml(params.title)}"`,
        `created: ${now}`,
        "tags:",
        "  - kanban",
        "  - project",
        "---",
        "",
        `# ${params.title}`,
        "",
      ];

      // Build Kanban columns as callout-style blocks
      // Obsidian Kanban plugin uses a specific format:
      // ---
      // kanban-plugin: basic
      // ---
      // ## Column Name
      // - [ ] Task
      // - [x] Done task
      // ## Another Column
      for (const col of params.columns) {
        lines.push(`## ${col.name}`);
        for (const task of col.tasks) {
          const checkbox = task.completed ? "[x]" : "[ ]";
          lines.push(`- ${checkbox} ${task.text}`);
        }
        lines.push("");
      }

      lines.push(
        "---",
        "",
        "> [!tip] Using this board",
        "> Open this note with the **Kanban** plugin installed to see it as a visual board. " +
          "You can also use it as a plain markdown task list.",
        "",
      );

      try {
        backend.ensureDirectory(backend.dirname(fullPath));
        const existed = backend.exists(fullPath);
        backend.writeText(fullPath, lines.join("\n"), "utf-8");

        const relPath = backend.relativePath(vaultDir, fullPath);
        const totalTasks = params.columns.reduce(
          (sum, c) => sum + c.tasks.length,
          0,
        );
        return {
          content: [
            {
              type: "text",
              text:
                `✅ ${existed ? "Updated" : "Created"} Kanban board: \`${relPath}\`\n\n` +
                `**${params.columns.length} column${params.columns.length === 1 ? "" : "s"}** ` +
                `— **${totalTasks} task${totalTasks === 1 ? "" : "s"}**\n\n` +
                params.columns
                  .map(
                    (c) =>
                      `- **${c.name}**: ${c.tasks.length} task${c.tasks.length === 1 ? "" : "s"}`,
                  )
                  .join("\n"),
            },
          ],
          details: {
            path: fullPath,
            relativePath: relPath,
            columns: params.columns.length,
            tasks: totalTasks,
          },
        };
      } catch (err: any) {
        return {
          content: [
            {
              type: "text",
              text: `Error creating Kanban board: ${err.message}`,
            },
          ],
          details: { error: err.message },
          isError: true,
        };
      }
    },
  });

  // --- obsidian_create_project_dashboard ---
  pi.registerTool({
    name: "obsidian_create_project_dashboard",
    label: "Create Project Dashboard",
    description:
      "Create a comprehensive project dashboard note with frontmatter, " +
      "goals, milestone Gantt chart, Dataview task queries, and meeting log.",
    promptSnippet:
      "Create a project dashboard with goals, milestones, Mermaid Gantt chart, and Dataview query sections",
    promptGuidelines: [
      "Use obsidian_create_project_dashboard for new projects to set up a single source of truth.",
      "The dashboard integrates with Dataview queries — tasks tagged with project tags automatically appear.",
      "After creating the dashboard, create milestone notes and daily notes that link back to the project.",
    ],
    parameters: Type.Object({
      vault: Type.String({
        description: "Vault name or absolute path to the vault directory.",
      }),
      note: Type.String({
        description:
          "Path for the dashboard note (e.g., 'projects/My Project/Dashboard').",
      }),
      project_name: Type.String({
        description: "Display name for the project.",
      }),
      goals: Type.Array(Type.String(), {
        description: "List of project goals.",
      }),
      milestones: Type.Array(
        Type.Object({
          name: Type.String({ description: "Milestone name." }),
          date: Type.String({
            description:
              "Target date (YYYY-MM-DD). Used in the Gantt chart.",
          }),
          status: Type.Optional(
            Type.String({
              description:
                "Status: 'done', 'active', or 'planned'. Default: 'planned'.",
              default: "planned",
            }),
          ),
        }),
        { description: "Project milestones for the Gantt chart." },
      ),
      team_members: Type.Optional(
        Type.Array(Type.String(), {
          description: "List of team members.",
        }),
      ),
    }),
    async execute(_toolCallId, params) {
      const { vaults, error } = backend.resolveVault(params.vault);
      if (error || vaults.length === 0) {
        return {
          content: [{ type: "text", text: error ?? "Vault not found." }],
          details: { error },
          isError: true,
        };
      }

      const vaultDir = vaults[0].path;
      const fullPath = backend.resolveNotePath(vaultDir, params.note, ".md");
      const now = new Date().toISOString().split("T")[0];
      const tagBase = params.project_name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "");

      // Build Gantt chart from milestones
      const ganttLines: string[] = [
        "```mermaid",
        "gantt",
        `    title ${params.project_name} Timeline`,
        "    dateFormat  YYYY-MM-DD",
        "    axisFormat  %b %d",
        "",
      ];

      if (params.milestones.length > 0) {
        ganttLines.push(`    section Milestones`);
        for (const ms of params.milestones) {
          const status =
            ms.status === "done"
              ? "done, "
              : ms.status === "active"
                ? "active, "
                : "";
          const id = ms.name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
          const startDate =
            params.milestones.indexOf(ms) === 0
              ? ms.date
              : `after ${params.milestones[params.milestones.indexOf(ms) - 1].name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;

          ganttLines.push(
            `    ${ms.name} :${status}${id}, ${startDate}, 14d`,
          );
        }
      }

      ganttLines.push("```");

      // Build project dashboard
      const teamSection = params.team_members?.length
        ? params.team_members.map((m) => `- ${m}`).join("\n")
        : "- ";

      const goalsSection = params.goals
        .map((g, i) => `${i + 1}. ${g}`)
        .join("\n");

      const content = [
        "---",
        `project: "${escapeYaml(params.project_name)}"`,
        `created: ${now}`,
        `updated: ${now}`,
        "tags:",
        `  - project/${tagBase}`,
        "  - dashboard",
        "---",
        "",
        `# 🚀 ${params.project_name}`,
        "",
        "## 📋 Overview",
        "",
        `_Created: ${now}_`,
        "",
        "## 🎯 Goals",
        "",
        goalsSection,
        "",
        "## 👥 Team",
        "",
        teamSection,
        "",
        "## 📅 Milestones",
        "",
        ganttLines.join("\n"),
        "",
        "| Milestone | Date | Status |",
        "|-----------|------|--------|",
        ...params.milestones.map(
          (ms) =>
            `| ${ms.name} | ${ms.date} | ${ms.status === "done" ? "✅ Done" : ms.status === "active" ? "🔄 Active" : "📋 Planned"} |`,
        ),
        "",
        "## ✅ Tasks",
        "",
        "```dataview",
        "TASK",
        `FROM "projects"`,
        `WHERE contains(tags, "#project/${tagBase}")`,
        "```",
        "",
        "## 📝 Notes",
        "",
        "```dataview",
        "LIST",
        `FROM "projects/${escapeDataview(params.project_name)}"`,
        "SORT file.name ASC",
        "```",
        "",
        "## 🤝 Meetings",
        "",
        "| Date | Topic | Attendees | Notes |",
        "|------|-------|-----------|-------|",
        "|      |       |           |       |",
        "",
        "## 🔗 Related Notes",
        "",
        `- [[${params.note}/Kanban|Kanban Board]]`,
        `- Daily notes tagged #project/${tagBase}`,
        "",
      ].join("\n");

      try {
        backend.ensureDirectory(backend.dirname(fullPath));
        const existed = backend.exists(fullPath);
        backend.writeText(fullPath, content, "utf-8");

        const relPath = backend.relativePath(vaultDir, fullPath);
        return {
          content: [
            {
              type: "text",
              text:
                `✅ ${existed ? "Updated" : "Created"} project dashboard: \`${relPath}\`\n\n` +
                `**${params.goals.length} goal${params.goals.length === 1 ? "" : "s"}** · ` +
                `**${params.milestones.length} milestone${params.milestones.length === 1 ? "" : "s"}** ` +
                `${
                  params.team_members?.length
                    ? `· **${params.team_members.length} team member${params.team_members.length === 1 ? "" : "s"}**`
                    : ""
                }\n\n` +
                `> 💡 Tag project notes with \`#project/${tagBase}\` to have them appear in the dashboard's Dataview queries.`,
            },
          ],
          details: {
            path: fullPath,
            relativePath: relPath,
            tag: `#project/${tagBase}`,
          },
        };
      } catch (err: any) {
        return {
          content: [
            {
              type: "text",
              text: `Error creating dashboard: ${err.message}`,
            },
          ],
          details: { error: err.message },
          isError: true,
        };
      }
    },
  });

  // --- obsidian_create_daily_note ---
  pi.registerTool({
    name: "obsidian_create_daily_note",
    label: "Create Daily Note",
    description:
      "Create a structured daily note with frontmatter and sections for tasks, notes, and meetings. " +
      "Supports default, meeting, and planning templates.",
    promptSnippet:
      "Create a structured daily note (default, meeting, or planning template) with frontmatter",
    promptGuidelines: [
      "Use obsidian_create_daily_note when the user wants a daily journal entry, meeting notes, or daily planning page.",
      "The 'meeting' template includes agenda, attendees, and action items. The 'planning' template uses MoSCoW prioritization.",
      "Daily notes are created with YYYY-MM-DD filename format and #daily tag for Dataview aggregation.",
    ],
    parameters: Type.Object({
      vault: Type.String({
        description: "Vault name or absolute path to the vault directory.",
      }),
      date: Type.String({
        description:
          'Date in YYYY-MM-DD format or "today" for the current date.',
      }),
      template: Type.Optional(
        Type.String({
          description:
            'Note template: "default", "meeting", or "planning". Default: "default".',
          default: "default",
        }),
      ),
    }),
    async execute(_toolCallId, params) {
      const { vaults, error } = backend.resolveVault(params.vault);
      if (error || vaults.length === 0) {
        return {
          content: [{ type: "text", text: error ?? "Vault not found." }],
          details: { error },
          isError: true,
        };
      }

      const template = params.template ?? "default";
      if (!["default", "meeting", "planning"].includes(template)) {
        return {
          content: [
            {
              type: "text",
              text: `Invalid template: "${template}". Valid options: default, meeting, planning.`,
            },
          ],
          details: { error: "Invalid template" },
          isError: true,
        };
      }

      let date = params.date;
      if (date === "today") {
        date = new Date().toISOString().split("T")[0];
      }

      let noteContent: string;
      try {
        noteContent = generateDailyNote(
          date,
          template as "default" | "meeting" | "planning",
        );
      } catch (err: any) {
        return {
          content: [
            {
              type: "text",
              text: `Invalid date: "${params.date}". Use YYYY-MM-DD format or "today".`,
            },
          ],
          details: { error: err.message },
          isError: true,
        };
      }
      const vaultDir = vaults[0].path;
      const noteName = `daily/${date}.md`;
      const fullPath = backend.resolveNotePath(vaultDir, noteName, ".md");

      try {
        backend.ensureDirectory(backend.dirname(fullPath));

        if (backend.exists(fullPath)) {
          return {
            content: [
              {
                type: "text",
                text:
                  `⚠️ Daily note for ${date} already exists: \`${backend.relativePath(vaultDir, fullPath)}\`\n\n` +
                  `Use **obsidian_append** to add content without overwriting, or **obsidian_read** to view the existing note.`,
              },
            ],
            details: {
              path: fullPath,
              relativePath: backend.relativePath(vaultDir, fullPath),
              existed: true,
            },
          };
        }

        backend.writeText(fullPath, noteContent, "utf-8");
        const relPath = backend.relativePath(vaultDir, fullPath);

        return {
          content: [
            {
              type: "text",
              text:
                `✅ Created ${template} daily note: \`${relPath}\`\n\n` +
                `Date: **${date}** · Template: **${template}** · Vault: **${vaults[0].name}**`,
            },
          ],
          details: {
            path: fullPath,
            relativePath: relPath,
            date,
            template,
          },
        };
      } catch (err: any) {
        return {
          content: [
            {
              type: "text",
              text: `Error creating daily note: ${err.message}`,
            },
          ],
          details: { error: err.message },
          isError: true,
        };
      }
    },
  });

  // --- Session start: notify about discovered vaults ---
  pi.on("session_start", (_event, ctx) => {
    const vaults = backend.listVaults();
    if (vaults.length > 0) {
      ctx.ui.notify(
        `Obsidian: ${vaults.length} vault${vaults.length === 1 ? "" : "s"} discovered`,
        "info",
      );
    }
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function escapeYaml(str: string): string {
  if (/[:"{}[\]\],&*#?|<>='`%@!]/.test(str)) {
    return `"${str.replace(/"/g, '\\"')}"`;
  }
  return str;
}

function escapeDataview(str: string): string {
  return str.replace(/"/g, '\\"');
}

function formatNoteTree(notes: string[]): string {
  const tree: Map<string, string[]> = new Map();
  for (const note of notes) {
    const dir = path.dirname(note);
    const file = path.basename(note);
    if (!tree.has(dir)) tree.set(dir, []);
    tree.get(dir)!.push(file);
  }

  const lines: string[] = [];
  const sortedDirs = Array.from(tree.keys()).sort();

  for (const dir of sortedDirs) {
    if (dir === ".") {
      for (const file of tree.get(dir)!.sort()) {
        lines.push(`- ${file.replace(/\.md$/, "")}`);
      }
    } else {
      lines.push(`- **${dir}/**`);
      for (const file of tree.get(dir)!.sort()) {
        lines.push(`  - ${file.replace(/\.md$/, "")}`);
      }
    }
  }

  return lines.join("\n");
}
