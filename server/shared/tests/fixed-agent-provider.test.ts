import assert from 'node:assert/strict';
import test from 'node:test';

import type { LLMProvider } from '@/shared/types.js';
import { getFixedAgentProvider, parseFixedAgentSetting } from '@/shared/utils.js';

type Case = {
  label: string;
  environment: NodeJS.ProcessEnv;
  /** The agent the UI is locked to, or null when users keep choosing it. */
  expected: LLMProvider | null;
  warns: boolean;
};

const cases: Case[] = [
  { label: 'unset', environment: {}, expected: null, warns: false },
  { label: 'empty', environment: { CLOUDCLI_FIXED_AGENT: '' }, expected: null, warns: false },
  { label: 'whitespace only', environment: { CLOUDCLI_FIXED_AGENT: '   ' }, expected: null, warns: false },
  { label: 'claude', environment: { CLOUDCLI_FIXED_AGENT: 'claude' }, expected: 'claude', warns: false },
  { label: 'codex', environment: { CLOUDCLI_FIXED_AGENT: 'codex' }, expected: 'codex', warns: false },
  { label: 'cursor', environment: { CLOUDCLI_FIXED_AGENT: 'cursor' }, expected: 'cursor', warns: false },
  { label: 'opencode', environment: { CLOUDCLI_FIXED_AGENT: 'opencode' }, expected: 'opencode', warns: false },
  { label: 'mixed case with padding', environment: { CLOUDCLI_FIXED_AGENT: ' Codex ' }, expected: 'codex', warns: false },
  { label: 'unknown agent', environment: { CLOUDCLI_FIXED_AGENT: 'gemini' }, expected: null, warns: true },
  { label: 'typo', environment: { CLOUDCLI_FIXED_AGENT: 'codexx' }, expected: null, warns: true },
];

for (const testCase of cases) {
  test(`fixed agent: ${testCase.label}`, () => {
    const originalWarn = console.warn;
    const warnings: string[] = [];
    console.warn = (message?: unknown) => {
      warnings.push(String(message));
    };

    try {
      assert.equal(getFixedAgentProvider(testCase.environment), testCase.expected);
      assert.equal(warnings.length, testCase.warns ? 1 : 0);
      if (testCase.warns) {
        assert.match(warnings[0], /Ignoring CLOUDCLI_FIXED_AGENT/);
      }
    } finally {
      console.warn = originalWarn;
    }
  });

  // `cloudcli status` reads the same parse and prints its own verdict, so the
  // parse itself must stay silent and must name the value it rejected.
  test(`fixed agent parse: ${testCase.label}`, () => {
    const originalWarn = console.warn;
    let warned = false;
    console.warn = () => {
      warned = true;
    };

    try {
      const setting = parseFixedAgentSetting(testCase.environment);
      assert.equal(setting.provider, testCase.expected);
      assert.equal(setting.invalidValue, testCase.warns ? testCase.environment.CLOUDCLI_FIXED_AGENT?.trim() : null);
      assert.equal(warned, false);
    } finally {
      console.warn = originalWarn;
    }
  });
}
