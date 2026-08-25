import { expect, describe, it } from 'vitest';

const immutableRef = /^[^@\s]+@[0-9a-f]{40}$/;

const stripQuoted = (value: string) => {
  const trimmed = value.trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
};

const splitTopLevel = (body: string) => {
  const entries: string[] = [];
  let start = 0;
  let quote: '"' | "'" | null = null;
  let curly = 0;
  let square = 0;
  for (let index = 0; index < body.length; index += 1) {
    const char = body[index];
    if (quote) {
      if (char === quote && (quote === "'" || body[index - 1] !== '\\')) quote = null;
      continue;
    }
    if (char === '"' || char === "'") { quote = char; continue; }
    if (char === '{') curly += 1;
    else if (char === '}') curly -= 1;
    else if (char === '[') square += 1;
    else if (char === ']') square -= 1;
    else if (char === ',' && curly === 0 && square === 0) { entries.push(body.slice(start, index)); start = index + 1; }
  }
  entries.push(body.slice(start));
  return entries;
};

const extractInlineJobRefs = (workflow: string) => {
  const jobs = workflow.match(/(?:^|\n)\s*["']?jobs["']?\s*:\s*\{([\s\S]*)\}\s*$/);
  if (!jobs) return [];
  const refs: string[] = [];
  for (const jobEntry of splitTopLevel(jobs[1])) {
    const job = jobEntry.match(/^\s*(?:"(?:\\.|[^"\\])*"|'(?:''|[^'])*'|[A-Za-z_][A-Za-z0-9_-]*)\s*:\s*\{([\s\S]*)\}\s*$/);
    if (!job) continue;
    for (const entry of splitTopLevel(job[1])) {
      const mapping = entry.match(/^\s*["']?uses["']?\s*:\s*(.+?)\s*$/);
      if (mapping) refs.push(stripQuoted(mapping[1]));
    }
  }
  return refs;
};

const expectInlineJobsPinned = (workflow: string) => {
  for (const ref of extractInlineJobRefs(workflow)) expect(ref).toMatch(immutableRef);
};

describe('inline flow-style jobs immutable pinning', () => {
  it('enforces reusable-workflow refs inside an inline jobs mapping', () => {
    const sha = '0123456789abcdef0123456789abcdef01234567';
    const pinned = `jobs: { call: { uses: owner/repo/.github/workflows/build.yml@${sha} } }`;
    expect(extractInlineJobRefs(pinned)).toEqual([`owner/repo/.github/workflows/build.yml@${sha}`]);
    expectInlineJobsPinned(pinned);
    expect(() => expectInlineJobsPinned('jobs: { call: { uses: owner/repo/.github/workflows/build.yml@main } }')).toThrow();
  });

  it('does not classify nested uses-like job inputs as workflow references', () => {
    const sha = '0123456789abcdef0123456789abcdef01234567';
    const workflow = `jobs: { call: { uses: owner/repo/.github/workflows/build.yml@${sha}, with: { uses: actions/checkout@v4 } }, build: { runs-on: ubuntu-latest, steps: [{ run: echo ok }] } }`;
    expect(extractInlineJobRefs(workflow)).toEqual([`owner/repo/.github/workflows/build.yml@${sha}`]);
    expectInlineJobsPinned(workflow);
  });
});
