"use client";

import { MessageView } from "@/components/MessageView";
import { ConversationProcessDetails } from "@/components/ConversationProcessDetails";
import { countToolCallBlocks, getDisplayableAssistantBlocks } from "@/lib/message-display";
import { hasDisplayableProcessMessage, presentAssistantTurn } from "@/lib/conversation-turn-presentation";
import type { ConversationAgent } from "@/lib/conversation-adapter";
import type { GroupAgentRun } from "@/lib/group-conversation-state";
import type { AgentMessage, AssistantMessage, ToolResultMessage } from "@/lib/types";

function toolResults(messages: AgentMessage[]): Map<string, ToolResultMessage> {
  const result = new Map<string, ToolResultMessage>();
  for (const message of messages) {
    if (message.role === "toolResult") result.set(message.toolCallId, message);
  }
  return result;
}

export type AgentRunControl = "steer" | "follow_up" | "abort";

export function ConversationAgentRunView({
  run,
  agent,
  onControl,
  onReply,
}: {
  run: GroupAgentRun;
  agent?: ConversationAgent;
  onControl?: (agentId: string, type: AgentRunControl, message?: string) => void;
  onReply?: (messageId: string, text: string) => void;
}) {
  const presentation = run.settled
    ? presentAssistantTurn(run.messages)
    : {
        processMessages: run.messages.filter(hasDisplayableProcessMessage),
        finalProcessMessage: null,
        finalAnswerMessage: null,
      };
  const { processMessages, finalProcessMessage } = presentation;
  const finalAnswerMessage = run.finalMessage ?? presentation.finalAnswerMessage;
  const results = toolResults(run.messages);
  const live = run.stream.streamingMessage;
  const toolCount = run.messages.reduce((count, message) => (
    message.role === "assistant"
      ? count + countToolCallBlocks(getDisplayableAssistantBlocks(message as AssistantMessage))
      : count
  ), live ? countToolCallBlocks(getDisplayableAssistantBlocks(live)) : 0);
  const processCount = processMessages.length + (finalProcessMessage ? 1 : 0) + (live && !run.settled ? 1 : 0);
  const cwd = agent?.cwd ?? "";
  const finalText = finalAnswerMessage?.content
    .filter((block) => block.type === "text")
    .map((block) => block.type === "text" ? block.text : "")
    .join("\n")
    .trim() ?? "";

  const promptControl = (type: "steer" | "follow_up", label: string) => {
    const message = window.prompt(label);
    if (message?.trim()) onControl?.(run.agentId, type, message.trim());
  };

  return <article data-agent-id={run.agentId} data-run-id={run.id} style={{ marginLeft: 18, marginBottom: 18 }}>
    <header style={{ display: "flex", alignItems: "center", gap: 8, minHeight: 24, marginBottom: 5, color: "var(--text-dim)", fontSize: 11 }}>
      <span aria-hidden="true" style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 20, height: 20, borderRadius: "50%", background: "var(--bg-selected)", color: "var(--text-muted)", fontWeight: 700 }}>
        {(agent?.name ?? run.agentId).slice(0, 1).toUpperCase()}
      </span>
      <span>{agent?.name ?? run.agentId} · {agent?.runtime ?? "Runtime"}</span>
      <span style={{ color: run.error ? "#ef4444" : run.status === "queued" ? "var(--text-dim)" : run.settled ? "var(--text-dim)" : "var(--accent)" }}>
        {run.error ? "Failed" : run.status === "queued" ? "Queued" : run.settled ? "Completed" : "Running"}
      </span>
      {!run.settled && run.status !== "queued" && onControl && <span role="group" aria-label={`Control ${agent?.name ?? run.agentId}`} style={{ display: "inline-flex", gap: 4, marginLeft: "auto" }}>
        <button type="button" onClick={() => promptControl("steer", `立即调整 ${agent?.name ?? run.agentId}`)} style={{ fontSize: 11 }}>Steer</button>
        <button type="button" onClick={() => promptControl("follow_up", `完成后继续 ${agent?.name ?? run.agentId}`)} style={{ fontSize: 11 }}>Follow-up</button>
        <button type="button" onClick={() => onControl(run.agentId, "abort")} style={{ fontSize: 11, color: "#ef4444" }}>Stop</button>
      </span>}
    </header>
    {processCount > 0 && <ConversationProcessDetails
      messageCount={processCount}
      toolCallCount={toolCount}
      defaultExpanded={!run.settled}
    >
      {processMessages.map((message, index) => <MessageView
        key={`${run.id}-process-${index}`}
        message={message}
        toolResults={results}
        cwd={cwd}
        showTimestamp
        prevTimestamp={index > 0 ? processMessages[index - 1].timestamp : undefined}
      />)}
      {finalProcessMessage && <MessageView
        message={finalProcessMessage}
        toolResults={results}
        cwd={cwd}
      />}
      {live && !run.settled && <MessageView
        message={live}
        isStreaming
        toolResults={results}
        cwd={cwd}
      />}
    </ConversationProcessDetails>}
    {finalAnswerMessage && <>
      <MessageView message={finalAnswerMessage} toolResults={results} cwd={cwd} entryId={run.finalMessageId} showTimestamp />
      {onReply && run.finalMessageId && finalText && <div style={{ display: "flex", justifyContent: "flex-start", marginTop: -12, marginBottom: 10 }}>
        <button type="button" onClick={() => onReply(run.finalMessageId!, finalText)} style={{ border: 0, background: "transparent", color: "var(--text-dim)", cursor: "pointer", fontSize: 11 }}>回复</button>
      </div>}
    </>}
    {run.error && <div role="alert" style={{ color: "#ef4444", fontSize: 12 }}>Error: {run.error}</div>}
  </article>;
}
