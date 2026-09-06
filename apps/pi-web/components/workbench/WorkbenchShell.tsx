"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { GroupChat } from "@/components/GroupChat";
import { conversationUrl, resolveConversationId } from "@/lib/conversation-navigation";
import styles from "./WorkbenchShell.module.css";

type AgentInfo = {
  id: string;
  name: string;
  handle?: string;
  description?: string;
  instructions?: string;
  runtime: string;
  provider: string;
  cwd?: string;
  online: boolean;
  desiredProvider?: string;
  desiredModel?: string;
  desiredThinkingLevel?: string;
  desiredCwd?: string;
  configVersion: number;
  presence?: string;
  inboxUnread?: number;
};

type RuntimeNode = {
  id: string;
  name: string;
  status: string;
  version?: string;
  nodeVersion?: string;
  piVersion?: string;
  os?: string;
  architecture?: string;
  capabilities: Record<string, boolean>;
};

type Channel = { id: string; title: string; agentIds: string[]; createdAt: number };
type Thread = { id: string; channelId: string; rootTurnId?: string; rootText?: string; title: string; createdAt: number };
type View = "tasks" | "agents" | "apps" | "settings";
type CanvasTab = "assets" | "workspace" | "runs";

type IconName = "home" | "agent" | "message" | "apps" | "settings" | "plus" | "folder" | "search" | "automation" | "import" | "panel" | "file" | "terminal" | "globe" | "database" | "cloud";

function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  const common = { width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.7, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };
  const paths: Record<IconName, ReactNode> = {
    home: <><path d="m3 11 9-8 9 8"/><path d="M5 10v10h14V10M9 20v-6h6v6"/></>,
    agent: <><rect x="4" y="6" width="16" height="13" rx="4"/><path d="M12 3v3M8 11h.01M16 11h.01M8 15h8"/></>,
    message: <><path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z"/><path d="M8 10h.01M12 10h.01M16 10h.01"/></>,
    apps: <><rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/></>,
    settings: <><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1A1.7 1.7 0 0 0 9 4.6 1.7 1.7 0 0 0 10 3V2.8h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z"/></>,
    plus: <path d="M12 5v14M5 12h14"/>,
    folder: <path d="M3 6.5A2.5 2.5 0 0 1 5.5 4H10l2 2h6.5A2.5 2.5 0 0 1 21 8.5v8A2.5 2.5 0 0 1 18.5 19h-13A2.5 2.5 0 0 1 3 16.5z"/>,
    search: <><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></>,
    automation: <><path d="M3 12h4l2-7 4 14 2-7h6"/></>,
    import: <><path d="M12 3v12m0 0 4-4m-4 4-4-4"/><path d="M5 19h14"/></>,
    panel: <><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M15 4v16"/></>,
    file: <><path d="M6 2h8l4 4v16H6z"/><path d="M14 2v5h5"/></>,
    terminal: <><rect x="3" y="4" width="18" height="16" rx="2"/><path d="m7 9 3 3-3 3m5 0h5"/></>,
    globe: <><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18"/></>,
    database: <><ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v7c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 12v7c0 1.7 3.6 3 8 3s8-1.3 8-3v-7"/></>,
    cloud: <path d="M6 18h12a4 4 0 0 0 .5-8A6.5 6.5 0 0 0 6 8.5 4.8 4.8 0 0 0 6 18Z"/>,
  };
  return <svg {...common}>{paths[name]}</svg>;
}

function Avatar({ agent, size = 32 }: { agent: AgentInfo; size?: number }) {
  return <span className={styles.avatar} style={{ width: size, height: size }}><Icon name="agent" size={Math.max(16, size - 12)} /><i className={agent.online ? styles.online : styles.offline} /></span>;
}

