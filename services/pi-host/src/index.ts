import { createInterface } from "node:readline";
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  createAgentSession,
  createAgentSessionServices,
  createCodingTools,
  ModelRuntime,
  SessionManager,
  getAgentDir,
  type AgentSession,
} from "@earendil-works/pi-coding-agent";
import { ActiveRunBinding } from "./active-run.js";

type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

type Request = {
  id: string;
  method: string;
  params?: Record<string, unknown>;
};

type SessionMetadata = {
  sessionFile: string;
  cwd: string;
  updatedAt: string;
};

type MetadataStore = Record<string, SessionMetadata>;

type HostedSession = {
  session: AgentSession;
  cwd: string;
  unsubscribe: () => void;
  lastActiveAt: number;
  activeRun: ActiveRunBinding;
};

const dataDir = resolve(process.env.MULTI_AGENT_DATA_DIR ?? "./data");
const sessionsDir = resolve(dataDir, "pi-sessions");
const metadataPath = resolve(dataDir, "sessions.json");
const modelsConfigPath = resolve(getAgentDir(), "models.json");
const idleMs = Number(process.env.MULTI_AGENT_SESSION_IDLE_MS ?? 30 * 60_000);

await mkdir(sessionsDir, { recursive: true });
const modelRuntime = await ModelRuntime.create();
const sessions = new Map<string, HostedSession>();
let metadata = await loadMetadata();

