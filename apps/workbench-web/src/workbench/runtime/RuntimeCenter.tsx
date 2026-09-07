import { useEffect, useMemo, useState, type FormEvent } from "react";
import type { RuntimeDetailResponse, RuntimeSummary } from "../../contracts/control-api";

type Props = { runtimes: RuntimeSummary[]; onBack: () => void; onUpdated: (runtime: RuntimeSummary) => void };

function observedLabel(runtime: RuntimeSummary) {
  return runtime.status === "online" ? "在线" : runtime.status === "stale" ? "心跳超时" : "离线";
}
function controlLabel(runtime: RuntimeSummary) {
  return runtime.controlState === "draining" ? "排空中" : runtime.controlState === "disabled" ? "已禁用" : "接收任务";
}
function relativeTime(value?: number) {
  if (!value) return "从未连接";
  const elapsed = Date.now() - value;
  if (elapsed < 60_000) return "刚刚";
  if (elapsed < 3_600_000) return `${Math.floor(elapsed / 60_000)} 分钟前`;
  return `${Math.floor(elapsed / 3_600_000)} 小时前`;
}

export function RuntimeCenter({ runtimes, onBack, onUpdated }: Props) {
  const [selectedId, setSelectedId] = useState(runtimes[0]?.id ?? "");
  const [detailOpen, setDetailOpen] = useState(false);
  const [detail, setDetail] = useState<RuntimeDetailResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState("");
  const [pairingOpen, setPairingOpen] = useState(false);
  const [pairingToken, setPairingToken] = useState("");
  const [pairingExpiresAt, setPairingExpiresAt] = useState(0);
  const [pairingRuntimeId, setPairingRuntimeId] = useState("runtime-remote");
  const [runtimeCredential, setRuntimeCredential] = useState("");
  const [pairingBusy, setPairingBusy] = useState(false);
  const selected = runtimes.find((runtime) => runtime.id === selectedId) ?? runtimes[0];

  useEffect(() => { if (!selectedId && runtimes[0]) setSelectedId(runtimes[0].id); }, [runtimes, selectedId]);
  const load = async (id: string) => {
    setLoading(true); setError("");
    try {
      const response = await fetch(`/api/multi-agent/runtimes/${encodeURIComponent(id)}`, { cache: "no-store" });
      if (!response.ok) throw new Error((await response.text()).trim() || "节点详情加载失败");
      setDetail(await response.json() as RuntimeDetailResponse);
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setLoading(false); }
  };
  useEffect(() => { if (selected?.id) void load(selected.id); }, [selected?.id]);
  const applyAction = async (action: "drain" | "resume" | "disable") => {
    if (!selected) return;
    const response = await fetch(`/api/multi-agent/runtimes/${encodeURIComponent(selected.id)}/${action}`, { method: "POST" });
    if (!response.ok) { setError((await response.text()).trim() || "节点操作失败"); return; }
    const data = await response.json() as { runtime: RuntimeSummary };
    onUpdated(data.runtime); setDetail((current) => current ? { ...current, runtime: data.runtime } : current);
  };
  const rename = async (event: FormEvent) => {
    event.preventDefault();
    if (!selected || !name.trim()) return;
    const response = await fetch(`/api/multi-agent/runtimes/${encodeURIComponent(selected.id)}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: name.trim() }) });
    if (!response.ok) { setError((await response.text()).trim() || "重命名失败"); return; }
    const data = await response.json() as { runtime: RuntimeSummary };
    onUpdated(data.runtime); setDetail((current) => current ? { ...current, runtime: data.runtime } : current); setRenaming(false);
  };
  const beginPairing = async () => {
    setPairingOpen(true); setPairingBusy(true); setRuntimeCredential(""); setError("");
    try {
      const response = await fetch("/api/multi-agent/runtime-pairings", { method: "POST" });
      if (!response.ok) throw new Error((await response.text()).trim() || "创建接入码失败");
      const data = await response.json() as { pairing: { token: string; expiresAt: number } };
      setPairingToken(data.pairing.token); setPairingExpiresAt(data.pairing.expiresAt);
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); setPairingOpen(false); }
    finally { setPairingBusy(false); }
  };
  const exchangePairing = async () => {
    if (!pairingToken || !pairingRuntimeId.trim() || pairingBusy) return;
    setPairingBusy(true);
    try {
      const response = await fetch("/api/multi-agent/runtime-pairings/exchange", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: pairingToken, runtimeId: pairingRuntimeId.trim() }) });
      if (!response.ok) throw new Error((await response.text()).trim() || "生成节点凭据失败");
      const data = await response.json() as { credential: { secret: string } };
      setRuntimeCredential(data.credential.secret); setPairingToken("");
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setPairingBusy(false); }
  };
  const capabilities = useMemo(() => Object.entries(detail?.runtime.capabilities ?? {}).filter(([, enabled]) => enabled), [detail]);

  return <section className="runtime-center"><header>{!detailOpen && <button type="button" className="runtime-fullscreen-back" onClick={onBack}>‹ <span>设置</span></button>}{detailOpen && <button type="button" className="runtime-back" onClick={() => setDetailOpen(false)}>‹</button>}<div className="runtime-page-title"><h1>{detailOpen ? detail?.runtime.name || "节点详情" : <>运行时 <small>{runtimes.length}</small></>}</h1><p>{detailOpen ? "节点状态、能力、数字员工和活跃运行" : "为数字员工和任务会话提供持续工作的机器与云端 Worker。"}</p></div>{!detailOpen && <button type="button" onClick={() => void beginPairing()}>＋ 添加电脑</button>}</header>{!detailOpen ? <div className="runtime-list-overview">{runtimes.map((runtime) => { const runtimeDetail = detail?.runtime.id === runtime.id ? detail : null; return <button type="button" key={runtime.id} onClick={() => { setSelectedId(runtime.id); setDetailOpen(true); }}><span className="runtime-list-name"><span className="runtime-list-device">▣<i className={runtime.status}/></span><span><b>{runtime.name}</b><small>{runtime.id} · {runtime.instanceId ? `daemon ${runtime.instanceId.slice(0, 8)}…` : "等待 daemon"}</small></span></span><span className="runtime-list-status"><b>{observedLabel(runtime)}</b><small>{controlLabel(runtime)}</small></span><span className="runtime-list-capacity"><b>{runtimeDetail?.models.length ?? "—"} 个模型</b><small>{runtimeDetail?.employees.length ?? "—"} 个数字员工</small></span><span className="runtime-list-space">默认工作空间</span><time>{relativeTime(runtime.lastSeenAt)}</time><i className="runtime-list-arrow">›</i></button>})}{runtimes.length === 0 && <div className="runtime-detail-empty">还没有 Runtime 节点，点击“添加电脑”开始接入。</div>}</div> : <div className="runtime-center-body detail-only"><aside>{runtimes.map((runtime) => <button type="button" className={runtime.id === selected?.id ? "active" : ""} onClick={() => setSelectedId(runtime.id)} key={runtime.id}><i className={runtime.status}/><span><b>{runtime.name}</b><small>{runtime.id}</small></span><em className={runtime.controlState || "active"}>{controlLabel(runtime)}</em></button>)}{runtimes.length === 0 && <p>还没有 Runtime 节点</p>}</aside><main>{loading && !detail ? <div className="runtime-detail-empty">正在读取节点状态…</div> : detail && selected ? <><div className="runtime-detail-title"><span className="runtime-device-icon">⌘</span><div><h2>{detail.runtime.name}</h2><p>{detail.runtime.id} · {detail.runtime.instanceId || "无在线实例"}</p></div><div className="runtime-detail-actions"><button type="button" onClick={() => { setName(detail.runtime.name); setRenaming(true); }}>重命名</button>{detail.runtime.controlState === "active" ? <button type="button" onClick={() => void applyAction("drain")}>排空</button> : <button type="button" className="primary" onClick={() => void applyAction("resume")}>恢复接单</button>}<button type="button" className="danger" disabled={detail.runtime.controlState === "disabled"} onClick={() => void applyAction("disable")}>禁用</button></div></div>{error && <div className="runtime-detail-error">{error}</div>}<div className="runtime-stat-grid"><article><span>连接状态</span><b className={detail.runtime.status}>{observedLabel(detail.runtime)}</b><small>心跳 {relativeTime(detail.runtime.lastSeenAt)}</small></article><article><span>控制状态</span><b>{controlLabel(detail.runtime)}</b><small>配置版本 {detail.runtime.configVersion ?? 1}</small></article><article><span>数字员工</span><b>{detail.employees.length}</b><small>{detail.employees.filter((employee) => employee.online).length} 个在线</small></article><article><span>活跃 Run</span><b>{detail.activeRuns?.length ?? 0}</b><small>当前实例</small></article></div><div className="runtime-detail-columns"><section><h3>节点信息</h3><dl><div><dt>系统</dt><dd>{detail.runtime.os || "-"} / {detail.runtime.architecture || "-"}</dd></div><div><dt>Runtime</dt><dd>{detail.runtime.version || "dev"}</dd></div><div><dt>Node</dt><dd>{detail.runtime.nodeVersion || "-"}</dd></div><div><dt>Pi</dt><dd>{detail.runtime.piVersion || "-"}</dd></div></dl><h3>Capabilities</h3><div className="runtime-capabilities">{capabilities.map(([name]) => <span key={name}>{name}</span>)}{capabilities.length === 0 && <small>没有上报能力</small>}</div></section><section><h3>数字员工</h3><div className="runtime-employees">{detail.employees.map((employee) => <article key={employee.id}><i className={employee.online ? "online" : ""}/><span><b>{employee.name}</b><small>{employee.id} · {employee.presence || (employee.online ? "available" : "offline")}</small></span></article>)}{detail.employees.length === 0 && <small>没有绑定数字员工</small>}</div><h3>可用模型 <em>{detail.models.length}</em></h3><div className="runtime-models">{detail.models.slice(0, 8).map((model) => <span key={`${model.provider}/${model.id}`}><b>{model.name || model.id}</b><small>{model.provider}/{model.id}</small></span>)}</div><h3>Skills <em>{detail.skills?.length ?? 0}</em></h3><div className="runtime-inventory-list">{(detail.skills ?? []).slice(0, 8).map((skill) => <article key={`${skill.source}/${skill.name}`}><b>{skill.name}</b><small>{skill.description || skill.filePath || skill.source || "Runtime Skill"}</small><i>{skill.disableModelInvocation ? "仅手动" : "可调用"}</i></article>)}{!detail.skills?.length && <small>没有发现 Skills</small>}</div><h3>Tools <em>{detail.tools?.length ?? 0}</em></h3><div className="runtime-capabilities">{(detail.tools ?? []).map((tool) => <span title={tool.description} key={tool.name}>{tool.name}</span>)}</div><h3>MCP</h3><div className="runtime-mcp-state">{detail.mcpSupported ? `${detail.mcpServers?.length ?? 0} 个 MCP Server` : "当前 Pi Runtime 尚未上报 MCP Inventory"}</div></section></div>{(detail.activeRuns?.length ?? 0) > 0 && <section className="runtime-active-runs"><h3>活跃运行</h3>{detail.activeRuns.map((run) => <div key={run.runId}><b>{run.agentId}</b><span>{run.conversationId}</span><code>{run.runId}</code></div>)}</section>}</> : <div className="runtime-detail-empty">选择一个节点查看详情</div>}</main></div>}{pairingOpen && <div className="backdrop runtime-rename-backdrop"><section className="runtime-pairing-dialog"><header><div><h3>添加 Runtime 节点</h3><p>接入码 15 分钟有效且只能兑换一次；节点凭据只显示一次。</p></div><button type="button" onClick={() => setPairingOpen(false)}>×</button></header>{!runtimeCredential ? <><label><span>Runtime ID</span><input value={pairingRuntimeId} onChange={(event) => setPairingRuntimeId(event.target.value)} placeholder="runtime-office-mac"/></label><div className="pairing-code"><span>一次性接入码</span><code>{pairingBusy ? "正在生成…" : pairingToken || "生成失败"}</code>{pairingExpiresAt > 0 && <small>有效期至 {new Date(pairingExpiresAt).toLocaleTimeString()}</small>}</div><footer><button type="button" onClick={() => setPairingOpen(false)}>取消</button><button type="button" className="primary" disabled={pairingBusy || !pairingToken || !pairingRuntimeId.trim()} onClick={() => void exchangePairing()}>生成节点凭据</button></footer></> : <><div className="pairing-success"><b>节点凭据已生成</b><p>请立即复制。关闭后无法再次查看。</p><code>{runtimeCredential}</code><button type="button" onClick={() => void navigator.clipboard.writeText(runtimeCredential)}>复制凭据</button></div><div className="pairing-command"><span>启动参数</span><pre>{`MULTI_AGENT_RUNTIME_ID=${pairingRuntimeId.trim()} \\\nMULTI_AGENT_RUNTIME_TOKEN='${runtimeCredential}' \\\n./.bin/runtime -server ws://CONTROL_HOST:30146/api/multi-agent/runtime/ws`}</pre><button type="button" onClick={() => void navigator.clipboard.writeText(`MULTI_AGENT_RUNTIME_ID=${pairingRuntimeId.trim()} MULTI_AGENT_RUNTIME_TOKEN='${runtimeCredential}' ./.bin/runtime -server ws://CONTROL_HOST:30146/api/multi-agent/runtime/ws`)}>复制命令</button></div><footer><button type="button" className="primary" onClick={() => setPairingOpen(false)}>完成</button></footer></>}</section></div>}{renaming && <div className="backdrop runtime-rename-backdrop"><form className="runtime-rename-dialog" onSubmit={rename}><h3>重命名 Runtime 节点</h3><p>自定义名称会在节点重连后继续保留。</p><input autoFocus value={name} onChange={(event) => setName(event.target.value)}/><footer><button type="button" onClick={() => setRenaming(false)}>取消</button><button className="primary" disabled={!name.trim()}>保存</button></footer></form></div>}</section>;
}
