import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const workflow = readFileSync('.github/workflows/ci.yml', 'utf8');

describe('CI workflow action pinning', () => {
  it('pins checkout and setup-node to immutable commits', () => {
    expect(workflow).toContain(
      'uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262 # v4',
    );
    expect(workflow).toContain(
      'uses: actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020 # v4',
    );
    expect(workflow).not.toMatch(/uses:\s*actions\/(checkout|setup-node)@v\d+\b/);
  });
});
