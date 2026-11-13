import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  AppError,
  assertFixedWorkdirPath,
  getFixedWorkdir,
  isFixedWorkdirPath,
  parseFixedWorkdirSetting,
} from '@/shared/utils.js';

const home = os.homedir();

const parseCases: Array<{ label: string; value: string | undefined; path: string | null; invalid: boolean }> = [
  { label: 'unset', value: undefined, path: null, invalid: false },
  { label: 'empty', value: '', path: null, invalid: false },
  { label: 'whitespace only', value: '   ', path: null, invalid: false },
  { label: 'home itself', value: '~', path: home, invalid: false },
  { label: 'under home', value: '~/work', path: path.join(home, 'work'), invalid: false },
  { label: 'absolute with padding and trailing slash', value: ' /srv/work/ ', path: '/srv/work', invalid: false },
  { label: 'dot segments', value: '/srv/a/../work', path: '/srv/work', invalid: false },
  { label: 'relative', value: 'work', path: null, invalid: true },
  { label: 'tilde user form', value: '~bob/work', path: null, invalid: true },
];

for (const testCase of parseCases) {
  test(`parseFixedWorkdirSetting: ${testCase.label}`, () => {
    const setting = parseFixedWorkdirSetting({ CLOUDCLI_FIXED_WORKDIR: testCase.value });
    assert.equal(setting.path, testCase.path);
    assert.equal(setting.invalidValue, testCase.invalid ? testCase.value?.trim() : null);
  });
}

test('getFixedWorkdir warns once per invalid value and locks nothing', () => {
  const warnings: string[] = [];
  const originalWarn = console.warn;
  console.warn = (message: string) => warnings.push(message);
  try {
    assert.equal(getFixedWorkdir({ CLOUDCLI_FIXED_WORKDIR: 'relative-once' }), null);
    assert.equal(getFixedWorkdir({ CLOUDCLI_FIXED_WORKDIR: 'relative-once' }), null);
  } finally {
    console.warn = originalWarn;
  }
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /Ignoring CLOUDCLI_FIXED_WORKDIR="relative-once"/);
});

test('isFixedWorkdirPath allows everything without a lock', async () => {
  assert.equal(await isFixedWorkdirPath('/anywhere', null), true);
});

test('isFixedWorkdirPath accepts only the exact folder, through symlinks, not its subfolders', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fixed-workdir-'));
  try {
    const fixed = path.join(root, 'work');
    fs.mkdirSync(path.join(fixed, 'sub'), { recursive: true });
    fs.symlinkSync(fixed, path.join(root, 'link'));

    assert.equal(await isFixedWorkdirPath(fixed, fixed), true);
    assert.equal(await isFixedWorkdirPath(`${fixed}/`, fixed), true);
    assert.equal(await isFixedWorkdirPath(path.join(root, 'link'), fixed), true);
    assert.equal(await isFixedWorkdirPath(path.join(fixed, 'sub'), fixed), false);
    assert.equal(await isFixedWorkdirPath(root, fixed), false);
    assert.equal(await isFixedWorkdirPath(path.join(root, 'missing'), fixed), false);
    assert.equal(await isFixedWorkdirPath('', fixed), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('assertFixedWorkdirPath throws a 403 FIXED_WORKDIR error outside the folder', async () => {
  const previous = process.env.CLOUDCLI_FIXED_WORKDIR;
  process.env.CLOUDCLI_FIXED_WORKDIR = '/srv/fixed-workdir-test';
  try {
    await assertFixedWorkdirPath('/srv/fixed-workdir-test');
    await assert.rejects(
      assertFixedWorkdirPath('/srv/elsewhere', 'Projects can only be created'),
      (error: unknown) =>
        error instanceof AppError
        && error.statusCode === 403
        && error.code === 'FIXED_WORKDIR'
        && /Projects can only be created in \/srv\/fixed-workdir-test/.test(error.message),
    );
  } finally {
    if (previous === undefined) delete process.env.CLOUDCLI_FIXED_WORKDIR;
    else process.env.CLOUDCLI_FIXED_WORKDIR = previous;
  }
});
