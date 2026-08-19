import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const validationContract = readFileSync('.github/codex/validate.md', 'utf8');
const implementationPrompt = readFileSync('.github/codex/implement.md', 'utf8');
const implementationContract = readFileSync('.github/codex/implementation-request.schema.md', 'utf8');

const requiredCommandsMatch = validationContract.match(
  /## Required commands\s+```bash\n([\s\S]*?)\n```/
);
const requiredCommands = requiredCommandsMatch?.[1]
  .split('\n')
  .map((command) => command.trim())
  .filter(Boolean);

describe('Codex validation policy', () => {
  it('keeps the repository-approved required command set exact and ordered', () => {
    expect(requiredCommands).toEqual(['npm ci', 'npm test -- --run', 'npm run build']);
  });

  it('forbids false success when required validation was skipped or unavailable', () => {
    expect(implementationPrompt).toContain('Run exactly the commands defined in `.github/codex/validate.md`.');
    expect(implementationPrompt).toContain('Do not claim success for a command that was skipped or unavailable.');
    expect(validationContract).toContain('Do not claim later commands passed if they were not run.');
    expect(validationContract).toContain('every required command and result');
  });

  it('ties reported validation evidence to the exact implementation revision', () => {
    expect(validationContract).toContain('full head SHA');
    expect(validationContract).toContain('A green result for an older SHA is never valid evidence for a newer revision.');
    expect(implementationContract).toContain('validation commands and results');
  });
});
