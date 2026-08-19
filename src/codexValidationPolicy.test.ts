import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const validationContract = readFileSync('.github/codex/validate.md', 'utf8');
const implementationPrompt = readFileSync('.github/codex/implement.md', 'utf8');
const implementationContract = readFileSync('.github/codex/implementation-request.schema.md', 'utf8');
const packageJson = JSON.parse(readFileSync('package.json', 'utf8')) as {
  scripts?: Record<string, string>;
};

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

  it('documents applicability without inventing unavailable repository checks', () => {
    expect(packageJson.scripts?.build).toContain('tsc -b');
    expect(packageJson.scripts?.lint).toBeUndefined();
    expect(packageJson.scripts?.format).toBeUndefined();
    expect(packageJson.scripts?.typecheck).toBeUndefined();
    expect(packageJson.scripts?.playwright).toBeUndefined();

    expect(validationContract).toContain('TypeScript type checking: it is required and is executed by `npm run build` through `tsc -b`');
    expect(validationContract).toContain('there is currently no repository format or format-check script');
    expect(validationContract).toContain('there is currently no repository lint script');
    expect(validationContract).toContain('no Playwright command is currently configured in `package.json`');
    expect(validationContract).toContain('no separate repository-required security or dependency audit command is currently configured');
  });

  it('does not allow a required-but-unconfigured check to be reported as complete', () => {
    expect(validationContract).toContain('If an issue explicitly requires a check that is not configured, report it as unavailable with the exact reason');
    expect(validationContract).toContain("do not claim the issue's validation is complete");
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
