import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import type { AgentSummary, RuntimeSummary } from "../../contracts/control-api";
import type { AutomationActionKind, AutomationCreateRequest, AutomationListResponse, AutomationRecord, AutomationResponse, AutomationRun, AutomationRunListResponse, AutomationRunResponse, AutomationTrigger, AutomationTriggerListResponse, AutomationTriggerResponse, CronPreviewResponse, ScriptLanguage } from "../../contracts/automation";

type Props = { agents: AgentSummary[]; runtimes: RuntimeSummary[]; onOpenConversation: (conversationId: string, agentRunId?: string) => void };
type Tab = "schedules" | "runs";
type ScheduleTab = "period" | "interval";
type PeriodPreset = "daily" | "weekdays" | "weekly" | "monthly" | "custom";

const weekdayOptions = [{ value: 1, label: "周一" }, { value: 2, label: "周二" }, { value: 3, label: "周三" }, { value: 4, label: "周四" }, { value: 5, label: "周五" }, { value: 6, label: "周六" }, { value: 0, label: "周日" }];

function cronTime(expression: string) {
  const [minute = "0", hour = "9"] = expression.trim().split(/\s+/);
  return /^\d+$/.test(minute) && /^\d+$/.test(hour) ? `${hour.padStart(2, "0")}:${minute.padStart(2, "0")}` : "09:00";
}

function inferPeriod(expression: string): PeriodPreset {
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5) return "custom";
  if (parts[2] === "*" && parts[3] === "*" && parts[4] === "*") return "daily";
  if (parts[2] === "*" && parts[3] === "*" && parts[4] === "1-5") return "weekdays";
  if (parts[2] === "*" && parts[3] === "*" && /^\d$/.test(parts[4])) return "weekly";
  if (/^\d+$/.test(parts[2]) && parts[3] === "*" && parts[4] === "*") return "monthly";
  return "custom";
}

function relativeTime(timestamp?: number) {
  if (!timestamp) return "尚未运行";
  const elapsed = Date.now() - timestamp;
  if (elapsed < 60_000) return "刚刚更新";
  if (elapsed < 3_600_000) return `${Math.floor(elapsed / 60_000)} 分钟前`;
  if (elapsed < 86_400_000) return `${Math.floor(elapsed / 3_600_000)} 小时前`;
  return `${Math.floor(elapsed / 86_400_000)} 天前`;
}

function statusLabel(status: AutomationRecord["status"]) {
  return { draft: "草稿（未启用）", active: "已启用", paused: "已暂停", archived: "已归档" }[status] ?? status;
}

function runStatusLabel(status: string) {
  return { received: "已接收", admitted: "准备中", queued: "等待中", dispatched: "已派发", running: "运行中", succeeded: "成功", failed: "失败", skipped: "已跳过", cancelled: "已取消", expired: "已过期" }[status] ?? status;
}
function runSourceLabel(source: string) { return source === "schedule" ? "定时触发" : source === "manual" ? "手动触发" : source; }
function runDuration(run: AutomationRun) {
  if (!run.startedAt) return "";
  const end = run.completedAt || Date.now();
  const seconds = Math.max(0, Math.round((end - run.startedAt) / 1000));
  return seconds < 60 ? `${seconds} 秒` : `${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒`;
}

function runFailureLabel(reason?: string) {
  if (!reason) return "";
  if (reason === "runtime reconnected without this active run") return "Runtime 重连后未恢复该运行，系统已将其标记为失败。";
  if (reason.includes("runtime_offline")) return "执行设备离线，任务未能开始。";
  return reason;
}

