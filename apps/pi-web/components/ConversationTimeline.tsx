"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ChatMinimap } from "@/components/ChatMinimap";
import { ConversationAgentRunView, type AgentRunControl } from "@/components/ConversationAgentRunView";
import { MessageView } from "@/components/MessageView";
import {
  captureScrollDistance,
  getNextVisibleCount,
  getVisibleRenderWindow,
  isScrollAtTail,
  restoreScrollTop,
  VISIBLE_PAGE_SIZE,
} from "@/lib/chat-lazy-load";
import type { ConversationAgent } from "@/lib/conversation-adapter";
import type { GroupConversationTurn } from "@/lib/group-conversation-state";
import { buildConversationMinimap } from "@/lib/conversation-minimap";
import type { UserMessage } from "@/lib/types";

export function ConversationTimeline({
  conversationId,
  turns,
  agents,
  selectedAgentIds,
  onEditUserMessage,
  onAgentControl,
  onCreateThread,
  onReply,
}: {
  conversationId: string;
  turns: GroupConversationTurn[];
  agents: ConversationAgent[];
  selectedAgentIds: string[];
  onEditUserMessage?: (message: UserMessage) => void;
  onAgentControl?: (agentId: string, type: AgentRunControl, message?: string) => void;
  onCreateThread?: (rootTurnId: string) => void;
  onReply?: (turnId: string, messageId: string, text: string) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const messageRefs = useRef<(HTMLDivElement | null)[]>([]);
  const followTailRef = useRef(true);
  const restoreDistanceRef = useRef<number | null>(null);
  const handledHashRef = useRef("");
  const [visibleCount, setVisibleCount] = useState(VISIBLE_PAGE_SIZE);

  useEffect(() => {
    setVisibleCount(VISIBLE_PAGE_SIZE);
    followTailRef.current = true;
    restoreDistanceRef.current = null;
    handledHashRef.current = "";
  }, [conversationId]);

  useEffect(() => {
    if (typeof window === "undefined" || !window.location.hash) return;
    const turnId = decodeURIComponent(window.location.hash.slice(1));
    const hashKey = `${conversationId}:${turnId}`;
    if (handledHashRef.current === hashKey || !turns.some((turn) => turn.id === turnId)) return;
    handledHashRef.current = hashKey;
    setVisibleCount(turns.length);
    requestAnimationFrame(() => document.getElementById(turnId)?.scrollIntoView({ behavior: "smooth", block: "center" }));
  }, [conversationId, turns]);

  useLayoutEffect(() => {
    const container = scrollRef.current;
    if (!container) return;
    if (restoreDistanceRef.current !== null) {
      container.scrollTop = restoreScrollTop(container.scrollHeight, restoreDistanceRef.current);
      restoreDistanceRef.current = null;
      return;
    }
    if (followTailRef.current) container.scrollTop = container.scrollHeight;
  }, [turns, visibleCount]);

  const { startIndex, hasMore } = getVisibleRenderWindow(turns.length, visibleCount);
  const visibleTurns = turns.slice(startIndex);
  const selectedCwd = agents.find((agent) => selectedAgentIds.includes(agent.id))?.cwd;
  const minimap = useMemo(() => buildConversationMinimap(turns), [turns]);
  messageRefs.current.length = minimap.messages.length;

  const revealEarlier = () => {
    const container = scrollRef.current;
    if (container) restoreDistanceRef.current = captureScrollDistance(container.scrollHeight, container.scrollTop);
    followTailRef.current = false;
    setVisibleCount((current) => getNextVisibleCount(current));
  };

  const revealAllHistory = () => {
    const container = scrollRef.current;
    if (container) restoreDistanceRef.current = captureScrollDistance(container.scrollHeight, container.scrollTop);
    followTailRef.current = false;
    setVisibleCount(turns.length);
  };

  return <div style={{ display: "flex", flex: 1, minHeight: 0, minWidth: 0 }}>
    <div
    ref={scrollRef}
    data-conversation-timeline={conversationId}
    onScroll={(event) => {
      const container = event.currentTarget;
      followTailRef.current = isScrollAtTail(container.scrollTop, container.clientHeight, container.scrollHeight);
    }}
    style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "28px max(24px, calc((100% - 900px) / 2))" }}
  >
    {hasMore && <div style={{ padding: "0 0 16px", textAlign: "center" }}>
      <button type="button" onClick={revealEarlier} style={{ color: "var(--text-muted)", fontSize: 12 }}>
        加载更早消息
      </button>
    </div>}
    {turns.length === 0 && <div style={{ marginTop: "25vh", color: "var(--text-muted)", textAlign: "center" }}>
      选择在线 Agent，在同一段 Conversation 中发送消息。
    </div>}
    {visibleTurns.map((turn) => {
      const anchor = minimap.anchors.get(turn.id);
      return <section id={turn.id} key={turn.id} data-turn-id={turn.id} style={{ marginBottom: 22 }}>
      <div ref={(element) => { if (anchor) messageRefs.current[anchor.user] = element; }}>
        {turn.user.authorId && <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 3, color: "var(--text-dim)", fontSize: 10 }}>
          {turn.user.authorId === "local-user" ? "You" : turn.user.authorId}
        </div>}
        {turn.user.replyToTurnId && <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 4 }}>
          <div style={{ maxWidth: "75%", padding: "5px 9px", borderRight: "2px solid var(--accent)", color: "var(--text-dim)", fontSize: 11, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            回复：{turn.user.replyToText ?? turn.user.replyToTurnId}
          </div>
        </div>}
        <MessageView
        message={turn.user}
        cwd={selectedCwd}
        entryId={turn.id}
        onEditContent={onEditUserMessage}
        showTimestamp
        />
        {onCreateThread && <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: -10, marginBottom: 8 }}>
          {onReply && <button type="button" onClick={() => onReply(turn.id, `message-${turn.id}`, typeof turn.user.content === "string" ? turn.user.content : turn.user.content.filter((block) => block.type === "text").map((block) => block.text).join("\n"))} style={{ border: 0, background: "transparent", color: "var(--text-dim)", cursor: "pointer", fontSize: 11 }}>
            回复
          </button>}
          <button type="button" onClick={() => onCreateThread(turn.id)} style={{ border: 0, background: "transparent", color: "var(--text-dim)", cursor: "pointer", fontSize: 11 }}>
            ↳ 新建 Thread
          </button>
        </div>}
        {!onCreateThread && onReply && <div style={{ display: "flex", justifyContent: "flex-end", marginTop: -10, marginBottom: 8 }}>
          <button type="button" onClick={() => onReply(turn.id, `message-${turn.id}`, typeof turn.user.content === "string" ? turn.user.content : turn.user.content.filter((block) => block.type === "text").map((block) => block.text).join("\n"))} style={{ border: 0, background: "transparent", color: "var(--text-dim)", cursor: "pointer", fontSize: 11 }}>回复</button>
        </div>}
      </div>
      {turn.runs.map((run) => {
        const answerIndex = anchor?.runs.get(run.id);
        return <div key={run.id} ref={(element) => { if (answerIndex !== undefined) messageRefs.current[answerIndex] = element; }}>
          <ConversationAgentRunView
        run={run}
        agent={agents.find((agent) => agent.id === run.agentId)}
        onControl={onAgentControl}
        onReply={onReply ? (messageId, text) => onReply(turn.id, messageId, text) : undefined}
          />
        </div>;
      })}
      </section>;
    })}
    </div>
    <ChatMinimap
      messages={minimap.messages}
      streamingMessage={null}
      scrollContainer={scrollRef}
      messageRefs={messageRefs}
      onRevealHistory={revealAllHistory}
    />
  </div>;
}
