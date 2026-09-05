import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const workflowsDir = '.github/workflows';
const workflowFiles = readdirSync(workflowsDir).filter((name) => name.endsWith('.yml') || name.endsWith('.yaml')).sort();

type FlowQuote = '"' | "'" | null;

const isEscapedQuote = (source: string, index: number) => {
  let backslashes = 0;
  for (let cursor = index - 1; cursor >= 0 && source[cursor] === '\\'; cursor -= 1) backslashes += 1;
  return backslashes % 2 === 1;
};
const stripYamlComment = (line: string) => {
  let quote: FlowQuote = null;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (quote) { if (char === quote && (quote === "'" || !isEscapedQuote(line, index))) quote = null; continue; }
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
const flowStructure = (line: string, initialQuote: FlowQuote = null) => {
  let quote: FlowQuote = initialQuote; let square = 0; let curly = 0;
  for (let index = 0; index < line.length; index += 1) { const char = line[index];
    if (quote) { if (char === quote && (quote === "'" || !isEscapedQuote(line, index))) quote = null; continue; }
    if (char === '"' || char === "'") { quote = char; continue; }
    if (char === '[') square += 1; else if (char === ']') square -= 1; else if (char === '{') curly += 1; else if (char === '}') curly -= 1;
  }
  return { square, curly, quote };
};
const sliceStructuralFlowSequence = (line: string, openingIndex: number) => {
  let quote: FlowQuote = null; let depth = 0;
  for (let index = openingIndex; index < line.length; index += 1) {
    const char = line[index];
    if (quote) { if (char === quote && (quote === "'" || !isEscapedQuote(line, index))) quote = null; continue; }
    if (char === '"' || char === "'") { quote = char; continue; }
    if (char === '[') depth += 1;
    if (char === ']') { depth -= 1; if (depth === 0) return line.slice(openingIndex, index + 1); }
  }
  return line.slice(openingIndex);
};
const splitTopLevelFlowEntries = (body: string) => {
  const entries: string[] = []; let start = 0; let quote: FlowQuote = null; let square = 0; let curly = 0;
  for (let index = 0; index < body.length; index += 1) {
    const char = body[index];
    if (quote) { if (char === quote && (quote === "'" || !isEscapedQuote(body, index))) quote = null; continue; }
    if (char === '"' || char === "'") { quote = char; continue; }
    if (char === '[') square += 1; else if (char === ']') square -= 1; else if (char === '{') curly += 1; else if (char === '}') curly -= 1;
    else if (char === ',' && square === 0 && curly === 0) { entries.push(body.slice(start, index)); start = index + 1; }
  }
  entries.push(body.slice(start));
  return entries;
};
const maskQuotedFlowScalarStructure = (source: string) => {
  const chars = [...source]; let quote: FlowQuote = null; let opening = -1;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (!quote) { if (char === '"' || char === "'") { quote = char; opening = index; } continue; }
    if (char !== quote || (quote === '"' && isEscapedQuote(source, index))) continue;
    let previous = opening - 1; while (previous >= 0 && /\s/.test(source[previous])) previous -= 1;
    if (previous >= 0 && source[previous] === ':') for (let cursor = opening + 1; cursor < index; cursor += 1) if (/[{},\[\]]/.test(chars[cursor])) chars[cursor] = ' ';
    quote = null; opening = -1;
  }
  return chars.join('');
};

