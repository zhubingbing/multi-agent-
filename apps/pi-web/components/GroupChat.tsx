"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChatInput, type ChatInputHandle } from "@/components/ChatInput";
import type { AgentRunControl } from "@/components/ConversationAgentRunView";
import { ConversationTimeline } from "@/components/ConversationTimeline";
import { toClientAgentEvent, type AgentEventLike } from "@/lib/agent-event-wire";
import { INITIAL_STREAMING_STATE, streamReducer, type ClientAssistantMessageEvent } from "@/lib/streaming-message";
import { ControlConversationAdapter } from "@/lib/control-conversation-adapter";
import type { ConversationAgent as AgentInfo, ConversationBinding, ConversationConnectionState, ConversationWireEvent as WireEvent } from "@/lib/conversation-adapter";
import { mergeGroupConversationTurns, type GroupAgentRun as AgentRun, type GroupConversationTurn as ConversationTurn } from "@/lib/group-conversation-state";
import { normalizeToolCalls } from "@/lib/normalize";
import type { AgentMessage } from "@/lib/types";

type PiWireEvent = {
  type?: string;
  message?: AgentMessage;
  assistantMessageEvent?: ClientAssistantMessageEvent;
  error?: unknown;
};

function runtimeCursorKey(runtimeId: string, instanceId: string): string {
  return `${runtimeId}\u0000${instanceId}`;
}

