import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const workflow = readFileSync('.github/workflows/codex-ci-fix-trigger.yml', 'utf8');

describe('Codex CI-fix workflow action pinning', () => {
  it('uses an immutable github-script commit instead of a floating major tag', () => {
    expect(workflow).toContain(
      'uses: actions/github-script@60a0d83039c74a4aee543508d2ffcb1c3799cdea # v7.0.1',
    );
    expect(workflow).not.toMatch(/uses:\s*actions\/github-script@v\d+\b/);
  });
});