export function WorkbenchShell() {
  const [view, setView] = useState<View>("tasks");
  const [channels, setChannels] = useState<Channel[]>([]);
  const [threads, setThreads] = useState<Thread[]>([]);
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [runtimes, setRuntimes] = useState<RuntimeNode[]>([]);
  const [activeId, setActiveId] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [draftTitle, setDraftTitle] = useState("");
  const [draftAgents, setDraftAgents] = useState<string[]>([]);
  const [canvasOpen, setCanvasOpen] = useState(true);
  const [canvasTab, setCanvasTab] = useState<CanvasTab>("workspace");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [editingAgent, setEditingAgent] = useState<AgentInfo | null>(null);
  const [agentDraft, setAgentDraft] = useState({ name: "", handle: "", description: "", instructions: "", desiredProvider: "", desiredModel: "", desiredThinkingLevel: "", desiredCwd: "" });
  const [savingAgent, setSavingAgent] = useState(false);

  const activeThread = threads.find((thread) => thread.id === activeId);
  const activeChannel = channels.find((channel) => channel.id === (activeThread?.channelId ?? activeId)) ?? channels[0];
  const activeConversation = activeThread ?? activeChannel;
  const conversationIds = useMemo(() => [...channels.map(({ id }) => id), ...threads.map(({ id }) => id)], [channels, threads]);
  const visibleChannels = useMemo(() => {
    const term = search.trim().toLocaleLowerCase();
    return term ? channels.filter((channel) => channel.title.toLocaleLowerCase().includes(term)) : channels;
  }, [channels, search]);

  const selectConversation = useCallback((id: string, mode: "push" | "replace" = "push") => {
    setActiveId(id);
    setView("tasks");
    if (typeof window === "undefined") return;
    const url = conversationUrl(window.location.href, id);
    if (mode === "replace") window.history.replaceState(null, "", url);
    else window.history.pushState(null, "", url);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([
      fetch("/api/multi-agent/channels", { cache: "no-store" }).then((response) => {
        if (!response.ok) throw new Error("无法读取任务");
        return response.json() as Promise<{ channels?: Channel[] }>;
      }),
      fetch("/api/multi-agent/agents", { cache: "no-store" }).then((response) => response.json()) as Promise<{ agents?: AgentInfo[] }>,
      fetch("/api/multi-agent/runtimes", { cache: "no-store" }).then((response) => response.json()) as Promise<{ runtimes?: RuntimeNode[] }>,
    ]).then(async ([channelData, agentData, runtimeData]) => {
      const restoredChannels = channelData.channels ?? [];
      const restoredThreads = (await Promise.all(restoredChannels.map(async (channel) => {
        const response = await fetch(`/api/multi-agent/threads?channelId=${encodeURIComponent(channel.id)}`, { cache: "no-store" });
        if (!response.ok) return [];
        return (await response.json() as { threads?: Thread[] }).threads ?? [];
      }))).flat();
      if (cancelled) return;
      setChannels(restoredChannels);
      setThreads(restoredThreads);
      setAgents(agentData.agents ?? []);
      setRuntimes(runtimeData.runtimes ?? []);
      const requested = new URL(window.location.href).searchParams.get("conversation");
      selectConversation(resolveConversationId([...restoredChannels.map(({ id }) => id), ...restoredThreads.map(({ id }) => id)], requested), "replace");
    }).catch((reason) => {
      if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason));
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [selectConversation]);

  useEffect(() => {
    const restore = () => setActiveId(resolveConversationId(conversationIds, new URL(window.location.href).searchParams.get("conversation")));
    window.addEventListener("popstate", restore);
    return () => window.removeEventListener("popstate", restore);
  }, [conversationIds]);

  const openCreate = () => {
    const first = agents.find((agent) => agent.online);
    setDraftTitle("");
    setDraftAgents(first ? [first.id] : []);
    setCreateOpen(true);
  };

  const createTask = async () => {
    const title = draftTitle.trim();
    if (!title || draftAgents.length === 0) return;
    const response = await fetch("/api/multi-agent/channels", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, agentIds: draftAgents }),
    });
    if (!response.ok) {
      setError(`创建任务失败：${await response.text()}`);
      return;
    }
    const { channel } = await response.json() as { channel: Channel };
    setChannels((current) => [channel, ...current]);
    selectConversation(channel.id);
    setCreateOpen(false);
  };

  const createThread = async (rootTurnId = "") => {
    if (!activeChannel) return;
    const title = window.prompt(rootTurnId ? "围绕这条消息创建讨论" : "讨论名称")?.trim();
    if (!title) return;
    const response = await fetch("/api/multi-agent/threads", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ channelId: activeChannel.id, rootTurnId, title }),
    });
    if (!response.ok) return setError(`创建讨论失败：${await response.text()}`);
    const { thread } = await response.json() as { thread: Thread };
    setThreads((current) => [...current, thread]);
    selectConversation(thread.id);
  };

  const renameTask = async () => {
    if (!activeChannel || activeThread) return;
    const title = window.prompt("重命名任务", activeChannel.title)?.trim();
    if (!title || title === activeChannel.title) return;
    const response = await fetch(`/api/multi-agent/channels/${encodeURIComponent(activeChannel.id)}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title }),
    });
    if (!response.ok) return setError(`重命名失败：${await response.text()}`);
    setChannels((current) => current.map((channel) => channel.id === activeChannel.id ? { ...channel, title } : channel));
  };

  const deleteConversation = async () => {
    if (!activeConversation || !activeChannel) return;
    if (!window.confirm(`删除${activeThread ? "讨论" : "任务"}“${activeConversation.title}”？`)) return;
    const response = await fetch(`/api/multi-agent/${activeThread ? "threads" : "channels"}/${encodeURIComponent(activeConversation.id)}`, { method: "DELETE" });
    if (!response.ok) return setError(`删除失败：${await response.text()}`);
    if (activeThread) {
      setThreads((current) => current.filter(({ id }) => id !== activeThread.id));
      selectConversation(activeChannel.id, "replace");
      return;
    }
    const remaining = channels.filter(({ id }) => id !== activeChannel.id);
    setChannels(remaining);
    setThreads((current) => current.filter(({ channelId }) => channelId !== activeChannel.id));
    selectConversation(remaining[0]?.id ?? "", "replace");
  };

  const openAgentEditor = (agent: AgentInfo) => {
    setEditingAgent(agent);
    setAgentDraft({ name: agent.name, handle: agent.handle ?? "", description: agent.description ?? "", instructions: agent.instructions ?? "", desiredProvider: agent.desiredProvider ?? "", desiredModel: agent.desiredModel ?? "", desiredThinkingLevel: agent.desiredThinkingLevel ?? "medium", desiredCwd: agent.desiredCwd ?? agent.cwd ?? "" });
  };

  const saveAgent = async () => {
    if (!editingAgent || !agentDraft.name.trim()) return;
    setSavingAgent(true);
    try {
      const response = await fetch(`/api/multi-agent/agents/${encodeURIComponent(editingAgent.id)}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(agentDraft) });
      if (!response.ok) return setError(`保存 AI 分身失败：${await response.text()}`);
      const { agent } = await response.json() as { agent: AgentInfo };
      setAgents((current) => current.map((candidate) => candidate.id === agent.id ? agent : candidate));
      setEditingAgent(null);
    } finally { setSavingAgent(false); }
  };

  const participantAgents = activeChannel?.agentIds.flatMap((id) => {
    const agent = agents.find((candidate) => candidate.id === id);
    return agent ? [agent] : [];
  }) ?? [];

  return <div className={styles.window}>
    <header className={styles.topbar}>
      <div className={styles.trafficLights}><i/><i/><i/></div>
      <button className={styles.accountButton} type="button">个人账号 <span>⌄</span></button>
      <div className={styles.dragRegion} />
      <span className={styles.connection}><i className={runtimes.some((runtime) => runtime.status === "online") ? styles.connectionOn : ""}/>{runtimes.filter((runtime) => runtime.status === "online").length} 台执行设备在线</span>
    </header>

    <div className={styles.body}>
      <nav className={styles.rail} aria-label="主导航">
        <RailButton icon="home" label="任务" active={view === "tasks"} onClick={() => setView("tasks")} />
        <RailButton icon="agent" label="AI 分身" active={view === "agents"} onClick={() => setView("agents")} />
        <RailButton icon="message" label="消息" disabled />
        <RailButton icon="apps" label="应用" active={view === "apps"} onClick={() => setView("apps")} />
        <div className={styles.railSpacer} />
        <RailButton icon="settings" label="设置" active={view === "settings"} onClick={() => setView("settings")} />
        <button className={styles.profileButton} type="button" onClick={() => setView("settings")}>U</button>
      </nav>

      <aside className={styles.sidebar}>
        {view === "tasks" && <TaskSidebar channels={visibleChannels} threads={threads} activeId={activeId} search={search} onSearch={setSearch} onCreate={openCreate} onSelect={selectConversation} />}
        {view === "agents" && <AgentSidebar agents={agents} onEdit={openAgentEditor} />}
        {view === "apps" && <SimpleSidebar title="应用中心" items={["应用", "技能", "连接器"]} />}
        {view === "settings" && <SimpleSidebar title="设置" items={["模型配置", "AI 设置", "执行设备", "系统权限", "外观显示", "版本信息"]} />}
      </aside>

      <main className={styles.main}>
        {error && <div className={styles.errorBanner}>{error}<button type="button" onClick={() => setError("")}>×</button></div>}
        {view === "tasks" && <>
          {loading ? <EmptyState icon="automation" title="正在加载任务工作台…" /> : activeConversation && activeChannel ? <div className={styles.taskLayout}>
            <section className={styles.conversationPane}>
              <div className={styles.taskHeader}>
                <div><strong>{activeThread ? activeThread.title : activeChannel.title}</strong>{activeThread && <span>任务讨论 · {activeChannel.title}</span>}</div>
                <div className={styles.participants}>{participantAgents.slice(0, 4).map((agent) => <Avatar key={agent.id} agent={agent} size={28} />)}</div>
                {!activeThread && <button className={styles.headerTextButton} type="button" onClick={() => void createThread()}>新建讨论</button>}
                {!activeThread && <button className={styles.headerTextButton} type="button" onClick={() => void renameTask()}>重命名</button>}
                <button className={styles.headerTextButtonDanger} type="button" onClick={() => void deleteConversation()}>删除</button>
                <button className={styles.iconButton} type="button" title={canvasOpen ? "收起工作台" : "打开工作台"} onClick={() => setCanvasOpen((open) => !open)}><Icon name="panel" size={17}/></button>
              </div>
              <div className={styles.chatHost}>
                <GroupChat conversationId={activeConversation.id} title={activeThread ? activeThread.title : activeChannel.title} participantAgentIds={activeChannel.agentIds} onCreateThread={activeThread ? undefined : (rootTurnId) => { void createThread(rootTurnId); }} workbench />
              </div>
            </section>
            {canvasOpen && <RightCanvas activeChannel={activeChannel} agents={participantAgents} runtimes={runtimes} tab={canvasTab} onTab={setCanvasTab} />}
          </div> : <EmptyState icon="message" title="开始一个新任务" description="选择 AI 分身，在工作空间中完成真实工作。" action={<button type="button" onClick={openCreate}>新建任务</button>} />}
        </>}
        {view === "agents" && <AgentCenter agents={agents} onEdit={openAgentEditor} />}
        {view === "apps" && <AppCenter />}
        {view === "settings" && <SettingsCenter runtimes={runtimes} agents={agents} />}
      </main>
    </div>

    {createOpen && <div className={styles.backdrop} onMouseDown={(event) => { if (event.target === event.currentTarget) setCreateOpen(false); }}>
      <section className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby="create-task-title">
        <header><span className={styles.dialogIcon}><Icon name="plus" /></span><div><h2 id="create-task-title">新建任务</h2><p>选择工作空间和 AI 分身，开始一项可持续推进的工作。</p></div><button type="button" onClick={() => setCreateOpen(false)} aria-label="关闭">×</button></header>
        <label>任务名称</label>
        <input value={draftTitle} onChange={(event) => setDraftTitle(event.target.value)} placeholder="例如：梳理产品方案并输出执行计划" autoFocus />
        <div className={styles.dialogSectionTitle}><span>选择 AI 分身</span><small>{draftAgents.length} 个已选择</small></div>
        <div className={styles.dialogAgents}>{agents.map((agent) => {
          const selected = draftAgents.includes(agent.id);
          return <button key={agent.id} type="button" disabled={!agent.online} className={selected ? styles.dialogAgentSelected : ""} onClick={() => setDraftAgents((current) => current.includes(agent.id) ? current.filter((id) => id !== agent.id) : [...current, agent.id])}>
            <Avatar agent={agent}/><span><strong>{agent.name}</strong><small>{agent.description || `${agent.provider} · ${agent.runtime}`}</small></span><i>{selected ? "✓" : ""}</i>
          </button>;
        })}</div>
        <div className={styles.workspaceField}><Icon name="folder"/><span><strong>默认工作空间</strong><small>{agents.find((agent) => draftAgents.includes(agent.id))?.desiredCwd || "使用 AI 分身配置的工作目录"}</small></span><button type="button" disabled>更改</button></div>
        <footer><button type="button" onClick={() => setCreateOpen(false)}>取消</button><button className={styles.primaryButton} type="button" disabled={!draftTitle.trim() || draftAgents.length === 0} onClick={() => void createTask()}><Icon name="plus" size={15}/>创建任务</button></footer>
      </section>
    </div>}
    {editingAgent && <div className={styles.backdrop} onMouseDown={(event) => { if (event.target === event.currentTarget) setEditingAgent(null); }}>
      <section className={`${styles.dialog} ${styles.agentDialog}`} role="dialog" aria-modal="true" aria-labelledby="edit-agent-title">
        <header><span className={styles.dialogIcon}><Icon name="agent" /></span><div><h2 id="edit-agent-title">配置 AI 分身</h2><p>修改身份和执行配置；已存在的 Session 需 Replace 后应用运行配置。</p></div><button type="button" onClick={() => setEditingAgent(null)} aria-label="关闭">×</button></header>
        <div className={styles.formGrid}>
          <AgentField label="名称" value={agentDraft.name} onChange={(name) => setAgentDraft((draft) => ({ ...draft, name }))}/>
          <AgentField label="Handle" value={agentDraft.handle} onChange={(handle) => setAgentDraft((draft) => ({ ...draft, handle }))}/>
          <AgentField label="角色描述" value={agentDraft.description} onChange={(description) => setAgentDraft((draft) => ({ ...draft, description }))} wide/>
          <AgentField label="Provider" value={agentDraft.desiredProvider} onChange={(desiredProvider) => setAgentDraft((draft) => ({ ...draft, desiredProvider }))}/>
          <AgentField label="Model" value={agentDraft.desiredModel} onChange={(desiredModel) => setAgentDraft((draft) => ({ ...draft, desiredModel }))}/>
          <AgentField label="Thinking" value={agentDraft.desiredThinkingLevel} onChange={(desiredThinkingLevel) => setAgentDraft((draft) => ({ ...draft, desiredThinkingLevel }))}/>
          <AgentField label="工作目录" value={agentDraft.desiredCwd} onChange={(desiredCwd) => setAgentDraft((draft) => ({ ...draft, desiredCwd }))}/>
          <AgentField label="角色规则" value={agentDraft.instructions} onChange={(instructions) => setAgentDraft((draft) => ({ ...draft, instructions }))} wide multiline/>
        </div>
        <footer><button type="button" onClick={() => setEditingAgent(null)}>取消</button><button className={styles.primaryButton} type="button" disabled={savingAgent || !agentDraft.name.trim()} onClick={() => void saveAgent()}>{savingAgent ? "保存中…" : "保存配置"}</button></footer>
      </section>
    </div>}
  </div>;
}

