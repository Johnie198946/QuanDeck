/** Model-only, connection-owned snapshots for the DSH rc.2 profile contract.
 * Never boot candidate profiles, evaluate YAML expressions, read credential stores,
 * or write any DSH-owned file. Availability means structurally reusable, not online.
 */
import path from 'node:path';
import os from 'node:os';
import { constants } from 'node:fs';
import { createHash } from 'node:crypto';
import { lstat, realpath, readdir, mkdir, chmod, open, unlink } from 'node:fs/promises';
import { isMap, isScalar, isSeq, isAlias, parseDocument } from 'yaml';

const MAX_BYTES = 2 * 1024 * 1024;
const MAX_PROFILES = 64;
const DEFAULT = '@deepseek-ai/dsh-agent-default-model';
const PI = '@deepseek-ai/dsh-llm-pi-ai';
const DEEPSEEK = '@deepseek-ai/dsh-llm-deepseek-api-key';
const CREDENTIALS = '@deepseek-ai/dsh-credentials-local';
const KNOWN_IDS = new Map([['agent-default-model', DEFAULT], ['llm-pi-ai', PI], ['llm-deepseek', DEEPSEEK], ['credentials', CREDENTIALS]]);
const REASONS = {
  format: '配置格式、重复条目或 YAML 标签无法安全识别。',
  source: '无法安全读取该来源配置，请在 DSH 中检查配置位置。',
  base: '来源未声明已知 DSH 基础配置，暂不支持自动复用。',
  model: '来源没有唯一、明确的默认模型。',
  route: '默认模型缺少明确的已知模型路由，可能继承自其他配置或企业插件。',
  dynamic: '模型配置含动态表达式或引用，暂不支持自动复用。',
  secret: '模型配置含内联凭据、自定义请求头或不支持的字段，请继续在 DSH 中管理。',
  credentials: '来源自定义了凭据存储，无法确认与 SDK 使用同一凭据来源。',
  sdk: 'SDK 模型条目无法安全合并，请先检查 SDK 配置。',
  stale: '来源配置已变化，请重新检查并选择模型来源。',
  snapshot: '模型配置快照不可用或已变化，请重新选择模型来源。',
};
const fail = (reason = 'format') => Object.assign(new Error(REASONS[reason]), { code: reason === 'stale' ? 'DSH_MODEL_SOURCE_CHANGED' : reason === 'snapshot' ? 'DSH_MODEL_SNAPSHOT_INVALID' : 'DSH_MODEL_SOURCE_UNSUPPORTED', reason });
const digest = value => createHash('sha256').update(value).digest('hex');
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const has = (value, key) => Object.hasOwn(value, key);
const PROFILE = /^[\p{L}\p{N}][\p{L}\p{N}_.-]{0,95}$/u;
const ENTRY = /^[\w.-]{1,160}$/;
const PROVIDER = /^[a-z][a-z0-9._-]{0,95}$/;
const MODEL = /^[A-Za-z0-9][A-Za-z0-9_./:@+-]{0,255}$/;
const HASH = /^[a-f0-9]{64}$/;
const REF = /^[A-Za-z_][A-Za-z0-9_]{0,159}$/;
const keysOnly = (value, keys, reason = 'secret') => {
  if (!record(value) || Object.keys(value).some(key => !keys.includes(key))) throw fail(reason);
};
const textId = (value, pattern = MODEL) => {
  if (typeof value !== 'string' || !pattern.test(value) || /:\/\/|^(?:sk-|eyJ)/i.test(value)) throw fail('model');
  return value;
};
const safeName = name => typeof name === 'string' && PROFILE.test(name) && !['node_modules', '.', '..'].includes(name);
const plainScalar = node => isScalar(node) && !node.tag ? node.value : undefined;

