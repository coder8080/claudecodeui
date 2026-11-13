import { loadHealthSettings } from '@/shared/healthSettings';

/**
 * The single folder an operator pinned new sessions to with
 * `CLOUDCLI_FIXED_WORKDIR`, as published on `/health` (the same path the server
 * registered as a project). The server enforces the lock; the UI only follows
 * it: it hides project creation and worktrees, offers new sessions only in that
 * project, and selects it when nothing else is.
 */

let fixedWorkdir: string | null = null;
let fixedWorkdirRequest: Promise<void> | null = null;
const fixedWorkdirListeners = new Set<() => void>();

/**
 * Reads the lock from `/health` once per page load; later calls share the
 * request. Fails open: without an answer the UI shows project creation, and the
 * server still refuses anything outside the folder.
 */
export function loadFixedWorkdir(): Promise<void> {
  fixedWorkdirRequest ??= (async () => {
    try {
      const data = await loadHealthSettings();
      if (typeof data.fixedWorkdir === 'string' && data.fixedWorkdir) {
        fixedWorkdir = data.fixedWorkdir;
      }
    } catch (error) {
      console.warn('[fixedWorkdir] Could not read the working folder lock from /health.', error);
    }
    fixedWorkdirListeners.forEach((listener) => listener());
  })();
  return fixedWorkdirRequest;
}

/** The operator-fixed working folder, or null when users pick projects freely (or /health has not answered). */
export function getFixedWorkdir(): string | null {
  return fixedWorkdir;
}

export function subscribeToFixedWorkdir(listener: () => void): () => void {
  fixedWorkdirListeners.add(listener);
  return () => {
    fixedWorkdirListeners.delete(listener);
  };
}

/**
 * Whether new sessions may be started in a project at `projectPath`: always
 * without a lock, otherwise only in the fixed folder. Trailing separators are
 * ignored; the server compares resolved paths and has the final say.
 */
export function isNewSessionAllowedIn(projectPath: string | null | undefined, lockedFolder: string | null): boolean {
  if (!lockedFolder) return true;
  const trim = (value: string) => value.replace(/[\\/]+$/, '');
  return Boolean(projectPath) && trim(projectPath as string) === trim(lockedFolder);
}