export function GroupChat({
  conversationId: providedConversationId,
  title = "Multi Agent Conversation",
  participantAgentIds,
  onCreateThread,
}: {
  conversationId?: string;
  title?: string;
  participantAgentIds?: string[];
  onCreateThread?: (rootTurnId: string) => void;
}) {
  const [generatedConversationId] = useState(() => `group-${crypto.randomUUID()}`);
  const conversationId = providedConversationId ?? generatedConversationId;
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [bindings, setBindings] = useState<ConversationBinding[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [executionMode, setExecutionMode] = useState<"parallel" | "sequential">("sequential");
  const [turns, setTurns] = useState<ConversationTurn[]>([]);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [replyTarget, setReplyTarget] = useState<{ turnId: string; messageId: string; text: string } | null>(null);
  const [connected, setConnected] = useState(false);
  const [notice, setNotice] = useState("正在连接 Control Server…");
  const adapter = useMemo(() => new ControlConversationAdapter(conversationId), [conversationId]);
  const runtimeCursorsRef = useRef(new Map<string, number>());
  const inputRef = useRef<ChatInputHandle>(null);

  const activeAgentIds = useMemo(() => turns.flatMap((turn) => turn.runs.filter((run) => !run.settled && run.status !== "queued").map((run) => run.agentId)), [turns]);
  const isStreaming = activeAgentIds.length > 0;

  const updateRun = useCallback((agentId: string, update: (run: AgentRun) => AgentRun, runId?: string) => {
    setTurns((current) => {
      const next = [...current];
      for (let turnIndex = next.length - 1; turnIndex >= 0; turnIndex--) {
        const runIndex = next[turnIndex].runs.findIndex((run) => (
          !run.settled && (runId ? run.id === runId : run.agentId === agentId)
        ));
        if (runIndex < 0) continue;
        const runs = [...next[turnIndex].runs];
        runs[runIndex] = update(runs[runIndex]);
        next[turnIndex] = { ...next[turnIndex], runs };
        break;
      }
      return next;
    });
  }, []);

  const handleAgentEvent = useCallback((agentId: string, rawEvent: PiWireEvent, runId?: string) => {
    const event = toClientAgentEvent(rawEvent as AgentEventLike) as PiWireEvent | null;
    if (!event) return;
    updateRun(agentId, (run) => {
      switch (event.type) {
        case "agent_start":
          return { ...run, status: "running", stream: streamReducer(run.stream, { type: "start" }) };
        case "message_start":
          return event.message?.role === "assistant"
            ? { ...run, stream: streamReducer(run.stream, { type: "snapshot", message: event.message }) }
            : run;
        case "message_update":
          return event.assistantMessageEvent
            ? { ...run, stream: streamReducer(run.stream, { type: "delta", event: event.assistantMessageEvent }) }
            : run;
        case "message_end": {
          const completed = event.message;
          if (!completed || completed.role === "user") return run;
          return {
            ...run,
            messages: [...run.messages, normalizeToolCalls(completed)],
            stream: streamReducer(run.stream, { type: "end" }),
          };
        }
        case "agent_settled":
          return { ...run, finalMessageId: run.finalMessageId ?? `message-${run.id}`, status: "settled", settled: true, stream: INITIAL_STREAMING_STATE };
        case "host_error":
          return { ...run, settled: true, stream: INITIAL_STREAMING_STATE, error: String(event.error ?? "Agent failed") };
        default:
          return run;
      }
    }, runId);
  }, [updateRun]);

  const loadHistory = useCallback(async () => {
    try {
      const data = await adapter.loadSnapshot();
      for (const cursor of data.cursors) {
        const key = runtimeCursorKey(cursor.runtimeId, cursor.instanceId);
        runtimeCursorsRef.current.set(key, Math.max(runtimeCursorsRef.current.get(key) ?? 0, cursor.sequence));
      }
      setTurns((current) => mergeGroupConversationTurns(current, data.turns));
      setBindings(data.bindings);
      if (data.currentVersion > 0) {
        void fetch("/api/multi-agent/read-cursors", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ conversationId, participantType: "member", participantId: "local-user", lastSeenVersion: data.currentVersion }),
        });
      }
    } catch (error) {
      setNotice(`无法读取历史：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setHistoryLoaded(true);
    }
  }, [adapter, conversationId]);

  useEffect(() => {
    void adapter.loadAgents().then((available) => {
      const participants = participantAgentIds?.length
        ? participantAgentIds.flatMap((id) => {
            const agent = available.find((candidate) => candidate.id === id);
            return agent ? [agent] : [];
          })
        : available;
      setAgents(participants);
      const firstOnline = participants.find((agent) => agent.online);
      setSelected(firstOnline ? [firstOnline.id] : []);
    }).catch(() => setNotice("无法读取 Agent 列表"));

    const handleStateChange = (state: ConversationConnectionState) => {
      setConnected(state === "connected");
      if (state === "connecting") setNotice("正在连接 Control Server…");
      if (state === "connected") setNotice("Control Server 已连接");
      if (state === "reconnecting") setNotice("Control Server 已断开，正在重连…");
    };
    const disconnect = adapter.connect({
      onStateChange: handleStateChange,
      onReconnect: () => { void loadHistory(); },
      onEvent: (wire: WireEvent) => {
        if (wire.runtimeId && wire.instanceId && wire.runtimeSeq) {
          const key = runtimeCursorKey(wire.runtimeId, wire.instanceId);
          const current = runtimeCursorsRef.current.get(key) ?? 0;
          if (wire.runtimeSeq <= current) return;
          runtimeCursorsRef.current.set(key, wire.runtimeSeq);
        }
        if (wire.type === "agent_event" && wire.agentId && wire.event) {
          handleAgentEvent(wire.agentId, wire.event as PiWireEvent, wire.runId);
        }
        if (wire.type === "conversation_committed" || wire.type === "inbox_dispatched" || wire.type === "sequential_dispatched") void loadHistory();
        if (wire.type === "agent_error" && wire.agentId) {
          updateRun(wire.agentId, (run) => ({ ...run, status: "failed", settled: true, error: wire.error ?? "Runtime error" }), wire.runId);
        }
        if (wire.type === "persistence_error") {
          if (wire.turnId) setTurns((current) => current.filter((turn) => turn.id !== wire.turnId));
          setNotice(`消息持久化失败：${wire.error ?? "unknown error"}`);
        }
        if (wire.type === "dispatched") setNotice(`已派发给 ${(wire.agentIds ?? []).length} 个 Agent`);
      },
    });
    return disconnect;
  }, [adapter, handleAgentEvent, loadHistory, participantAgentIds, updateRun]);

  useEffect(() => {
    setHistoryLoaded(false);
    void loadHistory();
  }, [loadHistory]);

  const sendAgentControl = (agentId: string, type: AgentRunControl, message = "") => {
    if (!adapter.send({ type, message, agentIds: [agentId] })) {
      setNotice("Control Server 尚未连接，命令未发送");
    }
  };

  const sendCommand = (type: "prompt" | "steer" | "follow_up" | "abort", message = "") => {
    const targets = type === "prompt" ? selected : activeAgentIds;
    if (!adapter.send({ type, message, agentIds: targets })) setNotice("Control Server 尚未连接，命令未发送");
  };

  const handleSend = (message: string) => {
    if (!historyLoaded) return;
    if (!connected) {
      setNotice("Control Server 尚未连接，消息未发送");
      return;
    }
    const normalized = message.toLocaleLowerCase();
    const mentioned = agents
      .map((agent) => ({
        agent,
        index: Math.min(...[
          normalized.indexOf(`@${agent.id.toLocaleLowerCase()}`),
          normalized.indexOf(`@${agent.name.toLocaleLowerCase()}`),
        ].filter((index) => index >= 0)),
      }))
      .filter((value) => Number.isFinite(value.index))
      .sort((left, right) => left.index - right.index)
      .map((value) => value.agent);
    const requestedIds = mentioned.length > 0 ? mentioned.map((agent) => agent.id) : selected;
    const targets = requestedIds.filter((id) => agents.some((agent) => agent.id === id && agent.online));
    if (!message.trim() || targets.length === 0) return;
    const createdAt = Date.now();
    const runs: AgentRun[] = targets.map((agentId, index) => ({
      id: crypto.randomUUID(), agentId, messages: [], stream: INITIAL_STREAMING_STATE,
      status: executionMode === "sequential" && targets.length > 1 && index > 0 ? "queued" : "running",
      settled: false,
    }));
    const turn: ConversationTurn = {
      id: crypto.randomUUID(),
      user: {
        role: "user",
        content: message,
        timestamp: createdAt,
        authorType: "member",
        authorId: "local-user",
        ...(replyTarget ? { replyToTurnId: replyTarget.turnId, replyToText: replyTarget.text } : {}),
      },
      runs,
    };
    setTurns((current) => [...current, turn]);
    if (!adapter.send({
      type: "prompt",
      message,
      agentIds: targets,
      turnId: turn.id,
      createdAt,
      runIds: Object.fromEntries(runs.map((run) => [run.agentId, run.id])),
      replyToTurnId: replyTarget?.turnId,
      replyToMessageId: replyTarget?.messageId,
      executionMode: targets.length > 1 ? executionMode : "parallel",
    })) {
      setTurns((current) => current.filter((candidate) => candidate.id !== turn.id));
      setNotice("Control Server 尚未连接，消息未发送");
    } else {
      setReplyTarget(null);
    }
  };

  const replaceAgentSession = async (agent: AgentInfo) => {
    const binding = bindings.find((candidate) => candidate.agentId === agent.id);
    if (!binding || activeAgentIds.includes(agent.id)) return;
    if (!window.confirm(`Replace ${agent.name} Session generation ${binding.generation}？Conversation 和消息会保留。`)) return;
    const response = await fetch(`/api/multi-agent/bindings/${encodeURIComponent(conversationId)}/${encodeURIComponent(agent.id)}/replace`, { method: "POST" });
    if (!response.ok) {
      window.alert(`Replace Session 失败：${await response.text()}`);
      return;
    }
    const data = await response.json() as { binding: ConversationBinding };
    setBindings((current) => current.map((candidate) => candidate.agentId === agent.id ? data.binding : candidate));
    setNotice(`${agent.name} Session 正在替换；下一条消息将对账新 Session`);
  };

  return <div style={{ display: "flex", flexDirection: "column", width: "100%", height: "100%", minWidth: 0, background: "var(--bg)" }}>
    <header style={{ display: "flex", alignItems: "center", gap: 12, minHeight: 44, padding: "6px 12px", borderBottom: "1px solid var(--border)", background: "var(--bg-panel)" }}>
      <strong style={{ fontFamily: "var(--font-mono)" }}>{title}</strong>
      <div style={{ display: "flex", gap: 6 }}>
        {agents.map((agent) => {
          const agentRunning = activeAgentIds.includes(agent.id);
          const binding = bindings.find((candidate) => candidate.agentId === agent.id);
          const bindingDetails = binding
            ? `Session ${binding.nativeSessionId} · generation ${binding.generation} · ${binding.effectiveProvider}/${binding.effectiveModel} · ${binding.effectiveThinkingLevel} · ${binding.effectiveCwd}`
            : "Session 尚未创建";
          return <span key={agent.id} style={{ display: "inline-flex", gap: 3 }}>
            <button type="button" onClick={() => setSelected((current) => current.includes(agent.id) ? current.filter((id) => id !== agent.id) : [...current, agent.id])} title={`${agent.provider} · ${agent.runtime} · ${agent.cwd} · ${bindingDetails}`} style={{ padding: "5px 9px", border: `1px solid ${selected.includes(agent.id) ? "var(--accent)" : "var(--border)"}`, borderRadius: 6, background: selected.includes(agent.id) ? "var(--user-bg)" : "var(--bg)", color: agent.online ? "var(--text)" : "var(--text-dim)", cursor: agent.online ? "pointer" : "not-allowed" }} disabled={!agent.online}>
              @{agent.name} · {agent.runtime} {agentRunning ? "◉ Running" : agent.online ? "● Ready" : "○ Offline"}
            </button>
            {binding && <button type="button" onClick={() => void replaceAgentSession(agent)} disabled={agentRunning || !agent.online} title={`Replace Session · generation ${binding.generation}`} style={{ padding: "0 6px", border: "1px solid var(--border)", borderRadius: 6, background: "var(--bg)", color: "var(--text-muted)", cursor: agentRunning || !agent.online ? "not-allowed" : "pointer" }}>↻</button>}
          </span>;
        })}
      </div>
      <select value={executionMode} onChange={(event) => setExecutionMode(event.target.value as "parallel" | "sequential")} title="Multi-Agent execution mode" style={{ height: 29, border: "1px solid var(--border)", borderRadius: 6, background: "var(--bg)", color: "var(--text-muted)", fontSize: 11 }}>
        <option value="sequential">Sequential shared context</option>
        <option value="parallel">Parallel independent</option>
      </select>
      <span role="status" aria-live="polite" style={{ marginLeft: "auto", color: connected ? "var(--text-muted)" : "#ef4444", fontSize: 11 }}>{notice}</span>
    </header>

    <ConversationTimeline
      conversationId={conversationId}
      turns={turns}
      agents={agents}
      selectedAgentIds={selected}
      onEditUserMessage={(message) => inputRef.current?.replaceMessage(message)}
      onAgentControl={sendAgentControl}
      onCreateThread={onCreateThread}
      onReply={(turnId, messageId, text) => setReplyTarget({ turnId, messageId, text })}
    />

    <div style={{ flexShrink: 0, borderTop: "1px solid var(--border)", background: "var(--bg)" }}>
      {replyTarget && <div style={{ display: "flex", alignItems: "center", gap: 8, maxWidth: 900, margin: "0 auto", padding: "7px 14px", color: "var(--text-muted)", fontSize: 11 }}>
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>回复：{replyTarget.text}</span>
        <button type="button" onClick={() => setReplyTarget(null)} aria-label="取消回复" style={{ marginLeft: "auto", border: 0, background: "transparent", color: "var(--text-muted)", cursor: "pointer" }}>×</button>
      </div>}
      {isStreaming && <div style={{ display: "flex", justifyContent: "center", gap: 8, paddingTop: 6 }}>
        <button type="button" onClick={() => { const text = window.prompt("立即调整方向"); if (text) sendCommand("steer", text); }}>Steer</button>
        <button type="button" onClick={() => { const text = window.prompt("完成后继续"); if (text) sendCommand("follow_up", text); }}>Follow-up</button>
      </div>}
      <ChatInput
        ref={inputRef}
        onSend={handleSend}
        onAbort={() => sendCommand("abort")}
        isStreaming={isStreaming}
        mentions={agents.map((agent) => ({
          id: agent.id,
          label: agent.name,
          description: `${agent.provider} · ${agent.runtime}`,
          kind: "agent" as const,
        }))}
        draftKey={conversationId}
      />
    </div>
  </div>;
}
