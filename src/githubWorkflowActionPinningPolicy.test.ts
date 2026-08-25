import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const workflowsDir = '.github/workflows';
const workflowFiles = readdirSync(workflowsDir).filter((name) => name.endsWith('.yml') || name.endsWith('.yaml')).sort();

const stripYamlComment = (line: string) => {
  let quote: '"' | "'" | null = null;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (quote) { if (char === quote && line[index - 1] !== '\\') quote = null; continue; }
    if (char === '"' || char === "'") { quote = char; continue; }
    if (char === '#' && (index === 0 || /\s/.test(line[index - 1]))) return line.slice(0, index);
  }
  return line;
};
const unquote = (value: string) => {
  const trimmed = value.trim().replace(/[,}]\s*$/, '').trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) return trimmed.slice(1, -1);
  return trimmed;
};
const yamlDoubleQuotedToJson = (key: string) => key.replace(/\\x([0-9a-fA-F]{2})/g, (_m, hex: string) => `\\u00${hex}`).replace(/\\U([0-9a-fA-F]{8})/g, (_m, hex: string) => {
  const cp = Number.parseInt(hex, 16); if (!Number.isFinite(cp) || cp > 0x10ffff) return _m;
  if (cp <= 0xffff) return `\\u${cp.toString(16).padStart(4, '0')}`;
  const adjusted = cp - 0x10000; const high = 0xd800 + (adjusted >> 10); const low = 0xdc00 + (adjusted & 0x3ff);
  return `\\u${high.toString(16)}\\u${low.toString(16)}`;
});
const decodeYamlKey = (rawKey: string) => {
  const key = rawKey.trim();
  if (key.startsWith('"') && key.endsWith('"')) { try { return JSON.parse(yamlDoubleQuotedToJson(key)); } catch { return key.slice(1, -1); } }
  if (key.startsWith("'") && key.endsWith("'")) return key.slice(1, -1).replace(/''/g, "'");
  return key;
};
const blockScalarHeader = /^[|>](?:(?:[+-][1-9]?)|(?:[1-9][+-]?))?\s*$/;
const flowStructure = (line: string) => {
  let quote: '"' | "'" | null = null; let square = 0; let curly = 0;
  for (let index = 0; index < line.length; index += 1) { const char = line[index];
    if (quote) { if (char === quote && (quote === "'" || line[index - 1] !== '\\')) quote = null; continue; }
    if (char === '"' || char === "'") { quote = char; continue; }
    if (char === '[') square += 1; else if (char === ']') square -= 1; else if (char === '{') curly += 1; else if (char === '}') curly -= 1;
  }
  return { square, curly };
};

