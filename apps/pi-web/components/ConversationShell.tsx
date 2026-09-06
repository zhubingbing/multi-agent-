"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { GroupChat } from "@/components/GroupChat";
import { WorkspaceModeNav } from "@/components/WorkspaceModeNav";
import { conversationUrl, resolveConversationId } from "@/lib/conversation-navigation";
import styles from "./ConversationShell.module.css";

type AgentInfo = { id: string; name: string; handle?: string; description?: string; instructions?: string; runtime: string; provider: string; cwd?: string; online: boolean; desiredProvider?: string; desiredModel?: string; desiredThinkingLevel?: string; desiredCwd?: string; configVersion: number; presence?: string; inboxUnread?: number };
type RuntimeNode = { id: string; name: string; status: string; version?: string; nodeVersion?: string; piVersion?: string; os?: string; architecture?: string; capabilities: Record<string, boolean>; configVersion: number };
type Channel = { id: string; title: string; agentIds: string[]; createdAt: number };
type Thread = { id: string; channelId: string; rootTurnId?: string; rootText?: string; title: string; createdAt: number };

export function ConversationShell({ diagnostic = false }: { diagnostic?: boolean }) {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [threads, setThreads] = useState<Thread[]>([]);
  const [activeId, setActiveId] = useState("");
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [runtimes, setRuntimes] = useState<RuntimeNode[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [draftTitle, setDraftTitle] = useState("");
  const [draftAgents, setDraftAgents] = useState<string[]>([]);
  const activeThread = threads.find((thread) => thread.id === activeId);
  const activeChannel = channels.find((channel) => channel.id === (activeThread?.channelId ?? activeId)) ?? channels[0];
  const activeConversation = activeThread ?? activeChannel;
  const conversationIds = useMemo(
    () => [...channels.map((channel) => channel.id), ...threads.map((thread) => thread.id)],
    [channels, threads],
  );

  const selectConversation = useCallback((conversationId: string, historyMode: "push" | "replace" = "push") => {
    setActiveId(conversationId);
    if (typeof window === "undefined") return;
    const nextUrl = conversationUrl(window.location.href, conversationId);
    if (historyMode === "replace") window.history.replaceState(null, "", nextUrl);
    else window.history.pushState(null, "", nextUrl);
  }, []);

  useEffect(() => {
    void Promise.all([
      fetch("/api/multi-agent/channels", { cache: "no-store" }).then((response) => {
        if (!response.ok) throw new Error("无法读取 Channel");
        return response.json() as Promise<{ channels?: Channel[] }>;
      }),
      fetch("/api/multi-agent/agents", { cache: "no-store" }).then((response) => response.json()) as Promise<{ agents?: AgentInfo[] }>,
      fetch("/api/multi-agent/runtimes", { cache: "no-store" }).then((response) => response.json()) as Promise<{ runtimes?: RuntimeNode[] }>,
    ]).then(async ([channelData, agentData, runtimeData]) => {
      const restoredChannels = channelData.channels ?? [];
      const restoredThreads = (await Promise.all(restoredChannels.map(async (channel) => {
        const response = await fetch(`/api/multi-agent/threads?channelId=${encodeURIComponent(channel.id)}`, { cache: "no-store" });
        if (!response.ok) throw new Error(`无法读取 ${channel.title} Threads`);
        return (await response.json() as { threads?: Thread[] }).threads ?? [];
      }))).flat();
      setChannels(restoredChannels);
      setThreads(restoredThreads);
      const requestedId = typeof window === "undefined" ? null : new URL(window.location.href).searchParams.get("conversation");
      const availableIds = [...restoredChannels.map((channel) => channel.id), ...restoredThreads.map((thread) => thread.id)];
      selectConversation(resolveConversationId(availableIds, requestedId), "replace");
      setAgents(agentData.agents ?? []);
      setRuntimes(runtimeData.runtimes ?? []);
    });
  }, [selectConversation]);

  useEffect(() => {
    const restoreFromLocation = () => {
      const requestedId = new URL(window.location.href).searchParams.get("conversation");
      setActiveId(resolveConversationId(conversationIds, requestedId));
    };
    window.addEventListener("popstate", restoreFromLocation);
    return () => window.removeEventListener("popstate", restoreFromLocation);
  }, [conversationIds]);

  const openCreate = () => {
    const firstOnline = agents.find((agent) => agent.online);
    setDraftTitle("");
    setDraftAgents(firstOnline ? [firstOnline.id] : []);
    setDialogOpen(true);
  };

  const createChannel = async () => {
    const title = draftTitle.trim();
    if (!title || draftAgents.length === 0) return;
    const response = await fetch("/api/multi-agent/channels", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, agentIds: draftAgents }),
    });
    if (!response.ok) {
      window.alert(`创建 Channel 失败：${await response.text()}`);
      return;
    }
    const { channel } = await response.json() as { channel: Channel };
    setChannels((current) => [channel, ...current]);
    selectConversation(channel.id);
    setDialogOpen(false);
  };

  const createThread = async (channel: Channel, rootTurnId = "") => {
    const title = window.prompt(rootTurnId ? `围绕消息新建 Thread` : `在 # ${channel.title} 中新建 Thread`)?.trim();
    if (!title) return;
    const response = await fetch("/api/multi-agent/threads", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ channelId: channel.id, rootTurnId, title }),
    });
    if (!response.ok) {
      window.alert(`创建 Thread 失败：${await response.text()}`);
      return;
    }
    const { thread } = await response.json() as { thread: Thread };
    setThreads((current) => [...current, thread]);
    selectConversation(thread.id);
  };

  const renameChannel = async () => {
    if (!activeChannel || activeThread) return;
    const title = window.prompt("重命名 Channel", activeChannel.title)?.trim();
    if (!title || title === activeChannel.title) return;
    const response = await fetch(`/api/multi-agent/channels/${encodeURIComponent(activeChannel.id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title }),
    });
    if (!response.ok) {
      window.alert(`重命名 Channel 失败：${await response.text()}`);
      return;
    }
    setChannels((current) => current.map((channel) => channel.id === activeChannel.id ? { ...channel, title } : channel));
  };

  const deleteActive = async () => {
    if (!activeConversation || !activeChannel) return;
    const kind = activeThread ? "Thread" : "Channel";
    if (!window.confirm(`删除 ${kind}“${activeConversation.title}”？其中的 Agent Session 也会关闭。`)) return;
    const resource = activeThread ? "threads" : "channels";
    const response = await fetch(`/api/multi-agent/${resource}/${encodeURIComponent(activeConversation.id)}`, { method: "DELETE" });
    if (!response.ok) {
      window.alert(`删除 ${kind} 失败：${await response.text()}`);
      return;
    }
    if (activeThread) {
      setThreads((current) => current.filter((thread) => thread.id !== activeThread.id));
      selectConversation(activeChannel.id, "replace");
    } else {
      const nextChannels = channels.filter((channel) => channel.id !== activeChannel.id);
      setChannels(nextChannels);
      setThreads((current) => current.filter((thread) => thread.channelId !== activeChannel.id));
      selectConversation(nextChannels[0]?.id ?? "", "replace");
    }
  };

  const jumpToThreadRoot = (thread: Thread, channel: Channel) => {
    if (!thread.rootTurnId) return;
    const current = new URL(window.location.href);
    current.hash = "";
    const parentUrl = conversationUrl(current.toString(), channel.id);
    selectConversation(channel.id);
    window.history.replaceState(null, "", `${parentUrl}#${encodeURIComponent(thread.rootTurnId)}`);
  };

  const configureAgent = async (agent: AgentInfo) => {
    const desiredProvider = window.prompt(`@${agent.name} Provider`, agent.desiredProvider ?? "")?.trim();
    if (desiredProvider === undefined) return;
    const desiredModel = window.prompt(`@${agent.name} Model`, agent.desiredModel ?? "")?.trim();
    if (desiredModel === undefined) return;
    const desiredThinkingLevel = window.prompt(`@${agent.name} Thinking`, agent.desiredThinkingLevel ?? "medium")?.trim();
    if (desiredThinkingLevel === undefined) return;
    const desiredCwd = window.prompt(`@${agent.name} cwd`, agent.desiredCwd ?? agent.cwd ?? "")?.trim();
    if (desiredCwd === undefined) return;
    const response = await fetch(`/api/multi-agent/agents/${encodeURIComponent(agent.id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: agent.name, handle: agent.handle ?? "", description: agent.description ?? "",
        instructions: agent.instructions ?? "", desiredProvider, desiredModel, desiredThinkingLevel, desiredCwd,
      }),
    });
    if (!response.ok) {
      window.alert(`更新 Agent 失败：${await response.text()}`);
      return;
    }
    const data = await response.json() as { agent: AgentInfo };
    setAgents((current) => current.map((candidate) => candidate.id === agent.id ? data.agent : candidate));
  };

  const agentName = (id: string) => agents.find((agent) => agent.id === id)?.name ?? id;

  return <div className={styles.shell}>
    <aside className={styles.sidebar}>
      <WorkspaceModeNav active="conversations" />
      <div className={styles.sidebarHeader}>
        <strong>Conversations</strong>
        <button type="button" className={styles.createButton} onClick={openCreate}>＋</button>
      </div>
      <div className={styles.saved}>Channel 共享参与者；每个 Thread 拥有独立 Agent Session</div>
      <details className={styles.runtimeSummary}>
        <summary>Nodes & Agents · {runtimes.filter((runtime) => runtime.status === "online").length}/{runtimes.length} online</summary>
        {runtimes.map((runtime) => <div key={runtime.id} className={styles.runtimeRow}>
          <strong>{runtime.name}</strong><span>{runtime.status} · {runtime.os}/{runtime.architecture} · Node {runtime.nodeVersion} · Pi {runtime.piVersion}</span>
        </div>)}
        {agents.map((agent) => <div key={agent.id} className={styles.runtimeRow}>
          <strong>@{agent.name} · {agent.presence ?? (agent.online ? "available" : "offline")}{agent.inboxUnread ? ` · inbox ${agent.inboxUnread}` : ""}</strong><span>adapter {agent.provider} · desired {agent.desiredProvider || "default"}/{agent.desiredModel || "default"} · {agent.desiredThinkingLevel || "default"} · config v{agent.configVersion}</span>
          <button type="button" onClick={() => void configureAgent(agent)} title="配置将在新建或 Replace Session 后生效">配置</button>
        </div>)}
      </details>
      <div className={styles.sectionTitle}><span>Channel 与 Thread</span><button type="button" onClick={openCreate}>＋</button></div>
      <div className={styles.channelList}>
        {channels.map((channel) => <div key={channel.id} className={styles.channelGroup}>
          <button type="button" className={`${styles.channel} ${channel.id === activeId ? styles.channelActive : ""}`} onClick={() => selectConversation(channel.id)}>
            <span className={styles.channelName}>#&nbsp;&nbsp;{channel.title}</span>
            <span className={styles.channelAgents}>{channel.agentIds.map(agentName).join(" · ")}</span>
          </button>
          <button type="button" className={styles.addThread} onClick={() => void createThread(channel)} aria-label={`在 ${channel.title} 中新建 Thread`}>＋ Thread</button>
          {threads.filter((thread) => thread.channelId === channel.id).map((thread) => <button
            key={thread.id}
            type="button"
            className={`${styles.thread} ${thread.id === activeId ? styles.channelActive : ""}`}
            onClick={() => selectConversation(thread.id)}
          >↳ {thread.title}</button>)}
        </div>)}
        {channels.length === 0 && <div className={styles.empty}>创建一个 Channel 开始聊天</div>}
      </div>
      {activeConversation && activeChannel && <div className={styles.sidebarFooter}>
        <span>{activeThread ? `Thread · #${activeChannel.title}` : `${activeChannel.agentIds.length} 个 Agent Session`}</span>
        {!activeThread && <button type="button" className={styles.renameAction} onClick={() => void renameChannel()}>重命名</button>}
        <button type="button" onClick={() => void deleteActive()}>删除</button>
      </div>}
    </aside>

    <main className={styles.main}>
      <div className={styles.mobileChannelNav}>
        <select aria-label="选择 Conversation" value={activeConversation?.id ?? ""} onChange={(event) => selectConversation(event.target.value)}>
          {channels.map((channel) => <optgroup key={channel.id} label={`# ${channel.title}`}>
            <option value={channel.id}># {channel.title}</option>
            {threads.filter((thread) => thread.channelId === channel.id).map((thread) => <option key={thread.id} value={thread.id}>↳ {thread.title}</option>)}
          </optgroup>)}
        </select>
        {activeChannel && <button type="button" onClick={() => void createThread(activeChannel)} aria-label="新建 Thread">↳</button>}
        <button type="button" onClick={openCreate} aria-label="新建 Channel">＋</button>
      </div>
      {diagnostic && <div role="status" style={{ flexShrink: 0, padding: "6px 12px", borderBottom: "1px solid var(--border)", background: "color-mix(in srgb, #d97706 12%, var(--bg-panel))", color: "var(--text-muted)", fontSize: 11 }}>
        Diagnostic compatibility route · 正式入口为 /conversations
      </div>}
      {activeConversation && activeChannel
        ? <>
          {activeThread?.rootTurnId && <div className={styles.threadRootCard}>
            <div><strong>Thread root</strong><span>{activeThread.rootText || activeThread.rootTurnId}</span></div>
            <button type="button" onClick={() => jumpToThreadRoot(activeThread, activeChannel)}>跳回 # {activeChannel.title}</button>
          </div>}
          <GroupChat
            key={activeConversation.id}
            conversationId={activeConversation.id}
            title={activeThread ? `↳ ${activeThread.title} · # ${activeChannel.title}` : `# ${activeChannel.title}`}
            participantAgentIds={activeChannel.agentIds}
            onCreateThread={activeThread ? undefined : (rootTurnId) => { void createThread(activeChannel, rootTurnId); }}
          />
          </>
        : <div className={styles.noChannel}>点击“＋”新建 Channel</div>}
    </main>

    {dialogOpen && <div className={styles.backdrop} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setDialogOpen(false); }}>
      <section className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby="new-channel-title">
        <header><div><span className={styles.eyebrow}>New Channel</span><h2 id="new-channel-title">新建 Channel</h2></div><button type="button" aria-label="关闭" onClick={() => setDialogOpen(false)}>×</button></header>
        <label className={styles.fieldLabel} htmlFor="channel-title">Channel 名称</label>
        <input id="channel-title" className={styles.channelInput} value={draftTitle} onChange={(event) => setDraftTitle(event.target.value)} placeholder="例如：Runtime 架构设计…" autoComplete="off" autoFocus />
        <div className={styles.agentHeading}><span>选择 Agent</span><small>{draftAgents.length} 已选择</small></div>
        <div className={styles.agentGrid}>
          {agents.map((agent) => {
            const checked = draftAgents.includes(agent.id);
            return <label key={agent.id} className={`${styles.agentCard} ${checked ? styles.agentSelected : ""} ${!agent.online ? styles.agentOffline : ""}`}>
              <input type="checkbox" checked={checked} disabled={!agent.online} onChange={() => setDraftAgents((current) => current.includes(agent.id) ? current.filter((id) => id !== agent.id) : [...current, agent.id])} />
              <span className={styles.agentAvatar}>{agent.name.slice(0, 1).toUpperCase()}</span>
              <span className={styles.agentInfo}><strong>{agent.name}</strong><small>{agent.provider} · {agent.runtime}</small></span>
              <span className={styles.agentStatus}>{agent.online ? "● Ready" : "○ Offline"}</span>
            </label>;
          })}
        </div>
        <footer><button type="button" className={styles.cancel} onClick={() => setDialogOpen(false)}>取消</button><button type="button" className={styles.submit} onClick={() => void createChannel()} disabled={!draftTitle.trim() || draftAgents.length === 0}>创建 Channel</button></footer>
      </section>
    </div>}
  </div>;
}
