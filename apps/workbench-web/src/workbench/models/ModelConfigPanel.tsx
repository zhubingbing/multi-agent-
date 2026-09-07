import { useEffect, useMemo, useState } from "react";
import type { AgentSummary } from "../../contracts/control-api";

type ModelEntry = { id: string; name?: string; api?: string; reasoning?: boolean; input?: string[]; contextWindow?: number; maxTokens?: number };
type ProviderEntry = { baseUrl?: string; api?: string; apiKey?: string; apiKeyConfigured?: boolean; models?: ModelEntry[] };
type ModelsConfig = { providers?: Record<string, ProviderEntry> };
type Selection = { type: "provider"; provider: string } | { type: "model"; provider: string; index: number };

const apis = ["openai-completions", "openai-responses", "anthropic-messages", "google-generative-ai"];

export function ModelConfigPanel({ agent, onClose, onSaved }: { agent: AgentSummary; onClose: () => void; onSaved: () => void }) {
  const [config, setConfig] = useState<ModelsConfig>({ providers: {} });
  const [selection, setSelection] = useState<Selection | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [showSecret, setShowSecret] = useState(false);
  const [discovering, setDiscovering] = useState(false);
  const [discoveryMessage, setDiscoveryMessage] = useState("");
  const [availableModels, setAvailableModels] = useState<Record<string, Array<{ id: string; name?: string }>>>({});
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    void fetch(`/api/multi-agent/models-config?agentId=${encodeURIComponent(agent.id)}`, { cache: "no-store", signal: controller.signal }).then(async (response) => {
      if (!response.ok) throw new Error((await response.text()).trim() || "模型配置加载失败");
      const data = await response.json() as { config?: ModelsConfig };
      const next = data.config?.providers ? data.config : { providers: {} };
      setConfig(next);
      const first = Object.keys(next.providers ?? {})[0];
      if (first) setSelection({ type: "provider", provider: first });
    }).catch((reason) => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : String(reason)); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [agent.id]);
  const providers = config.providers ?? {};
  const selectedProvider = selection ? providers[selection.provider] : undefined;
  const selectedModel = selection?.type === "model" ? selectedProvider?.models?.[selection.index] : undefined;
  const updateProvider = (provider: string, value: ProviderEntry) => setConfig((current) => ({ ...current, providers: { ...(current.providers ?? {}), [provider]: value } }));
  const addProvider = () => {
    let name = "new-provider", suffix = 1;
    while (providers[name]) name = `new-provider-${suffix++}`;
    setConfig((current) => ({ ...current, providers: { ...(current.providers ?? {}), [name]: { api: "openai-completions", models: [] } } }));
    setSelection({ type: "provider", provider: name });
  };
  const renameProvider = (previous: string, nextRaw: string) => {
    const next = nextRaw.trim();
    if (!next || next === previous || providers[next]) return;
    const entries = Object.entries(providers).map(([key, value]) => [key === previous ? next : key, value] as const);
    setConfig((current) => ({ ...current, providers: Object.fromEntries(entries) }));
    setSelection((current) => current ? { ...current, provider: next } : current);
  };
  const removeProvider = (provider: string) => {
    const next = { ...providers }; delete next[provider];
    setConfig((current) => ({ ...current, providers: next }));
    const first = Object.keys(next)[0]; setSelection(first ? { type: "provider", provider: first } : null);
  };
  const addModel = (provider: string) => {
    const value = providers[provider] ?? {};
    const models = [...(value.models ?? []), { id: "" }];
    updateProvider(provider, { ...value, models });
    setSelection({ type: "model", provider, index: models.length - 1 });
  };
  const updateModel = (provider: string, index: number, patch: Partial<ModelEntry>) => {
    const value = providers[provider] ?? {}; const models = [...(value.models ?? [])];
    models[index] = { ...models[index], ...patch }; updateProvider(provider, { ...value, models });
  };
  const removeModel = (provider: string, index: number) => {
    const value = providers[provider] ?? {}; const models = [...(value.models ?? [])]; models.splice(index, 1);
    updateProvider(provider, { ...value, models }); setSelection({ type: "provider", provider });
  };
  const discoverModels = async (providerName: string, openForm = false) => {
    const provider = providers[providerName];
    if (!provider || discovering) return;
    setDiscovering(true); setDiscoveryMessage(""); setError("");
    try {
      const response = await fetch(`/api/multi-agent/models-config/discover?agentId=${encodeURIComponent(agent.id)}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ providerName, provider }) });
      if (!response.ok) throw new Error((await response.text()).trim() || "自动获取模型失败");
      const data = await response.json() as { models?: Array<{ id: string; name?: string }> };
      const discovered = data.models ?? [];
      setAvailableModels((current) => ({ ...current, [providerName]: discovered }));
      setDiscoveryMessage(`已获取 ${discovered.length} 个可用模型，请在模型表单中选择。`);
      if (openForm) {
        const blankIndex = (provider.models ?? []).findIndex((model) => !model.id.trim());
        if (blankIndex >= 0) setSelection({ type: "model", provider: providerName, index: blankIndex });
        else addModel(providerName);
      }
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setDiscovering(false); }
  };
  const testModel = async (providerName: string, provider: ProviderEntry, model: ModelEntry) => {
    if (testing || !model.id.trim()) return;
    setTesting(true); setTestResult(null); setError("");
    try {
      const response = await fetch(`/api/multi-agent/models-config/test?agentId=${encodeURIComponent(agent.id)}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ providerName, provider, model }) });
      if (!response.ok) throw new Error((await response.text()).trim() || "模型测试失败");
      const data = await response.json() as { ok?: boolean; latencyMs?: number; responseText?: string };
      setTestResult({ ok: true, message: `连接成功${data.latencyMs ? ` · ${data.latencyMs} ms` : ""}${data.responseText ? ` · ${data.responseText}` : ""}` });
    } catch (reason) { setTestResult({ ok: false, message: reason instanceof Error ? reason.message : String(reason) }); }
    finally { setTesting(false); }
  };
  const invalid = useMemo(() => Object.entries(providers).some(([name, provider]) => !name.trim() || (provider.models ?? []).some((model) => !model.id.trim())), [providers]);
  const save = async () => {
    if (saving || invalid) return;
    setSaving(true); setError("");
    try {
      const response = await fetch(`/api/multi-agent/models-config?agentId=${encodeURIComponent(agent.id)}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(config) });
      if (!response.ok) throw new Error((await response.text()).trim() || "模型配置保存失败");
      onSaved(); onClose();
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setSaving(false); }
  };
  return <div className="backdrop model-config-backdrop"><section className="model-config-panel" role="dialog" aria-modal="true" aria-label="模型配置"><header><b>模型</b><code>当前设备 · {agent.runtime} · ~/.pi/agent/models.json</code><button type="button" onClick={onClose}>×</button></header><div className="model-config-body"><aside><div>{loading ? <p>正在加载…</p> : Object.entries(providers).map(([name, provider]) => <section key={name}><button type="button" className={selection?.type === "provider" && selection.provider === name ? "active" : ""} onClick={() => setSelection({ type: "provider", provider: name })}>◉ <span>{name}</span></button>{(provider.models ?? []).map((model, index) => <button type="button" className={`model ${selection?.type === "model" && selection.provider === name && selection.index === index ? "active" : ""}`} onClick={() => setSelection({ type: "model", provider: name, index })} key={`${index}-${model.id}`}><span>{model.id || "新模型"}</span>{model.reasoning && <i>T</i>}</button>)}<button type="button" className="model add" onClick={() => addModel(name)}>＋ 模型</button></section>)}</div><button type="button" className="add-provider" onClick={addProvider}>＋ 添加 Provider</button></aside><main>{selection?.type === "provider" && selectedProvider && <div className="model-config-detail" key={selection.provider}><div className="detail-title"><small>PROVIDER</small><button type="button" className="danger" onClick={() => removeProvider(selection.provider)}>删除</button></div><label><span>Provider 名称</span><input defaultValue={selection.provider} onBlur={(event) => renameProvider(selection.provider, event.target.value)}/></label><label><span>Base URL</span><input value={selectedProvider.baseUrl ?? ""} onChange={(event) => updateProvider(selection.provider, { ...selectedProvider, baseUrl: event.target.value })} placeholder="https://api.example.com/v1"/></label><label><span>API Key</span><div className="secret"><input type={showSecret ? "text" : "password"} value={selectedProvider.apiKey ?? ""} onChange={(event) => updateProvider(selection.provider, { ...selectedProvider, apiKey: event.target.value })} placeholder={selectedProvider.apiKeyConfigured ? "已配置；留空将保持现有密钥" : "API Key 或环境变量名"}/><button type="button" onClick={() => setShowSecret((value) => !value)}>{showSecret ? "隐藏" : "显示"}</button></div><small>也可以填写环境变量引用；凭据仅发送到该 Runtime。</small></label><label><span>API 协议</span><select value={selectedProvider.api ?? "openai-completions"} onChange={(event) => updateProvider(selection.provider, { ...selectedProvider, api: event.target.value })}>{apis.map((api) => <option value={api} key={api}>{api}</option>)}</select></label><div className="provider-model-actions"><button type="button" className="discover" disabled={discovering || !selectedProvider.baseUrl} onClick={() => void discoverModels(selection.provider, true)}>{discovering ? "正在获取…" : "获取表单可用模型"}</button><button type="button" className="import" onClick={() => addModel(selection.provider)}>手动添加模型</button></div>{discoveryMessage && <p className="discovery-ok">{discoveryMessage}</p>}</div>}{selection?.type === "model" && selectedProvider && selectedModel && <div className="model-config-detail"><div className="detail-title"><small>模型 · {selection.provider}</small><button type="button" className="test" disabled={testing || !selectedModel.id.trim()} onClick={() => void testModel(selection.provider, selectedProvider, selectedModel)}>{testing ? "测试中…" : "测试"}</button><button type="button" className="danger" onClick={() => removeModel(selection.provider, selection.index)}>删除</button></div><div className="two"><label><span>ID *</span><div className="model-id-field"><input autoFocus value={selectedModel.id} onChange={(event) => updateModel(selection.provider, selection.index, { id: event.target.value })} placeholder="从可用模型中选择，或手动输入"/><button type="button" disabled={discovering || !selectedProvider.baseUrl} onClick={() => void discoverModels(selection.provider)}>{discovering ? "获取中…" : "获取可用模型"}</button></div>{(availableModels[selection.provider]?.length ?? 0) > 0 && <select className="available-model-select" value="" onChange={(event) => { const found = availableModels[selection.provider].find((model) => model.id === event.target.value); if (found) updateModel(selection.provider, selection.index, { id: found.id, name: found.name ?? selectedModel.name }); }}><option value="">选择服务端返回的模型（{availableModels[selection.provider].length}）</option>{availableModels[selection.provider].map((model) => <option value={model.id} key={model.id}>{model.name ? `${model.name} · ${model.id}` : model.id}</option>)}</select>}</label><label><span>Name</span><input value={selectedModel.name ?? ""} onChange={(event) => updateModel(selection.provider, selection.index, { name: event.target.value })} placeholder="Display name"/></label></div><label><span>模型 API 协议</span><select value={selectedModel.api ?? ""} onChange={(event) => updateModel(selection.provider, selection.index, { api: event.target.value || undefined })}><option value="">跟随 Provider（{selectedProvider.api ?? "openai-completions"}）</option>{apis.map((api) => <option value={api} key={api}>{api}</option>)}</select><small>同一个网关中的不同模型可能需要不同协议；例如部分 Claude 路由只支持 OpenAI Chat Completions。</small></label><fieldset><legend>能力</legend><label className="check"><input type="checkbox" checked={Boolean(selectedModel.reasoning)} onChange={(event) => updateModel(selection.provider, selection.index, { reasoning: event.target.checked })}/>推理 / 思考</label><label className="check"><input type="checkbox" checked={selectedModel.input?.includes("image") ?? false} onChange={(event) => updateModel(selection.provider, selection.index, { input: event.target.checked ? ["text", "image"] : ["text"] })}/>图片输入</label></fieldset><div className="two"><label><span>上下文窗口（tokens）</span><input type="number" value={selectedModel.contextWindow ?? 128000} onChange={(event) => updateModel(selection.provider, selection.index, { contextWindow: Number(event.target.value) })}/></label><label><span>最大输出 tokens</span><input type="number" value={selectedModel.maxTokens ?? 16384} onChange={(event) => updateModel(selection.provider, selection.index, { maxTokens: Number(event.target.value) })}/></label></div>{testResult && <div className={`model-test-result ${testResult.ok ? "success" : "error"}`}>{testResult.message}</div>}</div>}{!selection && !loading && <div className="model-config-empty"><b>还没有自定义 Provider</b><p>点击左下角添加一个模型服务。</p></div>}</main></div><footer>{error && <span>{error}</span>}<button type="button" onClick={onClose}>取消</button><button type="button" className="primary" disabled={saving || invalid} onClick={() => void save()}>{saving ? "保存中…" : "保存"}</button></footer></section></div>;
}
