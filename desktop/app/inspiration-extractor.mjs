import { randomUUID } from "node:crypto";
import {
  configuredAnalysisConnection,
  isAnalysisReceipt,
  profileKey,
} from "./knowledge-graph-agent.mjs";
import { extractKnowledgeAtoms } from "./knowledge-reasoning.mjs";

const ideaKinds = new Set(["观点", "方法", "经验", "目标", "约束"]);

export function createInspirationExtractor({ readLibrary, readConfigured, connections, assist }) {
  let cache;
  const pending = new Map();
  async function analyze(notes, connection, profile, stored) {
    const ask = async (prompt, outputSchema) => {
      const request = {
        requestId: randomUUID(),
        projectId: "personal-knowledge",
        connectionId: connection.connectionId,
        tool: connection.tool,
        kind: "integration",
        timeoutMs: 120000,
        prompt,
        outputSchema,
      };
      const receipt = await assist(request);
      if (!isAnalysisReceipt(receipt, request)) throw Error("灵感提炼回复的来源无法核对");
      return receipt.output;
    };
    // Personal notes may also contain separate AI answers; the canvas asks for the author's ideas.
    const analysis = await extractKnowledgeAtoms({
      notes: notes.map((note) => ({ ...note, expansions: [] })),
      ask,
      previous:
        stored?.version === 2 && stored.profile === profile
          ? stored
          : cache?.profile === profile
            ? cache.analysis
            : undefined,
    });
    const latest = readLibrary();
    const active = configuredAnalysisConnection(readConfigured(), connections());
    if (!active || profileKey(active) !== profile) throw Error("Agent 配置已变化，请重新提炼");
    if (
      notes.some(
        (note) =>
          !latest.notes.some(
            (n) => n.id === note.id && !n.archivedAt && n.revision === note.revision,
          ),
      )
    )
      throw Error("提炼期间笔记已变化，请重新选择");
    cache = { profile, analysis };
    return analysis.atoms
      .filter((atom) => ideaKinds.has(atom.kind))
      .map((atom) => ({
        id: "idea-" + atom.id,
        idea: {
          title: atom.summary,
          detail: "",
          origin: "extracted",
          source: {
            noteId: atom.noteId,
            revision: atom.revision,
            field: atom.source,
            start: atom.start,
            end: atom.end,
            digest: atom.digest,
          },
        },
      }));
  }
  return async (ids) => {
    if (!Array.isArray(ids) || !ids.length || !ids.every((id) => typeof id === "string"))
      throw Error("请选择笔记");
    const library = readLibrary();
    const byId = new Map(library.notes.filter((n) => !n.archivedAt).map((note) => [note.id, note]));
    const notes = [...new Set(ids)].sort().map((id) => byId.get(id));
    if (notes.some((note) => !note)) throw Error("有笔记已移除，请重新选择");
    const connection = configuredAnalysisConnection(readConfigured(), connections());
    if (!connection) throw Error("请在设置里连接可用于提炼的 Agent");
    const profile = profileKey(connection);
    const key = JSON.stringify([profile, notes.map((n) => [n.id, n.revision])]);
    if (!pending.has(key))
      pending.set(
        key,
        analyze(
          notes.map((n) => ({
            id: n.id,
            title: n.title,
            body: n.body,
            revision: n.revision,
            updatedAt: n.updatedAt,
            createdAt: n.createdAt,
          })),
          connection,
          profile,
          library.agentGraph?.reasoning,
        ).finally(() => pending.delete(key)),
      );
    return pending.get(key);
  };
}