function RailButton({ icon, label, active, disabled, onClick }: { icon: IconName; label: string; active?: boolean; disabled?: boolean; onClick?: () => void }) {
  return <button type="button" className={`${styles.railButton} ${active ? styles.railButtonActive : ""}`} title={disabled ? `${label} · 即将开放` : label} disabled={disabled} onClick={onClick}><Icon name={icon}/></button>;
}

function TaskSidebar({ channels, threads, activeId, search, onSearch, onCreate, onSelect }: { channels: Channel[]; threads: Thread[]; activeId: string; search: string; onSearch: (value: string) => void; onCreate: () => void; onSelect: (id: string) => void }) {
  return <>
    <div className={styles.sidebarActions}>
      <button className={styles.newTask} type="button" onClick={onCreate}><Icon name="plus" size={16}/>新任务</button>
      <button type="button"><Icon name="apps" size={16}/>应用中心</button>
      <button type="button" disabled><Icon name="automation" size={16}/>自动化</button>
      <button type="button" disabled><Icon name="import" size={16}/>导入数据</button>
    </div>
    <div className={styles.workspaceHeading}><span>工作空间 <small>({channels.length ? 1 : 0})</small></span><button type="button" onClick={onCreate}><Icon name="plus" size={14}/></button></div>
    <div className={styles.searchBox}><Icon name="search" size={14}/><input value={search} onChange={(event) => onSearch(event.target.value)} placeholder="搜索任务"/></div>
    <div className={styles.workspaceList}>
      <div className={styles.workspaceRow}><Icon name="folder" size={16}/><span>默认工作空间</span><small>{channels.length}</small></div>
      {channels.map((channel) => <div key={channel.id}>
        <button type="button" className={`${styles.taskRow} ${activeId === channel.id ? styles.taskRowActive : ""}`} onClick={() => onSelect(channel.id)}><span>{channel.title}</span></button>
        {threads.filter((thread) => thread.channelId === channel.id).map((thread) => <button key={thread.id} type="button" className={`${styles.threadRow} ${activeId === thread.id ? styles.taskRowActive : ""}`} onClick={() => onSelect(thread.id)}>↳ {thread.title}</button>)}
      </div>)}
      {channels.length === 0 && <p className={styles.sidebarEmpty}>还没有任务</p>}
    </div>
  </>;
}

