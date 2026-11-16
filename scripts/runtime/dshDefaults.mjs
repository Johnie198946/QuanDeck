import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { isMap, isScalar, isSeq, parseDocument } from 'yaml';

const executeFile = promisify(execFile);
const CONFIG_GUIDANCE = '无法读取 DSH 的默认模型。请先在 DSH 中设置默认模型，并确认其 SDK 配置可用，再回到 QuanDeck 测试连接。';
const invalid = () => new Error(CONFIG_GUIDANCE);
const plainScalar = node => isScalar(node) && (!node.tag || node.tag === 'tag:yaml.org,2002:str');
const identifier = node => plainScalar(node) && typeof node.value === 'string' && node.value.trim() && node.value.length <= 512 && !/[\x00-\x1f]/.test(node.value) ? node.value.trim() : null;

/** Read only the source-owned default selection, never credentials or the first model.
 * --dump-config has already composed bundle, profile, and home patches. It leaves
 * !!js expressions unevaluated; neither YAML tags nor expressions execute here.
 * Official contract: dsh-v0.2.0-rc.2/packages/core/agent-default-model/src/index.ts.
 */
export function parseDshDefaults(source) {
  try {
    if (typeof source !== 'string' || source.length > 2 * 1024 * 1024) throw invalid();
    const document = parseDocument(source, { prettyErrors: false, strict: true, uniqueKeys: true });
    if (document.errors.length || !isSeq(document.contents)) throw invalid();
    const matches = [];
    let visited = 0;
    const walk = (entries, uncertain = false, depth = 0) => {
      if (depth > 32) throw invalid();
      for (const entry of entries.items) {
        if (++visited > 10000 || !isMap(entry)) throw invalid();
        const disabled = entry.get('disabled', true);
        if (isScalar(disabled) && !disabled.tag && disabled.value === true) continue;
        const inactiveUnknown = uncertain || (disabled !== undefined && !(isScalar(disabled) && !disabled.tag && disabled.value === false));
        const name = entry.get('name', true);
        if (identifier(name) === '@deepseek-ai/dsh-agent-default-model') {
          const config = entry.get('config', true);
          if (inactiveUnknown || !isMap(config)) throw invalid();
          const provider = identifier(config.get('provider', true));
          const model = identifier(config.get('model', true));
          const reasoning = config.get('reasoningEffort', true);
          const reasoningEffort = reasoning === undefined ? undefined : identifier(reasoning);
          if (!provider || !model || reasoningEffort === null) throw invalid();
          matches.push({ provider, model, ...(reasoningEffort ? { reasoningEffort } : {}) });
        }
        const group = entry.get('group', true), children = entry.get('config', true);
        if (isSeq(children) && group !== undefined) {
          const knownGroup = isScalar(group) && !group.tag && group.value === true;
          walk(children, inactiveUnknown || !knownGroup, depth + 1);
        }
      }
    };
    walk(document.contents);
    if (matches.length !== 1) throw invalid();
    return matches[0];
  } catch {
    // YAML/parser errors can contain source lines and embedded credentials.
    throw invalid();
  }
}

/** Read afresh for every process start; never pin inferred defaults in a connection. */
export async function resolveDshDefaults(connection, invocation, { execute = executeFile } = {}) {
  const provider = connection.provider?.trim(), model = connection.model?.trim();
  if (provider && model) return { provider, model }; // Preserve existing explicit overrides.
  if (provider || model) throw new Error('此旧连接的模型覆盖配置不完整。请重新测试连接以沿用 DSH 的默认模型。');
  let source;
  try {
    const result = await execute(invocation.binary, invocation.args, {
      cwd: connection.projectPath, timeout: 10000, maxBuffer: 2 * 1024 * 1024,
      windowsHide: true, env: { ...process.env, ...invocation.env },
    });
    source = String(result.stdout ?? '');
  } catch {
    // execFile errors contain stdout/stderr; do not expose or persist either.
    throw invalid();
  }
  return parseDshDefaults(source);
}
