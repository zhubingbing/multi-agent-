import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { captureScrollDistance, getLiveFollowAttached, getNextVisibleCount, getVisibleRenderWindow, restoreScrollTop, VISIBLE_PAGE_SIZE, type GroupConversationTurn } from "@multi-agent/chat-core";
import { AgentRunView, UserMessageView } from "./WorkbenchMessageView";

type Agent = { id: string; name: string; runtime?: string; cwd?: string; online?: boolean };

export function ConversationTimeline({ conversationId, turns, agents, onEdit, onReply, onControl }: {
  conversationId: string;
  turns: GroupConversationTurn[];
  agents: Agent[];
  onEdit?: (text: string) => void;
  onReply?: (turnId: string, messageId: string, text: string) => void;
  onControl?: (agentId: string, type: "steer" | "follow_up" | "abort", message?: string) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const followTailRef = useRef(true);
  const previousScrollTopRef = useRef(0);
  const restoreDistanceRef = useRef<number | null>(null);
  const [visibleCount, setVisibleCount] = useState(VISIBLE_PAGE_SIZE);

  useEffect(() => {
    setVisibleCount(VISIBLE_PAGE_SIZE);
    followTailRef.current = true;
    previousScrollTopRef.current = 0;
    restoreDistanceRef.current = null;
  }, [conversationId]);

  useLayoutEffect(() => {
    const container = scrollRef.current;
    if (!container) return;
    if (restoreDistanceRef.current !== null) {
      container.scrollTop = restoreScrollTop(container.scrollHeight, restoreDistanceRef.current);
      restoreDistanceRef.current = null;
    } else if (followTailRef.current) container.scrollTop = container.scrollHeight;
    previousScrollTopRef.current = container.scrollTop;
  }, [turns, visibleCount]);

  const { startIndex, hasMore } = getVisibleRenderWindow(turns.length, visibleCount);
  const visible = turns.slice(startIndex);
  const revealEarlier = () => {
    const container = scrollRef.current;
    if (container) restoreDistanceRef.current = captureScrollDistance(container.scrollHeight, container.scrollTop);
    followTailRef.current = false;
    setVisibleCount((count) => getNextVisibleCount(count));
  };

  return <div className="timeline" ref={scrollRef} onScroll={(event) => {
    const target = event.currentTarget;
    followTailRef.current = getLiveFollowAttached(followTailRef.current, previousScrollTopRef.current, target.scrollTop, target.clientHeight, target.scrollHeight);
    previousScrollTopRef.current = target.scrollTop;
  }}>
    {hasMore && <div className="load-history"><button type="button" onClick={revealEarlier}>加载更早消息</button></div>}
    {turns.length === 0 && <div className="timeline-empty">描述目标，AI 分身会理解任务、使用工具并持续推进。</div>}
    {visible.map((turn) => <section className="conversation-turn" id={turn.id} key={turn.id}>
      {turn.user.replyToText && <div className="reply-reference">回复：{turn.user.replyToText}</div>}
      <UserMessageView message={turn.user} onEdit={onEdit} onReply={onReply ? (text) => onReply(turn.id, `message-${turn.id}`, text) : undefined}/>
      {turn.runs.map((run) => <AgentRunView key={run.id} run={run} agent={agents.find((agent) => agent.id === run.agentId)} onControl={onControl} onReply={onReply ? (text) => onReply(turn.id, run.finalMessageId || `message-${run.id}`, text) : undefined}/>) }
    </section>)}
  </div>;
}
