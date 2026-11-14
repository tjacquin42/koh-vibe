/**
 * One conversation's sheet: its tool calls, its subagents, the files it
 * wrote — from the transcripts the activity index already holds. Built for
 * the conversation the cockpit shows, and for no other: the rest of the
 * cockpit needs none of this detail.
 *
 * A subagent is named by the `.meta.json` Claude Code writes beside its
 * transcript (`description`, `agentType`, `model`, `finished`); without one,
 * by the first line of the prompt it was given.
 */
import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import type { SessionSheetView, SheetAgentView, SheetFileView, SheetToolView, TokenCount } from '../../shared/protocol';
import type { FileState } from './index';
import { emptyTokens } from './view';

/** How many tool calls the sheet lists — the count says how many there were in all. */
export const SHEET_TOOLS = 150;
/** The calls that change a file: what « files touched » counts. Reads are not changes. */
const WRITE_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);

export interface AgentMeta {
  description?: string;
  agentType?: string;
  model?: string;
  finished?: boolean;
}

export function parseAgentMeta(raw: string): AgentMeta {
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return {};
  }
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return {};
  const r = v as Record<string, unknown>;
  const out: AgentMeta = {};
  if (typeof r['description'] === 'string' && r['description'].trim() !== '') out.description = r['description'].trim();
  if (typeof r['agentType'] === 'string') out.agentType = r['agentType'];
  if (typeof r['model'] === 'string') out.model = r['model'];
  if (typeof r['finished'] === 'boolean') out.finished = r['finished'];
  return out;
}

/** `…/subagents/agent-abc.jsonl` → `abc`. */
export function agentIdOf(path: string): string {
  return basename(path, '.jsonl').replace(/^agent-/, '');
}

/** The meta files of a conversation's subagents, by agent id. A missing or broken one is just absent. */
export async function readAgentMetas(states: readonly FileState[], read: (path: string) => Promise<string> = (p) => readFile(p, 'utf8')): Promise<Map<string, AgentMeta>> {
  const out = new Map<string, AgentMeta>();
  await Promise.all(
    states
      .filter((s) => s.subagent)
      .map(async (s) => {
        try {
          out.set(agentIdOf(s.path), parseAgentMeta(await read(s.path.replace(/\.jsonl$/, '.meta.json'))));
        } catch {
          // No meta file: the prompt names it.
        }
      }),
  );
  return out;
}

/**
 * A path the view may show: relative to the conversation's directory when it
 * is inside, `~/…` when it is under the home, as is otherwise. The home's
 * full path never reaches a screenshot.
 */
export function displayPath(path: string, cwd: string | undefined, home: string): string {
  if (cwd !== undefined && path.startsWith(`${cwd}/`)) return path.slice(cwd.length + 1);
  if (path.startsWith(`${home}/`)) return `~/${path.slice(home.length + 1)}`;
  return path;
}

function add(into: TokenCount, u: TokenCount): void {
  into.input += u.input;
  into.output += u.output;
  into.cacheWrite += u.cacheWrite;
  into.cacheRead += u.cacheRead;
}

export function buildSheet(
  states: readonly FileState[],
  sessionId: string,
  since: number,
  metas: ReadonlyMap<string, AgentMeta>,
  home: string,
): SessionSheetView | undefined {
  const mine = states.filter((s) => s.sessionId === sessionId);
  if (mine.length === 0) return undefined;
  const own = mine.find((s) => !s.subagent);
  const cwd = own?.cwd;
  const tools: SheetToolView[] = [];
  const files = new Map<string, SheetFileView>();
  const agents: SheetAgentView[] = [];
  const tokens = emptyTokens();
  const subagentTokens = emptyTokens();
  let lastPrompt: SessionSheetView['lastPrompt'];

  for (const st of mine) {
    const agentId = st.subagent ? agentIdOf(st.path) : undefined;
    const stTokens = emptyTokens();
    const stamps: number[] = [];
    for (const u of st.usage.values()) {
      add(st.subagent ? subagentTokens : tokens, u.usage);
      add(stTokens, u.usage);
      stamps.push(u.at);
    }
    let toolCalls = 0;
    let firstPrompt: string | undefined;
    for (const i of st.items) {
      stamps.push(i.at);
      if (i.kind === 'prompt') {
        firstPrompt ??= i.text;
        if (!st.subagent && (lastPrompt === undefined || i.at > lastPrompt.at)) lastPrompt = { at: i.at, text: i.text };
        continue;
      }
      if (i.kind !== 'tool') continue;
      toolCalls++;
      const call: SheetToolView = { at: i.at, tool: i.tool };
      if (i.target !== undefined) call.target = i.target;
      if (agentId !== undefined) call.agent = agentId;
      tools.push(call);
      if (i.path !== undefined && WRITE_TOOLS.has(i.tool)) {
        const shown = displayPath(i.path, cwd ?? st.cwd, home);
        const f = files.get(shown);
        if (f === undefined) files.set(shown, { path: shown, writes: 1, lastAt: i.at });
        else {
          f.writes++;
          f.lastAt = Math.max(f.lastAt, i.at);
        }
      }
    }
    if (agentId !== undefined && stamps.length > 0) {
      const meta = metas.get(agentId) ?? {};
      const a: SheetAgentView = {
        id: agentId,
        label: meta.description ?? firstPrompt ?? agentId,
        tokens: stTokens,
        tools: toolCalls,
        firstAt: Math.min(...stamps),
        lastAt: Math.max(...stamps),
      };
      if (meta.agentType !== undefined) a.type = meta.agentType;
      if (meta.model !== undefined) a.model = meta.model;
      if (meta.finished !== undefined) a.finished = meta.finished;
      agents.push(a);
    }
  }
  tools.sort((a, b) => b.at - a.at);
  agents.sort((a, b) => b.lastAt - a.lastAt);
  const sheet: SessionSheetView = {
    id: sessionId,
    since,
    tools: tools.slice(0, SHEET_TOOLS),
    toolCount: tools.length,
    agents,
    files: [...files.values()].sort((a, b) => b.lastAt - a.lastAt),
    tokens,
    subagentTokens,
  };
  if (lastPrompt !== undefined) sheet.lastPrompt = lastPrompt;
  return sheet;
}
