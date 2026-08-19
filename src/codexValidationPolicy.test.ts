import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const validationContract = readFileSync('.github/codex/validate.md', 'utf8');
const implementationPrompt = readFileSync('.github/codex/implement.md', 'utf8');
const implementationContract = readFileSync('.github/codex/implementation-request.schema.md', 'utf8');

describe('Codex validation policy', () => {
  it('keeps the repository-approved required command set explicit', () => {
    expect(validationContract).toContain('npm ci');
    expect(validationContract).toContain('npm test -- --run');
    expect(validationContract).toContain('npm run build');
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