function AgentSidebar({ agents, onEdit }: { agents: AgentInfo[]; onEdit: (agent: AgentInfo) => void }) {
  return <><div className={styles.sidebarActions}><button className={styles.newTask} type="button" disabled title="需要 Agent 创建 API"><Icon name="plus" size={16}/>新建 AI 分身</button><button type="button"><Icon name="agent" size={16}/>全部分身</button></div><h3 className={styles.sideLabel}>我的 AI 分身</h3><div className={styles.agentSideList}>{agents.map((agent) => <button type="button" key={agent.id} onClick={() => onEdit(agent)}><Avatar agent={agent}/><span><strong>{agent.name}</strong><small>{agent.presence || (agent.online ? "可用" : "离线")}</small></span></button>)}</div></>;
}

function SimpleSidebar({ title, items }: { title: string; items: string[] }) {
  return <><h2 className={styles.simpleSideTitle}>{title}</h2><div className={styles.simpleSideList}>{items.map((item, index) => <button type="button" className={index === 0 ? styles.simpleSideActive : ""} key={item}>{item}</button>)}</div></>;
}

function RightCanvas({ activeChannel, agents, runtimes, tab, onTab }: { activeChannel: Channel; agents: AgentInfo[]; runtimes: RuntimeNode[]; tab: CanvasTab; onTab: (tab: CanvasTab) => void }) {
  return <aside className={styles.canvas}>
    <div className={styles.canvasTabs}><button className={tab === "assets" ? styles.canvasTabActive : ""} onClick={() => onTab("assets")}>资产</button><button className={tab === "workspace" ? styles.canvasTabActive : ""} onClick={() => onTab("workspace")}>工作空间</button><button className={tab === "runs" ? styles.canvasTabActive : ""} onClick={() => onTab("runs")}>运行</button></div>
    {tab === "workspace" && <div className={styles.canvasContent}><h2>{activeChannel.title}</h2><SectionTitle>工作目录</SectionTitle><div className={styles.infoCard}><Icon name="folder"/><span><strong>{agents[0]?.desiredCwd || agents[0]?.cwd || "尚未设置目录"}</strong><small>本机工作空间</small></span></div><SectionTitle>AI 分身</SectionTitle>{agents.map((agent) => <div className={styles.agentCanvasRow} key={agent.id}><Avatar agent={agent}/><span><strong>{agent.name}</strong><small>{agent.desiredModel || agent.provider} · {agent.presence || "available"}</small></span></div>)}<SectionTitle>任务设置</SectionTitle><div className={styles.settingRows}><button>授权策略 <span>按需确认 ›</span></button><button>执行限制 <span>默认 ›</span></button><button>归档任务 <span>›</span></button></div></div>}
    {tab === "assets" && <div className={styles.canvasContent}><h2>任务资产</h2><div className={styles.quickGrid}><Quick icon="folder" label="目录"/><Quick icon="cloud" label="云盘"/><Quick icon="database" label="多维表"/><Quick icon="file" label="文档"/><Quick icon="globe" label="浏览器"/><Quick icon="terminal" label="终端"/></div><EmptyState icon="file" title="还没有打开的资产" description="Agent 创建和修改的文件会显示在这里。" compact /></div>}
    {tab === "runs" && <div className={styles.canvasContent}><h2>执行状态</h2>{runtimes.map((runtime) => <div className={styles.runtimeCard} key={runtime.id}><i className={runtime.status === "online" ? styles.onlineDot : ""}/><span><strong>{runtime.name}</strong><small>{runtime.status} · {runtime.os || "unknown"}/{runtime.architecture || "unknown"}</small><small>Node {runtime.nodeVersion || "-"} · Pi {runtime.piVersion || "-"}</small></span></div>)}</div>}
  </aside>;
}

