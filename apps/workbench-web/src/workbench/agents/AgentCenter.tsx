import { useEffect, useState, type FormEvent } from "react";
import type { AgentConfigPatch, AgentResponse, AgentSummary, ChannelSummary, RuntimeDetailResponse, RuntimeSummary } from "../../contracts/control-api";

type Props = {
  agents: AgentSummary[];
  channels: ChannelSummary[];
  runtimes: RuntimeSummary[];
  activeAgentId: string;
  onAgentUpdated: (agent: AgentSummary) => void;
  onChooseModel: (agentId: string) => void;
};

function toPatch(agent: AgentSummary): AgentConfigPatch {
  return {
    name: agent.name,
    handle: agent.handle ?? "",
    description: agent.description ?? "",
    instructions: agent.instructions ?? "",
    desiredProvider: agent.desiredProvider ?? agent.provider,
    desiredModel: agent.desiredModel ?? "",
    desiredThinkingLevel: agent.desiredThinkingLevel ?? "medium",
    desiredCwd: agent.desiredCwd ?? agent.cwd,
  };
}

export function AgentCenter({ agents, channels, runtimes, activeAgentId, onAgentUpdated, onChooseModel }: Props) {
  const active = agents.find((agent) => agent.id === activeAgentId) ?? agents[0] ?? null;
  const recentTasks = active ? channels.filter((channel) => channel.agentIds.includes(active.id)).slice(0, 5) : [];
  const runtime = active ? runtimes.find((item) => item.id === active.runtimeId) : undefined;
  const [inventory, setInventory] = useState<RuntimeDetailResponse | null>(null);
  useEffect(() => {
    if (!active?.runtimeId) { setInventory(null); return; }
    const controller = new AbortController();
    void fetch(`/api/multi-agent/runtimes/${encodeURIComponent(active.runtimeId)}`, { cache: "no-store", signal: controller.signal }).then((response) => response.ok ? response.json() : Promise.reject()).then((value: RuntimeDetailResponse) => setInventory(value)).catch(() => { if (!controller.signal.aborted) setInventory(null); });
    return () => controller.abort();
  }, [active?.runtimeId]);
  const [editing, setEditing] = useState<AgentSummary | null>(null);
  const [draft, setDraft] = useState<AgentConfigPatch | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  const openEditor = (agent: AgentSummary) => {
    setEditing(agent);
    setDraft(toPatch(agent));
    setError("");
    setSaved(false);
  };
  const closeEditor = () => {
    if (saving) return;
    setEditing(null);
    setDraft(null);
  };
  const update = <K extends keyof AgentConfigPatch>(key: K, value: AgentConfigPatch[K]) => {
    setDraft((current) => current ? { ...current, [key]: value } : current);
    setSaved(false);
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!editing || !draft || !draft.name.trim() || saving) return;
    setSaving(true);
    setError("");
    setSaved(false);
    try {
      const response = await fetch(`/api/multi-agent/agents/${encodeURIComponent(editing.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      });
      if (!response.ok) throw new Error((await response.text()).trim() || `保存失败（${response.status}）`);
      const { agent } = await response.json() as AgentResponse;
      onAgentUpdated(agent);
      setEditing(agent);
      setDraft(toPatch(agent));
      setSaved(true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setSaving(false);
    }
  };

  if (!active) return <div className="agent-profile-empty"><span>◉</span><b>还没有数字员工</b><p>连接 Runtime 后，注册的数字员工会显示在这里。</p></div>;

  return <>
    <section className="agent-profile">
      <header className="agent-profile-header">
        <span className="agent-profile-avatar">◉<i className={active.online ? "online" : ""}/></span>
        <div><h1>{active.name}</h1><p>{active.handle ? `@${active.handle}` : active.id} · {active.desiredModel || active.provider}</p></div>
        <div className="agent-profile-header-actions"><button type="button" className="model" onClick={() => onChooseModel(active.id)}>可用模型</button><button type="button" onClick={() => openEditor(active)} title="编辑数字员工">✎</button></div>
      </header>

      <div className="employee-facts"><div><span>状态</span><b className={active.online ? "online" : ""}>{active.presence === "working" ? "工作中" : active.presence === "waiting" ? "等待中" : active.online ? "可用" : "离线"}</b></div><div><span>归属</span><b>local-user</b><small>当前单用户模式</small></div><div><span>工作空间</span><b>默认工作空间</b><small>{channels.filter((channel) => channel.agentIds.includes(active.id)).length} 个任务对话</small></div><div><span>Runtime 工位</span><b>{active.runtime}</b><small>{active.runtimeId || "未注册"}{runtime ? ` · ${runtime.os}/${runtime.architecture}` : ""}</small></div></div>

      <div className="agent-capabilities">
        <article><b><span>▣</span>人设与规则</b><p>{active.instructions || active.description || "处理通用任务时先理解目标，再直接推进；遇到明确的专项工作，可以建议交给更合适的数字员工。"}</p></article>
        <article><b><span>✣</span>Skills <em>{inventory?.skills?.length ?? 0}</em></b><p>{inventory?.skills?.length ? inventory.skills.slice(0, 4).map((skill) => skill.name).join("、") : "当前 Runtime 没有发现可用 Skill。"}</p></article>
        <article><b><span>⌘</span>Tools / MCP <em>{inventory?.tools?.length ?? 0}</em></b><p>{inventory?.tools?.length ? `${inventory.tools.map((tool) => tool.name).join("、")}${inventory.mcpSupported ? ` · MCP ${inventory.mcpServers.length}` : " · MCP 未上报"}` : "当前 Runtime 没有上报工具明细。"}</p></article>
      </div>

      <div className="agent-profile-content">
        <section className="agent-memory">
          <header><b><span>◉</span>记忆</b><button type="button">导出⌄</button></header>
          <nav><button className="active">概览</button><button>全部记录</button></nav>
          <small>上次整理：尚未整理</small>
          <div><span>🌱</span><b>{active.name} 还在认识你</b><p>随着任务和对话持续进行，可沉淀经过授权的偏好、规则和工作上下文。</p></div>
        </section>
        <section className="agent-recent">
          <header><b><span>☷</span>最近任务</b></header>
          {recentTasks.map((task) => <article key={task.id}><span>□</span><div><b>{task.title}</b><small>默认工作空间</small></div><i/></article>)}
          {recentTasks.length === 0 && <p>还没有参与过任务</p>}
        </section>
      </div>

      <div className="agent-memory-composer">想要修改？告诉 {active.name} 该记住或忘记什么</div>
    </section>

    {editing && draft && <div className="backdrop" onMouseDown={(event) => event.target === event.currentTarget && closeEditor()}>
      <form className="dialog agent-config-dialog" onSubmit={submit}>
        <header><span>◉</span><div><h2>配置数字员工</h2><p>{editing.id} · 配置版本 {editing.configVersion ?? 1}</p></div><button type="button" onClick={closeEditor}>×</button></header>
        <div className="agent-config-fields">
          <label><span>名称</span><input value={draft.name} onChange={(event) => update("name", event.target.value)} required/></label>
          <label><span>Handle</span><input value={draft.handle} onChange={(event) => update("handle", event.target.value)} placeholder="例如 dev-pi"/></label>
          <label className="wide"><span>角色说明</span><input value={draft.description} onChange={(event) => update("description", event.target.value)} placeholder="这个数字员工负责什么"/></label>
          <div className="agent-config-model-note">模型由当前执行设备提供；请在具体任务对话中选择模型。不同对话可以使用不同模型。</div>
          <label><span>工作目录</span><input value={draft.desiredCwd} onChange={(event) => update("desiredCwd", event.target.value)} placeholder={editing.cwd}/></label>
          <label className="wide"><span>Instructions</span><textarea value={draft.instructions} onChange={(event) => update("instructions", event.target.value)} placeholder="定义角色、工作方式和边界"/></label>
        </div>
        <div className="agent-config-runtime"><b>当前执行设备</b><span>{editing.runtime}</span><small>{editing.online ? "在线" : "离线"} · 当前会话配置不会被静默替换</small></div>
        {error && <div className="agent-config-error" role="alert">{error}</div>}
        {saved && <div className="agent-config-saved">配置已保存。已打开的会话需要 Replace Session 后才会应用新配置。</div>}
        <footer><button type="button" onClick={closeEditor}>取消</button><button className="submit" disabled={saving || !draft.name.trim()}>{saving ? "保存中…" : "保存配置"}</button></footer>
      </form>
    </div>}
  </>;
}
