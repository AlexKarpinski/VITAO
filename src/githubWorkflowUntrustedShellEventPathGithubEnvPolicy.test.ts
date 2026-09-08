import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const workflowsDir = '.github/workflows';
const workflowFiles = readdirSync(workflowsDir).filter((name) => /\.ya?ml$/.test(name)).sort();
const sensitiveEventField = /(?:comment\.body|issue\.body|pull_request\.body|review\.body|discussion\.body)/i;

const assertNoEventPathGithubEnvShellFlow = (workflow: string) => {
  const lines = workflow.split('\n');
  const taintedEnv = new Set<string>();
  const eventObjects = new Set<string>();
  const taintedValues = new Set<string>();

  for (const raw of lines) {
    const line = raw.trim();

    const eventRead = line.match(
      /\b(?:const|let|var)\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*(?:JSON\.parse\s*\(\s*)?(?:[A-Za-z_$][A-Za-z0-9_$]*\.)?readFileSync\s*\([^\n]*GITHUB_EVENT_PATH/i,
    );
    if (eventRead) eventObjects.add(eventRead[1]);

    const localAssignment = line.match(/\b(?:const|let|var)\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*([^;]+)/);
    if (localAssignment) {
      const [, name, value] = localAssignment;
      const referencesSensitiveEventField = [...eventObjects].some((eventObject) => {
        const escaped = eventObject.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        return new RegExp(`\\b${escaped}\\s*(?:\\.|\\[)`, 'i').test(value) && sensitiveEventField.test(value);
      });
      const referencesTaintedValue = [...taintedValues].some((tainted) => {
        const escaped = tainted.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        return new RegExp(`\\b${escaped}\\b`).test(value);
      });
      if (referencesSensitiveEventField || referencesTaintedValue) taintedValues.add(name);
    }

    const shellWrite = line.match(
      /(?:echo|printf)\s+["']?([A-Za-z_][A-Za-z0-9_]*)=.*GITHUB_EVENT_PATH.*(?:>>|>)\s*["']?\$?\{?GITHUB_ENV\}?/i,
    );
    if (shellWrite && sensitiveEventField.test(line)) taintedEnv.add(shellWrite[1]);

    const programmaticWrite = /(?:appendFileSync|writeFileSync)\s*\(/i.test(line) && /GITHUB_ENV/i.test(line);
    if (programmaticWrite) {
      const assignment = line.match(/\b([A-Za-z_][A-Za-z0-9_]*)=/);
      const directSensitiveValue = [...eventObjects].some((eventObject) => {
        const escaped = eventObject.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        return new RegExp(`\\b${escaped}\\s*(?:\\.|\\[)`, 'i').test(line) && sensitiveEventField.test(line);
      });
      const aliasedSensitiveValue = [...taintedValues].some((tainted) => {
        const escaped = tainted.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        return new RegExp(`(?:\\$\\{?${escaped}\\}?|\\b${escaped}\\b)`).test(line);
      });
      if (assignment && (directSensitiveValue || aliasedSensitiveValue)) taintedEnv.add(assignment[1]);
    }

    const run = line.match(/^(?:-\s*)?run\s*:\s*(.*)$/);
    if (!run) continue;
    for (const name of taintedEnv) {
      const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const ref = new RegExp(`(?:\\$${escaped}\\b|\\$\\{${escaped}(?:[:}])|%${escaped}%|\\$env:${escaped}\\b|env\\.${escaped}\\b)`, 'i');
      if (ref.test(run[1]) && /(?:bash\s+-c|sh\s+-c|eval|invoke-expression|call\s+%)/i.test(run[1])) {
        throw new Error(`tainted ${name} from GITHUB_EVENT_PATH reaches shell execution`);
      }
    }
  }
};

describe('GITHUB_EVENT_PATH to GITHUB_ENV shell boundary', () => {
  it('rejects event-body data persisted to GITHUB_ENV then executed', () => {
    const workflow = `steps:\n  - run: echo "CMD=$(jq -r '.comment.body' "$GITHUB_EVENT_PATH")" >> "$GITHUB_ENV"\n  - run: bash -c "$CMD"`;
    expect(() => assertNoEventPathGithubEnvShellFlow(workflow)).toThrow();
  });

  it('rejects event-body data written programmatically to GITHUB_ENV then executed', () => {
    const workflow = `steps:\n  - run: |\n      const fs = require('node:fs');\n      const event = JSON.parse(fs.readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));\n      const command = event.comment.body;\n      fs.appendFileSync(process.env.GITHUB_ENV, \`CMD=\${command}\\n\`);\n  - run: bash -c "$CMD"`;
    expect(() => assertNoEventPathGithubEnvShellFlow(workflow)).toThrow();
  });

  it('allows programmatic constant writes to GITHUB_ENV', () => {
    const workflow = `steps:\n  - run: |\n      const fs = require('node:fs');\n      fs.appendFileSync(process.env.GITHUB_ENV, 'CMD=echo-safe\\n');\n  - run: bash -c "$CMD"`;
    expect(() => assertNoEventPathGithubEnvShellFlow(workflow)).not.toThrow();
  });

  it('allows constant persisted values', () => {
    const workflow = `steps:\n  - run: echo "CMD=echo-safe" >> "$GITHUB_ENV"\n  - run: bash -c "$CMD"`;
    expect(() => assertNoEventPathGithubEnvShellFlow(workflow)).not.toThrow();
  });

  it('enforces every checked-in workflow', () => {
    for (const file of workflowFiles) assertNoEventPathGithubEnvShellFlow(readFileSync(join(workflowsDir, file), 'utf8'));
  });
});
