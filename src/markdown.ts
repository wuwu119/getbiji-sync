// INPUT: RawNote, BijiNote from types.ts
// OUTPUT: sanitizeFilename, escapeYamlString, cleanHtml, buildFrontmatter, buildMarkdown, bijiNoteToRawNote, resolveFilename
// POS: Markdown generation and note conversion for biji-sync

import type { RawNote, BijiNote } from "./types";

const UNSAFE_CHARS = /[/\\?%*:|"<>\0]/g;

/**
 * Remove filesystem-unsafe characters, collapse whitespace, strip leading dots,
 * trim, and limit to 200 characters.
 */
export function sanitizeFilename(name: string): string {
  const result = name
    .replace(UNSAFE_CHARS, "")
    .replace(/\s+/g, " ")
    .replace(/^\.+/, "")
    .trim()
    .slice(0, 200);
  return result || "无标题";
}

/**
 * Escape special characters for safe embedding inside a YAML double-quoted string.
 */
export function escapeYamlString(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\t/g, "\\t")
    .replace(/\0/g, "")
    .replace(/[\u2028\u2029]/g, "");
}

/**
 * Clean HTML content to plain Markdown using regex only.
 * No external dependencies (no DOMParser, turndown, etc.).
 */
export function cleanHtml(html: string): string {
  let result = html;

  // 1. <br>, <br/>, <br /> -> \n
  result = result.replace(/<br\s*\/?>/gi, "\n");

  // 2. </p> -> \n\n; <p> and <p ...> -> removed
  result = result.replace(/<\/p>/gi, "\n\n");
  result = result.replace(/<p[^>]*>/gi, "");

  // 3. <a href="URL">text</a> -> [text](URL), strip dangerous protocols
  result = result.replace(
    /<a\s+[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi,
    (_match: string, url: string, text: string) => {
      if (/^\s*(javascript|data|vbscript):/i.test(url)) {
        return text;
      }
      return `[${text}](${url})`;
    },
  );

  // 4. Strip all remaining HTML tags, keep inner text
  result = result.replace(/<[^>]+>/g, "");

  // 5. Collapse 3+ consecutive newlines to \n\n
  result = result.replace(/\n{3,}/g, "\n\n");

  // 6. Decode HTML entities
  result = result
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");

  return result;
}

/**
 * Build YAML frontmatter from a RawNote with fixed field order:
 * biji_id, title, note_type, entry_type, tags, source_url?, origin?, created_at, updated_at
 */
export function buildFrontmatter(note: RawNote): string {
  const lines: string[] = [];

  // biji_id (required)
  lines.push(`biji_id: "${escapeYamlString(note.id)}"`);

  // title
  lines.push(`title: "${escapeYamlString(note.title)}"`);

  // note_type
  if (note.noteType) {
    lines.push(`note_type: "${escapeYamlString(note.noteType)}"`);
  }

  // entry_type
  if (note.entryType) {
    lines.push(`entry_type: "${escapeYamlString(note.entryType)}"`);
  }

  // tags
  if (note.tags.length === 0) {
    lines.push("tags: []");
  } else {
    lines.push(`tags:\n${note.tags.map((t) => `  - "${escapeYamlString(t)}"`).join("\n")}`);
  }

  // source_url (optional, omit if undefined/empty)
  if (note.sourceUrl) {
    lines.push(`source_url: "${escapeYamlString(note.sourceUrl)}"`);
  }

  // origin (optional, omit if undefined/empty)
  if (note.origin) {
    lines.push(`origin: "${escapeYamlString(note.origin)}"`);
  }

  // created_at
  lines.push(`created_at: "${escapeYamlString(note.createdAt)}"`);

  // updated_at
  lines.push(`updated_at: "${escapeYamlString(note.updatedAt)}"`);

  return `---\n${lines.join("\n")}\n---`;
}

/**
 * Build full Markdown document: frontmatter + heading + content + optional callout.
 */
export function buildMarkdown(note: RawNote): string {
  const frontmatter = buildFrontmatter(note);
  const safeTitle = note.title.replace(/[\r\n]+/g, " ");
  const parts = [frontmatter, "", `# ${safeTitle}`, "", note.content];

  if (note.originalContent) {
    const lines = note.originalContent.replace(/\n$/, "").split("\n");
    parts.push(
      "",
      "> [!quote]- 原文",
      ...lines.map((line) => (line ? `> ${line}` : ">")),
    );
  }

  return parts.join("\n") + "\n";
}

/**
 * Convert a BijiNote API response to the internal RawNote format.
 * Returns null if the note has no id (defensive handling).
 */
export function bijiNoteToRawNote(note: BijiNote): RawNote | null {
  // Defensive: skip notes with missing id
  if (!note.id) {
    return null;
  }

  // Tags: filter out system tags, handle null/missing
  const tagNames = (note.tags ?? [])
    .filter((t) => t.name && t.type !== "system")
    .map((t) => t.name);

  // Source URL: first attachment with a url
  const sourceUrl = (note.attachments ?? []).find((a) => a.url)?.url;

  // Content: prefer content, fallback to body_text, then empty
  const rawContent = note.content || note.body_text || "";

  // Clean HTML from content
  const content = cleanHtml(rawContent);

  // Coerce title to string defensively
  const title = note.title ? String(note.title) : "无标题";

  return {
    id: note.id,
    title,
    content,
    tags: tagNames,
    createdAt: note.created_at,
    updatedAt: note.updated_at,
    sourceUrl,
    noteType: note.note_type ?? "unknown",
    entryType: note.entry_type,
    origin: note.source,
  };
}

/**
 * Resolve a filename, appending a short id suffix if there is a biji_id conflict.
 */
export function resolveFilename(
  title: string,
  bijiId: string,
  existingBijiId?: string | null,
): string {
  const base = sanitizeFilename(title || "无标题");
  if (existingBijiId !== undefined && existingBijiId !== bijiId) {
    return `${base}-${bijiId.slice(0, 6)}`;
  }
  return base;
}
