import os from 'node:os';
import path from 'node:path';
import { readdir, rm, rmdir, unlink } from 'node:fs/promises';

import { sessionsDb } from '@/modules/database/index.js';

/**
 * Claude sessions the server started only as a vehicle for something else (the
 * login REPL behind Settings → Claude → Login) and that must never become a
 * chat or a project.
 *
 * Without this, the login REPL's transcript is indexed like any other session:
 * its cwd (the server's launch folder, typically the home directory) turns into
 * a sidebar project, and an archived one is even un-archived. The shell
 * launches such a REPL with a known `--session-id`, excludes that id here so
 * the Claude synchronizer skips it, and discards the transcript once the PTY
 * exits.
 *
 * State is in memory: if the server dies while a login REPL is alive, the
 * transcript is left behind and indexed by the next scan.
 *
 * Exported for the providers tests, which point it at a temporary projects
 * folder; production code uses `ephemeralSessionsService` below.
 */
export function createEphemeralSessionsService(
  claudeProjectsRoot: string = path.join(os.homedir(), '.claude', 'projects'),
) {
  const excludedIds = new Set<string>();

  // Removes `<id>.jsonl` and the `<id>/` sidecar folder (subagents, tool
  // results) from whichever project folder holds them. The uuid is unique, so
  // scanning every folder avoids depending on how Claude encodes the cwd.
  async function removeTranscripts(providerSessionId: string): Promise<void> {
    let projectFolders: string[];
    try {
      projectFolders = await readdir(claudeProjectsRoot);
    } catch {
      return;
    }

    for (const folderName of projectFolders) {
      const folderPath = path.join(claudeProjectsRoot, folderName);
      let removed = false;
      try {
        await unlink(path.join(folderPath, `${providerSessionId}.jsonl`));
        removed = true;
      } catch {
        // Not in this folder.
      }
      await rm(path.join(folderPath, providerSessionId), { recursive: true, force: true }).catch(() => undefined);

      if (removed) {
        // A folder created only for this transcript would linger empty;
        // `rmdir` refuses a folder that still holds anything else.
        await rmdir(folderPath).catch(() => undefined);
      }
    }
  }

  return {
    /** Keeps the Claude synchronizer from indexing this provider session id. */
    exclude(providerSessionId: string): void {
      excludedIds.add(providerSessionId);
    },

    /** Whether the Claude synchronizer must skip a transcript with this session id. */
    isExcluded(providerSessionId: string): boolean {
      return excludedIds.has(providerSessionId);
    },

    /**
     * Deletes the session's transcript files and, as a safety net, any session
     * row that slipped in, then forgets the id. The project row is left alone:
     * it may have existed before this session.
     */
    async discard(providerSessionId: string): Promise<void> {
      try {
        await removeTranscripts(providerSessionId);
        sessionsDb.deleteSessionByProviderSessionId(providerSessionId, 'claude');
      } catch (error) {
        console.warn(`[WARN] Could not discard ephemeral Claude session ${providerSessionId}:`, error);
      } finally {
        excludedIds.delete(providerSessionId);
      }
    },
  };
}

/**
 * Process-wide instance. Used by the Claude session synchronizer (skips
 * excluded ids) and, through the providers barrel, by the server entrypoint,
 * which injects it into the shell websocket so the Claude login REPL is never
 * indexed and its transcript is removed when the PTY exits.
 */
export const ephemeralSessionsService = createEphemeralSessionsService();
