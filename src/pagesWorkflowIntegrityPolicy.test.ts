import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const deployWorkflow = readFileSync('.github/workflows/deploy-pages.yml', 'utf8');

describe('GitHub Pages workflow integrity policy', () => {
  it('pins every third-party action to an immutable full commit SHA', () => {
    const actionRefs = [...deployWorkflow.matchAll(/^\s*(?:-\s*)?uses:\s*([^\s#]+)(?:\s+#.*)?$/gm)].map(
      (match) => match[1]
    );

    expect(actionRefs.length).toBeGreaterThan(0);
    for (const actionRef of actionRefs) {
      expect(actionRef).toMatch(/^[^@\s]+@[0-9a-f]{40}$/);
    }
  });

  it('installs dependencies from the committed lockfile before building Pages', () => {
    expect(deployWorkflow).toContain('run: npm ci');
    expect(deployWorkflow).not.toContain('run: npm install\n');
    expect(deployWorkflow.indexOf('run: npm ci')).toBeLessThan(
      deployWorkflow.indexOf('run: npm run build')
    );
  });
});
