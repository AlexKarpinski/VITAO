import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const workflowsDir = '.github/workflows';

const workflowFiles = readdirSync(workflowsDir)
  .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
  .sort();

describe('GitHub workflow action pinning policy', () => {
  it('pins every external action in every workflow to an immutable full commit SHA', () => {
    expect(workflowFiles.length).toBeGreaterThan(0);

    for (const workflowFile of workflowFiles) {
      const workflow = readFileSync(join(workflowsDir, workflowFile), 'utf8');
      const actionRefs = [...workflow.matchAll(/^\s*(?:-\s*)?uses:\s*([^\s#]+)(?:\s+#.*)?$/gm)].map(
        (match) => match[1]
      );

      for (const actionRef of actionRefs) {
        if (actionRef.startsWith('./')) continue;
        expect(actionRef, `${workflowFile}: ${actionRef}`).toMatch(/^[^@\s]+@[0-9a-f]{40}$/);
      }
    }
  });
});
