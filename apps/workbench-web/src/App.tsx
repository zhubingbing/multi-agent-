import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";

type View = "tasks" | "agents" | "apps" | "automation" | "settings";
type TaskMode = "chat" | "split" | "canvas";
type CanvasTab = "assets" | "workspace" | "runs";
type Channel = { id: string; title: string; agentIds: string[]; createdAt: number };
type Agent = { id: string; name: string; runtime: string; runtimeId?: string; provider: string; cwd: string; online: boolean; description?: string; desiredModel?: string; desiredThinkingLevel?: string; desiredCwd?: string; presence?: string; inboxUnread?: number };
type Runtime = { id: string; name: string; status: string; nodeVersion?: string; piVersion?: string; os?: string; architecture?: string };
type ContentBlock = { type?: string; text?: string };
type PublicMessage = { id: string; turnId: string; authorType: "member" | "agent" | "system"; authorId: string; runId?: string; content: { role?: string; content?: string | ContentBlock[]; timestamp?: number }; createdAt: number };
type Binding = { agentId: string; nativeSessionId: string; generation: number; state: string; effectiveModel?: string; effectiveProvider?: string; effectiveThinkingLevel?: string; effectiveCwd?: string };

const iconPaths: Record<string, ReactNode> = {
  tasks: <><path d="m3 11 9-8 9 8"/><path d="M5 10v10h14V10M9 20v-6h6v6"/></>,
  agents: <><rect x="4" y="6" width="16" height="13" rx="4"/><path d="M12 3v3M8 11h.01M16 11h.01M8 15h8"/></>,
  message: <><path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z"/><path d="M8 10h.01M12 10h.01M16 10h.01"/></>,
  apps: <><rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/></>,
  automation: <path d="M3 12h4l2-7 4 14 2-7h6"/>,
  settings: <><circle cx="12" cy="12" r="3"/><path d="M12 2.8v2M12 19.2v2M2.8 12h2M19.2 12h2M5.5 5.5l1.4 1.4M17.1 17.1l1.4 1.4M18.5 5.5l-1.4 1.4M6.9 17.1l-1.4 1.4"/></>,
  plus: <path d="M12 5v14M5 12h14"/>,
  folder: <path d="M3 6.5A2.5 2.5 0 0 1 5.5 4H10l2 2h6.5A2.5 2.5 0 0 1 21 8.5v8A2.5 2.5 0 0 1 18.5 19h-13A2.5 2.5 0 0 1 3 16.5z"/>,
  search: <><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></>,
  import: <><path d="M12 3v12m0 0 4-4m-4 4-4-4"/><path d="M5 19h14"/></>,
  panel: <><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M15 4v16"/></>,
  columns: <><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M12 4v16"/></>,
  chat: <><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M17 4v16"/></>,
  canvas: <><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 4v16"/></>,
  send: <><path d="m22 2-7 20-4-9-9-4z"/><path d="M22 2 11 13"/></>,
  file: <><path d="M6 2h8l4 4v16H6z"/><path d="M14 2v5h5"/></>,
  terminal: <><rect x="3" y="4" width="18" height="16" rx="2"/><path d="m7 9 3 3-3 3m5 0h5"/></>,
  globe: <><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a15 15 0 0 1 0 18"/></>,
  database: <><ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v7c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 12v7c0 1.7 3.6 3 8 3s8-1.3 8-3v-7"/></>,
};

