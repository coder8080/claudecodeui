import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { closeConnection, initializeDatabase, projectsDb, sessionsDb } from '@/modules/database/index.js';
import { ClaudeSessionSynchronizer } from '@/modules/providers/list/claude/claude-session-synchronizer.provider.js';
import {
  createEphemeralSessionsService,
  ephemeralSessionsService,
} from '@/modules/providers/services/ephemeral-sessions.service.js';

const LOGIN_ID = '0b5a1f0e-3c3e-4d39-9a7e-6f7c2b1d9e10';

// `discard` also drops a stray session row, so every test gets its own database.
async function withTemporaryDatabase(run: (directory: string) => Promise<void>): Promise<void> {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ephemeral-db-'));
  const previousDatabasePath = process.env.DATABASE_PATH;
  closeConnection();
  process.env.DATABASE_PATH = path.join(directory, 'auth.db');
  await initializeDatabase();
  try {
    await run(directory);
  } finally {
    closeConnection();
    if (previousDatabasePath === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = previousDatabasePath;
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

test('discard removes the transcript, its sidecar folder and a folder left empty', () => withTemporaryDatabase(async (root) => {
  {
    const loginOnlyFolder = path.join(root, '-home-user');
    const sharedFolder = path.join(root, '-home-user-work');
    fs.mkdirSync(path.join(loginOnlyFolder, LOGIN_ID, 'subagents'), { recursive: true });
    fs.writeFileSync(path.join(loginOnlyFolder, `${LOGIN_ID}.jsonl`), '{}\n');
    fs.mkdirSync(sharedFolder);
    fs.writeFileSync(path.join(sharedFolder, 'other-session.jsonl'), '{}\n');

    const service = createEphemeralSessionsService(root);
    service.exclude(LOGIN_ID);
    assert.equal(service.isExcluded(LOGIN_ID), true);

    await service.discard(LOGIN_ID);

    assert.equal(fs.existsSync(loginOnlyFolder), false);
    assert.equal(fs.existsSync(path.join(sharedFolder, 'other-session.jsonl')), true);
    assert.equal(service.isExcluded(LOGIN_ID), false);
  }
}));

test('discard keeps a project folder that still holds other sessions', () => withTemporaryDatabase(async (root) => {
  {
    const folder = path.join(root, '-home-user');
    fs.mkdirSync(folder);
    fs.writeFileSync(path.join(folder, `${LOGIN_ID}.jsonl`), '{}\n');
    fs.writeFileSync(path.join(folder, 'real-session.jsonl'), '{}\n');

    await createEphemeralSessionsService(root).discard(LOGIN_ID);

    assert.deepEqual(fs.readdirSync(folder), ['real-session.jsonl']);
  }
}));

test('the Claude synchronizer does not index an excluded session, nor create its project', () => withTemporaryDatabase(async (directory) => {
  const writeTranscript = (sessionId: string, cwd: string) => {
    const transcriptPath = path.join(directory, `${sessionId}.jsonl`);
    fs.writeFileSync(
      transcriptPath,
      `${JSON.stringify({ type: 'user', sessionId, cwd, message: { role: 'user', content: '/login' } })}\n`,
    );
    return transcriptPath;
  };
  const synchronizer = new ClaudeSessionSynchronizer();

  // The process-wide instance is the one the synchronizer consults.
  ephemeralSessionsService.exclude(LOGIN_ID);
  assert.equal(await synchronizer.synchronizeFile(writeTranscript(LOGIN_ID, '/home/login-only')), null);
  assert.equal(sessionsDb.getSessionByProviderSessionId(LOGIN_ID), null);
  assert.equal(sessionsDb.getSessionById(LOGIN_ID), null);
  assert.equal(projectsDb.getProjectPath('/home/login-only'), null);

  // Any other transcript is indexed as before.
  const otherId = '7d3f9a2e-5b1c-4e8f-a6d0-2c9b8e7f1a34';
  assert.ok(await synchronizer.synchronizeFile(writeTranscript(otherId, '/home/real-project')));
  assert.ok(projectsDb.getProjectPath('/home/real-project'));
}));
