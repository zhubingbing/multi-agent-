export interface AgentEventLike { type: string; [key: string]: unknown }

type Indexed = { contentIndex: number };
type TextStart = Indexed & { type: "text_start" };
type TextDelta = Indexed & { type: "text_delta"; delta: string };
type TextEnd = Indexed & { type: "text_end"; content: string };
type ThinkingStart = Indexed & { type: "thinking_start" };
type ThinkingDelta = Indexed & { type: "thinking_delta"; delta: string };
type ThinkingEnd = Indexed & { type: "thinking_end"; content: string };
type ToolStart = Indexed & { type: "toolcall_start"; id?: string; toolName?: string; partial?: unknown };
type ToolDelta = Indexed & { type: "toolcall_delta"; delta: string; id?: string; toolName?: string; partial?: unknown };
type ToolEnd = Indexed & { type: "toolcall_end"; toolCall: { id: string; name: string; arguments: Record<string, unknown> } };
export type ClientAssistantMessageEvent = TextStart | TextDelta | TextEnd | ThinkingStart | ThinkingDelta | ThinkingEnd | ToolStart | ToolDelta | ToolEnd;
export type ClientMessageUpdateEvent = { type: "message_update"; assistantMessageEvent: ClientAssistantMessageEvent };

const OMITTED_EVENT_TYPES = new Set(["turn_start", "turn_end"]);
function isObject(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function toolCallMetadata(event: Record<string, unknown>): { id: string; toolName: string } | null {
  if ((event.type !== "toolcall_start" && event.type !== "toolcall_delta") || !isObject(event.partial)) return null;
  const content = event.partial.content;
  const contentIndex = event.contentIndex;
  if (!Array.isArray(content) || typeof contentIndex !== "number") return null;
  const block = content[contentIndex];
  if (!isObject(block) || block.type !== "toolCall") return null;
  const id = typeof block.id === "string" ? block.id : typeof block.toolCallId === "string" ? block.toolCallId : null;
  const toolName = typeof block.name === "string" ? block.name : typeof block.toolName === "string" ? block.toolName : null;
  return id !== null && toolName !== null ? { id, toolName } : null;
}

/** Project Pi runtime events into the stable browser event shape used by every chat surface. */
export function toClientAgentEvent(event: AgentEventLike): AgentEventLike | ClientMessageUpdateEvent | null {
  if (OMITTED_EVENT_TYPES.has(event.type)) return null;
  if (event.type === "message_update") {
    const assistantMessageEvent = event.assistantMessageEvent;
    if (!isObject(assistantMessageEvent)) return null;
    if (!("partial" in assistantMessageEvent)) return { type: "message_update", assistantMessageEvent } as ClientMessageUpdateEvent;
    const metadata = toolCallMetadata(assistantMessageEvent);
    const { partial: _partial, ...deltaEvent } = assistantMessageEvent;
    void _partial;
    return { type: "message_update", assistantMessageEvent: metadata ? { ...deltaEvent, ...metadata } : deltaEvent } as ClientMessageUpdateEvent;
  }
  if (event.type === "tool_execution_update") return { type: "tool_execution_update", toolCallId: event.toolCallId, toolName: event.toolName, partialResult: event.partialResult };
  if (event.type === "agent_end") return { type: "agent_end" };
  return event;
}

export function isEventIncludedInSnapshot(event: AgentEventLike, snapshot: unknown): boolean {
  return snapshot !== undefined && (event.type === "message_start" || event.type === "message_update") && event.message === snapshot;
}