function emit(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

function log(message: string, error?: unknown): void {
  const suffix = error instanceof Error ? `: ${error.stack ?? error.message}` : error ? `: ${String(error)}` : "";
  process.stderr.write(`[pi-host] ${message}${suffix}\n`);
}

async function loadMetadata(): Promise<MetadataStore> {
  try {
    return JSON.parse(await readFile(metadataPath, "utf8")) as MetadataStore;
  } catch {
    return {};
  }
}

async function saveMetadata(): Promise<void> {
  const temporary = `${metadataPath}.tmp`;
  await mkdir(dirname(metadataPath), { recursive: true });
  await writeFile(temporary, `${JSON.stringify(metadata, null, 2)}\n`, "utf8");
  await rename(temporary, metadataPath);
}

function stringParam(params: Record<string, unknown>, name: string, required = true): string {
  const value = params[name];
  if (typeof value === "string" && value.trim()) return value.trim();
  if (!required) return "";
  throw new Error(`${name} is required`);
}

async function openSession(
  sessionKey: string,
  cwdInput: string,
  modelName: string,
  thinkingLevel: string,
): Promise<HostedSession> {
  const cached = sessions.get(sessionKey);
  if (cached) {
    cached.lastActiveAt = Date.now();
    return cached;
  }

  const cwd = resolve(cwdInput);
  const previous = metadata[sessionKey];
  const sessionManager = previous?.sessionFile && existsSync(previous.sessionFile)
    ? SessionManager.open(previous.sessionFile, undefined, cwd)
    : SessionManager.create(cwd, sessionsDir);

  const model = modelName
    ? (() => {
        const slash = modelName.indexOf("/");
        if (slash < 1) throw new Error("model must use provider/model format");
        const found = modelRuntime.getModel(modelName.slice(0, slash), modelName.slice(slash + 1));
        if (!found) throw new Error(`model not found: ${modelName}`);
        return found;
      })()
    : undefined;

  const created = await createAgentSession({
    cwd,
    modelRuntime,
    sessionManager,
    ...(model ? { model } : {}),
    ...(thinkingLevel ? { thinkingLevel: thinkingLevel as ThinkingLevel } : {}),
  });

  const hosted: HostedSession = {
    session: created.session,
    cwd,
    unsubscribe: () => undefined,
    lastActiveAt: Date.now(),
    activeRun: new ActiveRunBinding(),
  };
  hosted.unsubscribe = created.session.subscribe((event) => {
    hosted.lastActiveAt = Date.now();
    const runId = hosted.activeRun.current;
    emit({ type: "event", sessionKey, runId, event });
    if (event.type === "agent_settled") hosted.activeRun.finish(runId);
  });
  sessions.set(sessionKey, hosted);

  if (created.session.sessionFile) {
    metadata[sessionKey] = {
      sessionFile: created.session.sessionFile,
      cwd,
      updatedAt: new Date().toISOString(),
    };
    await saveMetadata();
  }

  emit({
    type: "event",
    sessionKey,
    event: {
      type: "session_ready",
      sessionId: created.session.sessionId,
      sessionFile: created.session.sessionFile,
      restored: Boolean(previous?.sessionFile),
      modelFallbackMessage: created.modelFallbackMessage,
    },
  });
  return hosted;
}

async function closeSession(sessionKey: string): Promise<void> {
  const hosted = sessions.get(sessionKey);
  if (!hosted) return;
  hosted.unsubscribe();
  hosted.session.dispose();
  sessions.delete(sessionKey);
}

async function sessionState(hosted: HostedSession): Promise<Record<string, unknown>> {
  return {
    sessionId: hosted.session.sessionId,
    sessionFile: hosted.session.sessionFile,
    isStreaming: hosted.session.isStreaming,
    model: hosted.session.model ? { provider: hosted.session.model.provider, id: hosted.session.model.id } : null,
    thinkingLevel: hosted.session.thinkingLevel,
    cwd: hosted.cwd,
    messages: hosted.session.messages,
  };
}

async function replaceSession(sessionKey: string, cwd: string, model: string, thinkingLevel: string): Promise<Record<string, unknown>> {
  await closeSession(sessionKey);
  delete metadata[sessionKey];
  await saveMetadata();
  return sessionState(await openSession(sessionKey, cwd, model, thinkingLevel));
}

function publicModels() {
  return modelRuntime.getAvailableSnapshot().map((model) => ({ provider: model.provider, id: model.id, name: model.name, reasoning: model.reasoning, contextWindow: model.contextWindow, maxTokens: model.maxTokens }));
}

async function readModelsConfig(): Promise<Record<string, unknown>> {
  try { return JSON.parse(await readFile(modelsConfigPath, "utf8")) as Record<string, unknown>; }
  catch { return { providers: {} }; }
}

function redactModelsConfig(config: Record<string, unknown>): Record<string, unknown> {
  const copy = structuredClone(config);
  const providers = copy.providers;
  if (!providers || typeof providers !== "object" || Array.isArray(providers)) return copy;
  for (const provider of Object.values(providers as Record<string, unknown>)) {
    if (!provider || typeof provider !== "object" || Array.isArray(provider)) continue;
    const entry = provider as Record<string, unknown>;
    if (typeof entry.apiKey === "string" && entry.apiKey) { entry.apiKey = ""; entry.apiKeyConfigured = true; }
  }
  return copy;
}

function mergeConfiguredSecrets(incoming: Record<string, unknown>, current: Record<string, unknown>): Record<string, unknown> {
  const next = structuredClone(incoming);
  const nextProviders = next.providers;
  const currentProviders = current.providers;
  if (!nextProviders || typeof nextProviders !== "object" || Array.isArray(nextProviders) || !currentProviders || typeof currentProviders !== "object" || Array.isArray(currentProviders)) return next;
  for (const [name, provider] of Object.entries(nextProviders as Record<string, unknown>)) {
    if (!provider || typeof provider !== "object" || Array.isArray(provider)) continue;
    const entry = provider as Record<string, unknown>;
    const previous = (currentProviders as Record<string, unknown>)[name];
    if (entry.apiKey === "" && entry.apiKeyConfigured === true && previous && typeof previous === "object" && !Array.isArray(previous)) entry.apiKey = (previous as Record<string, unknown>).apiKey;
    delete entry.apiKeyConfigured;
  }
  return next;
}

async function providerWithResolvedSecret(providerName: string, draft: unknown): Promise<Record<string, unknown>> {
  if (!draft || typeof draft !== "object" || Array.isArray(draft)) throw new Error("provider config is required");
  const provider = { ...(draft as Record<string, unknown>) };
  if (provider.apiKey === "" && provider.apiKeyConfigured === true) {
    const current = await readModelsConfig();
    const existing = current.providers && typeof current.providers === "object" && !Array.isArray(current.providers) ? (current.providers as Record<string, unknown>)[providerName] : undefined;
    if (existing && typeof existing === "object" && !Array.isArray(existing)) provider.apiKey = (existing as Record<string, unknown>).apiKey;
  }
  delete provider.apiKeyConfigured;
  return provider;
}

async function discoverProviderModels(providerName: string, draft: unknown): Promise<Array<{ id: string; name?: string }>> {
  const provider = await providerWithResolvedSecret(providerName, draft);
  const baseUrl = typeof provider.baseUrl === "string" ? provider.baseUrl.trim() : "";
  if (!baseUrl) throw new Error("请先填写 Base URL");
  const api = typeof provider.api === "string" ? provider.api : "openai-completions";
  const apiKey = typeof provider.apiKey === "string" ? provider.apiKey.trim() : "";
  if (!apiKey) throw new Error("请先填写 API Key");
  const url = new URL(baseUrl);
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("Base URL 只支持 HTTP 或 HTTPS");
  const cleanPath = url.pathname.replace(/\/+$/, "");
  if (!/\/models$/i.test(cleanPath)) {
    let path = cleanPath;
    if (api === "anthropic-messages" && !/\/v\d+(?:beta)?$/i.test(path)) path += "/v1";
    if (api === "google-generative-ai" && !/\/v\d+(?:beta)?$/i.test(path)) path += "/v1beta";
    url.pathname = `${path}/models`.replace(/\/+/g, "/");
  }
  if (api === "anthropic-messages") url.searchParams.set("limit", "1000");
  if (api === "google-generative-ai") { url.searchParams.set("pageSize", "1000"); url.searchParams.set("key", apiKey); }
  const headers: Record<string, string> = { accept: "application/json" };
  if (api === "anthropic-messages") { headers["x-api-key"] = apiKey; headers["anthropic-version"] = "2023-06-01"; }
  else if (api !== "google-generative-ai") headers.authorization = `Bearer ${apiKey}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  try {
    const response = await fetch(url, { headers, signal: controller.signal });
    if (!response.ok) throw new Error(`获取模型失败：HTTP ${response.status}`);
    const value = await response.json() as unknown;
    const record = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
    const source = Array.isArray(value) ? value : ["data", "models", "items", "results"].map((key) => record[key]).find(Array.isArray) ?? [];
    const seen = new Set<string>();
    return (source as unknown[]).flatMap((item) => {
      const entry = typeof item === "string" ? { id: item } : item && typeof item === "object" && !Array.isArray(item) ? item as Record<string, unknown> : null;
      const raw = entry && typeof entry.id === "string" ? entry.id : entry && typeof entry.name === "string" ? entry.name : "";
      const id = raw.startsWith("models/") ? raw.slice(7) : raw;
      if (!id || seen.has(id)) return [];
      seen.add(id);
      const name = entry && typeof entry.displayName === "string" ? entry.displayName : entry && typeof entry.display_name === "string" ? entry.display_name : undefined;
      return [{ id, ...(name ? { name } : {}) }];
    }).sort((left, right) => (left.name || left.id).localeCompare(right.name || right.id, undefined, { numeric: true }));
  } finally { clearTimeout(timer); }
}

async function testProviderModel(providerName: string, draftProvider: unknown, draftModel: unknown): Promise<Record<string, unknown>> {
  if (!draftModel || typeof draftModel !== "object" || Array.isArray(draftModel)) throw new Error("model config is required");
  const model = { ...(draftModel as Record<string, unknown>) };
  const modelId = typeof model.id === "string" ? model.id.trim() : "";
  if (!modelId) throw new Error("Model ID 不能为空");
  const provider = await providerWithResolvedSecret(providerName, draftProvider);
  const directory = await mkdtemp(`${tmpdir()}/multi-agent-model-test-`);
  const modelsPath = resolve(directory, "models.json");
  try {
    await writeFile(modelsPath, JSON.stringify({ providers: { [providerName]: { ...provider, models: [{ ...model, id: modelId }] } } }), { encoding: "utf8", mode: 0o600 });
    const runtime = await ModelRuntime.create({ modelsPath });
    if (runtime.getError()) throw new Error(runtime.getError());
    const target = runtime.getModel(providerName, modelId);
    if (!target) throw new Error(`模型未加载：${providerName}/${modelId}`);
    const startedAt = Date.now();
    const response = await runtime.completeSimple(target, { messages: [{ role: "user", content: "Reply with OK only.", timestamp: Date.now() }] }, { maxTokens: 16, maxRetries: 0, timeoutMs: 20_000, cacheRetention: "none" });
    if (response.stopReason === "error" || response.stopReason === "aborted") throw new Error(response.errorMessage || "模型测试失败");
    const responseText = response.content.filter((block) => block.type === "text").map((block) => block.text).join("").slice(0, 300);
    return { ok: true, latencyMs: Date.now() - startedAt, responseText, provider: providerName, model: modelId };
  } finally { await rm(directory, { recursive: true, force: true }); }
}

async function saveModelsConfig(config: unknown): Promise<void> {
  if (!config || typeof config !== "object" || Array.isArray(config)) throw new Error("model config must be an object");
  const merged = mergeConfiguredSecrets(config as Record<string, unknown>, await readModelsConfig());
  const providers = merged.providers;
  if (providers !== undefined && (!providers || typeof providers !== "object" || Array.isArray(providers))) throw new Error("providers must be an object");
  await mkdir(dirname(modelsConfigPath), { recursive: true });
  const temporary = `${modelsConfigPath}.tmp`;
  await writeFile(temporary, `${JSON.stringify(merged, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await rename(temporary, modelsConfigPath);
  await modelRuntime.refresh();
}

async function dispatch(request: Request): Promise<unknown> {
  const params = request.params ?? {};
  if (request.method === "capabilities.list") {
    const cwd = resolve(stringParam(params, "cwd"));
    const services = await createAgentSessionServices({ cwd, agentDir: getAgentDir() });
    const loaded = services.resourceLoader.getSkills();
    const tools = createCodingTools(cwd);
    return {
      skills: loaded.skills.map((skill) => ({ name: skill.name, description: skill.description, filePath: skill.filePath, source: skill.sourceInfo?.source || "runtime", disableModelInvocation: skill.disableModelInvocation })),
      skillDiagnostics: loaded.diagnostics.map((diagnostic) => ({ type: diagnostic.type, message: diagnostic.message, source: diagnostic.path })),
      tools: tools.map((tool) => ({ name: tool.name, description: tool.description, source: "pi-builtin" })),
      mcpServers: [],
      mcpSupported: false,
    };
  }
  if (request.method === "models.list") {
    const models = await modelRuntime.getAvailable();
    return {
      models: models.map((model) => ({
        provider: model.provider,
        id: model.id,
        name: model.name,
        reasoning: model.reasoning,
        contextWindow: model.contextWindow,
        maxTokens: model.maxTokens,
      })),
      error: modelRuntime.getError(),
    };
  }
  if (request.method === "models.config.get") return { config: redactModelsConfig(await readModelsConfig()), models: publicModels(), error: modelRuntime.getError() };
  if (request.method === "models.config.discover") {
    const providerName = stringParam(params, "providerName");
    return { models: await discoverProviderModels(providerName, params.provider) };
  }
  if (request.method === "models.config.test") {
    const providerName = stringParam(params, "providerName");
    return testProviderModel(providerName, params.provider, params.model);
  }
  if (request.method === "models.config.save") {
    await saveModelsConfig(params.config);
    await modelRuntime.getAvailable();
    return { config: redactModelsConfig(await readModelsConfig()), models: publicModels(), error: modelRuntime.getError() };
  }
  const sessionKey = stringParam(params, "sessionKey");

  if (request.method === "session.open") {
    const cwd = stringParam(params, "cwd");
    const hosted = await openSession(
      sessionKey,
      cwd,
      stringParam(params, "model", false),
      stringParam(params, "thinkingLevel", false),
    );
    return sessionState(hosted);
  }

  if (request.method === "session.replace") {
    return replaceSession(
      sessionKey,
      stringParam(params, "cwd"),
      stringParam(params, "model", false),
      stringParam(params, "thinkingLevel", false),
    );
  }

  const hosted = sessions.get(sessionKey);
  if (!hosted) throw new Error(`session is not open: ${sessionKey}`);
  hosted.lastActiveAt = Date.now();

  switch (request.method) {
    case "session.prompt": {
      const message = stringParam(params, "message");
      const runId = stringParam(params, "runId");
      if (hosted.session.isStreaming || hosted.activeRun.current) throw new Error("session is streaming; use steer or followUp");
      hosted.activeRun.begin(runId);
      void hosted.session.prompt(message).catch((error: unknown) => {
        emit({ type: "event", sessionKey, runId, event: { type: "host_error", error: error instanceof Error ? error.message : String(error) } });
        hosted.activeRun.finish(runId);
      });
      return { accepted: true };
    }
    case "session.steer":
      await hosted.session.steer(stringParam(params, "message"));
      return { accepted: true };
    case "session.followUp":
      await hosted.session.followUp(stringParam(params, "message"));
      return { accepted: true };
    case "session.abort":
      await hosted.session.abort();
      return { accepted: true };
    case "session.state":
      return {
        sessionId: hosted.session.sessionId,
        sessionFile: hosted.session.sessionFile,
        isStreaming: hosted.session.isStreaming,
        model: hosted.session.model ? `${hosted.session.model.provider}/${hosted.session.model.id}` : null,
        thinkingLevel: hosted.session.thinkingLevel,
        messageCount: hosted.session.messages.length,
      };
    case "session.close":
      await closeSession(sessionKey);
      return { closed: true };
    default:
      throw new Error(`unsupported method: ${request.method}`);
  }
}

const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
input.on("line", (line) => {
  if (!line.trim()) return;
  void (async () => {
    let request: Request;
    try {
      request = JSON.parse(line) as Request;
      if (!request.id || !request.method) throw new Error("id and method are required");
      const result = await dispatch(request);
      emit({ type: "response", id: request.id, success: true, result });
    } catch (error) {
      const id = (() => {
        try { return (JSON.parse(line) as Partial<Request>).id ?? ""; } catch { return ""; }
      })();
      emit({ type: "response", id, success: false, error: error instanceof Error ? error.message : String(error) });
    }
  })();
});

const evictor = setInterval(() => {
  const now = Date.now();
  for (const [key, hosted] of sessions) {
    if (!hosted.session.isStreaming && now - hosted.lastActiveAt >= idleMs) {
      void closeSession(key).catch((error) => log(`failed to evict ${key}`, error));
    }
  }
}, Math.min(idleMs, 60_000));
evictor.unref();

async function shutdown(): Promise<void> {
  clearInterval(evictor);
  await Promise.all([...sessions.keys()].map(closeSession));
  process.exit(0);
}
process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());

emit({ type: "host_ready", pid: process.pid });