function SectionTitle({ children }: { children: ReactNode }) { return <h3 className={styles.sectionTitle}>{children}</h3>; }
function Quick({ icon, label }: { icon: IconName; label: string }) { return <button type="button"><Icon name={icon}/><span>{label}</span></button>; }

function AgentCenter({ agents, onEdit }: { agents: AgentInfo[]; onEdit: (agent: AgentInfo) => void }) {
  return <div className={styles.page}><PageHeader icon="agent" title="AI 分身" description="创建和管理能够持续工作的数字成员"/><div className={styles.agentGrid}>{agents.map((agent) => <article key={agent.id}><Avatar agent={agent} size={54}/><div><h3>{agent.name}</h3><p>{agent.description || "通用 AI 分身"}</p></div><span className={agent.online ? styles.statusGood : styles.statusMuted}>{agent.online ? "可用" : "离线"}</span><dl><div><dt>模型</dt><dd>{agent.desiredModel || agent.provider}</dd></div><div><dt>执行设备</dt><dd>{agent.runtime}</dd></div><div><dt>思考模式</dt><dd>{agent.desiredThinkingLevel || "默认"}</dd></div></dl><button type="button" onClick={() => onEdit(agent)}>查看与配置</button></article>)}</div></div>;
}

function AgentField({ label, value, onChange, wide, multiline }: { label: string; value: string; onChange: (value: string) => void; wide?: boolean; multiline?: boolean }) {
  return <label className={wide ? styles.formFieldWide : styles.formField}><span>{label}</span>{multiline ? <textarea value={value} onChange={(event) => onChange(event.target.value)} rows={5}/> : <input value={value} onChange={(event) => onChange(event.target.value)}/>}</label>;
}