function document(source) {
  if (typeof source !== 'string' || Buffer.byteLength(source) > MAX_BYTES || source.includes('\0')) throw fail();
  const doc = parseDocument(source, { prettyErrors: false, strict: true, uniqueKeys: true });
  if (doc.errors.length) throw fail();
  let visited = 0;
  const check = (node, depth = 0) => {
    if (++visited > 20000 || depth > 40 || isAlias(node)) throw fail();
    if (node?.tag && !['tag:yaml.org,2002:js', 'tag:yaml.org,2002:str', 'tag:yaml.org,2002:bool', 'tag:yaml.org,2002:int', 'tag:yaml.org,2002:float', 'tag:yaml.org,2002:null'].includes(node.tag)) throw fail();
    if (isMap(node)) for (const pair of node.items) {
      if (!isScalar(pair.key) || typeof pair.key.value !== 'string' || ['__proto__', 'prototype', 'constructor', '<<'].includes(pair.key.value)) throw fail();
      check(pair.key, depth + 1); check(pair.value, depth + 1);
    }
    if (isSeq(node)) for (const item of node.items) check(item, depth + 1);
  };
  check(doc.contents);
  return doc.contents;
}

/** Convert selected model nodes only. Unrelated !!js nodes are never evaluated. */
function literal(node) {
  if (node?.tag || isAlias(node)) throw fail('dynamic');
  if (node === null || node === undefined) return null;
  if (isScalar(node)) {
    const value = node.value;
    if (typeof value === 'number' && !Number.isFinite(value)) throw fail();
    if (typeof value === 'string' && (value.length > 16384 || /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(value) || /\$\{|\bprocess\.env\b/.test(value))) throw fail('dynamic');
    return value;
  }
  if (isSeq(node)) return node.items.map(literal);
  if (isMap(node)) return Object.fromEntries(node.items.map(pair => [pair.key.value, literal(pair.value)]));
  throw fail();
}

function entries(source, composed = false) {
  const root = document(source);
  if (!isSeq(root) || root.items.length > 2000) throw fail();
  const rows = [], ids = new Set();
  for (const row of root.items) {
    if (!isMap(row)) throw fail();
    // Inserts/groups can hide extra defaults and plugin identity changes.
    if (row.has('insert') || row.has('include') || row.has('group')) throw fail('route');
    const id = plainScalar(row.get('id', true));
    const nameNode = row.get('name', true);
    const name = nameNode === undefined ? (composed ? undefined : KNOWN_IDS.get(id)) : plainScalar(nameNode);
    if (typeof id !== 'string' || !ENTRY.test(id) || ids.has(id)) throw fail();
    ids.add(id);
    if (nameNode !== undefined && typeof name !== 'string') throw fail('dynamic');
    if ([DEFAULT, PI, DEEPSEEK, CREDENTIALS].includes(name) && row.items.some(pair => !['id', 'name', 'config', 'disabled'].includes(pair.key.value))) throw fail('route');
    rows.push({ id, name, row });
  }
  return rows;
}

function selection(config) {
  keysOnly(config, ['provider', 'model', 'reasoningEffort'], 'model');
  const provider = textId(config.provider, PROVIDER), model = textId(config.model);
  const reasoningEffort = has(config, 'reasoningEffort') ? textId(config.reasoningEffort) : undefined;
  return { provider, model, ...(reasoningEffort ? { reasoningEffort } : {}) };
}

const ROUTE_KEYS = ['apiKeyEnv', 'displayName', 'api', 'baseURL', 'models', 'modelOverrides', 'compat', 'defaultContextWindow', 'defaultMaxTokens', 'defaultInput', 'reasoning', 'thinkingBudgets', 'cacheRetention', 'transport', 'timeoutMs', 'websocketConnectTimeoutMs', 'streamIdleTimeoutMs', 'maxRequestImageBytes', 'requestImagePixelBudget', 'requestImageMaxBytes', 'retryPolicy'];
const MODEL_KEYS = ['id', 'name', 'contextWindow', 'maxTokens', 'input', 'reasoningEfforts', 'compat'];
const COMPAT_KEYS = ['supportsStore', 'supportsDeveloperRole', 'supportsReasoningEffort', 'supportsUsageInStreaming', 'supportsFinishReason', 'maxTokensField', 'requiresToolResultName', 'requiresAssistantAfterToolResult', 'requiresThinkingAsText', 'requiresReasoningContentOnAssistantMessages', 'thinkingFormat', 'chatTemplateKwargs', 'chatTemplateArgs', 'supportsThinkingTokenBudget', 'thinkingTokenBudgetField', 'vllmPriority', 'supportsMaxOutputTokens', 'supportsStrictMode', 'cacheControlFormat', 'supportsLongCacheRetention', 'supportsEagerToolInputStreaming', 'supportsCacheControlOnTools', 'supportsTemperature', 'forceAdaptiveThinking', 'allowEmptySignature', 'supportsStrictTools'];
const DEEP_KEYS = ['apiKeyEnv', 'baseURL', 'thinking', 'reasoningEffort', 'maxTokens', 'defaultContextWindow', 'models', 'streamIdleTimeoutMs', 'maxRequestFilesBytes', 'maxInlineRequestImageBytes', 'maxImagesPerRequest', 'imageOffloadByteQuantum', 'inlineImageOffloadByteQuantum', 'imageOffloadCountQuantum', 'filesApiTimeoutMs', 'fileExpiresAfterSeconds', 'fileRefreshMarginSeconds', 'fileQuotaCleanupBatch', 'retryPolicy'];
const DEEP_MODEL_KEYS = ['id', 'name', 'contextWindow', 'maxTokens', 'inputModalities', 'imagePixelBudget', 'imageMaxBytes', 'systemPromptUpdate', 'toolUpdate'];

function safeStatic(value, depth = 0) {
  if (depth > 20) throw fail();
  if (typeof value === 'string') {
    if (value.length > 16384 || /[\x00-\x08\x0b\x0c\x0e-\x1f]|\$\{|\bprocess\.env\b/.test(value)) throw fail('dynamic');
  } else if (typeof value === 'number') { if (!Number.isFinite(value)) throw fail(); }
  else if (Array.isArray(value)) { if (value.length > 1024) throw fail(); value.forEach(item => safeStatic(item, depth + 1)); }
  else if (record(value)) for (const [key, item] of Object.entries(value)) {
    if (['__proto__', 'prototype', 'constructor'].includes(key) || /(?:api.?key|secret|password|authorization|cookie|headers|access.?token|refresh.?token)/i.test(key) && key !== 'apiKeyEnv') throw fail('secret');
    safeStatic(item, depth + 1);
  } else if (value !== null && typeof value !== 'boolean') throw fail();
}

function endpoint(value) {
  try {
    const url = new URL(value);
    if (typeof value !== 'string' || !['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw fail('secret');
  } catch { throw fail('secret'); }
}

function route(value, { selectedModel, deep = false } = {}) {
  keysOnly(value, deep ? DEEP_KEYS : ROUTE_KEYS);
  safeStatic(value);
  if (has(value, 'apiKeyEnv') && (typeof value.apiKeyEnv !== 'string' || !REF.test(value.apiKeyEnv))) throw fail('secret');
  if (has(value, 'baseURL')) endpoint(value.baseURL);
  if (value.compat !== undefined) keysOnly(value.compat, COMPAT_KEYS);
  if (value.thinkingBudgets !== undefined) keysOnly(value.thinkingBudgets, ['minimal', 'low', 'medium', 'high']);
  if (value.retryPolicy !== undefined) keysOnly(value.retryPolicy, ['mode', 'maxRetries', 'baseDelayMs', 'maxDelayMs']);
  if (value.models !== undefined) {
    if (!Array.isArray(value.models) || !value.models.length || value.models.length > 1024) throw fail('route');
    const ids = new Set();
    for (const model of value.models) {
      keysOnly(model, deep ? DEEP_MODEL_KEYS : MODEL_KEYS);
      textId(model.id); if (ids.has(model.id)) throw fail('route'); ids.add(model.id);
      if (model.compat !== undefined) keysOnly(model.compat, COMPAT_KEYS);
    }
    if (selectedModel && !ids.has(selectedModel)) throw fail('route');
  }
  if (value.modelOverrides !== undefined) {
    if (!record(value.modelOverrides) || value.models !== undefined) throw fail('route');
    for (const [id, override] of Object.entries(value.modelOverrides)) { textId(id); keysOnly(override, MODEL_KEYS.filter(key => key !== 'id')); if (override.compat !== undefined) keysOnly(override.compat, COMPAT_KEYS); }
  }
  // Reuse only explicit routes; do not guess catalog defaults, ambient keys, or endpoints.
  if (selectedModel && (!value.apiKeyEnv || !value.baseURL || !value.models || !deep && !['openai-completions', 'openai-responses', 'anthropic-messages'].includes(value.api))) throw fail('route');
  return value;
}

function active(row) {
  if (!row) throw fail('route');
  const disabled = row.row.get('disabled', true);
  if (disabled !== undefined && plainScalar(disabled) !== false) throw fail('route');
}

function selectedRoute(rows, defaults) {
  const selected = [];
  for (const row of rows.filter(item => item.name === PI || item.name === DEEPSEEK)) {
    const disabled = row.row.get('disabled', true);
    if (plainScalar(disabled) === true) continue;
    const configNode = row.row.get('config', true);
    if (configNode === undefined) continue;
    const config = literal(configNode);
    if (row.name === PI) {
      keysOnly(config, ['providers']);
      if (!record(config.providers)) throw fail('route');
      if (has(config.providers, defaults.provider)) {
        active(row); selected.push({ adapter: PI, id: row.id, config: route(config.providers[defaults.provider], { selectedModel: defaults.model }) });
      }
    } else if (defaults.provider === 'deepseek-official') {
      active(row); selected.push({ adapter: DEEPSEEK, id: row.id, config: route(config, { selectedModel: defaults.model, deep: true }) });
    }
  }
  if (selected.length !== 1) throw fail('route');
  return selected[0];
}

function defaultRow(rows) {
  const found = rows.filter(row => row.name === DEFAULT);
  if (found.length !== 1) throw fail('model');
  active(found[0]);
  return { row: found[0], defaults: selection(literal(found[0].row.get('config', true))) };
}

function checkCredentials(rows) {
  for (const row of rows.filter(item => item.id === 'credentials' || item.name === CREDENTIALS)) {
    if (row.name !== CREDENTIALS) throw fail('credentials');
    active(row);
    if (row.row.has('config')) keysOnly(literal(row.row.get('config', true)), ['watch', 'debounceMs'], 'credentials');
  }
}

function compose(profileSource, homeSource) {
  const composed = new Map();
  for (const source of [profileSource, homeSource]) for (const entry of entries(source)) {
    const previous = composed.get(entry.id);
    if (previous && entry.name && previous.name && entry.name !== previous.name) throw fail('route');
    // Each row's config is replaced in full; missing fields retain the prior layer.
    if (previous) {
      const merged = previous.row.clone();
      for (const pair of entry.row.items) merged.set(pair.key.value, pair.value);
      composed.set(entry.id, { id: entry.id, name: entry.name ?? previous.name, row: merged });
    } else composed.set(entry.id, entry);
  }
  const rows = [...composed.values()];
  checkCredentials(rows);
  const { defaults } = defaultRow(rows);
  return { ...defaults, ...selectedRoute(rows, defaults) };
}

function sdkSummary(source) {
  let defaults;
  try {
    const rows = entries(source, true);
    defaults = defaultRow(rows).defaults;
    checkCredentials(rows); selectedRoute(rows, defaults);
    return { ...defaults, status: 'configured' };
  } catch { return { ...defaults, status: 'unavailable' }; }
}

const inside = (parent, child) => { const relative = path.relative(parent, child); return relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative); };
async function directory(parent, name) {
  const target = path.join(parent, name), stat = await lstat(target);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw fail('source');
  const canonical = await realpath(target);
  if (!inside(parent, canonical) || canonical !== target) throw fail('source');
  return canonical;
}

async function readFileBounded(parent, name, optional = false) {
  const target = path.join(parent, name);
  let info;
  try { info = await lstat(target); } catch (error) { if (optional && error.code === 'ENOENT') return undefined; throw fail('source'); }
  if (!info.isFile() || info.isSymbolicLink() || info.size > MAX_BYTES || await realpath(target) !== target) throw fail('source');
  let handle;
  try {
    handle = await open(target, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
    const opened = await handle.stat();
    if (!opened.isFile() || opened.size > MAX_BYTES || opened.ino !== info.ino || opened.dev !== info.dev) throw fail('source');
    const buffer = Buffer.alloc(MAX_BYTES + 1); let bytes = 0;
    while (bytes <= MAX_BYTES) {
      const result = await handle.read(buffer, bytes, buffer.length - bytes, bytes);
      if (!result.bytesRead) break;
      bytes += result.bytesRead;
    }
    if (bytes > MAX_BYTES) throw fail('source');
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, bytes));
  } catch { throw fail('source'); } finally { await handle?.close(); }
}

function resolveHome(value) {
  let root = value ?? (process.env.DSH_HOME?.trim() ? process.env.DSH_HOME : path.join(os.homedir(), '.dsh'));
  if (typeof root !== 'string' || !root || /[\0\r\n]/.test(root)) throw fail('source');
  if (/^~(?:[/\\]|$)/.test(root)) root = path.join(os.homedir(), root.slice(2));
  return path.resolve(root);
}

async function sourceAt(home, profile) {
  if (!safeName(profile) || profile === 'sdk') throw fail('source');
  const canonicalHome = await realpath(home);
  const profiles = await directory(canonicalHome, 'profiles');
  const dir = await directory(profiles, profile);
  const manifestText = await readFileBounded(dir, 'package.json');
  const profileText = await readFileBounded(dir, 'cordis.patch.yml', true) ?? '[]';
  const homeText = await readFileBounded(canonicalHome, 'cordis.patch.yml', true) ?? '[]';
  const revision = digest(JSON.stringify([canonicalHome, profile, manifestText, profileText, homeText]));
  try {
    const manifest = literal(document(manifestText));
    const bundles = manifest?.dsh?.profile?.bundles;
    // rc.2 Desktop initializes from PROFILE_TEMPLATES.web, which directly lists
    // dsh-base + dsh-web-app (apps/desktop/src/project-manager.ts:createPluginProfile).
    if (!Array.isArray(bundles) || !bundles.every(bundle => typeof bundle === 'string') || !bundles.includes('@deepseek-ai/dsh-base')) throw fail('base');
    return { profile, revision, status: 'available', ...compose(profileText, homeText) };
  } catch (error) { return { profile, revision, status: 'unsupported', reason: REASONS[error.reason] ?? REASONS.format }; }
}

function publicCandidate(candidate) {
  const { profile, revision, status, reason, provider, model, reasoningEffort } = candidate;
  return { profile, revision, status, ...(reason ? { reason } : {}), ...(provider ? { provider, model, ...(reasoningEffort ? { reasoningEffort } : {}) } : {}) };
}

function buildPatch(candidate, sdkConfig) {
  const rows = entries(sdkConfig, true);
  checkCredentials(rows);
  const defaults = rows.filter(row => row.name === DEFAULT);
  const adapters = rows.filter(row => row.name === candidate.adapter);
  if (defaults.length !== 1 || adapters.length !== 1) throw fail('sdk');
  active(defaults[0]); active(adapters[0]);
  let config;
  if (candidate.adapter === PI) {
    const existing = adapters[0].row.has('config') ? literal(adapters[0].row.get('config', true)) : {};
    keysOnly(existing, ['providers']);
    if (existing.providers !== undefined && !record(existing.providers)) throw fail('sdk');
    const providers = { ...(existing.providers ?? {}) };
    for (const [name, current] of Object.entries(providers)) { textId(name, PROVIDER); route(current); }
    providers[candidate.provider] = candidate.config;
    config = { providers };
  } else config = candidate.config;
  return [{ id: adapters[0].id, config }, { id: defaults[0].id, config: selection({ provider: candidate.provider, model: candidate.model, ...(candidate.reasoningEffort ? { reasoningEffort: candidate.reasoningEffort } : {}) }) }];
}

function validateSnapshot(source, ref) {
  const root = literal(document(source));
  if (!Array.isArray(root) || root.length !== 2) throw fail('snapshot');
  for (const row of root) { keysOnly(row, ['id', 'config']); if (typeof row.id !== 'string' || !ENTRY.test(row.id)) throw fail('snapshot'); }
  if (root[0].id === root[1].id) throw fail('snapshot');
  const defaults = selection(root[1].config);
  if (JSON.stringify(defaults) !== JSON.stringify(selection({ provider: ref.provider, model: ref.model, ...(ref.reasoningEffort ? { reasoningEffort: ref.reasoningEffort } : {}) }))) throw fail('snapshot');
  const adapter = root[0].config;
  if (has(adapter, 'providers')) {
    keysOnly(adapter, ['providers']);
    if (!record(adapter.providers) || !has(adapter.providers, defaults.provider)) throw fail('snapshot');
    for (const [name, config] of Object.entries(adapter.providers)) { textId(name, PROVIDER); route(config, name === defaults.provider ? { selectedModel: defaults.model } : {}); }
  } else {
    if (defaults.provider !== 'deepseek-official') throw fail('snapshot');
    route(adapter, { deep: true, selectedModel: defaults.model });
  }
  return defaults;
}

async function storageRoot(storageDir, create = false) {
  if (typeof storageDir !== 'string' || !path.isAbsolute(storageDir) || /[\0\r\n]/.test(storageDir)) throw fail('snapshot');
  if (create) await mkdir(storageDir, { recursive: true, mode: 0o700 });
  const stat = await lstat(storageDir);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw fail('snapshot');
  const root = await realpath(storageDir);
  if (create && process.platform !== 'win32') await chmod(root, 0o700);
  if (!create && process.platform !== 'win32' && (stat.mode & 0o077)) throw fail('snapshot');
  return root;
}

/** storageDir is trusted runtime metadata, never taken from a saved connection. */
export async function readDshModelConfig(ref, { storageDir } = {}) {
  try {
    if (!record(ref) || !HASH.test(ref.digest) || !HASH.test(ref.revision) || !safeName(ref.profile) || typeof ref.path !== 'string') throw fail('snapshot');
    const root = await storageRoot(storageDir);
    const expected = path.join(root, `${ref.digest}.json`);
    if (path.resolve(ref.path) !== expected) throw fail('snapshot');
    const info = await lstat(expected);
    if (info.isSymbolicLink() || !info.isFile() || info.nlink !== 1 || process.platform !== 'win32' && (info.mode & 0o077)) throw fail('snapshot');
    const source = await readFileBounded(root, `${ref.digest}.json`);
    if (digest(source) !== ref.digest) throw fail('snapshot');
    return { path: expected, ...validateSnapshot(source, ref) };
  } catch { throw fail('snapshot'); }
}

export function createDshModelSources({ home, storageDir } = {}) {
  const selectedHome = resolveHome(home);
  return {
    async inspect({ sdkConfig } = {}) {
      const sdk = sdkSummary(sdkConfig);
      try {
        const root = await realpath(selectedHome), profiles = await directory(root, 'profiles');
        const dirs = (await readdir(profiles, { withFileTypes: true })).filter(entry => entry.isDirectory() && !entry.isSymbolicLink() && safeName(entry.name) && entry.name !== 'sdk').sort((a, b) => a.name.localeCompare(b.name));
        const candidates = [];
        for (const entry of dirs.slice(0, MAX_PROFILES)) {
          try { candidates.push(publicCandidate(await sourceAt(selectedHome, entry.name))); }
          catch { candidates.push({ profile: entry.name, revision: digest(entry.name), status: 'unsupported', reason: REASONS.source }); }
        }
        return { candidates, sdk, ...(dirs.length > MAX_PROFILES ? { message: '来源数量较多，仅检查前 64 个配置。' } : {}) };
      } catch { return { candidates: [], sdk, message: '没有找到可安全读取的 DSH profile，请确认 DSH 配置位置。' }; }
    },
    async prepare({ profile, revision } = {}, sdkConfig) {
      try {
        if (!safeName(profile) || !HASH.test(revision)) throw fail('stale');
        const candidate = await sourceAt(selectedHome, profile);
        if (candidate.revision !== revision) throw fail('stale');
        if (candidate.status !== 'available') throw fail('route');
        const patch = buildPatch(candidate, sdkConfig);
        const content = `${JSON.stringify(patch, null, 2)}\n`;
        const hash = digest(content), root = await storageRoot(storageDir, true);
        const ref = { path: path.join(root, `${hash}.json`), digest: hash, profile, revision, provider: candidate.provider, model: candidate.model, ...(candidate.reasoningEffort ? { reasoningEffort: candidate.reasoningEffort } : {}) };
        validateSnapshot(content, ref);
        let handle;
        try {
          handle = await open(ref.path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW || 0), 0o600);
          await handle.writeFile(content, 'utf8'); await handle.sync();
        } catch (error) {
          if (handle) { await handle.close(); handle = null; await unlink(ref.path).catch(() => {}); }
          if (error.code !== 'EEXIST') throw fail('snapshot');
        } finally { await handle?.close(); }
        await readDshModelConfig(ref, { storageDir });
        return ref;
      } catch (error) { throw error.code?.startsWith('DSH_MODEL_') ? error : fail('source'); }
    },
  };
}
