import assert from 'node:assert/strict';
import test from 'node:test';

import type { CliEnvironment, CliOutput } from '@/shared/types.js';

import { createCliService } from '../cli.service.js';

function createHarness() {
  const logMessages: string[] = [];
  const errorMessages: string[] = [];
  const environment: CliEnvironment = {};
  const output: CliOutput = {
    log: (message = '') => logMessages.push(message),
    error: (message = '') => errorMessages.push(message),
  };
  let serverStarts = 0;
  let sandboxArguments: string[] = [];
  let latestVersionRequests = 0;
  const service = createCliService({
    applicationRoot: '/application',
    defaultDatabasePath: '/home/user/.cloudcli/auth.db',
    homeDirectory: '/home/user',
    packageMetadata: {
      version: '1.2.3',
      homepage: 'https://cloudcli.example',
      bugsUrl: 'https://cloudcli.example/issues',
    },
    environment,
    fileSystem: {
      pathExists: () => false,
      getFileStats: () => ({ size: 0, modifiedAt: new Date(0) }),
    },
    output,
    sandboxService: {
      execute: async (argumentsList) => {
        sandboxArguments = argumentsList;
        return 7;
      },
    },
    getLatestPackageVersion: async () => {
      latestVersionRequests += 1;
      return '1.2.3';
    },
    updateGlobalPackage: () => undefined,
    startServer: async () => {
      serverStarts += 1;
    },
    startBrowserUseMcp: async () => undefined,
  });

  return {
    service,
    environment,
    logMessages,
    errorMessages,
    getServerStarts: () => serverStarts,
    getSandboxArguments: () => sandboxArguments,
    getLatestVersionRequests: () => latestVersionRequests,
  };
}

test('applies CLI options to the injected environment before starting the server', async () => {
  const harness = createHarness();

  const exitCode = await harness.service.run([
    '--port',
    '8080',
    '--database-path=/data/app.db',
  ]);

  assert.equal(exitCode, 0);
  assert.equal(harness.environment.SERVER_PORT, '8080');
  assert.equal(harness.environment.DATABASE_PATH, '/data/app.db');
  assert.equal(harness.getServerStarts(), 1);
});

test('passes only sandbox arguments to the injected sandbox service', async () => {
  const harness = createHarness();

  const exitCode = await harness.service.run(['sandbox', 'ls']);

  assert.equal(exitCode, 7);
  assert.deepEqual(harness.getSandboxArguments(), ['ls']);
});

test('returns a failure code for an unknown command without exiting the process', async () => {
  const harness = createHarness();

  const exitCode = await harness.service.run(['unknown']);

  assert.equal(exitCode, 1);
  assert.match(harness.errorMessages[0], /Unknown command: unknown/);
});

test('skips the start-up update check when CLOUDCLI_DISABLE_UPDATE_CHECK is set', async () => {
  const harness = createHarness();
  harness.environment.CLOUDCLI_DISABLE_UPDATE_CHECK = 'true';

  const exitCode = await harness.service.run(['start']);

  assert.equal(exitCode, 0);
  assert.equal(harness.getLatestVersionRequests(), 0);
  assert.equal(harness.getServerStarts(), 1);
});

test('checks for updates on start when CLOUDCLI_DISABLE_UPDATE_CHECK is unset', async () => {
  const harness = createHarness();

  const exitCode = await harness.service.run(['start']);

  assert.equal(exitCode, 0);
  assert.equal(harness.getLatestVersionRequests(), 1);
  assert.equal(harness.getServerStarts(), 1);
});

const fixedAgentStatusLine = async (value: string | undefined) => {
  const harness = createHarness();
  harness.environment.CLOUDCLI_FIXED_AGENT = value;

  const exitCode = await harness.service.run(['status']);

  assert.equal(exitCode, 0);
  const line = harness.logMessages.find((message) => message.includes('CLOUDCLI_FIXED_AGENT:'));
  assert.ok(line, 'status lists CLOUDCLI_FIXED_AGENT');
  // Strip terminal colours so the assertions read the text an operator sees.
  return line.replace(/\x1b\[[0-9;]*m/g, '');
};

test('status shows the agent CLOUDCLI_FIXED_AGENT locks the chat to', async () => {
  const line = await fixedAgentStatusLine(' Codex ');

  assert.match(line, /CLOUDCLI_FIXED_AGENT: codex$/);
});

test('status flags a mistyped CLOUDCLI_FIXED_AGENT as ignored instead of showing it as active', async () => {
  const line = await fixedAgentStatusLine('codexx');

  assert.match(line, /\[WARN\] "codexx" is not a supported agent/);
  assert.match(line, /expected claude, codex, cursor, opencode/);
  assert.match(line, /ignored, users choose the agent/);
});

test('status reports an unset CLOUDCLI_FIXED_AGENT as users choosing the agent', async () => {
  const line = await fixedAgentStatusLine(undefined);

  assert.match(line, /\(not set, users choose the agent\)/);
});

test('still checks for updates on an explicit update command when the flag is set', async () => {
  const harness = createHarness();
  harness.environment.CLOUDCLI_DISABLE_UPDATE_CHECK = 'true';

  const exitCode = await harness.service.run(['update']);

  assert.equal(exitCode, 0);
  assert.equal(harness.getLatestVersionRequests(), 1);
});