function AppCenter() {
  const groups = [{ title: "内置能力", items: [["Skills", "Agent 可调用的专业能力"], ["Plugins", "扩展 Agent 和工作台"], ["Models", "模型与服务提供方"]] }, { title: "工作应用", items: [["本地目录", "读取和修改项目文件"], ["终端", "运行命令和开发工具"], ["浏览器", "网页调研与信息采集"]] }];
  return <div className={styles.page}><PageHeader icon="apps" title="应用中心" description="使用应用、技能和连接器扩展 Agent 的能力"/><div className={styles.pageTabs}><button className={styles.pageTabActive}>应用</button><button>技能</button><button>连接器</button></div>{groups.map((group) => <section className={styles.appGroup} key={group.title}><h2>{group.title}</h2><div>{group.items.map(([name, description], index) => <article key={name}><span><Icon name={index === 0 ? "apps" : index === 1 ? "automation" : "database"}/></span><div><strong>{name}</strong><small>{description}</small></div><button type="button">查看</button></article>)}</div></section>)}</div>;
}

function SettingsCenter({ runtimes, agents }: { runtimes: RuntimeNode[]; agents: AgentInfo[] }) {
  return <div className={styles.page}><PageHeader icon="settings" title="执行设备" description="查看 Agent Runtime 的连接状态和运行环境"/><section className={styles.settingsSection}><h2>设备状态</h2>{runtimes.map((runtime) => <div className={styles.settingsRuntime} key={runtime.id}><span className={styles.deviceIcon}><Icon name="terminal"/></span><div><strong>{runtime.name}</strong><small>{runtime.os || "unknown"} · {runtime.architecture || "unknown"}</small></div><span className={runtime.status === "online" ? styles.statusGood : styles.statusMuted}>{runtime.status}</span><dl><div><dt>Node</dt><dd>{runtime.nodeVersion || "-"}</dd></div><div><dt>Pi</dt><dd>{runtime.piVersion || "-"}</dd></div><div><dt>AI 分身</dt><dd>{agents.filter((agent) => agent.runtime === runtime.id || agent.runtime === runtime.name).length}</dd></div></dl></div>)}</section></div>;
}

function PageHeader({ icon, title, description, action }: { icon: IconName; title: string; description: string; action?: string }) { return <header className={styles.pageHeader}><span><Icon name={icon}/></span><div><h1>{title}</h1><p>{description}</p></div>{action && <button type="button"><Icon name="plus" size={15}/>{action}</button>}</header>; }

function EmptyState({ icon, title, description, action, compact }: { icon: IconName; title: string; description?: string; action?: ReactNode; compact?: boolean }) { return <div className={`${styles.emptyState} ${compact ? styles.emptyCompact : ""}`}><Icon name={icon} size={compact ? 26 : 34}/><strong>{title}</strong>{description && <p>{description}</p>}{action}</div>; }