function Icon({ name, size = 18 }: { name: string; size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>{iconPaths[name]}</svg>;
}

function textOf(message: PublicMessage): string {
  const content = message.content?.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.filter((block) => block.type === "text").map((block) => block.text ?? "").join("\n");
}

function taskTitleFromPrompt(message: string): string {
  const compact = message.replace(/\s+/g, " ").trim();
  return compact.length > 24 ? `${compact.slice(0, 24)}…` : compact || "新任务";
}

function socketUrl(conversationId: string) {
  const url = new URL(window.location.origin);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = "/api/multi-agent/conversation/ws";
  url.searchParams.set("conversationId", conversationId);
  return url.toString();
}

export function App() {
  const [view, setView] = useState<View>("tasks");
  const [channels, setChannels] = useState<Channel[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [runtimes, setRuntimes] = useState<Runtime[]>([]);
  const [activeId, setActiveId] = useState("");
  const [messages, setMessages] = useState<PublicMessage[]>([]);
  const [bindings, setBindings] = useState<Binding[]>([]);
  const [selectedAgents, setSelectedAgents] = useState<string[]>([]);
  const [mode, setMode] = useState<TaskMode>(() => (localStorage.getItem("workbench-task-mode-v2") as TaskMode) || "chat");
  const [canvasTab, setCanvasTab] = useState<CanvasTab>("workspace");
  const [connected, setConnected] = useState(false);
  const [running, setRunning] = useState<string[]>([]);
  const [draft, setDraft] = useState("");
  const [draftAgentId, setDraftAgentId] = useState("");
  const [creatingFromDraft, setCreatingFromDraft] = useState(false);
  const [executionMode, setExecutionMode] = useState<"sequential" | "parallel">("sequential");
  const [search, setSearch] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [createTitle, setCreateTitle] = useState("");
  const [createAgents, setCreateAgents] = useState<string[]>([]);
  const [error, setError] = useState("");
  const socketRef = useRef<WebSocket | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const active = channels.find((channel) => channel.id === activeId);
  const participants = active?.agentIds.flatMap((id) => agents.find((agent) => agent.id === id) ?? []) ?? [];
  const filteredChannels = useMemo(() => channels.filter((channel) => channel.title.toLocaleLowerCase().includes(search.toLocaleLowerCase())), [channels, search]);

  const loadShell = useCallback(async () => {
    try {
      const [channelResponse, agentResponse, runtimeResponse] = await Promise.all([
        fetch("/api/multi-agent/channels", { cache: "no-store" }),
        fetch("/api/multi-agent/agents", { cache: "no-store" }),
        fetch("/api/multi-agent/runtimes", { cache: "no-store" }),
      ]);
      if (!channelResponse.ok) throw new Error("Control Server 尚未启动");
      const channelData = await channelResponse.json() as { channels?: Channel[] };
      const agentData = await agentResponse.json() as { agents?: Agent[] };
      const runtimeData = await runtimeResponse.json() as { runtimes?: Runtime[] };
      const nextChannels = channelData.channels ?? [];
      setChannels(nextChannels);
      setAgents(agentData.agents ?? []);
      setDraftAgentId((current) => current || (agentData.agents ?? []).find((agent) => agent.online)?.id || (agentData.agents ?? [])[0]?.id || "");
      setRuntimes(runtimeData.runtimes ?? []);
      setActiveId((current) => current || new URLSearchParams(location.search).get("conversation") || nextChannels[0]?.id || "");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  }, []);

  const loadConversation = useCallback(async (conversationId: string) => {
    if (!conversationId) { setMessages([]); setBindings([]); return; }
    const [messageResponse, bindingResponse] = await Promise.all([
      fetch(`/api/multi-agent/conversations/${encodeURIComponent(conversationId)}/messages`, { cache: "no-store" }),
      fetch(`/api/multi-agent/bindings?conversationId=${encodeURIComponent(conversationId)}`, { cache: "no-store" }),
    ]);
    if (messageResponse.ok) setMessages(((await messageResponse.json()) as { messages?: PublicMessage[] }).messages ?? []);
    if (bindingResponse.ok) setBindings(((await bindingResponse.json()) as { bindings?: Binding[] }).bindings ?? []);
  }, []);

  useEffect(() => { void loadShell(); }, [loadShell]);
  useEffect(() => {
    if (!activeId) return;
    history.replaceState(null, "", `/conversations?conversation=${encodeURIComponent(activeId)}`);
    void loadConversation(activeId);
    setSelectedAgents(active?.agentIds.filter((id) => agents.find((agent) => agent.id === id)?.online).slice(0, 1) ?? []);
    let stopped = false;
    let timer: number | undefined;
    const connect = () => {
      if (stopped) return;
      const socket = new WebSocket(socketUrl(activeId));
      socketRef.current = socket;
      socket.onopen = () => setConnected(true);
      socket.onmessage = ({ data }) => {
        const event = JSON.parse(data) as { type?: string; agentId?: string; agentIds?: string[] };
        if (event.type === "dispatched") setRunning(event.agentIds ?? []);
        if (event.type === "agent_event" && event.agentId && !running.includes(event.agentId)) setRunning((current) => [...new Set([...current, event.agentId!])]);
        if (["conversation_committed", "agent_error", "persistence_error"].includes(event.type ?? "")) {
          void loadConversation(activeId);
          if (event.agentId) setRunning((current) => current.filter((id) => id !== event.agentId));
        }
      };
      socket.onclose = () => { setConnected(false); if (!stopped) timer = window.setTimeout(connect, 800); };
    };
    connect();
    return () => { stopped = true; if (timer) clearTimeout(timer); socketRef.current?.close(); socketRef.current = null; };
  }, [activeId, active?.agentIds, agents, loadConversation]);
  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" }); }, [messages, running]);

  const chooseMode = (next: TaskMode) => { setMode(next); localStorage.setItem("workbench-task-mode-v2", next); };
  const selectTask = (id: string) => { setActiveId(id); setView("tasks"); };
  const beginDraftTask = () => {
    setActiveId("");
    setMessages([]);
    setBindings([]);
    setRunning([]);
    setDraft("");
    setDraftAgentId((current) => current || agents.find((agent) => agent.online)?.id || agents[0]?.id || "");
    setView("tasks");
    history.replaceState(null, "", "/conversations");
  };
  const openCreate = () => { setCreateTitle(""); setCreateAgents(agents.find((agent) => agent.online)?.id ? [agents.find((agent) => agent.online)!.id] : []); setCreateOpen(true); };

  const createTask = async (event: FormEvent) => {
    event.preventDefault();
    const response = await fetch("/api/multi-agent/channels", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: createTitle.trim(), agentIds: createAgents }) });
    if (!response.ok) { setError(await response.text()); return; }
    const { channel } = await response.json() as { channel: Channel };
    setChannels((current) => [channel, ...current]); setActiveId(channel.id); setCreateOpen(false);
  };

  const dispatchPrompt = (socket: WebSocket, message: string, targets: string[], requestedMode: "sequential" | "parallel") => {
    const turnId = crypto.randomUUID();
    const createdAt = Date.now();
    const runIds = Object.fromEntries(targets.map((id) => [id, crypto.randomUUID()]));
    setMessages((current) => [...current, { id: `optimistic-${turnId}`, turnId, authorType: "member", authorId: "local-user", content: { role: "user", content: message }, createdAt }]);
    setRunning(targets);
    socket.send(JSON.stringify({ type: "prompt", message, agentIds: targets, turnId, createdAt, runIds, executionMode: targets.length > 1 ? requestedMode : "parallel" }));
  };

  const send = (event: FormEvent) => {
    event.preventDefault();
    const message = draft.trim();
    const targets = selectedAgents.length ? selectedAgents : participants.filter((agent) => agent.online).slice(0, 1).map((agent) => agent.id);
    if (!message || !socketRef.current || socketRef.current.readyState !== WebSocket.OPEN || !targets.length) return;
    dispatchPrompt(socketRef.current, message, targets, executionMode);
    setDraft("");
  };

  const sendDraftTask = async (event: FormEvent) => {
    event.preventDefault();
    const message = draft.trim();
    const target = agents.find((agent) => agent.id === draftAgentId && agent.online) ?? agents.find((agent) => agent.online);
    if (!message || !target || creatingFromDraft) return;
    setCreatingFromDraft(true);
    try {
      const response = await fetch("/api/multi-agent/channels", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: taskTitleFromPrompt(message), agentIds: [target.id] }),
      });
      if (!response.ok) throw new Error(await response.text());
      const { channel } = await response.json() as { channel: Channel };
      setChannels((current) => [channel, ...current]);
      setSelectedAgents([target.id]);
      setActiveId(channel.id);
      setDraft("");
      const socket = new WebSocket(socketUrl(channel.id));
      socket.onopen = () => {
        dispatchPrompt(socket, message, [target.id], "parallel");
        window.setTimeout(() => socket.close(), 400);
      };
      socket.onerror = () => setError("任务已创建，但发送失败，请在任务中重新发送。 ");
    } catch (reason) {
      setError(`创建任务失败：${reason instanceof Error ? reason.message : String(reason)}`);
    } finally {
      setCreatingFromDraft(false);
    }
  };

  return <div className="window">
    <header className="topbar"><div className="traffic"><i/><i/><i/></div><button className="account">个人账号⌄</button><div className="drag"/><span className="connection"><i className={connected ? "on" : ""}/>{connected ? "服务已连接" : "正在连接"}</span></header>
    <div className="shell">
      <nav className="rail"><Rail icon="tasks" label="任务" active={view === "tasks"} onClick={() => setView("tasks")}/><Rail icon="agents" label="AI 分身" active={view === "agents"} onClick={() => setView("agents")}/><Rail icon="message" label="消息"/><Rail icon="apps" label="应用" active={view === "apps"} onClick={() => setView("apps")}/><Rail icon="automation" label="自动化" active={view === "automation"} onClick={() => setView("automation")}/><span/><Rail icon="settings" label="设置" active={view === "settings"} onClick={() => setView("settings")}/><button className="profile">U</button></nav>
      <aside className="sidebar">
        {view === "tasks" ? <><div className="primary-nav"><button className="new" onClick={beginDraftTask}><Icon name="plus" size={16}/>新任务</button><button onClick={() => setView("apps")}><Icon name="apps" size={16}/>应用中心</button><button onClick={() => setView("automation")}><Icon name="automation" size={16}/>自动化</button><button><Icon name="import" size={16}/>导入数据</button></div><div className="side-heading">工作空间 <small>({channels.length ? 1 : 0})</small><button onClick={openCreate}>＋</button></div><div className="search"><Icon name="search" size={14}/><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索任务"/></div><div className="tasks"><div className="workspace"><Icon name="folder" size={16}/>默认工作空间 <small>{channels.length}</small></div>{filteredChannels.map((channel) => <button className={channel.id === activeId ? "active" : ""} key={channel.id} onClick={() => selectTask(channel.id)}>{channel.title}</button>)}</div></> : <ModuleSidebar view={view}/>} 
      </aside>
      <main className="main">
        {error && <div className="error">{error}<button onClick={() => setError("")}>×</button></div>}
        {view === "tasks" ? active ? <div className={`task-layout mode-${mode}`}>
          <section className="conversation"><TaskHeader title={active.title}/><div className="agent-strip">{participants.map((agent) => <button key={agent.id} disabled={!agent.online} className={selectedAgents.includes(agent.id) ? "selected" : ""} onClick={() => setSelectedAgents((current) => current.includes(agent.id) ? current.filter((id) => id !== agent.id) : [...current, agent.id])}><Avatar agent={agent}/><span>{agent.name}</span><i>{running.includes(agent.id) ? "运行中" : agent.online ? "可用" : "离线"}</i></button>)}{selectedAgents.length > 1 && <select value={executionMode} onChange={(event) => setExecutionMode(event.target.value as "sequential" | "parallel")}><option value="sequential">顺序协作</option><option value="parallel">并行协作</option></select>}</div><div className="timeline" ref={scrollRef}>{messages.length === 0 && <Welcome agent={participants[0]}/>} {messages.map((message) => <Message key={message.id} message={message} agent={agents.find((candidate) => candidate.id === message.authorId)}/>)}{running.map((id) => <div className="agent-running" key={id}><Avatar agent={agents.find((agent) => agent.id === id)}/><span><b>{agents.find((agent) => agent.id === id)?.name}</b><i/><i/><i/></span></div>)}</div><form className="composer" onSubmit={send}><textarea value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="提个问题，我来查找和分析…" onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }}/><div><span>{participants.find((agent) => selectedAgents.includes(agent.id))?.name || "选择 AI 分身"}⌄</span><span>{participants.find((agent) => selectedAgents.includes(agent.id))?.desiredModel || "默认模型"}⌄</span><span>按需确认⌄</span><button disabled={!draft.trim() || !connected}><Icon name="send" size={16}/></button></div></form></section>
          <TaskCanvas tab={canvasTab} onTab={setCanvasTab} active={active} agents={participants} runtimes={runtimes} bindings={bindings} mode={mode} onMode={chooseMode}/>
        </div> : <DraftTaskHome agents={agents} selectedAgentId={draftAgentId} onSelectAgent={setDraftAgentId} draft={draft} onDraft={setDraft} onSend={sendDraftTask} sending={creatingFromDraft}/> : <ModulePage view={view} agents={agents} runtimes={runtimes}/>} 
      </main>
    </div>
    {createOpen && <div className="backdrop" onMouseDown={(event) => event.target === event.currentTarget && setCreateOpen(false)}><form className="dialog" onSubmit={createTask}><header><span><Icon name="plus"/></span><div><h2>新建任务</h2><p>选择工作空间和 AI 分身，开始一项可持续推进的工作。</p></div><button type="button" onClick={() => setCreateOpen(false)}>×</button></header><label>任务名称</label><input autoFocus value={createTitle} onChange={(event) => setCreateTitle(event.target.value)} placeholder="例如：梳理产品方案并输出执行计划"/><h3>选择 AI 分身 <small>{createAgents.length} 个已选择</small></h3><div className="agent-picker">{agents.map((agent) => <button type="button" disabled={!agent.online} className={createAgents.includes(agent.id) ? "picked" : ""} key={agent.id} onClick={() => setCreateAgents((current) => current.includes(agent.id) ? current.filter((id) => id !== agent.id) : [...current, agent.id])}><Avatar agent={agent}/><span><b>{agent.name}</b><small>{agent.description || `${agent.provider} · ${agent.runtime}`}</small></span><i>{createAgents.includes(agent.id) ? "✓" : ""}</i></button>)}</div><div className="workspace-choice"><Icon name="folder"/><span><b>默认工作空间</b><small>使用 AI 分身配置的工作目录</small></span></div><footer><button type="button" onClick={() => setCreateOpen(false)}>取消</button><button className="submit" disabled={!createTitle.trim() || !createAgents.length}><Icon name="plus" size={15}/>创建任务</button></footer></form></div>}
  </div>;
}

