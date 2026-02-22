// INPUT: obsidian (Notice, TFile, TFolder, normalizePath), main.ts (BijiSyncPlugin), api.ts, auth.ts, markdown.ts
// OUTPUT: syncBiji
// POS: Sync engine — orchestrates fetching notes from API and writing to vault

import { Notice, TFile, TFolder, normalizePath } from "obsidian";
import type BijiSyncPlugin from "./main";
import { AuthFatalError, fetchNotes, fetchLinkDetail, DETAIL_DELAY } from "./api";
import { refreshJwt, validateRefreshToken } from "./auth";
import {
  bijiNoteToRawNote,
  buildMarkdown,
  resolveFilename,
  cleanHtml,
} from "./markdown";

/**
 * Main sync loop: fetches notes from Get笔记 API and writes them to the vault.
 *
 * Cursor semantics:
 * - API returns notes newest-first (create_desc)
 * - newestNoteId = first note of first page (captured once per sync)
 * - Incremental stop: note.id === lastSyncId means we reached previously-synced territory
 * - lastSyncId is saved ONCE after sync completes
 *
 * Error isolation:
 * - Single-note errors: catch, count, continue
 * - AuthFatalError: re-throw immediately
 */
export async function syncBiji(
  plugin: BijiSyncPlugin,
  signal: AbortSignal,
  options?: { silent?: boolean },
): Promise<void> {
  // 1. Snapshot settings
  const targetFolder = plugin.settings.targetFolder;
  const lastSyncId = plugin.settings.lastSyncId;

  const silent = options?.silent ?? false;

  // 2. Validate refreshToken
  const tokenError = validateRefreshToken(plugin.settings.refreshToken);
  if (tokenError) {
    if (!silent) new Notice(tokenError);
    return;
  }

  // 3. Get/refresh JWT
  let jwt: string;
  try {
    jwt = await refreshJwt(plugin.settings.refreshToken);
  } catch (err) {
    throw new AuthFatalError(
      "Failed to obtain JWT",
      err instanceof Error ? err : undefined,
    );
  }

  // JWT refresh callback — updates local jwt variable
  const refreshJwtCallback = async (): Promise<string> => {
    jwt = await refreshJwt(plugin.settings.refreshToken);
    return jwt;
  };

  // 4. Ensure target folder exists
  const folder = plugin.app.vault.getAbstractFileByPath(
    normalizePath(targetFolder),
  );
  if (!(folder instanceof TFolder)) {
    await plugin.app.vault.createFolder(normalizePath(targetFolder));
  }

  // Counters
  let syncCount = 0;
  let skipCount = 0;
  let errorCount = 0;
  let newestNoteId: string | null = null;
  let shouldStop = false;
  let isFirstPage = true;

  // 5. Fetch pages of notes
  for await (const { notes } of fetchNotes(jwt, refreshJwtCallback, signal)) {
    if (signal.aborted) break;

    // 6. Process each note on the page
    for (const note of notes) {
      // 6a. Check abort
      if (signal.aborted) break;

      // Capture newestNoteId from first note of first page
      if (isFirstPage && newestNoteId === null && note.id) {
        newestNoteId = note.id;
      }

      // 6b. Incremental stop condition
      if (lastSyncId && note.id === lastSyncId) {
        shouldStop = true;
        break;
      }

      // Process single note with error isolation
      try {
        // 6d. Convert BijiNote -> RawNote
        const rawNote = bijiNoteToRawNote(note);
        if (!rawNote) {
          skipCount++;
          continue;
        }

        // 6c. Dedup via MetadataCache
        const baseName = resolveFilename(rawNote.title, rawNote.id);
        const targetPath = normalizePath(
          `${targetFolder}/${baseName}.md`,
        );
        const existingFile =
          plugin.app.vault.getAbstractFileByPath(targetPath);

        if (existingFile instanceof TFile) {
          const cachedMeta =
            plugin.app.metadataCache.getFileCache(existingFile);
          const existingBijiId = cachedMeta?.frontmatter?.biji_id;
          if (existingBijiId === note.id) {
            skipCount++;
            continue; // Already synced
          }
        }

        // 6e. For link notes: fetch original content
        if (rawNote.noteType === "link") {
          const linkContent = await fetchLinkDetail(
            jwt,
            note.id,
            refreshJwtCallback,
          );
          if (linkContent) {
            // 6f. Apply cleanHtml to originalContent
            rawNote.originalContent = cleanHtml(linkContent);
          }
          // Rate-limit between consecutive link detail requests
          await new Promise((r) => setTimeout(r, DETAIL_DELAY));
        }

        // 6g. Build markdown
        const markdown = buildMarkdown(rawNote);

        // 6h. Resolve filename conflicts
        let finalName: string;
        if (existingFile instanceof TFile) {
          const cachedMeta =
            plugin.app.metadataCache.getFileCache(existingFile);
          const existingBijiId = cachedMeta?.frontmatter?.biji_id;
          finalName = resolveFilename(
            rawNote.title,
            rawNote.id,
            existingBijiId,
          );
        } else {
          finalName = baseName;
        }

        const finalPath = normalizePath(
          `${targetFolder}/${finalName}.md`,
        );

        // 6i. Create file in vault
        await plugin.app.vault.create(finalPath, markdown);
        syncCount++;
      } catch (err) {
        // AuthFatalError must propagate
        if (err instanceof AuthFatalError) throw err;
        errorCount++;
        console.error(`Failed to sync note ${note.id}:`, err);
        continue;
      }
    }

    isFirstPage = false;

    if (shouldStop || signal.aborted) break;

    // Per-page progress notice
    if (!silent) new Notice(`Synced ${syncCount} notes...`);
  }

  // 7. Save lastSyncId + lastSyncTime
  if (newestNoteId) {
    plugin.settings.lastSyncId = newestNoteId;
  }
  plugin.settings.lastSyncTime = Date.now();
  await plugin.saveSettings();

  // 8. Show summary
  if (!silent) {
    if (signal.aborted) {
      new Notice(
        `Sync cancelled: ${syncCount} new, ${skipCount} skipped`,
      );
    } else {
      new Notice(
        `Sync complete: ${syncCount} new, ${skipCount} skipped, ${errorCount} errors`,
      );
    }
  }
}