export function AutomationPage({ agents, runtimes, onOpenConversation }: Props) {
  const [tab, setTab] = useState<Tab>("schedules");
  const [items, setItems] = useState<AutomationRecord[]>([]);
  const [runs, setRuns] = useState<AutomationRun[]>([]);
  const [triggers, setTriggers] = useState<Record<string, AutomationTrigger>>({});
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<AutomationRecord | null>(null);
  const [detailId, setDetailId] = useState("");
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const [manage, setManage] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [runFilter, setRunFilter] = useState<"all" | "running" | "succeeded" | "failed">("all");
  const [actionMenuId, setActionMenuId] = useState("");
  const [pendingDelete, setPendingDelete] = useState<AutomationRecord[]>([]);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    try {
      const [automationResponse, runResponse] = await Promise.all([
        fetch("/api/multi-agent/automations", { cache: "no-store" }),
        fetch("/api/multi-agent/automation-runs", { cache: "no-store" }),
      ]);
      if (!automationResponse.ok) throw new Error((await automationResponse.text()).trim() || "自动化加载失败");
      if (!runResponse.ok) throw new Error((await runResponse.text()).trim() || "运行记录加载失败");
      const data = await automationResponse.json() as AutomationListResponse;
      const runData = await runResponse.json() as AutomationRunListResponse;
      setItems(data.automations ?? []);
      setRuns(runData.runs ?? []);
      const triggerResults = await Promise.all((data.automations ?? []).map(async (item) => {
        const response = await fetch(`/api/multi-agent/automations/${encodeURIComponent(item.id)}/triggers`, { cache: "no-store" });
        if (!response.ok) return [item.id, undefined] as const;
        const value = await response.json() as AutomationTriggerListResponse;
        return [item.id, value.triggers?.[0]] as const;
      }));
      setTriggers(Object.fromEntries(triggerResults.filter((entry): entry is readonly [string, AutomationTrigger] => Boolean(entry[1]))));
      setError("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!runs.some((run) => ["received", "admitted", "queued", "dispatched", "running"].includes(run.status))) return;
    const timer = window.setInterval(() => void load(), 2500);
    return () => window.clearInterval(timer);
  }, [load, runs]);
  useEffect(() => {
    if (!actionMenuId) return;
    const close = (event: MouseEvent) => { if (!(event.target instanceof Element) || !event.target.closest(".automation-row-menu")) setActionMenuId(""); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [actionMenuId]);
  const visible = useMemo(() => items.filter((item) => `${item.name} ${item.description ?? ""}`.toLocaleLowerCase().includes(search.toLocaleLowerCase())), [items, search]);
  const visibleRuns = useMemo(() => runs.filter((run) => {
    const matchesStatus = runFilter === "all" || (runFilter === "running" ? ["received", "admitted", "queued", "dispatched", "running"].includes(run.status) : run.status === runFilter);
    const name = items.find((item) => item.id === run.automationId)?.name ?? run.automationId;
    return matchesStatus && name.toLocaleLowerCase().includes(search.toLocaleLowerCase());
  }), [items, runFilter, runs, search]);

  const runNow = async (id: string) => {
    const response = await fetch(`/api/multi-agent/automations/${encodeURIComponent(id)}/run`, { method: "POST" });
    if (!response.ok) { setError((await response.text()).trim() || "立即运行失败"); return; }
    const { run } = await response.json() as AutomationRunResponse;
    setRuns((current) => [run, ...current.filter((item) => item.id !== run.id)]);
    setTab("runs");
  };
  const setStatus = async (id: string, action: "pause" | "resume" | "archive") => {
    const response = await fetch(`/api/multi-agent/automations/${encodeURIComponent(id)}/${action}`, { method: "POST" });
    if (!response.ok) { setError((await response.text()).trim() || "操作失败"); return false; }
    const { automation } = await response.json() as AutomationResponse;
    if (action === "archive") setItems((current) => current.filter((item) => item.id !== id));
    else setItems((current) => current.map((item) => item.id === id ? automation : item));
    return true;
  };
  const confirmDelete = async () => {
    if (!pendingDelete.length || deleting) return;
    setDeleting(true);
    try {
      for (const item of pendingDelete) {
        if (!(await setStatus(item.id, "archive"))) return;
      }
      setSelected([]);
      setManage(false);
      setPendingDelete([]);
    } finally { setDeleting(false); }
  };

  const detailItem = items.find((item) => item.id === detailId);
  if (detailItem) {
    const trigger = triggers[detailItem.id];
    const history = runs.filter((run) => run.automationId === detailItem.id);
    return <section className="automation-detail-page"><header><button type="button" className="back" onClick={() => setDetailId("")}>‹</button><div><h1>{detailItem.name}</h1><p>{statusLabel(detailItem.status)} · 规则版本 {detailItem.ruleVersion}</p></div><button type="button" onClick={() => void runNow(detailItem.id)}>▷ 立即运行</button><button type="button" onClick={() => setEditing(detailItem)}>编辑</button><button type="button" className="danger" onClick={() => setPendingDelete([detailItem])}>删除</button></header><div className="automation-detail-body"><main><section><h2>执行内容</h2><div className="automation-detail-executor"><span className={`automation-kind ${detailItem.actionType}`}>{detailItem.actionType === "script" ? "⌘" : "◉"}</span><div><b>{detailItem.actionType === "script" ? `${detailItem.action.language} 脚本` : agents.find((agent) => agent.id === detailItem.action.agentId)?.name || detailItem.action.agentId}</b><small>{detailItem.actionType === "script" ? detailItem.action.runtimeId : "数字员工"}</small></div></div><pre>{detailItem.actionType === "script" ? detailItem.action.source : detailItem.action.runbook}</pre></section><section><h2>自动执行</h2><dl><div><dt>执行频率</dt><dd>{trigger?.enabled ? trigger.cronExpression : "仅手动执行"}</dd></div><div><dt>时区</dt><dd>{trigger?.timezone || "—"}</dd></div><div><dt>下次运行</dt><dd>{trigger?.nextFireAt ? new Date(trigger.nextFireAt).toLocaleString() : "—"}</dd></div><div><dt>输出方式</dt><dd>{detailItem.outputMode === "create_task" ? "创建任务" : "仅保留运行记录"}</dd></div><div><dt>并发策略</dt><dd>{detailItem.concurrencyPolicy}</dd></div></dl></section></main><aside><header><h2>运行历史 <span>{history.length}</span></h2></header>{history.slice(0, 20).map((run) => { const taskDeleted = Boolean(run.conversationDeleted || (run.status === "succeeded" && !run.conversationId)); return <button type="button" disabled={!run.conversationId || taskDeleted} onClick={() => run.conversationId && onOpenConversation(run.conversationId, run.agentRunId)} key={run.id}><span className={`automation-run-status ${run.status}`}/><span><b>{runStatusLabel(run.status)}</b><small>{runSourceLabel(run.source)} · {new Date(run.triggeredAt).toLocaleTimeString()}</small></span><time>{taskDeleted ? "任务已删除" : runDuration(run)}</time></button>})}{history.length === 0 && <p>还没有运行记录</p>}</aside></div>{pendingDelete.length > 0 && <div className="backdrop automation-delete-backdrop"><div className="automation-delete-dialog"><span>!</span><h3>删除“{detailItem.name}”？</h3><p>删除后停止触发，历史运行和关联任务会保留。</p><footer><button type="button" onClick={() => setPendingDelete([])}>取消</button><button type="button" className="danger" disabled={deleting} onClick={() => void confirmDelete()}>{deleting ? "删除中…" : "确认删除"}</button></footer></div></div>}{editing && <AutomationDialog initial={editing} initialTrigger={trigger} agents={agents} runtimes={runtimes} onClose={() => setEditing(null)} onSaved={(updated, savedTrigger) => { setItems((current) => current.map((item) => item.id === updated.id ? updated : item)); if (savedTrigger) setTriggers((current) => ({ ...current, [updated.id]: savedTrigger })); setEditing(null); }}/>}</section>;
  }

  return <section className="automation-page">
    <header className="automation-toolbar">
      {manage ? <div className="automation-bulk"><button type="button" onClick={() => setSelected(selected.length === visible.length ? [] : visible.map((item) => item.id))}>全选</button><button type="button" className="danger" disabled={!selected.length} onClick={() => setPendingDelete(items.filter((item) => selected.includes(item.id)))}>删除所选</button><span>已选择 {selected.length} 项</span></div> : <nav><button type="button" className={tab === "schedules" ? "active" : ""} onClick={() => setTab("schedules")}>◷ 定时任务</button><button type="button" className={tab === "runs" ? "active" : ""} onClick={() => setTab("runs")}>▣ 运行记录</button></nav>}
      <div className="automation-toolbar-actions">
        {!manage && <label><span>⌕</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索自动化/记录"/></label>}
        <button type="button" onClick={() => { setManage((value) => !value); setSelected([]); }}>{manage ? "退出管理" : "批量管理"}</button>
        {!manage && <div className="automation-add"><button type="button" className="primary" onClick={() => setCreateOpen(true)}>添加自动化</button><button type="button" className="primary caret" onClick={() => setAddMenuOpen((value) => !value)}>⌄</button>{addMenuOpen && <div><button type="button" onClick={() => { setCreateOpen(true); setAddMenuOpen(false); }}>从空白创建</button><button type="button" disabled>从专家模板创建 · 即将开放</button><button type="button" disabled>从 Skill 创建 · 即将开放</button><button type="button" disabled>从连接器创建 · 即将开放</button></div>}</div>}
      </div>
    </header>

    {error && <div className="automation-error">{error}<button type="button" onClick={() => setError("")}>×</button></div>}
    {tab === "schedules" ? <div className="automation-list">
      <div className="automation-section-label">当前⌄</div>
      {loading && <div className="automation-empty">正在加载自动化…</div>}
      {!loading && visible.map((item) => <article key={item.id}>
        {manage && <input type="checkbox" checked={selected.includes(item.id)} onChange={() => setSelected((current) => current.includes(item.id) ? current.filter((id) => id !== item.id) : [...current, item.id])}/>}<span className={`automation-kind ${item.actionType}`}>{item.actionType === "script" ? "⌘" : "◉"}</span>
        <div className="automation-title"><button type="button" onClick={() => setDetailId(item.id)}>{item.name}</button><span>{item.actionType === "script" ? `${item.action.language} · ${item.action.runtimeId}` : `${agents.find((agent) => agent.id === item.action.agentId)?.name || item.action.agentId} · 数字员工`}</span></div>
        <div className="automation-schedule"><span>{triggers[item.id]?.enabled ? `${statusLabel(item.status)} · ${triggers[item.id].cronExpression} · ${triggers[item.id].timezone}` : statusLabel(item.status)}</span><small>{item.status === "draft" ? "尚未启用，不会自动执行" : triggers[item.id]?.enabled && triggers[item.id].nextFireAt ? `下次运行 ${new Date(triggers[item.id].nextFireAt!).toLocaleString()}` : "仅手动执行"}</small></div>
        <time>{relativeTime(item.updatedAt)}</time>
        {!manage && <button type="button" className={`automation-enable-toggle ${item.status === "active" ? "on" : ""}`} aria-label={item.status === "active" ? "暂停自动化" : "启用自动化"} onClick={() => void setStatus(item.id, item.status === "active" ? "pause" : "resume")}><i/></button>}
        {!manage && <div className="automation-row-menu"><button type="button" className="automation-more" aria-label={`${item.name}的更多操作`} aria-expanded={actionMenuId === item.id} onClick={() => setActionMenuId((current) => current === item.id ? "" : item.id)}>•••</button>{actionMenuId === item.id && <div className="automation-action-menu"><button type="button" onClick={() => { setEditing(item); setActionMenuId(""); }}>编辑</button><button type="button" onClick={() => { void runNow(item.id); setActionMenuId(""); }}>立即运行</button><i/><button type="button" className="danger" onClick={() => { setPendingDelete([item]); setActionMenuId(""); }}>删除</button></div>}</div>}
      </article>)}
      {!loading && visible.length === 0 && <div className="automation-empty"><span>◷</span><b>还没有自动化</b><p>创建一条数字员工或 Script 自动化，把重复工作交给后台执行。</p><button type="button" onClick={() => setCreateOpen(true)}>添加自动化</button></div>}
    </div> : <div className="automation-run-list">
      <div className="automation-section-label"><span>最近运行</span><nav className="automation-run-filters">{([['all','全部'],['running','进行中'],['succeeded','成功'],['failed','失败']] as const).map(([value, label]) => <button type="button" className={runFilter === value ? "active" : ""} onClick={() => setRunFilter(value)} key={value}>{label}</button>)}</nav></div>
      {visibleRuns.map((run) => { const automation = items.find((item) => item.id === run.automationId); const taskDeleted = Boolean(run.conversationDeleted || (run.status === "succeeded" && run.actionType === "agent_prompt" && !run.conversationId)); return <article className={`status-${run.status}`} key={run.id}>
        <span className={`automation-run-status ${run.status}`}/><div className="automation-run-main"><b>{automation?.name || `已删除的自动化 · ${run.automationId.slice(-6)}`}</b><small>{runSourceLabel(run.source)} · {new Date(run.triggeredAt).toLocaleString()}</small></div><span className={`automation-run-badge ${taskDeleted ? "deleted" : run.status}`}>{taskDeleted ? "任务已删除" : runStatusLabel(run.status)}</span><time>{runDuration(run)}</time>{run.failureReason && <p>{runFailureLabel(run.failureReason)}</p>}{taskDeleted ? <span className="automation-run-task-deleted">运行结果：{runStatusLabel(run.status)}</span> : run.conversationId ? <button type="button" onClick={() => onOpenConversation(run.conversationId!, run.agentRunId)}>查看任务</button> : null}
      </article>; })}
      {runs.length === 0 && <div className="automation-empty automation-runs-empty"><span>▣</span><b>还没有运行记录</b><p>点击自动化后的“立即运行”，后台会创建任务并派发给数字员工。</p></div>}
      {runs.length > 0 && visibleRuns.length === 0 && <div className="automation-empty automation-runs-empty"><span>⌕</span><b>没有匹配的运行记录</b><p>调整状态筛选或搜索关键词。</p></div>}
    </div>}

    {pendingDelete.length > 0 && <div className="backdrop automation-delete-backdrop" onMouseDown={(event) => event.target === event.currentTarget && !deleting && setPendingDelete([])}><div className="automation-delete-dialog" role="alertdialog" aria-modal="true" aria-labelledby="automation-delete-title"><span>!</span><h3 id="automation-delete-title">删除{pendingDelete.length > 1 ? `这 ${pendingDelete.length} 条自动化` : `“${pendingDelete[0].name}”`}？</h3><p>删除后不会继续触发。已有运行记录和关联任务会保留，方便审计和追溯。</p><footer><button type="button" disabled={deleting} onClick={() => setPendingDelete([])}>取消</button><button type="button" className="danger" disabled={deleting} onClick={() => void confirmDelete()}>{deleting ? "删除中…" : "确认删除"}</button></footer></div></div>}
    {createOpen && <AutomationDialog agents={agents} runtimes={runtimes} onClose={() => setCreateOpen(false)} onSaved={(created, trigger) => { setItems((current) => [created, ...current]); if (trigger) setTriggers((current) => ({ ...current, [created.id]: trigger })); setCreateOpen(false); }}/>} 
    {editing && <AutomationDialog initial={editing} initialTrigger={triggers[editing.id]} agents={agents} runtimes={runtimes} onClose={() => setEditing(null)} onSaved={(updated, trigger) => { setItems((current) => current.map((item) => item.id === updated.id ? updated : item)); setTriggers((current) => trigger ? ({ ...current, [updated.id]: trigger }) : Object.fromEntries(Object.entries(current).filter(([id]) => id !== updated.id))); setEditing(null); }}/>}
  </section>;
}

function AutomationDialog({ initial, initialTrigger, agents, runtimes, onClose, onSaved }: { initial?: AutomationRecord; initialTrigger?: AutomationTrigger; agents: AgentSummary[]; runtimes: RuntimeSummary[]; onClose: () => void; onSaved: (item: AutomationRecord, trigger?: AutomationTrigger) => void }) {
  const [name, setName] = useState(initial?.name ?? "");
  const [kind, setKind] = useState<AutomationActionKind>(initial?.actionType ?? "agent_prompt");
  const [body, setBody] = useState(initial?.action.runbook ?? initial?.action.source ?? "");
  const [agentId, setAgentId] = useState(initial?.action.agentId ?? agents.find((agent) => agent.online)?.id ?? agents[0]?.id ?? "");
  const [runtimeId, setRuntimeId] = useState(initial?.action.runtimeId ?? runtimes.find((runtime) => runtime.status === "online")?.id ?? runtimes[0]?.id ?? "");
  const [language, setLanguage] = useState<ScriptLanguage>(initial?.action.language ?? "python");
  const [outputMode, setOutputMode] = useState<"create_task" | "run_only">(initial?.outputMode ?? "create_task");
  const [scheduleEnabled, setScheduleEnabled] = useState(Boolean(initialTrigger?.enabled));
  const initialCron = initialTrigger?.cronExpression ?? "0 9 * * 1-5";
  const [cronExpression, setCronExpression] = useState(initialCron);
  const [scheduleTab, setScheduleTab] = useState<ScheduleTab>("period");
  const [periodPreset, setPeriodPreset] = useState<PeriodPreset>(inferPeriod(initialCron));
  const [scheduleTime, setScheduleTime] = useState(cronTime(initialCron));
  const [weekDay, setWeekDay] = useState(Number(initialCron.trim().split(/\s+/)[4]) || 1);
  const [monthDay, setMonthDay] = useState(Number(initialCron.trim().split(/\s+/)[2]) || 1);
  const [intervalEvery, setIntervalEvery] = useState(30);
  const [intervalUnit, setIntervalUnit] = useState<"minute" | "hour">("minute");
  const [timezone, setTimezone] = useState(initialTrigger?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? "UTC");
  const [preview, setPreview] = useState<number[]>([]);
  const [previewError, setPreviewError] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const valid = Boolean(name.trim() && body.trim() && (kind === "agent_prompt" ? agentId : runtimeId) && (!scheduleEnabled || (cronExpression.trim() && timezone.trim())));

  useEffect(() => {
    if (!scheduleEnabled || (scheduleTab === "period" && periodPreset === "custom")) return;
    if (scheduleTab === "interval") {
      setCronExpression(intervalUnit === "minute" ? `*/${intervalEvery} * * * *` : `0 */${intervalEvery} * * *`);
      return;
    }
    const [hour, minute] = scheduleTime.split(":").map(Number);
    const prefix = `${minute || 0} ${hour || 0}`;
    setCronExpression(periodPreset === "daily" ? `${prefix} * * *` : periodPreset === "weekdays" ? `${prefix} * * 1-5` : periodPreset === "weekly" ? `${prefix} * * ${weekDay}` : `${prefix} ${monthDay} * *`);
  }, [intervalEvery, intervalUnit, monthDay, periodPreset, scheduleEnabled, scheduleTab, scheduleTime, weekDay]);

  useEffect(() => {
    if (!scheduleEnabled) { setPreview([]); setPreviewError(""); return; }
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch("/api/multi-agent/automations/cron-preview", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ cronExpression, timezone }), signal: controller.signal });
        if (!response.ok) throw new Error((await response.text()).trim() || "Cron 无效");
        const data = await response.json() as CronPreviewResponse;
        setPreview(data.nextFireAt ?? []); setPreviewError("");
      } catch (reason) { if (!controller.signal.aborted) { setPreview([]); setPreviewError(reason instanceof Error ? reason.message : String(reason)); } }
    }, 300);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [cronExpression, scheduleEnabled, timezone]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!valid || saving) return;
    const request: AutomationCreateRequest = {
      name: name.trim(), ...(!initial ? { status: "active" as const } : {}), outputMode,
      action: kind === "agent_prompt"
        ? { kind, agentId, runbook: body, sessionPolicy: "fresh" }
        : { kind, runtimeId, language, source: body, sessionPolicy: "fresh" },
    };
    setSaving(true); setError("");
    try {
      const response = await fetch(initial ? `/api/multi-agent/automations/${encodeURIComponent(initial.id)}` : "/api/multi-agent/automations", { method: initial ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(request) });
      if (!response.ok) throw new Error((await response.text()).trim() || `${initial ? "保存" : "创建"}自动化失败`);
      const { automation } = await response.json() as AutomationResponse;
      let trigger = initialTrigger;
      if (scheduleEnabled) {
        const triggerResponse = await fetch(initialTrigger ? `/api/multi-agent/automations/${encodeURIComponent(automation.id)}/triggers/${encodeURIComponent(initialTrigger.id)}` : `/api/multi-agent/automations/${encodeURIComponent(automation.id)}/triggers`, { method: initialTrigger ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind: "schedule", cronExpression, timezone, enabled: true }) });
        if (!triggerResponse.ok) throw new Error((await triggerResponse.text()).trim() || "保存执行频率失败");
        trigger = ((await triggerResponse.json()) as AutomationTriggerResponse).trigger;
      } else if (initialTrigger) {
        const triggerResponse = await fetch(`/api/multi-agent/automations/${encodeURIComponent(automation.id)}/triggers/${encodeURIComponent(initialTrigger.id)}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enabled: false }) });
        if (!triggerResponse.ok) throw new Error((await triggerResponse.text()).trim() || "停用执行频率失败");
        trigger = undefined;
      }
      onSaved(automation, trigger);
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setSaving(false); }
  };

  return <div className="backdrop automation-backdrop" onMouseDown={(event) => event.target === event.currentTarget && !saving && onClose()}><form className="automation-dialog" onSubmit={submit}>
    <header><h2>{initial ? "编辑自动化任务" : "添加自动化任务"}</h2><button type="button" onClick={onClose}>×</button></header>
    <label className="automation-name"><span>名称</span><input autoFocus value={name} onChange={(event) => setName(event.target.value)} placeholder="输入任务名称"/></label>
    <div className="automation-action-tabs"><button type="button" className={kind === "agent_prompt" ? "active" : ""} onClick={() => setKind("agent_prompt")}>数字员工</button><button type="button" className={kind === "script" ? "active" : ""} onClick={() => setKind("script")}>任务脚本</button></div>
    <label className="automation-prompt"><span>{kind === "agent_prompt" ? "提示词 / Runbook" : "脚本源码"}</span><textarea value={body} onChange={(event) => setBody(event.target.value)} placeholder={kind === "agent_prompt" ? "描述目标、背景、步骤、约束和预期结果" : language === "python" ? "print('hello automation')" : language === "go" ? "package main\n\nfunc main() {}" : "#!/bin/sh\nset -eu"}/><div><span>＋ 添加上下文</span>{kind === "agent_prompt" ? <select value={agentId} onChange={(event) => setAgentId(event.target.value)}>{agents.map((agent) => <option value={agent.id} key={agent.id}>{agent.name}{agent.online ? "" : " · 离线"}</option>)}</select> : <><select value={language} onChange={(event) => setLanguage(event.target.value as ScriptLanguage)}><option value="shell">Shell</option><option value="python">Python</option><option value="go">Go</option></select><select value={runtimeId} onChange={(event) => setRuntimeId(event.target.value)}>{runtimes.map((runtime) => <option value={runtime.id} key={runtime.id}>{runtime.name} · {runtime.status}</option>)}</select></>}</div></label>
    <div className="automation-context-row"><span>▱ 默认工作空间⌄</span><span className="permission">◉ 按需确认⌄</span><select value={outputMode} onChange={(event) => setOutputMode(event.target.value as "create_task" | "run_only")}><option value="create_task">生成任务</option><option value="run_only">仅运行记录</option></select></div>
    <div className="automation-frequency-row"><span>执行频率</span><button type="button" className={scheduleEnabled ? "configured" : ""} onClick={() => setScheduleEnabled((value) => !value)}>{scheduleEnabled ? scheduleTab === "interval" ? `每 ${intervalEvery} ${intervalUnit === "minute" ? "分钟" : "小时"}` : periodPreset === "daily" ? `每天 ${scheduleTime}` : periodPreset === "weekdays" ? `工作日 ${scheduleTime}` : periodPreset === "weekly" ? `每${weekdayOptions.find((item) => item.value === weekDay)?.label} ${scheduleTime}` : periodPreset === "monthly" ? `每月 ${monthDay} 日 ${scheduleTime}` : "自定义计划" : "手动执行"}<span>⌄</span></button></div>
    {scheduleEnabled && <div className="automation-frequency-popover"><nav><button type="button" className={scheduleTab === "period" ? "active" : ""} onClick={() => setScheduleTab("period")}>周期</button><button type="button" className={scheduleTab === "interval" ? "active" : ""} onClick={() => setScheduleTab("interval")}>间隔</button></nav>{scheduleTab === "period" ? <><select value={periodPreset} onChange={(event) => setPeriodPreset(event.target.value as PeriodPreset)}><option value="daily">每天</option><option value="weekdays">每个工作日</option><option value="weekly">每周</option><option value="monthly">每月</option><option value="custom">自定义 Cron</option></select>{periodPreset === "weekly" && <select value={weekDay} onChange={(event) => setWeekDay(Number(event.target.value))}>{weekdayOptions.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select>}{periodPreset === "monthly" && <label className="frequency-number"><input type="number" min="1" max="31" value={monthDay} onChange={(event) => setMonthDay(Math.max(1, Math.min(31, Number(event.target.value))))}/><span>日</span></label>}{periodPreset !== "custom" ? <input type="time" value={scheduleTime} onChange={(event) => setScheduleTime(event.target.value)}/> : <label className="frequency-cron"><span>Cron（分 时 日 月 周）</span><input value={cronExpression} onChange={(event) => setCronExpression(event.target.value)} placeholder="0 9 * * 1-5"/></label>}</> : <div className="frequency-interval"><span>每</span><input type="number" min="1" max={intervalUnit === "minute" ? 59 : 23} value={intervalEvery} onChange={(event) => setIntervalEvery(Math.max(1, Math.min(intervalUnit === "minute" ? 59 : 23, Number(event.target.value))))}/><select value={intervalUnit} onChange={(event) => setIntervalUnit(event.target.value as "minute" | "hour")}><option value="minute">分钟</option><option value="hour">小时</option></select><span>执行一次</span></div>}<label className="frequency-timezone"><span>时区</span><select value={timezone} onChange={(event) => setTimezone(event.target.value)}><option value={Intl.DateTimeFormat().resolvedOptions().timeZone}>{Intl.DateTimeFormat().resolvedOptions().timeZone}</option>{Intl.DateTimeFormat().resolvedOptions().timeZone !== "Asia/Shanghai" && <option value="Asia/Shanghai">Asia/Shanghai</option>}<option value="UTC">UTC</option></select></label>{previewError ? <p className="error">{previewError}</p> : <div className="frequency-preview"><b>接下来执行</b>{preview.slice(0, 3).map((value) => <time key={value}>{new Date(value).toLocaleString()}</time>)}</div>}</div>}
    <div className="automation-setting-row"><span>有效期</span><b>长期有效</b></div>
    <div className="automation-setting-row muted"><span>完成后推送到 Lark Bot</span><button type="button" disabled title="Lark Notification Outbox 正在开发">○</button><small>配置渠道后开放</small></div>
    {error && <div className="automation-dialog-error">{error}</div>}
    <footer><button type="button" onClick={onClose}>取消</button><button className="primary" disabled={!valid || saving || Boolean(previewError)}>{saving ? "保存中…" : initial ? "保存更改" : "创建并启用"}</button></footer>
  </form></div>;
}