const extractActionRefs = (workflow: string) => {
  const refs: string[] = []; const lines = workflow.split('\n'); const scalarAnchors = new Map<string, string>(); let ignoredBlockIndent: number | null = null; let flowStepsDepth = 0; let flowStepsQuote: FlowQuote = null; let jobsIndent: number | null = null; let jobIndent: number | null = null; let blockStepsIndent: number | null = null; let pendingBareStepIndent: number | null = null;
  const resolveYamlKey = (rawKey: string) => { const decoded = decodeYamlKey(rawKey); return decoded.startsWith('*') ? scalarAnchors.get(decoded.slice(1)) ?? decoded : decoded; };
  const collectFlowUses = (source: string) => {
    const topLevel = maskQuotedFlowScalarStructure(source).replace(/\b(?:with|env|metadata)\s*:\s*\{[^{}]*\}/g, '');
    const flowEntryPattern = /(?=(?:^|[\[{,])\s*((?:"(?:\\.|[^"\\])*"|'(?:''|[^'])*'|\*[A-Za-z0-9_-]+|[A-Za-z_][A-Za-z0-9_-]*))\s*:\s*("[^"]+"|'[^']+'|[^,}\]\s]+))/g;
    for (const entry of topLevel.matchAll(flowEntryPattern)) if (resolveYamlKey(entry[1]) === 'uses') refs.push(unquote(entry[2]));
  };
  const collectInlineJobs = (body: string) => {
    for (const jobEntry of splitTopLevelFlowEntries(body)) {
      const job = jobEntry.match(/^\s*(?:"(?:\\.|[^"\\])*"|'(?:''|[^'])*'|[A-Za-z_][A-Za-z0-9_-]*)\s*:\s*\{([\s\S]*)\}\s*$/);
      if (!job) continue;
      for (const entry of splitTopLevelFlowEntries(job[1])) {
        const mapping = entry.match(/^\s*((?:"(?:\\.|[^"\\])*"|'(?:''|[^'])*'|\*[A-Za-z0-9_-]+|[A-Za-z_][A-Za-z0-9_-]*))\s*:\s*(.+?)\s*$/);
        if (mapping && resolveYamlKey(mapping[1]) === 'uses') refs.push(unquote(mapping[2]));
        if (mapping && resolveYamlKey(mapping[1]) === 'steps') {
          const opening = entry.indexOf('[');
          if (opening >= 0) collectFlowUses(sliceStructuralFlowSequence(entry, opening));
        }
      }
    }
  };
  for (let index = 0; index < lines.length; index += 1) {
    const rawLine = lines[index]; const indent = rawLine.match(/^\s*/)?.[0].length ?? 0; const withoutComment = stripYamlComment(rawLine); const trimmed = withoutComment.trim();
    if (ignoredBlockIndent !== null) { if (!trimmed || indent > ignoredBlockIndent) continue; ignoredBlockIndent = null; }
    if (!trimmed) continue;
    const scalarAnchor = withoutComment.match(/:\s*&([A-Za-z0-9_-]+)\s+("(?:\\.|[^"\\])*"|'(?:''|[^'])*'|[A-Za-z0-9_-]+)\s*$/); if (scalarAnchor) scalarAnchors.set(scalarAnchor[1], unquote(scalarAnchor[2]));

    const inlineJobs = withoutComment.match(/^\s*((?:"(?:\\.|[^"\\])*"|'(?:''|[^'])*'|[A-Za-z_][A-Za-z0-9_-]*))\s*:\s*\{(.*)\}\s*$/);
    if (inlineJobs && resolveYamlKey(inlineJobs[1]) === 'jobs') { collectInlineJobs(inlineJobs[2]); continue; }
    const multilineJobs = withoutComment.match(/^\s*((?:"(?:\\.|[^"\\])*"|'(?:''|[^'])*'|[A-Za-z_][A-Za-z0-9_-]*))\s*:\s*\{\s*$/);
    if (multilineJobs && resolveYamlKey(multilineJobs[1]) === 'jobs') {
      const collected: string[] = []; let depth = 1; let quote: FlowQuote = null;
      for (let child = index + 1; child < lines.length; child += 1) {
        const childLine = stripYamlComment(lines[child]); const structure = flowStructure(childLine, quote); quote = structure.quote; depth += structure.curly;
        if (depth <= 0) { index = child; break; }
        collected.push(childLine.trim()); index = child;
      }
      collectInlineJobs(collected.join(' '));
      continue;
    }

    const flowStartMatches = Array.from(withoutComment.matchAll(/(?=(?:^|[{,])\s*((?:"(?:\\.|[^"\\])*"|'(?:''|[^'])*'|\*[A-Za-z0-9_-]+|[A-Za-z_][A-Za-z0-9_-]*))\s*:\s*(?:&[A-Za-z0-9_-]+\s+)*\[)/g));
    const flowStepsMatch = flowStartMatches.find((match) => resolveYamlKey(match[1]) === 'steps'); const startsFlowSteps = Boolean(flowStepsMatch); if (startsFlowSteps && flowStepsDepth === 0) { flowStepsDepth = 1; flowStepsQuote = null; }
    const section = trimmed.match(/^((?:"(?:\\.|[^"\\])*"|'(?:''|[^'])*'|[A-Za-z_][A-Za-z0-9_-]*))\s*:\s*$/);
    if (section && resolveYamlKey(section[1]) === 'jobs') { jobsIndent = indent; jobIndent = null; blockStepsIndent = null; pendingBareStepIndent = null; continue; }
    if (section && resolveYamlKey(section[1]) === 'steps') { blockStepsIndent = indent; pendingBareStepIndent = null; continue; }
    if (blockStepsIndent !== null && indent <= blockStepsIndent) { blockStepsIndent = null; pendingBareStepIndent = null; }
    if (blockStepsIndent !== null && /^-\s*$/.test(trimmed)) { pendingBareStepIndent = indent; continue; }
    if (pendingBareStepIndent !== null && indent > pendingBareStepIndent && trimmed.startsWith('{')) { collectFlowUses(trimmed); pendingBareStepIndent = null; continue; }
    if (jobsIndent !== null && indent <= jobsIndent) { jobsIndent = null; jobIndent = null; }
    if (jobsIndent !== null && indent > jobsIndent && jobIndent === null) jobIndent = indent;
    const explicitKey = withoutComment.match(/^\s*(?:-\s*)?\?\s*((?:"(?:\\.|[^"\\])*"|'(?:''|[^'])*'|\*[A-Za-z0-9_-]+|[A-Za-z0-9_-]+))\s*$/);
    if (explicitKey && resolveYamlKey(explicitKey[1]) === 'steps') {
      for (let child = index + 1; child < lines.length; child += 1) {
        const explicitValue = stripYamlComment(lines[child]).match(/^\s*:\s*(.*)$/);
        if (!explicitValue) { if (stripYamlComment(lines[child]).trim()) break; continue; }
        const value = explicitValue[1].trim();
        if (value) { const opening = value.indexOf('['); if (opening >= 0) collectFlowUses(sliceStructuralFlowSequence(value, opening)); index = child; }
        break;
      }
      continue;
    }
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

    const flowJob = withoutComment.match(/^\s*(?:"(?:\\.|[^"\\])*"|'(?:''|[^'])*'|[A-Za-z_][A-Za-z0-9_-]*)\s*:\s*\{(.*)\}\s*$/);
    if (flowJob && jobIndent !== null && indent === jobIndent) {
      for (const entry of splitTopLevelFlowEntries(flowJob[1])) {
        const mapping = entry.match(/^\s*((?:"(?:\\.|[^"\\])*"|'(?:''|[^'])*'|\*[A-Za-z0-9_-]+|[A-Za-z_][A-Za-z0-9_-]*))\s*:\s*(.+?)\s*$/);
        if (mapping && resolveYamlKey(mapping[1]) === 'uses') refs.push(unquote(mapping[2]));
      }
    }

    const flowContext = flowStepsDepth > 0 || /^\s*-\s*\{/.test(withoutComment);
    if (flowContext) {
      let flowSource = withoutComment;
      if (flowStepsMatch?.index !== undefined) {
        const openingIndex = withoutComment.indexOf('[', flowStepsMatch.index);
        if (openingIndex >= 0) flowSource = sliceStructuralFlowSequence(withoutComment, openingIndex);
      }
      collectFlowUses(flowSource);
      const topLevel = maskQuotedFlowScalarStructure(flowSource).replace(/\b(?:with|env|metadata)\s*:\s*\{[^{}]*\}/g, '');
      const multiline = topLevel.match(/(?:^|[\[{,])\s*((?:"(?:\\.|[^"\\])*"|'(?:''|[^'])*'|\*[A-Za-z0-9_-]+|[A-Za-z_][A-Za-z0-9_-]*))\s*:\s*$/);
      if (multiline && resolveYamlKey(multiline[1]) === 'uses') for (let child = index + 1; child < lines.length; child += 1) { const v = stripYamlComment(lines[child]).trim(); if (!v) continue; refs.push(unquote(v.replace(/[}\],]+\s*$/, ''))); index = child; break; }
    }
    if (flowStepsDepth > 0) { const structure = flowStructure(withoutComment, flowStepsQuote); flowStepsQuote = structure.quote; flowStepsDepth += structure.square; if (startsFlowSteps) flowStepsDepth -= 1; if (flowStepsDepth <= 0) { flowStepsDepth = 0; flowStepsQuote = null; } }
  }
  return refs;
};
const expectImmutableExternalActions = (workflow: string, source: string) => { for (const ref of extractActionRefs(workflow)) { if (ref.startsWith('./')) continue; expect(ref, `${source}: ${ref}`).toMatch(/^[^@\s]+@[0-9a-f]{40}$/); } };

describe('GitHub workflow action pinning policy', () => {
  it('pins every external action in every workflow to an immutable full commit SHA', () => { expect(workflowFiles.length).toBeGreaterThan(0); for (const file of workflowFiles) expectImmutableExternalActions(readFileSync(join(workflowsDir, file), 'utf8'), file); });
  it('accepts both valid block-scalar indicator orders while enforcing immutable refs', () => { const sha='0123456789abcdef0123456789abcdef01234567'; for (const header of ['>2+','>+2','|2-','|-2']) { expectImmutableExternalActions(`uses: ${header}\n  actions/checkout@${sha}`, 'block.yml'); expect(() => expectImmutableExternalActions(`uses: ${header}\n  actions/checkout@v4`, 'block.yml')).toThrow(); } });
  it('ignores uses-like flow keys in unrelated mappings but enforces actual flow steps', () => { const sha='0123456789abcdef0123456789abcdef01234567'; const safe=[`env: { uses: actions/checkout@v4 }`,`with: { uses: actions/cache@v4 }`,`metadata: { uses: actions/setup-node@v4 }`,`steps: [{uses: actions/checkout@${sha}}]`].join('\n'); expect(extractActionRefs(safe)).toEqual([`actions/checkout@${sha}`]); expectImmutableExternalActions(safe,'flow.yml'); expect(() => expectImmutableExternalActions('steps: [{uses: actions/checkout@v4}]','flow.yml')).toThrow(); });
  it('ignores uses-like text in quoted flow scalars and nested environment data', () => { const safe='steps: [{ run: "echo ok, uses: actions/checkout@v4", env: { TEMPLATE: "{}", uses: harmless-value@v4 } }]'; expect(extractActionRefs(safe)).toEqual([]); expectImmutableExternalActions(safe,'quoted-flow-data.yml'); const mutable='steps: [{ run: "echo ok, uses: actions/cache@v4", env: { TEMPLATE: "{}", uses: harmless-value@v4 } }, { uses: actions/checkout@v4 }]'; expect(() => expectImmutableExternalActions(mutable,'quoted-flow-data.yml')).toThrow(); });
  it('preserves structural flow-step context across quoted brackets and nested inputs', () => { const sha='0123456789abcdef0123456789abcdef01234567'; const pinned=[`steps: [`,`  { run: "echo ]" },`,`  { uses: actions/checkout@${sha}, with: { uses: actions/cache@v4 } },`,`  { uses: actions/setup-node@${sha} }`,`]`].join('\n'); expect(extractActionRefs(pinned)).toEqual([`actions/checkout@${sha}`,`actions/setup-node@${sha}`]); expectImmutableExternalActions(pinned,'multiline-flow.yml'); const mutable=['steps: [','  { run: "echo ]" },','  { uses: actions/checkout@v4 },',']'].join('\n'); expect(() => expectImmutableExternalActions(mutable,'multiline-flow.yml')).toThrow(); });
  it('recognizes quoted steps keys before entering multiline flow-step context', () => { const sha='0123456789abcdef0123456789abcdef01234567'; const pinned=['"steps": [',`  { "uses": actions/checkout@${sha} },`,']'].join('\n'); expect(extractActionRefs(pinned)).toEqual([`actions/checkout@${sha}`]); expectImmutableExternalActions(pinned,'quoted-steps.yml'); const mutable=['"steps": [','  { "uses": actions/checkout@v4 },',']'].join('\n'); expect(() => expectImmutableExternalActions(mutable,'quoted-steps.yml')).toThrow(); });
  it('recognizes inline flow-style job steps keys without scanning sibling mappings', () => { const sha='0123456789abcdef0123456789abcdef01234567'; const pinned=`jobs:\n  demo: { runs-on: ubuntu-latest, strategy: { matrix: { include: [{ uses: actions/cache@v4 }] } }, steps: [{ uses: actions/checkout@${sha} }] }`; expect(extractActionRefs(pinned)).toEqual([`actions/checkout@${sha}`]); expectImmutableExternalActions(pinned,'inline-job.yml'); const mutable='jobs:\n  demo: { runs-on: ubuntu-latest, steps: [{ uses: actions/checkout@v4 }] }'; expect(() => expectImmutableExternalActions(mutable,'inline-job.yml')).toThrow(); });
  it('enforces immutable refs for flow-style reusable workflow jobs', () => { const sha='0123456789abcdef0123456789abcdef01234567'; const pinned=`jobs:\n  call: { uses: owner/repo/.github/workflows/build.yml@${sha} }`; expect(extractActionRefs(pinned)).toEqual([`owner/repo/.github/workflows/build.yml@${sha}`]); expectImmutableExternalActions(pinned,'reusable-job.yml'); expect(() => expectImmutableExternalActions('jobs:\n  call: { uses: owner/repo/.github/workflows/build.yml@main }','reusable-job.yml')).toThrow(); });
  it('recognizes implicit flow step mappings after an opening sequence bracket', () => { const sha='0123456789abcdef0123456789abcdef01234567'; const pinned=`demo: { runs-on: ubuntu-latest, steps: [ uses: actions/checkout@${sha} ] }`; expect(extractActionRefs(pinned)).toEqual([`actions/checkout@${sha}`]); expectImmutableExternalActions(pinned,'implicit-flow-step.yml'); expect(() => expectImmutableExternalActions('demo: { runs-on: ubuntu-latest, steps: [ uses: actions/checkout@v4 ] }','implicit-flow-step.yml')).toThrow(); });
  it('recognizes anchored flow-style steps sequences', () => { const sha='0123456789abcdef0123456789abcdef01234567'; const pinned=`steps: &common [{ uses: actions/checkout@${sha} }]`; expect(extractActionRefs(pinned)).toEqual([`actions/checkout@${sha}`]); expectImmutableExternalActions(pinned,'anchored-steps.yml'); expect(() => expectImmutableExternalActions('steps: &common [{ uses: actions/checkout@v4 }]','anchored-steps.yml')).toThrow(); });
  it('ignores block-scalar content before flow-step detection', () => { const unsafe='note: |\n  steps: [{ uses: actions/checkout@v4 }]'; expect(extractActionRefs(unsafe)).toEqual([]); });
  it('recognizes quoted jobs sections for reusable workflow scope', () => { const sha='0123456789abcdef0123456789abcdef01234567'; const pinned=`"jobs":\n  call: { uses: owner/repo/.github/workflows/build.yml@${sha} }`; expectImmutableExternalActions(pinned,'quoted-jobs.yml'); expect(() => expectImmutableExternalActions('"jobs":\n  call: { uses: owner/repo/.github/workflows/build.yml@main }','quoted-jobs.yml')).toThrow(); });
  it('resolves aliased steps mapping keys before flow-step detection', () => { const sha='0123456789abcdef0123456789abcdef01234567'; const pinned=`label: &step-key steps\n*step-key: [{ uses: actions/checkout@${sha} }]`; expectImmutableExternalActions(pinned,'aliased-steps.yml'); expect(() => expectImmutableExternalActions('label: &step-key steps\n*step-key: [{ uses: actions/checkout@v4 }]','aliased-steps.yml')).toThrow(); });
  it('enforces reusable-workflow refs inside inline jobs mappings', () => { const sha='0123456789abcdef0123456789abcdef01234567'; const pinned=`jobs: { call: { uses: owner/repo/.github/workflows/build.yml@${sha} } }`; expect(extractActionRefs(pinned)).toEqual([`owner/repo/.github/workflows/build.yml@${sha}`]); expect(() => expectImmutableExternalActions('jobs: { call: { uses: owner/repo/.github/workflows/build.yml@main } }','inline-jobs.yml')).toThrow(); });
  it('recognizes multiline outer jobs mappings and quoted reusable-workflow uses keys', () => { const sha='0123456789abcdef0123456789abcdef01234567'; const pinned=['jobs: {',`  call: { "uses": owner/repo/.github/workflows/build.yml@${sha} }`,'}'].join('\n'); expect(extractActionRefs(pinned)).toEqual([`owner/repo/.github/workflows/build.yml@${sha}`]); expect(() => expectImmutableExternalActions(['jobs: {','  call: { "uses": owner/repo/.github/workflows/build.yml@main }','}'].join('\n'),'multiline-jobs.yml')).toThrow(); });
  it('recognizes explicit-key steps collections', () => { const sha='0123456789abcdef0123456789abcdef01234567'; const pinned=`jobs:\n  build:\n    ? steps\n    : [{ uses: actions/checkout@${sha} }]`; expect(extractActionRefs(pinned)).toContain(`actions/checkout@${sha}`); expect(() => expectImmutableExternalActions('jobs:\n  build:\n    ? steps\n    : [{ uses: actions/checkout@v4 }]','explicit-steps.yml')).toThrow(); });
  it('preserves block steps scope across bare sequence markers and decoded uses keys', () => { const sha='0123456789abcdef0123456789abcdef01234567'; const pinned=['steps:','  -','    { "\\u0075ses": actions/checkout@'+sha+' }'].join('\n'); expect(extractActionRefs(pinned)).toContain(`actions/checkout@${sha}`); expect(() => expectImmutableExternalActions(['steps:','  -','    { "\\u0075ses": actions/checkout@v4 }'].join('\n'),'bare-step.yml')).toThrow(); });
  it('closes flow quotes after even backslash runs', () => {
    const sha = '0123456789abcdef0123456789abcdef01234567';
    const pinnedSteps = ['steps: [', '  { run: "printf \\\\" },', `  { uses: actions/checkout@${sha} },`, ']'].join('\n');
    expect(extractActionRefs(pinnedSteps)).toEqual([`actions/checkout@${sha}`]);
    const pinnedJob = `jobs:\n  call: { name: "Path \\\\" , uses: owner/repo/.github/workflows/build.yml@${sha} }`;
    expect(extractActionRefs(pinnedJob)).toContain(`owner/repo/.github/workflows/build.yml@${sha}`);
  });
  it('preserves quote state across multiline flow jobs', () => {
    const sha = '0123456789abcdef0123456789abcdef01234567';
    const pinned = ['jobs: {', '  call: { name: "template {{', `  }}", uses: owner/repo/.github/workflows/build.yml@${sha} }`, '}'].join('\n');
    expect(extractActionRefs(pinned)).toEqual([`owner/repo/.github/workflows/build.yml@${sha}`]);
    const mutable = ['jobs: {', '  call: { name: "template {{', '  }}", uses: owner/repo/.github/workflows/build.yml@main }', '}'].join('\n');
    expect(() => expectImmutableExternalActions(mutable, 'multiline-flow-job-quote.yml')).toThrow();
  });
  it('preserves quote state across multiline flow step scalars', () => {
    const sha = '0123456789abcdef0123456789abcdef01234567';
    const pinned = ['steps: [', '  { run: "echo [', '  ]" },', `  { uses: actions/checkout@${sha} },`, ']'].join('\n');
    expect(extractActionRefs(pinned)).toEqual([`actions/checkout@${sha}`]);
    const mutable = ['steps: [', '  { run: "echo [', '  ]" },', '  { uses: actions/checkout@v4 },', ']'].join('\n');
    expect(() => expectImmutableExternalActions(mutable, 'multiline-flow-step-quote.yml')).toThrow();
  });
});