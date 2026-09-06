import {
  INITIAL_STREAMING_STATE,
  normalizeToolCalls,
  streamReducer,
  toClientAgentEvent,
  type AgentEventLike,
  type AgentMessage,
  type AssistantMessage,
  type ClientAssistantMessageEvent,
  type StreamingState,
} from "@multi-agent/chat-core";

export type { AssistantMessage } from "@multi-agent/chat-core";
export type AgentSessionEvent = AgentEventLike;
export type LiveRun = {
  id: string;
  agentId: string;
  status: "queued" | "running" | "failed";
  messages: AgentMessage[];
  stream: StreamingState;
  error?: string;
};

/** Workbench run adapter over the same reducer and event projection used by pi-web. */
export function reduceLiveRun(run: LiveRun, rawEvent: AgentSessionEvent): LiveRun {
  const event = toClientAgentEvent(rawEvent) as (AgentEventLike & {
    message?: AgentMessage;
    assistantMessageEvent?: ClientAssistantMessageEvent;
    error?: unknown;
  }) | null;
  if (!event) return run;
  switch (event.type) {
    case "agent_start":
      return { ...run, status: "running", stream: streamReducer(run.stream, { type: "start" }) };
    case "message_start":
      return event.message?.role === "assistant" ? { ...run, stream: streamReducer(run.stream, { type: "snapshot", message: event.message }) } : run;
    case "message_update":
      return event.assistantMessageEvent ? { ...run, stream: streamReducer(run.stream, { type: "delta", event: event.assistantMessageEvent }) } : run;
    case "message_end": {
      if (!event.message || event.message.role === "user") return run;
      return { ...run, messages: [...run.messages, normalizeToolCalls(event.message)], stream: streamReducer(run.stream, { type: "end" }) };
    }
    case "host_error":
      return { ...run, status: "failed", stream: INITIAL_STREAMING_STATE, error: String(event.error ?? "Agent failed") };
    default:
      return run;
  }
}

export function emptyLiveRun(id: string, agentId: string, status: LiveRun["status"] = "running"): LiveRun {
  return { id, agentId, status, messages: [], stream: INITIAL_STREAMING_STATE };
}

export function assistantMessages(messages: AgentMessage[]): AssistantMessage[] {
  return messages.filter((message): message is AssistantMessage => message.role === "assistant");
}