function DraftTaskHome({ agents, selectedAgentId, onSelectAgent, draft, onDraft, onSend, sending }: { agents: Agent[]; selectedAgentId: string; onSelectAgent: (id: string) => void; draft: string; onDraft: (value: string) => void; onSend: (event: FormEvent) => void; sending: boolean }) {
  const selected = agents.find((agent) => agent.id === selectedAgentId) ?? agents.find((agent) => agent.online) ?? agents[0];
  const displayName = selected?.name || "小糖糖";
  return <section className="draft-task-home">
    <header><b>新任务</b><span>草稿</span></header>
    <div className="draft-stage">
      <div className="draft-greeting"><span className="draft-mascot"><Icon name="agents" size={32}/></span><h1>今天想和 <strong>{displayName}</strong> 一起完成什么？</h1></div>
      <form className="draft-composer" onSubmit={onSend}>
        <textarea autoFocus value={draft} onChange={(event) => onDraft(event.target.value)} placeholder="提个问题，我来查找和分析…" onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }}/>
        <div className="draft-toolbar">
          <label><Avatar agent={selected}/><select value={selected?.id || ""} onChange={(event) => onSelectAgent(event.target.value)}>{agents.map((agent) => <option key={agent.id} value={agent.id} disabled={!agent.online}>{agent.name}{agent.online ? "" : "（离线）"}</option>)}{agents.length === 0 && <option value="">小糖糖</option>}</select></label>
          <button type="button" className="mode-pill">问答⌄</button><button type="button" className="permission-pill">按需确认⌄</button><button type="button" className="add-pill">＋</button>
          <button className="draft-send" disabled={!draft.trim() || !selected?.online || sending} title={!selected?.online ? "需要一个在线 AI 分身" : "发送"}>{sending ? <i className="send-spinner"/> : <Icon name="send" size={15}/>}</button>
        </div>
        <div className="draft-context"><span><Icon name="folder" size={13}/>默认工作空间⌄</span><span>{selected?.desiredModel || selected?.provider || "默认模型"}⌄</span></div>
      </form>
      <div className="draft-shortcuts"><button type="button"><Icon name="file" size={14}/>文档</button><button type="button"><Icon name="database" size={14}/>表格</button><button type="button"><Icon name="globe" size={14}/>浏览器</button></div>
    </div>
    <aside className="draft-right"><h3>打开的标签</h3><p>打开文档、网页或终端后会显示在这里</p><div><b>快捷入口</b><span><Icon name="folder" size={13}/>目录</span><span><Icon name="database" size={13}/>多维表</span><span><Icon name="file" size={13}/>文档</span><span><Icon name="apps" size={13}/>工作台</span></div></aside>
  </section>;
}

