import { describe, it, expect } from "vitest";
import {
  sanitizeFilename,
  escapeYamlString,
  cleanHtml,
  buildFrontmatter,
  buildMarkdown,
  bijiNoteToRawNote,
  resolveFilename,
} from "../src/markdown";
import type { RawNote, BijiNote } from "../src/types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeBijiNote(overrides: Partial<BijiNote> = {}): BijiNote {
  return {
    id: "note-abc-123",
    note_id: "nid-001",
    title: "Test Note",
    content: "<p>Hello world</p>",
    body_text: "Hello world",
    source: "app",
    note_type: "plain_text",
    entry_type: "manual",
    tags: [
      { id: "t1", name: "tag-a", type: "user" },
      { id: "t2", name: "tag-b", type: "user" },
    ],
    attachments: [
      { type: "link", url: "https://example.com", title: "Example" },
    ],
    created_at: "2024-01-15T10:00:00Z",
    updated_at: "2024-01-16T12:00:00Z",
    edit_time: "2024-01-16T12:00:00Z",
    ...overrides,
  };
}

function makeRawNote(overrides: Partial<RawNote> = {}): RawNote {
  return {
    id: "note-abc-123",
    title: "Test Note",
    content: "Hello world",
    tags: ["tag-a", "tag-b"],
    createdAt: "2024-01-15T10:00:00Z",
    updatedAt: "2024-01-16T12:00:00Z",
    sourceUrl: "https://example.com",
    noteType: "plain_text",
    entryType: "manual",
    origin: "app",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// sanitizeFilename
// ---------------------------------------------------------------------------

describe("sanitizeFilename", () => {
  it("removes illegal characters", () => {
    expect(sanitizeFilename('a/b\\c?d%e*f:g|h"i<j>k')).toBe("abcdefghijk");
  });

  it("collapses whitespace", () => {
    expect(sanitizeFilename("hello   world  foo")).toBe("hello world foo");
  });

  it("strips leading dots", () => {
    expect(sanitizeFilename("...hidden")).toBe("hidden");
  });

  it("trims whitespace", () => {
    expect(sanitizeFilename("  hello  ")).toBe("hello");
  });

  it("truncates at 200 characters", () => {
    const long = "a".repeat(250);
    expect(sanitizeFilename(long)).toHaveLength(200);
  });

  it("handles empty string with fallback", () => {
    expect(sanitizeFilename("")).toBe("无标题");
  });

  it("handles all-dots input with fallback", () => {
    expect(sanitizeFilename("...")).toBe("无标题");
  });

  it("handles all-unsafe-chars input with fallback", () => {
    expect(sanitizeFilename("///\\\\")).toBe("无标题");
  });

  it("removes null bytes", () => {
    expect(sanitizeFilename("hello\0world")).toBe("helloworld");
  });
});

// ---------------------------------------------------------------------------
// escapeYamlString
// ---------------------------------------------------------------------------

describe("escapeYamlString", () => {
  it("escapes double quotes", () => {
    expect(escapeYamlString('say "hello"')).toBe('say \\"hello\\"');
  });

  it("escapes newlines", () => {
    expect(escapeYamlString("line1\nline2")).toBe("line1\\nline2");
  });

  it("escapes backslashes", () => {
    expect(escapeYamlString("back\\slash")).toBe("back\\\\slash");
  });

  it("removes null characters", () => {
    expect(escapeYamlString("a\0b")).toBe("ab");
  });

  it("escapes tabs", () => {
    expect(escapeYamlString("a\tb")).toBe("a\\tb");
  });

  it("escapes carriage returns", () => {
    expect(escapeYamlString("a\rb")).toBe("a\\rb");
  });

  it("removes line/paragraph separators", () => {
    expect(escapeYamlString("a\u2028b\u2029c")).toBe("abc");
  });
});

// ---------------------------------------------------------------------------
// cleanHtml
// ---------------------------------------------------------------------------

describe("cleanHtml", () => {
  it("converts br tags to newline", () => {
    expect(cleanHtml("hello<br>world")).toBe("hello\nworld");
    expect(cleanHtml("hello<br/>world")).toBe("hello\nworld");
    expect(cleanHtml("hello<br />world")).toBe("hello\nworld");
  });

  it("converts p tags to double newline", () => {
    expect(cleanHtml("<p>para1</p><p>para2</p>")).toBe("para1\n\npara2\n\n");
  });

  it("converts a tags to markdown links", () => {
    expect(cleanHtml('<a href="https://example.com">click me</a>')).toBe(
      "[click me](https://example.com)",
    );
  });

  it("strips other HTML tags, keeping inner text", () => {
    expect(cleanHtml("<b>bold</b> and <i>italic</i>")).toBe(
      "bold and italic",
    );
  });

  it("collapses 3+ consecutive newlines to double newline", () => {
    expect(cleanHtml("a\n\n\n\nb")).toBe("a\n\nb");
  });

  it("decodes HTML entities", () => {
    expect(cleanHtml("&amp; &lt; &gt; &quot; &#39; &nbsp;")).toBe(
      "& < > \" '  ",
    );
  });

  it("leaves plain text unchanged", () => {
    expect(cleanHtml("just plain text")).toBe("just plain text");
  });

  it("handles empty string", () => {
    expect(cleanHtml("")).toBe("");
  });

  it("handles nested tags", () => {
    expect(cleanHtml("<div><span>nested</span></div>")).toBe("nested");
  });

  it("strips javascript: URLs from links", () => {
    expect(cleanHtml('<a href="javascript:alert(1)">click</a>')).toBe("click");
  });

  it("strips data: URLs from links", () => {
    expect(cleanHtml('<a href="data:text/html,<script>alert(1)</script>">click</a>')).toBe("click");
  });

  it("strips vbscript: URLs from links", () => {
    expect(cleanHtml('<a href="vbscript:MsgBox">click</a>')).toBe("click");
  });

  it("strips javascript: URLs case-insensitively", () => {
    expect(cleanHtml('<a href="JaVaScRiPt:alert(1)">click</a>')).toBe("click");
  });

  it("preserves safe http links", () => {
    expect(cleanHtml('<a href="http://example.com">safe</a>')).toBe("[safe](http://example.com)");
  });
});

// ---------------------------------------------------------------------------
// bijiNoteToRawNote
// ---------------------------------------------------------------------------

describe("bijiNoteToRawNote", () => {
  it("converts all fields correctly", () => {
    const biji = makeBijiNote();
    const raw = bijiNoteToRawNote(biji);
    expect(raw).not.toBeNull();
    expect(raw!.id).toBe("note-abc-123");
    expect(raw!.title).toBe("Test Note");
    // Content is HTML-cleaned
    expect(raw!.content).toBe("Hello world\n\n");
    expect(raw!.tags).toEqual(["tag-a", "tag-b"]);
    expect(raw!.createdAt).toBe("2024-01-15T10:00:00Z");
    expect(raw!.updatedAt).toBe("2024-01-16T12:00:00Z");
    expect(raw!.sourceUrl).toBe("https://example.com");
    expect(raw!.noteType).toBe("plain_text");
    expect(raw!.entryType).toBe("manual");
    expect(raw!.origin).toBe("app");
  });

  it("filters out system tags", () => {
    const biji = makeBijiNote({
      tags: [
        { id: "t1", name: "user-tag", type: "user" },
        { id: "t2", name: "sys-tag", type: "system" },
        { id: "t3", name: "another", type: "custom" },
      ],
    });
    const raw = bijiNoteToRawNote(biji)!;
    expect(raw.tags).toEqual(["user-tag", "another"]);
  });

  it("handles null tags -> empty array", () => {
    const biji = makeBijiNote({ tags: null as unknown as BijiNote["tags"] });
    const raw = bijiNoteToRawNote(biji)!;
    expect(raw.tags).toEqual([]);
  });

  it("handles missing tags (undefined) -> empty array", () => {
    const biji = makeBijiNote();
    (biji as Record<string, unknown>).tags = undefined;
    const raw = bijiNoteToRawNote(biji)!;
    expect(raw.tags).toEqual([]);
  });

  it("handles null attachments -> no sourceUrl", () => {
    const biji = makeBijiNote({
      attachments: null as unknown as BijiNote["attachments"],
    });
    const raw = bijiNoteToRawNote(biji)!;
    expect(raw.sourceUrl).toBeUndefined();
  });

  it("falls back to body_text when content is empty", () => {
    const biji = makeBijiNote({ content: "", body_text: "fallback text" });
    const raw = bijiNoteToRawNote(biji)!;
    expect(raw.content).toBe("fallback text");
  });

  it("returns empty string when both content and body_text are empty", () => {
    const biji = makeBijiNote({ content: "", body_text: "" });
    const raw = bijiNoteToRawNote(biji)!;
    expect(raw.content).toBe("");
  });

  it("returns null for missing id", () => {
    const biji = makeBijiNote({ id: "" });
    expect(bijiNoteToRawNote(biji)).toBeNull();
  });

  it("returns null for undefined id", () => {
    const biji = makeBijiNote();
    (biji as Record<string, unknown>).id = undefined;
    expect(bijiNoteToRawNote(biji)).toBeNull();
  });

  it("coerces number title to string", () => {
    const biji = makeBijiNote({ title: 12345 as unknown as string });
    const raw = bijiNoteToRawNote(biji)!;
    expect(raw.title).toBe("12345");
  });

  it("uses default title for empty title", () => {
    const biji = makeBijiNote({ title: "" });
    const raw = bijiNoteToRawNote(biji)!;
    expect(raw.title).toBe("无标题");
  });

  it("defaults null note_type to 'unknown'", () => {
    const biji = makeBijiNote({
      note_type: null as unknown as string,
    });
    const raw = bijiNoteToRawNote(biji)!;
    expect(raw.noteType).toBe("unknown");
  });

  it("cleans HTML from content", () => {
    const biji = makeBijiNote({ content: "<b>bold</b><br>line2" });
    const raw = bijiNoteToRawNote(biji)!;
    expect(raw.content).toBe("bold\nline2");
  });
});

// ---------------------------------------------------------------------------
// buildFrontmatter
// ---------------------------------------------------------------------------

describe("buildFrontmatter", () => {
  it("renders all fields in correct order", () => {
    const note = makeRawNote();
    const fm = buildFrontmatter(note);

    const lines = fm.split("\n");
    expect(lines[0]).toBe("---");
    expect(lines[1]).toContain("biji_id:");
    expect(lines[2]).toContain("title:");
    expect(lines[3]).toContain("note_type:");
    expect(lines[4]).toContain("entry_type:");
    expect(lines[5]).toContain("tags:");

    // After tags list items, find source_url, origin, created_at, updated_at
    const joined = fm;
    expect(joined).toContain('biji_id: "note-abc-123"');
    expect(joined).toContain('title: "Test Note"');
    expect(joined).toContain('note_type: "plain_text"');
    expect(joined).toContain('entry_type: "manual"');
    expect(joined).toContain('source_url: "https://example.com"');
    expect(joined).toContain('origin: "app"');
    expect(joined).toContain('created_at: "2024-01-15T10:00:00Z"');
    expect(joined).toContain('updated_at: "2024-01-16T12:00:00Z"');
    expect(lines[lines.length - 1]).toBe("---");
  });

  it("omits optional fields when undefined/empty", () => {
    const note = makeRawNote({
      sourceUrl: undefined,
      origin: undefined,
      noteType: undefined,
      entryType: undefined,
    });
    const fm = buildFrontmatter(note);
    expect(fm).not.toContain("source_url:");
    expect(fm).not.toContain("origin:");
    expect(fm).not.toContain("note_type:");
    expect(fm).not.toContain("entry_type:");
  });

  it("escapes YAML special characters in values", () => {
    const note = makeRawNote({ title: 'Title with "quotes" and\nnewline' });
    const fm = buildFrontmatter(note);
    expect(fm).toContain('title: "Title with \\"quotes\\" and\\nnewline"');
  });

  it("renders tags as YAML list", () => {
    const note = makeRawNote({ tags: ["alpha", "beta"] });
    const fm = buildFrontmatter(note);
    expect(fm).toContain('tags:\n  - "alpha"\n  - "beta"');
  });

  it("renders empty tags as empty array", () => {
    const note = makeRawNote({ tags: [] });
    const fm = buildFrontmatter(note);
    expect(fm).toContain("tags: []");
  });

  it("preserves field order: biji_id before title before tags", () => {
    const note = makeRawNote();
    const fm = buildFrontmatter(note);
    const bijiIdIdx = fm.indexOf("biji_id:");
    const titleIdx = fm.indexOf("title:");
    const tagsIdx = fm.indexOf("tags:");
    const createdIdx = fm.indexOf("created_at:");
    const updatedIdx = fm.indexOf("updated_at:");

    expect(bijiIdIdx).toBeLessThan(titleIdx);
    expect(titleIdx).toBeLessThan(tagsIdx);
    expect(tagsIdx).toBeLessThan(createdIdx);
    expect(createdIdx).toBeLessThan(updatedIdx);
  });
});

// ---------------------------------------------------------------------------
// buildMarkdown
// ---------------------------------------------------------------------------

describe("buildMarkdown", () => {
  it("includes callout block when originalContent exists", () => {
    const note = makeRawNote({ originalContent: "Original text here" });
    const md = buildMarkdown(note);
    expect(md).toContain("> [!quote]- 原文");
    expect(md).toContain("> Original text here");
  });

  it("prefixes each line of multi-line originalContent with >", () => {
    const note = makeRawNote({
      originalContent: "line1\nline2\nline3",
    });
    const md = buildMarkdown(note);
    expect(md).toContain("> line1");
    expect(md).toContain("> line2");
    expect(md).toContain("> line3");
  });

  it("handles empty lines in originalContent with bare >", () => {
    const note = makeRawNote({
      originalContent: "line1\n\nline3",
    });
    const md = buildMarkdown(note);
    const lines = md.split("\n");
    const quoteStart = lines.indexOf("> [!quote]- 原文");
    expect(lines[quoteStart + 1]).toBe("> line1");
    expect(lines[quoteStart + 2]).toBe(">");
    expect(lines[quoteStart + 3]).toBe("> line3");
  });

  it("omits callout block when originalContent is absent", () => {
    const note = makeRawNote({ originalContent: undefined });
    const md = buildMarkdown(note);
    expect(md).not.toContain("> [!quote]");
  });

  it("produces frontmatter + heading even with empty content and no originalContent", () => {
    const note = makeRawNote({ content: "", originalContent: undefined });
    const md = buildMarkdown(note);
    expect(md).toContain("---");
    expect(md).toContain("# Test Note");
    expect(md).not.toContain("> [!quote]");
  });

  it("ends with a newline", () => {
    const note = makeRawNote();
    const md = buildMarkdown(note);
    expect(md.endsWith("\n")).toBe(true);
  });

  it("includes title as H1 heading", () => {
    const note = makeRawNote({ title: "My Great Title" });
    const md = buildMarkdown(note);
    expect(md).toContain("# My Great Title");
  });

  it("sanitizes newlines in title for heading", () => {
    const note = makeRawNote({ title: "Title\nWith\r\nBreaks" });
    const md = buildMarkdown(note);
    expect(md).toContain("# Title With Breaks");
  });
});

// ---------------------------------------------------------------------------
// resolveFilename
// ---------------------------------------------------------------------------

describe("resolveFilename", () => {
  it("returns clean name when no conflict", () => {
    expect(resolveFilename("My Note", "abc123")).toBe("My Note");
  });

  it("appends id suffix when different biji_id exists", () => {
    expect(resolveFilename("My Note", "abc123", "xyz789")).toBe(
      "My Note-abc123",
    );
  });

  it("returns clean name when same biji_id", () => {
    expect(resolveFilename("My Note", "abc123", "abc123")).toBe("My Note");
  });

  it("returns clean name when existingBijiId is undefined (no existing file)", () => {
    expect(resolveFilename("My Note", "abc123", undefined)).toBe("My Note");
  });

  it("appends suffix when existingBijiId is null (file exists but has no biji_id)", () => {
    expect(resolveFilename("My Note", "abc123", null)).toBe(
      "My Note-abc123",
    );
  });

  it("uses default title for empty string", () => {
    expect(resolveFilename("", "abc123")).toBe("无标题");
  });

  it("sanitizes the title", () => {
    expect(resolveFilename("bad/name?yes", "abc123")).toBe("badnameyes");
  });
});
