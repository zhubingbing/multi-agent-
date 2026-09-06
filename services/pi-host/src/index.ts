import { createInterface } from "node:readline";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  createAgentSession,
  ModelRuntime,
  SessionManager,
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

async function dispatch(request: Request): Promise<unknown> {
  const params = request.params ?? {};
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