function Rail({ icon, label, active, onClick }: { icon: string; label: string; active?: boolean; onClick?: () => void }) { return <button title={label} className={active ? "active" : ""} onClick={onClick}><Icon name={icon}/></button>; }
function Avatar({ agent }: { agent?: Agent }) { return <span className="avatar"><Icon name="agents" size={17}/><i className={agent?.online ? "online" : ""}/></span>; }
function ModeSwitch({ mode, onMode }: { mode: TaskMode; onMode: (mode: TaskMode) => void }) { return <div className="mode-switch"><button title="对话聚焦" className={mode === "chat" ? "active" : ""} onClick={() => onMode("chat")}><Icon name="chat" size={15}/></button><button title="分屏" className={mode === "split" ? "active" : ""} onClick={() => onMode("split")}><Icon name="columns" size={15}/></button><button title="工作台聚焦" className={mode === "canvas" ? "active" : ""} onClick={() => onMode("canvas")}><Icon name="canvas" size={15}/></button></div>; }
function TaskHeader({ title }: { title: string }) { return <header className="task-header"><b>{title}</b><div className="task-header-actions"><button title="任务设置">⌂</button><button title="协作者">♧</button></div></header>; }
function Welcome({ agent }: { agent?: Agent }) { return <div className="welcome"><Avatar agent={agent}/><h2>想先做点什么？</h2><p>描述目标，{agent?.name || "AI 分身"} 会理解任务、使用工具并持续推进。</p><div><button>分析当前项目</button><button>整理一份执行计划</button><button>让多个分身协作</button></div></div>; }
function Message({ message, agent }: { message: PublicMessage; agent?: Agent }) { const text = textOf(message); if (!text) return null; const user = message.authorType === "member"; return <article className={user ? "message user-message" : "message agent-message"}>{!user && <header><Avatar agent={agent}/><b>{agent?.name || message.authorId}</b></header>}<div>{text.split("\n").map((line, index) => <p key={index}>{line || <br/>}</p>)}</div><time>{new Date(message.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</time></article>; }
function TaskCanvas({ tab, onTab, active, agents, runtimes, bindings, mode, onMode }: { tab: CanvasTab; onTab: (tab: CanvasTab) => void; active: Channel; agents: Agent[]; runtimes: Runtime[]; bindings: Binding[]; mode: TaskMode; onMode: (mode: TaskMode) => void }) {
  if (mode === "chat") return <aside className="canvas canvas-rail"><nav><b>打开的标签</b><ModeSwitch mode={mode} onMode={onMode}/></nav><div className="canvas-rail-body"><p>打开文档、网页或终端后会显示在这里</p><div className="rail-shortcuts"><h3>快捷入口</h3><button><Icon name="folder" size={16}/>目录</button><button><Icon name="database" size={16}/>云盘</button><button><Icon name="database" size={16}/>多维表</button><button><Icon name="file" size={16}/>文档</button><button className="workbench"><Icon name="apps" size={16}/>工作台</button></div></div></aside>;
  return <aside className="canvas"><nav><button className={tab === "assets" ? "active" : ""} onClick={() => onTab("assets")}>资产</button><button className={tab === "workspace" ? "active" : ""} onClick={() => onTab("workspace")}>工作空间</button><button className={tab === "runs" ? "active" : ""} onClick={() => onTab("runs")}>运行</button><ModeSwitch mode={mode} onMode={onMode}/></nav><div className="canvas-body">{tab === "workspace" && <><h2>{active.title}</h2><Section title="工作目录"><div className="info-card"><Icon name="folder"/><span><b>{agents[0]?.desiredCwd || agents[0]?.cwd || "尚未设置"}</b><small>本机工作空间</small></span></div></Section><Section title="AI 分身">{agents.map((agent) => <div className="person" key={agent.id}><Avatar agent={agent}/><span><b>{agent.name}</b><small>{agent.desiredModel || agent.provider} · {agent.presence || "available"}</small></span></div>)}</Section><Section title="任务设置"><div className="rows"><button>授权策略 <span>按需确认 ›</span></button><button>执行限制 <span>默认 ›</span></button><button>归档任务 <span>›</span></button></div></Section></>}{tab === "assets" && <><h2>任务资产</h2><div className="quick"><Quick icon="folder" label="目录"/><Quick icon="file" label="文档"/><Quick icon="database" label="多维表"/><Quick icon="globe" label="浏览器"/><Quick icon="terminal" label="终端"/></div><Empty title="还没有打开的资产" description="Agent 创建和修改的文件会显示在这里。"/></>}{tab === "runs" && <><h2>执行状态</h2>{runtimes.map((runtime) => <div className="runtime" key={runtime.id}><i className={runtime.status === "online" ? "online" : ""}/><span><b>{runtime.name}</b><small>{runtime.status} · {runtime.os}/{runtime.architecture}</small><small>Node {runtime.nodeVersion || "-"} · Pi {runtime.piVersion || "-"}</small></span></div>)}{bindings.map((binding) => <div className="binding" key={binding.agentId}><b>{agents.find((agent) => agent.id === binding.agentId)?.name || binding.agentId}</b><span>Session #{binding.generation}</span><small>{binding.effectiveProvider}/{binding.effectiveModel} · {binding.state}</small></div>)}</>}</div></aside>;
}
function Section({ title, children }: { title: string; children: ReactNode }) { return <section className="section"><h3>{title}</h3>{children}</section>; }
function Quick({ icon, label }: { icon: string; label: string }) { return <button><Icon name={icon}/><span>{label}</span></button>; }
function Empty({ title, description, action }: { title: string; description?: string; action?: ReactNode }) { return <div className="empty"><Icon name="message" size={30}/><b>{title}</b>{description && <p>{description}</p>}{action}</div>; }
function ModuleSidebar({ view }: { view: View }) { const data: Record<string, string[]> = { agents: ["全部分身", "已停用"], apps: ["应用", "技能", "连接器"], automation: ["全部任务", "运行记录"], settings: ["模型配置", "AI 设置", "执行设备", "系统权限", "外观显示", "版本信息"] }; return <><h2 className="module-title">{{ agents: "AI 分身", apps: "应用中心", automation: "自动化", settings: "设置", tasks: "任务" }[view]}</h2><div className="module-links">{(data[view] || []).map((item, index) => <button className={index === 0 ? "active" : ""} key={item}>{item}</button>)}</div></>; }
function ModulePage({ view, agents, runtimes }: { view: View; agents: Agent[]; runtimes: Runtime[] }) { const titles = { agents: ["AI 分身", "创建和管理能够持续工作的数字成员"], apps: ["应用中心", "使用应用、技能和连接器扩展 Agent 的能力"], automation: ["自动化", "让 Agent 按计划自动执行任务"], settings: ["执行设备", "查看 Agent Runtime 的连接状态和运行环境"], tasks: ["任务", ""] }[view]; return <div className="page"><header className="page-header"><span><Icon name={view}/></span><div><h1>{titles[0]}</h1><p>{titles[1]}</p></div>{view === "agents" && <button>＋ 新建 AI 分身</button>}</header>{view === "agents" && <div className="agent-grid">{agents.map((agent) => <article key={agent.id}><Avatar agent={agent}/><div><h3>{agent.name}</h3><p>{agent.description || "通用 AI 分身"}</p></div><em className={agent.online ? "good" : ""}>{agent.online ? "可用" : "离线"}</em><dl><div><dt>模型</dt><dd>{agent.desiredModel || agent.provider}</dd></div><div><dt>执行设备</dt><dd>{agent.runtime}</dd></div><div><dt>思考</dt><dd>{agent.desiredThinkingLevel || "默认"}</dd></div></dl><button>查看与配置</button></article>)}</div>}{view === "apps" && <Catalog/>}{view === "automation" && <Empty title="还没有任何自动化任务" description="创建定时任务，让 Agent 按计划自动执行。" action={<button>＋ 新建</button>}/>} {view === "settings" && <div className="runtime-list">{runtimes.map((runtime) => <article key={runtime.id}><span><Icon name="terminal"/></span><div><b>{runtime.name}</b><small>{runtime.os} · {runtime.architecture}</small></div><em className={runtime.status === "online" ? "good" : ""}>{runtime.status}</em><dl><div><dt>Node</dt><dd>{runtime.nodeVersion || "-"}</dd></div><div><dt>Pi</dt><dd>{runtime.piVersion || "-"}</dd></div></dl></article>)}</div>}</div>; }
function Catalog() { return <>{["内置能力", "工作应用"].map((group, groupIndex) => <section className="catalog" key={group}><h2>{group}</h2><div>{(groupIndex ? [["本地目录", "读取和修改项目文件"], ["终端", "运行命令和开发工具"], ["浏览器", "网页调研与信息采集"]] : [["Skills", "Agent 可调用的专业能力"], ["Plugins", "扩展 Agent 和工作台"], ["Models", "模型与服务提供方"]]).map(([title, description], index) => <article key={title}><span><Icon name={index === 0 ? "apps" : index === 1 ? "automation" : "database"}/></span><div><b>{title}</b><small>{description}</small></div><button>查看</button></article>)}</div></section>)}</>; }
