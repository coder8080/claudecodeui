import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { closeConnection, initializeDatabase, sessionsDb } from '@/modules/database/index.js';
import { handleChatConnection } from '@/modules/websocket/services/chat-websocket.service.js';
import { chatRunRegistry } from '@/modules/websocket/services/chat-run-registry.service.js';
import { connectedClients } from '@/modules/websocket/services/websocket-state.service.js';

const SESSION_ID = 'fixed-workdir-session';

function createFakeSocket() {
  const socket = new EventEmitter() as EventEmitter & {
    readyState: number;
    frames: Array<Record<string, unknown>>;
    send: (data: string) => void;
  };
  socket.readyState = 1;
  socket.frames = [];
  socket.send = (data: string) => socket.frames.push(JSON.parse(data) as Record<string, unknown>);
  return socket;
}

type Folders = { fixedRoot: string; oldProject: string; elsewhere: string };

/**
 * Runs a chat gateway whose one session lives in `oldProject`, a folder outside
 * the CLOUDCLI_FIXED_WORKDIR lock (as an existing pre-lock project would).
 */
async function withGateway(
  lock: (folders: Folders) => string | null,
  runTest: (context: {
    socket: ReturnType<typeof createFakeSocket>;
    runs: Array<Record<string, unknown>>;
    folders: Folders;
  }) => Promise<void>,
): Promise<void> {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const previousLock = process.env.CLOUDCLI_FIXED_WORKDIR;
  const tempDirectory = await mkdtemp(path.join(os.tmpdir(), 'chat-fixed-workdir-'));
  const folders: Folders = {
    fixedRoot: path.join(tempDirectory, 'work'),
    oldProject: path.join(tempDirectory, 'old-project'),
    elsewhere: path.join(tempDirectory, 'elsewhere'),
  };
  await Promise.all(Object.values(folders).map((folder) => mkdir(folder, { recursive: true })));
  await mkdir(path.join(folders.fixedRoot, 'sub'), { recursive: true });

  closeConnection();
  process.env.DATABASE_PATH = path.join(tempDirectory, 'auth.db');
  const lockValue = lock(folders);
  if (lockValue === null) delete process.env.CLOUDCLI_FIXED_WORKDIR;
  else process.env.CLOUDCLI_FIXED_WORKDIR = lockValue;
  await initializeDatabase();

  const runs: Array<Record<string, unknown>> = [];
  const socket = createFakeSocket();
  try {
    const now = new Date().toISOString();
    sessionsDb.createSession(SESSION_ID, 'claude', folders.oldProject, 'Old session', now, now, null);
    handleChatConnection(
      socket as never,
      { user: { id: 1 } } as never,
      {
        runtime: {
          hasRuntime: () => true,
          run: async (_provider: string, _command: string, options: Record<string, unknown>) => {
            runs.push(options);
          },
        } as never,
      },
    );
    await runTest({ socket, runs, folders });
  } finally {
    connectedClients.clear();
    chatRunRegistry.clearAll();
    closeConnection();
    if (previousDatabasePath === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = previousDatabasePath;
    if (previousLock === undefined) delete process.env.CLOUDCLI_FIXED_WORKDIR;
    else process.env.CLOUDCLI_FIXED_WORKDIR = previousLock;
    await rm(tempDirectory, { recursive: true, force: true });
  }
}

async function send(socket: ReturnType<typeof createFakeSocket>, options: Record<string, unknown>) {
  socket.emit('message', JSON.stringify({ type: 'chat.send', sessionId: SESSION_ID, content: 'Hi', options }));
  // The guard awaits `realpath`; give the async handler time to settle.
  await new Promise((resolve) => { setTimeout(resolve, 50); });
}

const fixedWorkdirErrors = (socket: ReturnType<typeof createFakeSocket>) =>
  socket.frames.filter((frame) => frame.kind === 'protocol_error' && frame.code === 'FIXED_WORKDIR');

test('under CLOUDCLI_FIXED_WORKDIR a client cwd outside the folder is refused before the run starts', async () => {
  await withGateway(({ fixedRoot }) => fixedRoot, async ({ socket, runs, folders }) => {
    await send(socket, { cwd: folders.elsewhere });
    assert.equal(runs.length, 0);
    assert.equal(fixedWorkdirErrors(socket).length, 1);

    // Subfolders of the fixed folder do not count either.
    await send(socket, { cwd: path.join(folders.fixedRoot, 'sub') });
    assert.equal(runs.length, 0);
    assert.equal(fixedWorkdirErrors(socket).length, 2);
  });
});

test('under CLOUDCLI_FIXED_WORKDIR an old session keeps running in its own folder or the fixed one', async () => {
  await withGateway(({ fixedRoot }) => fixedRoot, async ({ socket, runs, folders }) => {
    // No cwd: the session's own (pre-lock) project.
    await send(socket, {});
    // The session's own folder, spelled with a trailing slash.
    await send(socket, { cwd: `${folders.oldProject}/` });
    // The fixed folder itself.
    await send(socket, { cwd: folders.fixedRoot });

    assert.equal(fixedWorkdirErrors(socket).length, 0);
    assert.deepEqual(
      runs.map((options) => options.cwd),
      [folders.oldProject, `${folders.oldProject}/`, folders.fixedRoot],
    );
  });
});

test('without CLOUDCLI_FIXED_WORKDIR any client cwd is passed through', async () => {
  await withGateway(() => null, async ({ socket, runs, folders }) => {
    await send(socket, { cwd: folders.elsewhere });
    assert.equal(fixedWorkdirErrors(socket).length, 0);
    assert.deepEqual(runs.map((options) => options.cwd), [folders.elsewhere]);
  });
});