const extractActionRefs = (workflow: string) => {
  const refs: string[] = []; const lines = workflow.split('\n'); const scalarAnchors = new Map<string, string>(); let ignoredBlockIndent: number | null = null; let flowStepsDepth = 0;
  const resolveYamlKey = (rawKey: string) => { const decoded = decodeYamlKey(rawKey); return decoded.startsWith('*') ? scalarAnchors.get(decoded.slice(1)) ?? decoded : decoded; };
  for (let index = 0; index < lines.length; index += 1) {
    const rawLine = lines[index]; const indent = rawLine.match(/^\s*/)?.[0].length ?? 0; const withoutComment = stripYamlComment(rawLine); const trimmed = withoutComment.trim();
    const flowStarts = withoutComment.matchAll(/(?=(?:^|[{,])\s*((?:"(?:\\.|[^"\\])*"|'(?:''|[^'])*'|[A-Za-z_][A-Za-z0-9_-]*))\s*:\s*\[)/g);
    const startsFlowSteps = Array.from(flowStarts).some((match) => resolveYamlKey(match[1]) === 'steps'); if (startsFlowSteps && flowStepsDepth === 0) flowStepsDepth = 1;
    if (ignoredBlockIndent !== null) { if (!trimmed || indent > ignoredBlockIndent) continue; ignoredBlockIndent = null; }
    if (!trimmed) continue;
    const scalarAnchor = withoutComment.match(/:\s*&([A-Za-z0-9_-]+)\s+("(?:\\.|[^"\\])*"|'(?:''|[^'])*'|[A-Za-z0-9_-]+)\s*$/); if (scalarAnchor) scalarAnchors.set(scalarAnchor[1], unquote(scalarAnchor[2]));
    const explicitKey = withoutComment.match(/^\s*(?:-\s*)?\?\s*((?:"(?:\\.|[^"\\])*"|'(?:''|[^'])*'|\*[A-Za-z0-9_-]+|[A-Za-z0-9_-]+))\s*$/);
    if (explicitKey && resolveYamlKey(explicitKey[1]) === 'uses') {
      for (let child = index + 1; child < lines.length; child += 1) { const childRaw = lines[child]; const explicitValue = stripYamlComment(childRaw).match(/^\s*:\s*(.*)$/); if (!explicitValue) { if (stripYamlComment(childRaw).trim()) break; continue; }
        const value = explicitValue[1].trim(); if (value) { refs.push(unquote(value)); index = child; break; }
        const valueIndent = childRaw.match(/^\s*/)?.[0].length ?? 0; for (let vc = child + 1; vc < lines.length; vc += 1) { const vRaw = lines[vc]; const vTrim = stripYamlComment(vRaw).trim(); const vIndent = vRaw.match(/^\s*/)?.[0].length ?? 0; if (!vTrim) continue; if (vIndent <= valueIndent) break; refs.push(unquote(vTrim)); index = vc; break; } break;
      } continue;
    }
    const canonical = withoutComment.match(/^\s*(?:-\s*)?((?:"(?:\\.|[^"\\])*"|'(?:''|[^'])*'|\*[A-Za-z0-9_-]+|[A-Za-z0-9_-]+))\s*:\s*(.*)$/);
    if (canonical && resolveYamlKey(canonical[1]) === 'uses') {
      const value = canonical[2].trim();
      if (blockScalarHeader.test(value)) { const folded: string[] = []; for (let child = index + 1; child < lines.length; child += 1) { const cRaw = lines[child]; const cTrim = stripYamlComment(cRaw).trim(); const cIndent = cRaw.match(/^\s*/)?.[0].length ?? 0; if (cTrim && cIndent <= indent) break; if (cTrim) folded.push(cTrim); index = child; } if (folded.length) refs.push(unquote(folded.join(' ')));
      } else if (value) refs.push(unquote(value)); else { for (let child = index + 1; child < lines.length; child += 1) { const cRaw = lines[child]; const cTrim = stripYamlComment(cRaw).trim(); const cIndent = cRaw.match(/^\s*/)?.[0].length ?? 0; if (!cTrim) continue; if (cIndent <= indent) break; refs.push(unquote(cTrim)); index = child; break; } }
      continue;
    }
    if (/:\s*[|>](?:(?:[+-][1-9]?)|(?:[1-9][+-]?))?\s*$/.test(withoutComment)) { ignoredBlockIndent = indent; continue; }
    if (/^\s*-?\s*["']?run["']?\s*:/.test(withoutComment)) continue;
    const flowContext = flowStepsDepth > 0 || /^\s*-\s*\{/.test(withoutComment);
    if (flowContext) {
      const topLevel = withoutComment.replace(/\b(?:with|env|metadata)\s*:\s*\{[^{}]*\}/g, '');
      const flowEntryPattern = /(?=(?:^|[{,])\s*((?:"(?:\\.|[^"\\])*"|'(?:''|[^'])*'|\*[A-Za-z0-9_-]+|[A-Za-z_][A-Za-z0-9_-]*))\s*:\s*("[^"]+"|'[^']+'|[^,}\s]+))/g;
      for (const entry of topLevel.matchAll(flowEntryPattern)) if (resolveYamlKey(entry[1]) === 'uses') refs.push(unquote(entry[2]));
      const multiline = topLevel.match(/(?:^|[{,])\s*((?:"(?:\\.|[^"\\])*"|'(?:''|[^'])*'|\*[A-Za-z0-9_-]+|[A-Za-z_][A-Za-z0-9_-]*))\s*:\s*$/);
      if (multiline && resolveYamlKey(multiline[1]) === 'uses') for (let child = index + 1; child < lines.length; child += 1) { const v = stripYamlComment(lines[child]).trim(); if (!v) continue; refs.push(unquote(v.replace(/[}\],]+\s*$/, ''))); index = child; break; }
    }
    if (flowStepsDepth > 0) { const structure = flowStructure(withoutComment); flowStepsDepth += structure.square; if (startsFlowSteps) flowStepsDepth -= 1; if (flowStepsDepth < 0) flowStepsDepth = 0; }
  }
  return refs;
};
const expectImmutableExternalActions = (workflow: string, source: string) => { for (const ref of extractActionRefs(workflow)) { if (ref.startsWith('./')) continue; expect(ref, `${source}: ${ref}`).toMatch(/^[^@\s]+@[0-9a-f]{40}$/); } };

describe('GitHub workflow action pinning policy', () => {
  it('pins every external action in every workflow to an immutable full commit SHA', () => { expect(workflowFiles.length).toBeGreaterThan(0); for (const file of workflowFiles) expectImmutableExternalActions(readFileSync(join(workflowsDir, file), 'utf8'), file); });
  it('accepts both valid block-scalar indicator orders while enforcing immutable refs', () => { const sha='0123456789abcdef0123456789abcdef01234567'; for (const header of ['>2+','>+2','|2-','|-2']) { expectImmutableExternalActions(`uses: ${header}\n  actions/checkout@${sha}`, 'block.yml'); expect(() => expectImmutableExternalActions(`uses: ${header}\n  actions/checkout@v4`, 'block.yml')).toThrow(); } });
  it('ignores uses-like flow keys in unrelated mappings but enforces actual flow steps', () => { const sha='0123456789abcdef0123456789abcdef01234567'; const safe=[`env: { uses: actions/checkout@v4 }`,`with: { uses: actions/cache@v4 }`,`metadata: { uses: actions/setup-node@v4 }`,`steps: [{uses: actions/checkout@${sha}}]`].join('\n'); expect(extractActionRefs(safe)).toEqual([`actions/checkout@${sha}`]); expectImmutableExternalActions(safe,'flow.yml'); expect(() => expectImmutableExternalActions('steps: [{uses: actions/checkout@v4}]','flow.yml')).toThrow(); });
  it('preserves structural flow-step context across quoted brackets and nested inputs', () => { const sha='0123456789abcdef0123456789abcdef01234567'; const pinned=[`steps: [`,`  { run: "echo ]" },`,`  { uses: actions/checkout@${sha}, with: { uses: actions/cache@v4 } },`,`  { uses: actions/setup-node@${sha} }`,`]`].join('\n'); expect(extractActionRefs(pinned)).toEqual([`actions/checkout@${sha}`,`actions/setup-node@${sha}`]); expectImmutableExternalActions(pinned,'multiline-flow.yml'); const mutable=['steps: [','  { run: "echo ]" },','  { uses: actions/checkout@v4 },',']'].join('\n'); expect(() => expectImmutableExternalActions(mutable,'multiline-flow.yml')).toThrow(); });
  it('recognizes quoted steps keys before entering multiline flow-step context', () => { const sha='0123456789abcdef0123456789abcdef01234567'; const pinned=['"steps": [',`  { "uses": actions/checkout@${sha} },`,']'].join('\n'); expect(extractActionRefs(pinned)).toEqual([`actions/checkout@${sha}`]); expectImmutableExternalActions(pinned,'quoted-steps.yml'); const mutable=['"steps": [','  { "uses": actions/checkout@v4 },',']'].join('\n'); expect(() => expectImmutableExternalActions(mutable,'quoted-steps.yml')).toThrow(); });
  it('recognizes inline flow-style job steps keys', () => { const sha='0123456789abcdef0123456789abcdef01234567'; const pinned=`demo: { runs-on: ubuntu-latest, steps: [{ uses: actions/checkout@${sha} }] }`; expect(extractActionRefs(pinned)).toEqual([`actions/checkout@${sha}`]); expectImmutableExternalActions(pinned,'inline-job.yml'); const mutable='demo: { runs-on: ubuntu-latest, steps: [{ uses: actions/checkout@v4 }] }'; expect(() => expectImmutableExternalActions(mutable,'inline-job.yml')).toThrow(); });
});
