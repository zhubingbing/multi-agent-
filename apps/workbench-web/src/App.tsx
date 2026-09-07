import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { INITIAL_STREAMING_STATE, mergeGroupConversationTurns, type GroupAgentRun, type GroupConversationTurn } from "@multi-agent/chat-core";
import { reduceLiveRun, type AgentSessionEvent, type LiveRun } from "./chat-stream";
import { ConversationTimeline } from "./ConversationTimeline";
import { ChatComposer } from "./ChatComposer";
import { AgentCenter } from "./workbench/agents/AgentCenter";
import { AutomationPage } from "./workbench/automation/AutomationPage";
import { ModelConfigPanel } from "./workbench/models/ModelConfigPanel";
import { RuntimeCenter } from "./workbench/runtime/RuntimeCenter";
import type {
  AgentListResponse,
  AgentResponse,
  AgentSummary,
  BindingListResponse,
  ChannelListResponse,
  ChannelSummary,
  ConversationBinding,
  ConversationTurnsResponse,
  CreateChannelResponse,
  ModelListResponse,
  ModelSummary,
  RuntimeListResponse,
  RuntimeSummary,
  WorkspaceListResponse,
  WorkspaceResponse,
  WorkspaceSummary,
  AgentConfigPatch,
} from "./contracts/control-api";

type View = "tasks" | "agents" | "settings";
type WorkbenchOverlay = "apps" | "automation";
type TaskMode = "chat" | "split" | "canvas";
type CanvasTab = "assets" | "workspace" | "runs";
type SettingsSection = "models" | "runtimes";

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
  const [settingsSection, setSettingsSection] = useState<SettingsSection>("models");
  const [overlay, setOverlay] = useState<WorkbenchOverlay | null>(null);
  const [channels, setChannels] = useState<ChannelSummary[]>([]);
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>([]);
  const [agents, setAgents] = useState<AgentSummary[]>([]);
  const [runtimes, setRuntimes] = useState<RuntimeSummary[]>([]);
  const [activeId, setActiveId] = useState("");
  const [activeAgentId, setActiveAgentId] = useState("");
  const [turns, setTurns] = useState<GroupConversationTurn[]>([]);
  const [bindings, setBindings] = useState<ConversationBinding[]>([]);
  const [selectedAgents, setSelectedAgents] = useState<string[]>([]);
  const [mode, setMode] = useState<TaskMode>(() => (localStorage.getItem("workbench-task-mode-v2") as TaskMode) || "chat");
  const [canvasTab, setCanvasTab] = useState<CanvasTab>("workspace");
  const [focusedRunId, setFocusedRunId] = useState("");
  const [connected, setConnected] = useState(false);
  const [running, setRunning] = useState<string[]>([]);
  const [draft, setDraft] = useState("");
  const [composerPrefill, setComposerPrefill] = useState("");
  const [replyTarget, setReplyTarget] = useState<{ turnId: string; messageId: string; text: string } | null>(null);
  const [draftAgentId, setDraftAgentId] = useState("");
  const [creatingFromDraft, setCreatingFromDraft] = useState(false);
  const [executionMode, setExecutionMode] = useState<"sequential" | "parallel">("sequential");
  const [search, setSearch] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [createTitle, setCreateTitle] = useState("");
  const [createAgents, setCreateAgents] = useState<string[]>([]);
  const [createWorkspaceId, setCreateWorkspaceId] = useState("workspace-default");
  const [workspaceManagerOpen, setWorkspaceManagerOpen] = useState(false);
  const [workspaceCreateOpen, setWorkspaceCreateOpen] = useState(false);
  const [collapsedWorkspaceIds, setCollapsedWorkspaceIds] = useState<string[]>(() => { try { const raw = localStorage.getItem("workbench-collapsed-workspaces"); return raw ? JSON.parse(raw) as string[] : []; } catch { return []; } });
  const [workspaceEditor, setWorkspaceEditor] = useState<WorkspaceSummary | null | undefined>(undefined);
  const [workspaceName, setWorkspaceName] = useState("");
  const [workspaceCwd, setWorkspaceCwd] = useState("");
  const [savingWorkspace, setSavingWorkspace] = useState(false);
  const [deletingWorkspaceId, setDeletingWorkspaceId] = useState("");
  const [deleteWorkspaceTarget, setDeleteWorkspaceTarget] = useState<WorkspaceSummary | null>(null);
  const [workspaceMenuId, setWorkspaceMenuId] = useState("");
  const [taskMenuId, setTaskMenuId] = useState("");
  const [deleteTaskTargets, setDeleteTaskTargets] = useState<ChannelSummary[]>([]);
  const [deletingTask, setDeletingTask] = useState(false);
  const [manageTasks, setManageTasks] = useState(false);
  const [selectedTaskIds, setSelectedTaskIds] = useState<string[]>([]);
  const [chatConfigAgentId, setChatConfigAgentId] = useState("");
  const [modelPickerAgentId, setModelPickerAgentId] = useState("");
  const [modelConfigAgentId, setModelConfigAgentId] = useState("");
  const [error, setError] = useState("");
  const socketRef = useRef<WebSocket | null>(null);
  const pendingPromptRef = useRef<{ conversationId: string; message: string; agentId: string } | null>(null);
  const runtimeCursorsRef = useRef(new Map<string, number>());

  const active = channels.find((channel) => channel.id === activeId);
  const participants = active?.agentIds.flatMap((id) => agents.find((agent) => agent.id === id) ?? []) ?? [];
  const filteredChannels = useMemo(() => channels.filter((channel) => channel.title.toLocaleLowerCase().includes(search.toLocaleLowerCase())), [channels, search]);

  const loadShell = useCallback(async () => {
    try {
      const [channelResponse, workspaceResponse, agentResponse, runtimeResponse] = await Promise.all([
        fetch("/api/multi-agent/channels", { cache: "no-store" }),
        fetch("/api/multi-agent/workspaces", { cache: "no-store" }),
        fetch("/api/multi-agent/agents", { cache: "no-store" }),
        fetch("/api/multi-agent/runtimes", { cache: "no-store" }),
      ]);
      if (!channelResponse.ok) throw new Error("Control Server 尚未启动");
      const channelData = await channelResponse.json() as ChannelListResponse;
      const workspaceData = await workspaceResponse.json() as WorkspaceListResponse;
      const agentData = await agentResponse.json() as AgentListResponse;
      const runtimeData = await runtimeResponse.json() as RuntimeListResponse;
      const nextChannels = channelData.channels ?? [];
      setChannels(nextChannels);
      setWorkspaces(workspaceData.workspaces ?? []);
      setAgents(agentData.agents ?? []);
      setActiveAgentId((current) => current || (agentData.agents ?? [])[0]?.id || "");
      setDraftAgentId((current) => current || (agentData.agents ?? []).find((agent) => agent.online)?.id || (agentData.agents ?? [])[0]?.id || "");
      setRuntimes(runtimeData.runtimes ?? []);
      setActiveId((current) => current || new URLSearchParams(location.search).get("conversation") || nextChannels[0]?.id || "");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  }, []);

  const updateRun = useCallback((agentId: string, update: (run: GroupAgentRun) => GroupAgentRun, runId?: string) => {
    setTurns((current) => {
      const next = [...current];
      for (let turnIndex = next.length - 1; turnIndex >= 0; turnIndex--) {
        const runIndex = next[turnIndex].runs.findIndex((run) => !run.settled && (runId ? run.id === runId : run.agentId === agentId));
        if (runIndex < 0) continue;
        const runs = [...next[turnIndex].runs];
        runs[runIndex] = update(runs[runIndex]);
        next[turnIndex] = { ...next[turnIndex], runs };
        break;
      }
      return next;
    });
  }, []);

  const loadConversation = useCallback(async (conversationId: string) => {
    if (!conversationId) { setTurns([]); setBindings([]); return; }
    const [bindingResponse, turnResponse] = await Promise.all([
      fetch(`/api/multi-agent/bindings?conversationId=${encodeURIComponent(conversationId)}`, { cache: "no-store" }),
      fetch(`/api/multi-agent/conversations/${encodeURIComponent(conversationId)}/turns`, { cache: "no-store" }),
    ]);
    if (bindingResponse.ok) setBindings(((await bindingResponse.json()) as BindingListResponse).bindings ?? []);
    if (turnResponse.ok) {
      const data = await turnResponse.json() as ConversationTurnsResponse;
      setTurns((current) => mergeGroupConversationTurns(current, data.turns ?? []));
      for (const cursor of data.cursors ?? []) {
        const key = `${cursor.runtimeId}\u0000${cursor.instanceId}`;
        runtimeCursorsRef.current.set(key, Math.max(runtimeCursorsRef.current.get(key) ?? 0, cursor.sequence));
      }
    }
  }, []);

  useEffect(() => {
    if (!workspaceMenuId) return;
    const close = (event: MouseEvent) => { if (!(event.target instanceof Element) || !event.target.closest(".workspace-menu") && !event.target.closest(".workspace-name")) setWorkspaceMenuId(""); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [workspaceMenuId]);
  useEffect(() => { void loadShell(); }, [loadShell]);
  useEffect(() => { try { localStorage.setItem("workbench-collapsed-workspaces", JSON.stringify(collapsedWorkspaceIds)); } catch { /* ignore */ } }, [collapsedWorkspaceIds]);
  const toggleWorkspaceCollapse = (id: string) => setCollapsedWorkspaceIds((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id]);
  const allCollapsed = workspaces.length > 0 && workspaces.every((workspace) => collapsedWorkspaceIds.includes(workspace.id));
  const toggleAllWorkspaces = () => setCollapsedWorkspaceIds(allCollapsed ? [] : workspaces.map((workspace) => workspace.id));
  useEffect(() => {
    if (!taskMenuId) return;
    const close = (event: MouseEvent) => { if (!(event.target instanceof Element) || !event.target.closest(".task-list-item")) setTaskMenuId(""); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [taskMenuId]);
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
      socket.onopen = () => {
        setConnected(true);
        const pending = pendingPromptRef.current;
        if (pending?.conversationId === activeId) {
          pendingPromptRef.current = null;
          dispatchPrompt(socket, pending.message, [pending.agentId], "parallel");
        }
      };
      socket.onmessage = ({ data }) => {
        const event = JSON.parse(data) as { type?: string; runtimeId?: string; instanceId?: string; runtimeSeq?: number; agentId?: string; agentIds?: string[]; runId?: string; event?: AgentSessionEvent; error?: string };
        if (event.runtimeId && event.instanceId && event.runtimeSeq) {
          const key = `${event.runtimeId}\u0000${event.instanceId}`;
          const cursor = runtimeCursorsRef.current.get(key) ?? 0;
          if (event.runtimeSeq <= cursor) return;
          runtimeCursorsRef.current.set(key, event.runtimeSeq);
        }
        if (event.type === "dispatched") setRunning(event.agentIds ?? []);
        if (event.type === "agent_event" && event.agentId && event.event) {
          setRunning((current) => current.includes(event.agentId!) ? current : [...current, event.agentId!]);
          updateRun(event.agentId, (run) => reduceLiveRun(run as LiveRun, event.event!) as GroupAgentRun, event.runId);
        }
        if (event.type === "conversation_committed" || event.type === "binding_updated") {
          void loadConversation(activeId).finally(() => {
            if (event.type === "conversation_committed" && event.agentId) setRunning((current) => current.filter((id) => id !== event.agentId));
          });
        }
        if (event.type === "agent_error" && event.agentId) {
          setRunning((current) => current.filter((id) => id !== event.agentId));
          updateRun(event.agentId, (run) => ({ ...run, status: "failed", settled: true, stream: INITIAL_STREAMING_STATE, error: event.error ?? "Runtime error" }), event.runId);
        }
        if (event.type === "persistence_error") void loadConversation(activeId);
      };
      socket.onclose = () => { setConnected(false); if (!stopped) timer = window.setTimeout(connect, 800); };
    };
    connect();
    return () => { stopped = true; if (timer) clearTimeout(timer); socketRef.current?.close(); socketRef.current = null; };
  }, [activeId, active?.agentIds, agents, loadConversation, updateRun]);

  const chooseMode = (next: TaskMode) => { setMode(next); localStorage.setItem("workbench-task-mode-v2", next); };
  const selectTask = (id: string) => { setTurns([]); setRunning([]); setFocusedRunId(""); setActiveId(id); setView("tasks"); setOverlay(null); };
  const openAutomationTask = (id: string, runId?: string) => { selectTask(id); setFocusedRunId(runId ?? ""); setCanvasTab("runs"); chooseMode("split"); };
  const openOverlay = (next: WorkbenchOverlay) => { setView("tasks"); setOverlay(next); };
  const beginDraftTask = () => {
    setActiveId("");
    setTurns([]);
    setBindings([]);
    setRunning([]);
    setDraft("");
    setDraftAgentId((current) => current || agents.find((agent) => agent.online)?.id || agents[0]?.id || "");
    setView("tasks");
    setOverlay(null);
    history.replaceState(null, "", "/conversations");
  };
  const openCreate = (workspaceId = workspaces[0]?.id || "workspace-default") => { setCreateTitle(""); setCreateWorkspaceId(workspaceId); setCreateAgents(agents.find((agent) => agent.online)?.id ? [agents.find((agent) => agent.online)!.id] : []); setCreateOpen(true); };

  const editWorkspace = (workspace?: WorkspaceSummary) => {
    setWorkspaceEditor(workspace ?? null);
    setWorkspaceName(workspace?.name ?? "");
    setWorkspaceCwd(workspace?.cwd ?? "");
  };

  const beginCreateWorkspace = () => {
    setWorkspaceEditor(null); setWorkspaceName(""); setWorkspaceCwd(""); setWorkspaceCreateOpen(true);
  };

  const saveWorkspace = async (event: FormEvent) => {
    event.preventDefault();
    if (!workspaceName.trim() || savingWorkspace) return;
    setSavingWorkspace(true); setError("");
    try {
      const editing = Boolean(workspaceEditor);
      const response = await fetch(editing ? `/api/multi-agent/workspaces/${encodeURIComponent(workspaceEditor!.id)}` : "/api/multi-agent/workspaces", {
        method: editing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: workspaceName.trim(), cwd: workspaceCwd.trim() }),
      });
      if (!response.ok) throw new Error((await response.text()).trim() || "保存工作空间失败");
      const { workspace } = await response.json() as WorkspaceResponse;
      setWorkspaces((current) => editing ? current.map((item) => item.id === workspace.id ? workspace : item) : [...current, workspace]);
      setWorkspaceEditor(undefined); setWorkspaceName(""); setWorkspaceCwd("");
      if (!editing) setWorkspaceCreateOpen(false);
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setSavingWorkspace(false); }
  };

  const deleteWorkspace = async (workspace: WorkspaceSummary) => {
    if (workspace.id === "workspace-default" || deletingWorkspaceId) return;
    setDeletingWorkspaceId(workspace.id); setError("");
    try {
      const response = await fetch(`/api/multi-agent/workspaces/${encodeURIComponent(workspace.id)}`, { method: "DELETE" });
      if (!response.ok) throw new Error((await response.text()).trim() || "删除工作空间失败");
      setWorkspaces((current) => current.filter((item) => item.id !== workspace.id));
      const removedChannels = channels.filter((channel) => channel.workspaceId === workspace.id);
      const removedIDs = new Set(removedChannels.map((channel) => channel.id));
      const remaining = channels.filter((channel) => !removedIDs.has(channel.id));
      setChannels(remaining);
      setSelectedTaskIds((current) => current.filter((id) => !removedIDs.has(id)));
      if (removedIDs.has(activeId)) {
        setTurns([]); setBindings([]); setRunning([]); setActiveId(remaining[0]?.id ?? "");
      }
      setDeleteWorkspaceTarget(null); setWorkspaceEditor(undefined);
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setDeletingWorkspaceId(""); }
  };

  const createTask = async (event: FormEvent) => {
    event.preventDefault();
    const response = await fetch("/api/multi-agent/channels", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: createTitle.trim(), workspaceId: createWorkspaceId, agentIds: createAgents }) });
    if (!response.ok) { setError(await response.text()); return; }
    const { channel } = await response.json() as CreateChannelResponse;
    setChannels((current) => [channel, ...current]); setActiveId(channel.id); setCreateOpen(false);
  };

  const deleteTask = async () => {
    if (!deleteTaskTargets.length || deletingTask) return;
    setDeletingTask(true);
    try {
      const results = await Promise.all(deleteTaskTargets.map(async (target) => {
        try {
          const response = await fetch(`/api/multi-agent/channels/${encodeURIComponent(target.id)}`, { method: "DELETE" });
          if (!response.ok) throw new Error((await response.text()).trim() || `删除任务失败（${target.title}）`);
          return { id: target.id, ok: true as const };
        } catch (reason) {
          return { id: target.id, ok: false as const, error: reason instanceof Error ? reason.message : String(reason) };
        }
      }));
      const removed = new Set(results.filter((entry) => entry.ok).map((entry) => entry.id));
      const failures = results.filter((entry) => !entry.ok);
      if (removed.size > 0) {
        const remaining = channels.filter((channel) => !removed.has(channel.id));
        setChannels(remaining);
        setSelectedTaskIds((current) => current.filter((id) => !removed.has(id)));
        if (activeId && removed.has(activeId)) {
          setTurns([]); setBindings([]); setRunning([]); setActiveId(remaining[0]?.id ?? "");
          history.replaceState(null, "", remaining[0] ? `/conversations?conversation=${encodeURIComponent(remaining[0].id)}` : "/conversations");
        }
      }
      if (failures.length > 0) {
        setError(failures[0].error || "部分任务删除失败");
      } else {
        setDeleteTaskTargets([]);
        if (manageTasks) setManageTasks(false);
      }
    } finally { setDeletingTask(false); }
  };

  const dispatchPrompt = (socket: WebSocket, message: string, targets: string[], requestedMode: "sequential" | "parallel") => {
    const turnId = crypto.randomUUID();
    const createdAt = Date.now();
    const runIds = Object.fromEntries(targets.map((id) => [id, crypto.randomUUID()]));
    const runs: GroupAgentRun[] = targets.map((agentId, index) => ({
      id: runIds[agentId],
      agentId,
      status: requestedMode === "sequential" && targets.length > 1 && index > 0 ? "queued" : "running",
      messages: [],
      stream: INITIAL_STREAMING_STATE,
      settled: false,
    }));
    setTurns((current) => [...current, {
      id: turnId,
      user: { role: "user", content: message, timestamp: createdAt, authorType: "member", authorId: "local-user", ...(replyTarget ? { replyToTurnId: replyTarget.turnId, replyToMessageId: replyTarget.messageId, replyToText: replyTarget.text } : {}) },
      runs,
    }]);
    setRunning(targets);
    socket.send(JSON.stringify({ type: "prompt", message, agentIds: targets, turnId, createdAt, runIds, executionMode: targets.length > 1 ? requestedMode : "parallel", ...(replyTarget ? { replyToTurnId: replyTarget.turnId, replyToMessageId: replyTarget.messageId } : {}) }));
    setReplyTarget(null);
  };

  const sendMessage = (message: string) => {
    const normalized = message.toLocaleLowerCase();
    const mentioned = participants.filter((agent) => normalized.includes(`@${agent.id.toLocaleLowerCase()}`) || normalized.includes(`@${agent.name.toLocaleLowerCase()}`)).map((agent) => agent.id);
    const requested = mentioned.length ? mentioned : selectedAgents;
    const targets = requested.filter((id) => participants.some((agent) => agent.id === id && agent.online));
    if (!message.trim() || !socketRef.current || socketRef.current.readyState !== WebSocket.OPEN || !targets.length) return;
    dispatchPrompt(socketRef.current, message.trim(), targets, executionMode);
    setComposerPrefill("");
  };

  const sendControl = (agentId: string | null, type: "steer" | "follow_up" | "abort", message = "") => {
    const agentIds = agentId ? [agentId] : running;
    if (!socketRef.current || socketRef.current.readyState !== WebSocket.OPEN || !agentIds.length) return;
    socketRef.current.send(JSON.stringify({ type, message, agentIds }));
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
      const { channel } = await response.json() as CreateChannelResponse;
      setChannels((current) => [channel, ...current]);
      setSelectedAgents([target.id]);
      pendingPromptRef.current = { conversationId: channel.id, message, agentId: target.id };
      setActiveId(channel.id);
      setDraft("");
    } catch (reason) {
      setError(`创建任务失败：${reason instanceof Error ? reason.message : String(reason)}`);
    } finally {
      setCreatingFromDraft(false);
    }
  };

  return <div className="window">
    <header className="topbar"><div className="traffic"><i/><i/><i/></div><button className="account">个人账号⌄</button><div className="drag"/><span className="connection"><i className={connected ? "on" : ""}/>{connected ? "服务已连接" : "正在连接"}</span></header>
    <div className={`shell ${view === "settings" && settingsSection === "runtimes" ? "module-fullscreen" : ""}`}>
      <nav className="rail"><Rail icon="tasks" label="任务" active={view === "tasks"} onClick={() => { setView("tasks"); setOverlay(null); }}/><Rail icon="agents" label="数字员工" active={!overlay && view === "agents"} onClick={() => { setView("agents"); setOverlay(null); }}/><Rail icon="message" label="消息"/><span/><Rail icon="settings" label="设置" active={!overlay && view === "settings"} onClick={() => { setView("settings"); setOverlay(null); }}/><button className="profile">U</button></nav>
      <aside className="sidebar">
        {view === "tasks" ? <><div className="primary-nav"><button className={`new ${!overlay ? "active" : ""}`} onClick={beginDraftTask}><Icon name="plus" size={16}/>新任务</button><button className={overlay === "apps" ? "active" : ""} onClick={() => openOverlay("apps")}><Icon name="apps" size={16}/>应用中心</button><button className={overlay === "automation" ? "active" : ""} onClick={() => openOverlay("automation")}><Icon name="automation" size={16}/>自动化</button><button><Icon name="import" size={16}/>导入数据</button></div><div className="side-heading">工作空间 <small>({workspaces.length})</small><button className="side-heading-icon" onClick={toggleAllWorkspaces} title={allCollapsed ? "展开全部" : "折叠全部"} aria-label={allCollapsed ? "展开全部工作空间" : "折叠全部工作空间"}>{allCollapsed ? "˅" : "˄"}</button><button className="side-heading-icon" disabled title="排序即将开放" aria-label="排序">⇅</button><button onClick={beginCreateWorkspace} title="新建工作空间">+</button></div>{channels.length > 0 && <button type="button" className="task-manage-toggle" onClick={() => { setManageTasks((value) => !value); setSelectedTaskIds([]); setTaskMenuId(""); }}>{manageTasks ? "完成任务管理" : "批量管理任务"}</button>}{manageTasks && <div className="task-bulk-bar"><label><input type="checkbox" checked={selectedTaskIds.length > 0 && selectedTaskIds.length === filteredChannels.length} ref={(node) => { if (node) node.indeterminate = selectedTaskIds.length > 0 && selectedTaskIds.length < filteredChannels.length; }} onChange={() => setSelectedTaskIds(selectedTaskIds.length === filteredChannels.length ? [] : filteredChannels.map((channel) => channel.id))}/><span>{selectedTaskIds.length ? `已选 ${selectedTaskIds.length}` : "全选"}</span></label><button type="button" className="danger" disabled={!selectedTaskIds.length} onClick={() => setDeleteTaskTargets(channels.filter((channel) => selectedTaskIds.includes(channel.id)))}>删除所选</button></div>}<div className="search"><Icon name="search" size={14}/><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索任务"/></div><div className="tasks">{workspaces.map((workspace) => { const workspaceChannels = filteredChannels.filter((channel) => channel.workspaceId === workspace.id); const collapsed = collapsedWorkspaceIds.includes(workspace.id); return <section className={`workspace-group ${collapsed ? "collapsed" : ""}`} key={workspace.id}><div className="workspace"><button type="button" className="workspace-chevron-btn" onClick={() => toggleWorkspaceCollapse(workspace.id)} aria-expanded={!collapsed} aria-label={collapsed ? `展开${workspace.name}` : `折叠${workspace.name}`}><i className={`workspace-chevron ${collapsed ? "collapsed" : ""}`}>›</i></button><button type="button" className="workspace-name" aria-expanded={workspaceMenuId === workspace.id} onClick={() => setWorkspaceMenuId((current) => current === workspace.id ? "" : workspace.id)}><Icon name="folder" size={16}/><span title={workspace.cwd || "未设置工作目录"}>{workspace.name}</span><small>{workspaceChannels.length}</small></button><button type="button" className="workspace-add-btn" onClick={() => openCreate(workspace.id)} title={`在${workspace.name}中新建任务`} aria-label={`在${workspace.name}中新建任务`}>+</button>{workspaceMenuId === workspace.id && <div className="workspace-menu"><button type="button" onClick={() => { if (collapsed) toggleWorkspaceCollapse(workspace.id); setWorkspaceMenuId(""); }}>{collapsed ? "展开" : "折叠"}</button><button type="button" onClick={() => { editWorkspace(workspace); setWorkspaceManagerOpen(true); setWorkspaceMenuId(""); }}>编辑</button>{workspace.id !== "workspace-default" && <><i/><button type="button" className="danger" disabled={deletingWorkspaceId === workspace.id} onClick={() => { void deleteWorkspace(workspace); setWorkspaceMenuId(""); }}>{deletingWorkspaceId === workspace.id ? "删除中…" : "删除工作空间"}</button></>}</div>}</div>{!collapsed && workspaceChannels.map((channel) => <div className={`task-list-item ${channel.id === activeId && !overlay && !manageTasks ? "active" : ""} ${manageTasks ? "manage" : ""} ${manageTasks && selectedTaskIds.includes(channel.id) ? "picked" : ""}`} key={channel.id}>{manageTasks && <input type="checkbox" className="task-list-check" checked={selectedTaskIds.includes(channel.id)} onChange={() => setSelectedTaskIds((current) => current.includes(channel.id) ? current.filter((id) => id !== channel.id) : [...current, channel.id])}/>}<button className="task-list-select" onClick={() => manageTasks ? setSelectedTaskIds((current) => current.includes(channel.id) ? current.filter((id) => id !== channel.id) : [...current, channel.id]) : selectTask(channel.id)}>{channel.title}</button>{!manageTasks && <><button className="task-list-more" aria-label={`${channel.title}的更多操作`} aria-expanded={taskMenuId === channel.id} onClick={() => setTaskMenuId((current) => current === channel.id ? "" : channel.id)}>•••</button>{taskMenuId === channel.id && <div className="task-list-menu"><button type="button" onClick={() => { selectTask(channel.id); setTaskMenuId(""); }}>打开</button><i/><button type="button" className="danger" onClick={() => { setDeleteTaskTargets([channel]); setTaskMenuId(""); }}>删除任务</button></div>}</>}</div>)}</section>; })}</div></> : view === "agents" ? <AgentSidebar agents={agents} activeAgentId={activeAgentId} onSelect={setActiveAgentId}/> : <ModuleSidebar view={view} settingsSection={settingsSection} onSettingsSection={setSettingsSection}/>}
      </aside>
      <main className="main">
        {error && <div className="app-error">{error}<button onClick={() => setError("")}>×</button></div>}
        {view === "tasks" ? active ? <div className={`task-layout mode-${mode}`}>
          <section className="conversation"><TaskHeader title={active.title}/><div className="agent-strip">{participants.map((agent) => <button key={agent.id} disabled={!agent.online} className={selectedAgents.includes(agent.id) ? "selected" : ""} onClick={() => setSelectedAgents((current) => current.includes(agent.id) ? current.filter((id) => id !== agent.id) : [...current, agent.id])}><Avatar agent={agent}/><span>{agent.name}</span><i>{running.includes(agent.id) ? "运行中" : agent.online ? "可用" : "离线"}</i></button>)}{selectedAgents.length > 1 && <select value={executionMode} onChange={(event) => setExecutionMode(event.target.value as "sequential" | "parallel")}><option value="sequential">顺序协作</option><option value="parallel">并行协作</option></select>}</div><ConversationTimeline conversationId={activeId} turns={turns} agents={agents} onEdit={(text) => setComposerPrefill(text)} onReply={(turnId, messageId, text) => setReplyTarget({ turnId, messageId, text })} onControl={(agentId, type, message) => sendControl(agentId, type, message)}/><ChatComposer draftKey={activeId} mentions={participants.map((agent) => ({ id: agent.id, label: agent.name, description: `${agent.provider} · ${agent.runtime}`, online: agent.online }))} selectedLabel={participants.find((agent) => selectedAgents.includes(agent.id))?.name || "选择数字员工"} modelLabel={bindings.find((binding) => selectedAgents.includes(binding.agentId))?.effectiveModel || participants.find((agent) => selectedAgents.includes(agent.id))?.desiredModel || "默认模型"} streaming={running.length > 0} connected={connected} initialValue={composerPrefill} reply={replyTarget?.text} onCancelReply={() => setReplyTarget(null)} onSend={sendMessage} onAbort={() => sendControl(null, "abort")} onControl={(type, message) => sendControl(null, type, message)} onAgentSettings={() => setChatConfigAgentId(selectedAgents[0] || participants[0]?.id || "")} onModelSettings={() => setModelPickerAgentId(selectedAgents[0] || participants[0]?.id || "")}/></section>
          <TaskCanvas tab={canvasTab} onTab={setCanvasTab} active={active} agents={participants} runtimes={runtimes} bindings={bindings} turns={turns} focusedRunId={focusedRunId} mode={mode} onMode={chooseMode}/>
        </div> : <DraftTaskHome agents={agents} selectedAgentId={draftAgentId} onSelectAgent={setDraftAgentId} draft={draft} onDraft={setDraft} onSend={sendDraftTask} sending={creatingFromDraft} onChooseModel={(id) => setModelPickerAgentId(id)}/> : <ModulePage view={view} settingsSection={settingsSection} onSettingsSection={setSettingsSection} agents={agents} runtimes={runtimes} channels={channels} activeAgentId={activeAgentId} onChooseModel={setModelPickerAgentId} onRuntimeUpdated={(updated) => setRuntimes((current) => current.map((runtime) => runtime.id === updated.id ? updated : runtime))} onAgentUpdated={(updated) => setAgents((current) => current.map((agent) => agent.id === updated.id ? updated : agent))}/>}
        {overlay && <section className="workspace-overlay" aria-label={overlay === "automation" ? "自动化" : "应用中心"}>
          <header className="workspace-overlay-header"><span><Icon name={overlay}/><b>{overlay === "automation" ? "自动化" : "应用中心"}</b><small>保留当前工作，不离开此页面</small></span><button type="button" onClick={() => setOverlay(null)} aria-label="关闭">×</button></header>
          <div className="workspace-overlay-body">{overlay === "automation" ? <AutomationPage agents={agents} runtimes={runtimes} onOpenConversation={openAutomationTask}/> : <Catalog/>}</div>
        </section>}
      </main>
    </div>
    {modelConfigAgentId && agents.find((agent) => agent.id === modelConfigAgentId) && <ModelConfigPanel agent={agents.find((agent) => agent.id === modelConfigAgentId)!} onClose={() => setModelConfigAgentId("")} onSaved={() => setModelPickerAgentId(modelConfigAgentId)}/>}
    {modelPickerAgentId && <ChatModelPicker agent={agents.find((agent) => agent.id === modelPickerAgentId)} binding={view === "tasks" ? bindings.find((binding) => binding.agentId === modelPickerAgentId) : undefined} conversationIds={view === "tasks" ? [activeId].filter(Boolean) : []} hasActiveRun={running.includes(modelPickerAgentId)} onConfigure={() => { setModelConfigAgentId(modelPickerAgentId); setModelPickerAgentId(""); }} onClose={() => setModelPickerAgentId("")}/>}
    {chatConfigAgentId && <ChatAgentSettings agent={agents.find((agent) => agent.id === chatConfigAgentId)} agents={participants} binding={bindings.find((binding) => binding.agentId === chatConfigAgentId)} conversationId={activeId} hasActiveRun={running.includes(chatConfigAgentId)} onSelectAgent={(id) => { setChatConfigAgentId(id); setSelectedAgents([id]); }} onClose={() => setChatConfigAgentId("")} onSaved={(updated) => setAgents((current) => current.map((agent) => agent.id === updated.id ? updated : agent))}/>}
    {workspaceCreateOpen && <div className="backdrop workspace-create-backdrop" onMouseDown={(event) => event.target === event.currentTarget && !savingWorkspace && setWorkspaceCreateOpen(false)}><form className="workspace-create-dialog" onSubmit={saveWorkspace}><header><span><Icon name="folder" size={23}/></span><div><h2>创建新工作空间</h2><p>命名后由服务端自动创建 Agent 的工作目录</p></div><button type="button" onClick={() => setWorkspaceCreateOpen(false)}>×</button></header><label className="workspace-create-label">工作空间名称</label><input className="workspace-name-input" autoFocus value={workspaceName} maxLength={80} onChange={(event) => setWorkspaceName(event.target.value)} placeholder="例如：产品研发"/><div className="workspace-server-directory"><Icon name="folder" size={27}/><span><b>服务端托管工作目录</b><small>{workspaceName.trim() ? `将根据“${workspaceName.trim()}”自动生成安全目录` : "填写名称后自动生成，无需输入客户端路径"}</small></span></div><footer><button type="button" onClick={() => setWorkspaceCreateOpen(false)}>取消</button><button type="submit" className="primary" disabled={!workspaceName.trim() || savingWorkspace}><Icon name="plus" size={15}/>{savingWorkspace ? "创建中…" : "创建工作空间"}</button></footer></form></div>}
    {workspaceManagerOpen && <div className="backdrop workspace-manager-backdrop" onMouseDown={(event) => event.target === event.currentTarget && !savingWorkspace && setWorkspaceManagerOpen(false)}><section className="workspace-manager" role="dialog" aria-modal="true" aria-labelledby="workspace-manager-title"><header><div><h2 id="workspace-manager-title">空间管理</h2><p>创建、查看、修改或删除工作空间。删除空间会同时删除其中的全部任务。</p></div><button type="button" onClick={() => setWorkspaceManagerOpen(false)}>×</button></header><div className="workspace-manager-body"><div className="workspace-manager-list"><div className="workspace-manager-list-title"><b>工作空间</b><button type="button" onClick={beginCreateWorkspace}>＋ 新建</button></div>{workspaces.map((workspace) => <article className={workspaceEditor?.id === workspace.id ? "active" : ""} key={workspace.id}><Icon name="folder" size={17}/><button type="button" className="workspace-manager-select" onClick={() => editWorkspace(workspace)}><b>{workspace.name}</b><small>{workspace.cwd || "未设置工作目录"} · {channels.filter((channel) => channel.workspaceId === workspace.id).length} 个任务</small></button><button type="button" onClick={() => editWorkspace(workspace)}>编辑</button>{workspace.id !== "workspace-default" && <button type="button" className="danger" disabled={deletingWorkspaceId === workspace.id} onClick={() => setDeleteWorkspaceTarget(workspace)}>{deletingWorkspaceId === workspace.id ? "删除中" : "删除"}</button>}</article>)}</div><form className="workspace-editor" onSubmit={saveWorkspace}><h3>{workspaceEditor ? "编辑工作空间" : "空间详情"}</h3>{workspaceEditor === undefined || workspaceEditor === null ? <div className="workspace-editor-empty"><Icon name="folder" size={28}/><p>选择一个工作空间查看和修改，或新建工作空间。</p></div> : <><label>空间名称<input autoFocus value={workspaceName} maxLength={80} onChange={(event) => setWorkspaceName(event.target.value)} placeholder="例如：产品研发"/></label><label>工作目录<input readOnly value={workspaceCwd} title={workspaceCwd}/><small>该目录由服务端托管，不能从浏览器修改。</small></label><footer><button type="button" onClick={() => setWorkspaceEditor(undefined)}>取消</button><button type="submit" className="primary" disabled={!workspaceName.trim() || savingWorkspace}>{savingWorkspace ? "保存中…" : "保存"}</button></footer></>}</form></div></section></div>}
    {deleteWorkspaceTarget && <div className="backdrop task-delete-backdrop"><div className="task-delete-dialog" role="alertdialog" aria-modal="true"><span>!</span><h3>删除工作空间“{deleteWorkspaceTarget.name}”？</h3><p>该空间及其中 {channels.filter((channel) => channel.workspaceId === deleteWorkspaceTarget.id).length} 个任务、对话和运行信息将一起删除，此操作无法撤销。</p><footer><button type="button" disabled={Boolean(deletingWorkspaceId)} onClick={() => setDeleteWorkspaceTarget(null)}>取消</button><button type="button" className="danger" disabled={Boolean(deletingWorkspaceId)} onClick={() => void deleteWorkspace(deleteWorkspaceTarget)}>{deletingWorkspaceId ? "删除中…" : "确认删除"}</button></footer></div></div>}
    {deleteTaskTargets.length > 0 && <div className="backdrop task-delete-backdrop" onMouseDown={(event) => event.target === event.currentTarget && !deletingTask && setDeleteTaskTargets([])}><div className="task-delete-dialog" role="alertdialog" aria-modal="true" aria-labelledby="task-delete-title"><span>!</span><h3 id="task-delete-title">{deleteTaskTargets.length === 1 ? `删除任务“${deleteTaskTargets[0].title}”？` : `删除选中的 ${deleteTaskTargets.length} 个任务？`}</h3><p>{deleteTaskTargets.length === 1 ? "任务中的对话、消息和运行信息会一起删除，此操作无法撤销。" : "选中任务的对话、消息和运行信息将一并删除，此操作无法撤销。"}</p><footer><button type="button" disabled={deletingTask} onClick={() => setDeleteTaskTargets([])}>取消</button><button type="button" className="danger" disabled={deletingTask} onClick={() => void deleteTask()}>{deletingTask ? "删除中…" : "确认删除"}</button></footer></div></div>}
    {createOpen && <div className="backdrop" onMouseDown={(event) => event.target === event.currentTarget && setCreateOpen(false)}><form className="dialog" onSubmit={createTask}><header><span><Icon name="plus"/></span><div><h2>新建任务</h2><p>选择工作空间和数字员工，开始一项可持续推进的工作。</p></div><button type="button" onClick={() => setCreateOpen(false)}>×</button></header><label>任务名称</label><input autoFocus value={createTitle} onChange={(event) => setCreateTitle(event.target.value)} placeholder="例如:梳理产品方案并输出执行计划"/><h3>选择数字员工 <small>{createAgents.length} 个已选择</small></h3><div className="agent-picker">{agents.map((agent) => <button type="button" disabled={!agent.online} className={createAgents.includes(agent.id) ? "picked" : ""} key={agent.id} onClick={() => setCreateAgents((current) => current.includes(agent.id) ? current.filter((id) => id !== agent.id) : [...current, agent.id])}><Avatar agent={agent}/><span><b>{agent.name}</b><small>{agent.description || `${agent.provider} · ${agent.runtime}`}</small></span><i>{createAgents.includes(agent.id) ? "✓" : ""}</i></button>)}</div><label>工作空间</label><select className="workspace-choice-select" value={createWorkspaceId} onChange={(event) => setCreateWorkspaceId(event.target.value)}>{workspaces.map((workspace) => <option value={workspace.id} key={workspace.id}>{workspace.name}{workspace.cwd ? ` · ${workspace.cwd}` : ""}</option>)}</select><footer><button type="button" onClick={() => setCreateOpen(false)}>取消</button><button className="submit" disabled={!createTitle.trim() || !createAgents.length}><Icon name="plus" size={15}/>创建任务</button></footer></form></div>}
  </div>;
}

function ChatModelPicker({ agent, binding, conversationIds, hasActiveRun, onConfigure, onClose }: { agent?: AgentSummary; binding?: ConversationBinding; conversationIds: string[]; hasActiveRun: boolean; onConfigure: () => void; onClose: () => void }) {
  const [models, setModels] = useState<ModelSummary[]>([]);
  const [query, setQuery] = useState("");
  const [provider, setProvider] = useState("all");
  const [loading, setLoading] = useState(true);
  const [applying, setApplying] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    if (!agent) return;
    const controller = new AbortController();
    setLoading(true); setError("");
    void fetch(`/api/multi-agent/models?agentId=${encodeURIComponent(agent.id)}`, { cache: "no-store", signal: controller.signal }).then(async (response) => {
      if (!response.ok) throw new Error((await response.text()).trim() || "模型目录加载失败");
      const data = await response.json() as ModelListResponse;
      setModels(data.models ?? []);
      if (data.error && !(data.models ?? []).length) setError(data.error);
    }).catch((reason) => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : String(reason)); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [agent?.id]);
  if (!agent) return null;
  const providers = [...new Set(models.map((model) => model.provider))].sort();
  const normalized = query.trim().toLocaleLowerCase();
  const visible = models.filter((model) => (provider === "all" || model.provider === provider) && (!normalized || `${model.name} ${model.id} ${model.provider}`.toLocaleLowerCase().includes(normalized))).sort((left, right) => (left.name || left.id).localeCompare(right.name || right.id, undefined, { numeric: true }));
  const currentProvider = binding?.effectiveProvider || agent.desiredProvider || agent.provider;
  const currentModel = binding?.effectiveModel || agent.desiredModel || "";
  const conversationOnly = conversationIds.length > 0;
  const choose = async (choice: ModelSummary) => {
    if (!conversationOnly || hasActiveRun || applying) return;
    const key = `${choice.provider}/${choice.id}`;
    setApplying(key); setError("");
    try {
      const replacement = await fetch(`/api/multi-agent/bindings/${encodeURIComponent(conversationIds[0])}/${encodeURIComponent(agent.id)}/replace`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ provider: choice.provider, model: choice.id, thinkingLevel: binding?.effectiveThinkingLevel || agent.desiredThinkingLevel || "medium" }) });
      if (!replacement.ok) throw new Error((await replacement.text()).trim() || "当前对话模型切换失败");
      onClose();
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setApplying(""); }
  };
  return <div className="backdrop model-picker-backdrop" onMouseDown={(event) => event.target === event.currentTarget && !applying && onClose()}><section className="chat-model-picker" role="dialog" aria-modal="true" aria-label="添加或切换模型"><header><div><h2>{conversationOnly ? "切换当前对话模型" : `${agent.name} 的可用模型`}</h2><p>{conversationOnly ? `只影响当前任务 · ${agent.runtime}` : `由 ${agent.runtime} 提供；不同对话可以选择不同模型`}</p></div><button type="button" onClick={onClose}>×</button></header><label className="model-search"><Icon name="search" size={15}/><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索模型名称、ID 或 Provider"/></label>{providers.length > 1 && <nav><button type="button" className={provider === "all" ? "active" : ""} onClick={() => setProvider("all")}>全部</button>{providers.map((value) => <button type="button" className={provider === value ? "active" : ""} onClick={() => setProvider(value)} key={value}>{value}</button>)}</nav>}<div className="model-picker-list">{loading && <div className="model-picker-empty">正在从 {agent.runtime} 发现模型…</div>}{!loading && visible.map((model) => { const key = `${model.provider}/${model.id}`; const active = model.provider === currentProvider && model.id === currentModel; return <button type="button" className={active ? "active" : ""} disabled={!conversationOnly || hasActiveRun || Boolean(applying)} onClick={() => void choose(model)} key={key}><span><b>{model.name || model.id}</b><small>{key}</small></span><em>{model.reasoning ? "支持思考" : "标准"}{model.contextWindow ? ` · ${Math.round(model.contextWindow / 1000)}k` : ""}</em><i>{applying === key ? "切换中…" : active ? "当前对话" : conversationOnly ? "切换" : "可用"}</i></button>})}{!loading && visible.length === 0 && <div className="model-picker-empty"><b>{error ? "模型目录不可用" : "没有匹配的模型"}</b><p>{error || "换一个关键词或 Provider 试试。"}</p></div>}</div><button type="button" className="configure-models" onClick={onConfigure}>✎ 配置自定义模型</button>{hasActiveRun && <footer>Agent 正在运行，停止或等待运行完成后再切换模型。</footer>}</section></div>;
}

function ChatAgentSettings({ agent, agents, binding, conversationId, hasActiveRun, onSelectAgent, onClose, onSaved }: { agent?: AgentSummary; agents: AgentSummary[]; binding?: ConversationBinding; conversationId: string; hasActiveRun: boolean; onSelectAgent: (id: string) => void; onClose: () => void; onSaved: (agent: AgentSummary) => void }) {
  const [provider, setProvider] = useState(agent?.desiredProvider || agent?.provider || "");
  const [model, setModel] = useState(agent?.desiredModel || "");
  const [thinking, setThinking] = useState(agent?.desiredThinkingLevel || "medium");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { setProvider(agent?.desiredProvider || agent?.provider || ""); setModel(agent?.desiredModel || ""); setThinking(agent?.desiredThinkingLevel || "medium"); setError(""); }, [agent?.id]);
  if (!agent) return null;
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!model.trim() || saving || hasActiveRun) return;
    setSaving(true); setError("");
    const patch: AgentConfigPatch = { name: agent.name, handle: agent.handle ?? "", description: agent.description ?? "", instructions: agent.instructions ?? "", desiredProvider: provider.trim(), desiredModel: model.trim(), desiredThinkingLevel: thinking, desiredCwd: agent.desiredCwd ?? agent.cwd };
    try {
      const response = await fetch(`/api/multi-agent/agents/${encodeURIComponent(agent.id)}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) });
      if (!response.ok) throw new Error((await response.text()).trim() || "模型配置保存失败");
      const { agent: updated } = await response.json() as AgentResponse;
      onSaved(updated);
      const replacement = await fetch(`/api/multi-agent/bindings/${encodeURIComponent(conversationId)}/${encodeURIComponent(agent.id)}/replace`, { method: "POST" });
      if (!replacement.ok && replacement.status !== 404) throw new Error((await replacement.text()).trim() || "新模型已保存，但当前会话切换失败");
      onClose();
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setSaving(false); }
  };
  const knownModels = [...new Set(agents.map((item) => item.desiredModel).filter((value): value is string => Boolean(value)))];
  return <div className="backdrop chat-settings-backdrop" onMouseDown={(event) => event.target === event.currentTarget && !saving && onClose()}><form className="chat-agent-settings" onSubmit={submit}><header><span className="run-avatar">◉</span><div><h2>选择当前对话的数字员工</h2><p>保存后替换当前任务会话，后续消息使用新配置。</p></div><button type="button" onClick={onClose}>×</button></header><label><span>数字员工</span><select value={agent.id} onChange={(event) => onSelectAgent(event.target.value)}>{agents.map((item) => <option key={item.id} value={item.id}>{item.name}{item.online ? "" : "（离线）"}</option>)}</select></label>{binding && <div className="chat-effective-model"><span>当前会话</span><b>{[binding.effectiveProvider, binding.effectiveModel].filter(Boolean).join("/") || "Runtime 默认模型"}</b><small>Session #{binding.generation} · {binding.effectiveThinkingLevel || "默认思考强度"}</small></div>}<div className="chat-model-fields"><label><span>Provider</span><input value={provider} onChange={(event) => setProvider(event.target.value)} placeholder={agent.provider}/></label><label><span>模型</span><input list="known-agent-models" value={model} onChange={(event) => setModel(event.target.value)} placeholder="例如 anthropic/claude-sonnet-4-5"/><datalist id="known-agent-models">{knownModels.map((value) => <option value={value} key={value}/>)}</datalist></label></div><label><span>思考强度</span><select value={thinking} onChange={(event) => setThinking(event.target.value)}>{["off", "minimal", "low", "medium", "high", "xhigh", "max"].map((value) => <option value={value} key={value}>{value}</option>)}</select></label>{hasActiveRun && <div className="chat-settings-notice">Agent 正在运行。停止或等待本次运行结束后再切换模型。</div>}{error && <div className="chat-settings-error">{error}</div>}<footer><button type="button" onClick={onClose}>取消</button><button className="primary" disabled={saving || hasActiveRun || !model.trim()}>{saving ? "切换中…" : "保存并应用到当前任务"}</button></footer></form></div>;
}

function DraftTaskHome({ agents, selectedAgentId, onSelectAgent, draft, onDraft, onSend, sending, onChooseModel }: { agents: AgentSummary[]; selectedAgentId: string; onSelectAgent: (id: string) => void; draft: string; onDraft: (value: string) => void; onSend: (event: FormEvent) => void; sending: boolean; onChooseModel: (agentId: string) => void }) {
  const selected = agents.find((agent) => agent.id === selectedAgentId) ?? agents.find((agent) => agent.online) ?? agents[0];
  const displayName = selected?.name || "小糖糖";
  const modelLabel = selected?.desiredModel || selected?.provider || "默认模型";
  return <section className="draft-task-home">
    <header><b>新任务</b><span>草稿</span></header>
    <div className="draft-stage">
      <div className="draft-greeting"><span className="draft-mascot"><Icon name="agents" size={32}/></span><h1>今天想和 <strong>{displayName}</strong> 一起完成什么？</h1></div>
      <form className="draft-composer" onSubmit={onSend}>
        <div className="draft-runtime"><Icon name="terminal" size={13}/><span>这个工作空间在 <b>{selected?.runtime || "等待执行设备"}</b> 上运行</span></div>
        <textarea autoFocus value={draft} onChange={(event) => onDraft(event.target.value)} placeholder="提个问题，我来查找和分析…" onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }}/>
        <div className="draft-toolbar">
          <label><Avatar agent={selected}/><select value={selected?.id || ""} onChange={(event) => onSelectAgent(event.target.value)}>{agents.map((agent) => <option key={agent.id} value={agent.id} disabled={!agent.online}>{agent.name}{agent.online ? "" : "（离线）"}</option>)}{agents.length === 0 && <option value="">小糖糖</option>}</select></label>
          <button type="button" className="mode-pill">问答⌄</button><button type="button" className="permission-pill">按需确认⌄</button><button type="button" className="add-pill">＋</button>
          <button className="draft-send" disabled={!draft.trim() || !selected?.online || sending} title={!selected?.online ? "需要一个在线数字员工" : "发送"}>{sending ? <i className="send-spinner"/> : <Icon name="send" size={15}/>}</button>
        </div>
        <div className="draft-context"><button type="button" className="draft-context-pill" disabled title="当前仅一个工作空间，多工作空间即将开放"><Icon name="folder" size={13}/>默认工作空间<i>⌄</i></button><button type="button" className="draft-context-pill" disabled={!selected} onClick={() => selected && onChooseModel(selected.id)} title={selected ? "选择或配置模型" : "需要先选择数字员工"}>{modelLabel}<i>⌄</i></button></div>
      </form>
      <div className="draft-shortcuts"><button type="button"><Icon name="file" size={14}/>文档</button><button type="button"><Icon name="database" size={14}/>表格</button><button type="button"><Icon name="globe" size={14}/>浏览器</button></div>
    </div>
    <aside className="draft-right"><h3>打开的标签</h3><p>打开文档、网页或终端后会显示在这里</p><div><b>快捷入口</b><span><Icon name="folder" size={13}/>目录</span><span><Icon name="database" size={13}/>多维表</span><span><Icon name="file" size={13}/>文档</span><span><Icon name="apps" size={13}/>工作台</span></div></aside>
  </section>;
}

function Rail({ icon, label, active, onClick }: { icon: string; label: string; active?: boolean; onClick?: () => void }) { return <button title={label} className={active ? "active" : ""} onClick={onClick}><Icon name={icon}/></button>; }
function Avatar({ agent }: { agent?: AgentSummary }) { return <span className="avatar"><Icon name="agents" size={17}/><i className={agent?.online ? "online" : ""}/></span>; }
function ModeSwitch({ mode, onMode }: { mode: TaskMode; onMode: (mode: TaskMode) => void }) { return <div className="mode-switch"><button title="对话聚焦" className={mode === "chat" ? "active" : ""} onClick={() => onMode("chat")}><Icon name="chat" size={15}/></button><button title="分屏" className={mode === "split" ? "active" : ""} onClick={() => onMode("split")}><Icon name="columns" size={15}/></button><button title="工作台聚焦" className={mode === "canvas" ? "active" : ""} onClick={() => onMode("canvas")}><Icon name="canvas" size={15}/></button></div>; }
function TaskHeader({ title }: { title: string }) { return <header className="task-header"><b>{title}</b><div className="task-header-actions"><button title="任务设置">⌂</button><button title="协作者">♧</button></div></header>; }
function TaskCanvas({ tab, onTab, active, agents, runtimes, bindings, turns, focusedRunId, mode, onMode }: { tab: CanvasTab; onTab: (tab: CanvasTab) => void; active: ChannelSummary; agents: AgentSummary[]; runtimes: RuntimeSummary[]; bindings: ConversationBinding[]; turns: GroupConversationTurn[]; focusedRunId: string; mode: TaskMode; onMode: (mode: TaskMode) => void }) {
  const focusedRun = focusedRunId ? turns.flatMap((turn) => turn.runs).find((run) => run.id === focusedRunId) : undefined;
  if (mode === "chat") return <aside className="canvas canvas-rail"><nav><b>打开的标签</b><ModeSwitch mode={mode} onMode={onMode}/></nav><div className="canvas-rail-body"><p>打开文档、网页或终端后会显示在这里</p><div className="rail-shortcuts"><h3>快捷入口</h3><button><Icon name="folder" size={16}/>目录</button><button><Icon name="database" size={16}/>云盘</button><button><Icon name="database" size={16}/>多维表</button><button><Icon name="file" size={16}/>文档</button><button className="workbench"><Icon name="apps" size={16}/>工作台</button></div></div></aside>;
  return <aside className="canvas"><nav><button className={tab === "assets" ? "active" : ""} onClick={() => onTab("assets")}>资产</button><button className={tab === "workspace" ? "active" : ""} onClick={() => onTab("workspace")}>工作空间</button><button className={tab === "runs" ? "active" : ""} onClick={() => onTab("runs")}>运行</button><ModeSwitch mode={mode} onMode={onMode}/></nav><div className="canvas-body">{tab === "workspace" && <><h2>{active.title}</h2><Section title="工作目录"><div className="info-card"><Icon name="folder"/><span><b>{agents[0]?.desiredCwd || agents[0]?.cwd || "尚未设置"}</b><small>本机工作空间</small></span></div></Section><Section title="数字员工">{agents.map((agent) => <div className="person" key={agent.id}><Avatar agent={agent}/><span><b>{agent.name}</b><small>{agent.desiredModel || agent.provider} · {agent.presence || "available"}</small></span></div>)}</Section><Section title="任务设置"><div className="rows"><button>授权策略 <span>按需确认 ›</span></button><button>执行限制 <span>默认 ›</span></button><button>归档任务 <span>›</span></button></div></Section></>}{tab === "assets" && <><h2>任务资产</h2><div className="quick"><Quick icon="folder" label="目录"/><Quick icon="file" label="文档"/><Quick icon="database" label="多维表"/><Quick icon="globe" label="浏览器"/><Quick icon="terminal" label="终端"/></div><Empty title="还没有打开的资产" description="Agent 创建和修改的文件会显示在这里。"/></>}{tab === "runs" && <><h2>运行详情</h2>{focusedRun && <div className="focused-run-card"><header><span className={`run-dot ${focusedRun.status}`}/><div><b>{agents.find((agent) => agent.id === focusedRun.agentId)?.name || focusedRun.agentId}</b><small>{focusedRun.id}</small></div><em>{focusedRun.error ? "失败" : focusedRun.settled ? "已完成" : focusedRun.status === "queued" ? "等待中" : "运行中"}</em></header>{focusedRun.error && <p>{focusedRun.error}</p>}<dl><div><dt>消息事件</dt><dd>{focusedRun.messages.length}</dd></div><div><dt>Session 状态</dt><dd>{focusedRun.settled ? "已结束" : "活动中"}</dd></div></dl></div>}{!focusedRun && focusedRunId && <div className="runtime">正在加载运行 {focusedRunId}…</div>}{runtimes.map((runtime) => <div className="runtime" key={runtime.id}><i className={runtime.status === "online" ? "online" : ""}/><span><b>{runtime.name}</b><small>{runtime.status} · {runtime.os}/{runtime.architecture}</small><small>Node {runtime.nodeVersion || "-"} · Pi {runtime.piVersion || "-"}</small></span></div>)}{bindings.map((binding) => <div className="binding" key={binding.agentId}><b>{agents.find((agent) => agent.id === binding.agentId)?.name || binding.agentId}</b><span>Session #{binding.generation}</span><small>{binding.effectiveProvider}/{binding.effectiveModel} · {binding.state}</small></div>)}</>}</div></aside>;
}
function Section({ title, children }: { title: string; children: ReactNode }) { return <section className="section"><h3>{title}</h3>{children}</section>; }
function Quick({ icon, label }: { icon: string; label: string }) { return <button><Icon name={icon}/><span>{label}</span></button>; }
function Empty({ title, description, action }: { title: string; description?: string; action?: ReactNode }) { return <div className="empty"><Icon name="message" size={30}/><b>{title}</b>{description && <p>{description}</p>}{action}</div>; }
function AgentSidebar({ agents, activeAgentId, onSelect }: { agents: AgentSummary[]; activeAgentId: string; onSelect: (id: string) => void }) {
  return <>
    <div className="agent-sidebar-actions">
      <button type="button" disabled title="完成 Control → Runtime 动态注册后开放"><Icon name="plus" size={15}/>新建数字员工</button>
      <button type="button"><span>⊘</span>已停用</button>
    </div>
    <div className="agent-sidebar-heading">我的数字员工 <small>{agents.length}</small></div>
    <div className="agent-sidebar-list">
      {agents.map((agent) => <button type="button" className={agent.id === activeAgentId ? "active" : ""} key={agent.id} onClick={() => onSelect(agent.id)}>
        <Avatar agent={agent}/><span><b>{agent.name}</b><small>{agent.description || agent.handle || agent.id}</small></span><time>{agent.presence === "working" ? "工作中" : agent.online ? "在线" : "离线"}</time>
      </button>)}
      {agents.length === 0 && <p>等待 Runtime 注册数字员工</p>}
    </div>
  </>;
}

function ModelSettingsPage({ agents, onConfigure }: { agents: AgentSummary[]; onConfigure: (agentId: string) => void }) {
  const agent = agents.find((item) => item.online) ?? agents[0];
  const [models, setModels] = useState<ModelSummary[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    if (!agent) { setLoading(false); return; }
    const controller = new AbortController();
    void fetch(`/api/multi-agent/models?agentId=${encodeURIComponent(agent.id)}`, { cache: "no-store", signal: controller.signal }).then((response) => response.ok ? response.json() : Promise.reject(new Error("模型目录加载失败"))).then((data: ModelListResponse) => setModels(data.models ?? [])).catch(() => {}).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [agent?.id]);
  return <div className="page model-settings-page"><header className="page-header"><span><Icon name="automation"/></span><div><h1>模型配置</h1><p>管理 Runtime 模型服务、默认模型和数字员工可用的模型</p></div>{agent && <button type="button" onClick={() => onConfigure(agent.id)}>＋ 添加模型服务</button>}</header><section className="model-settings-section"><h2>当前设备可用模型</h2><p>{agent ? `${agent.runtime} · 选择模型时只展示该设备真实可用的目录` : "等待 Runtime 注册"}</p><div>{loading ? <small>正在加载模型目录…</small> : models.slice(0, 8).map((model) => <article key={`${model.provider}/${model.id}`}><i/><span><b>{model.name || model.id}</b><small>{model.provider}/{model.id} · {model.contextWindow ? `${Math.round(model.contextWindow / 1000)}k tokens` : "上下文未知"}</small></span><em>{model.reasoning ? "支持思考" : "可用"}</em></article>)}</div></section><section className="model-settings-section services"><header><div><h2>我的模型服务</h2><p>连接自己的 Provider、API 地址和模型定义。</p></div>{agent && <button type="button" onClick={() => onConfigure(agent.id)}>＋ 添加模型服务</button>}</header>{agent ? <div className="model-service-summary"><Icon name="terminal"/><span><b>{agent.runtime}</b><small>配置保存在该设备的 ~/.pi/agent/models.json</small></span><button type="button" onClick={() => onConfigure(agent.id)}>管理</button></div> : <p>没有在线执行设备。</p>}</section></div>;
}

function ModuleSidebar({ view, settingsSection, onSettingsSection }: { view: View; settingsSection: SettingsSection; onSettingsSection: (section: SettingsSection) => void }) { const data: Record<View, string[]> = { agents: ["全部员工", "已停用"], settings: ["模型配置", "AI 设置", "执行设备", "系统权限", "外观显示", "版本信息"], tasks: [] }; return <><h2 className="module-title">{{ agents: "数字员工", settings: "设置", tasks: "任务" }[view]}</h2><div className="module-links">{data[view].map((item, index) => <button className={view === "settings" ? (settingsSection === "models" && index === 0) || (settingsSection === "runtimes" && index === 2) ? "active" : "" : index === 0 ? "active" : ""} key={item} onClick={() => { if (view === "settings" && index === 0) onSettingsSection("models"); if (view === "settings" && index === 2) onSettingsSection("runtimes"); }}>{item}</button>)}</div></>; }
function ModulePage({ view, settingsSection, agents, runtimes, channels, activeAgentId, onAgentUpdated, onChooseModel, onRuntimeUpdated, onSettingsSection = () => undefined }: { view: View; settingsSection: SettingsSection; agents: AgentSummary[]; runtimes: RuntimeSummary[]; channels: ChannelSummary[]; activeAgentId: string; onAgentUpdated: (agent: AgentSummary) => void; onChooseModel: (agentId: string) => void; onRuntimeUpdated: (runtime: RuntimeSummary) => void; onSettingsSection?: (section: SettingsSection) => void }) { if (view === "agents") return <AgentCenter agents={agents} channels={channels} runtimes={runtimes} activeAgentId={activeAgentId} onAgentUpdated={onAgentUpdated} onChooseModel={onChooseModel}/>; if (view === "settings" && settingsSection === "models") return <ModelSettingsPage agents={agents} onConfigure={onChooseModel}/>; if (view === "settings") return <RuntimeCenter runtimes={runtimes} onBack={() => onSettingsSection("models")} onUpdated={onRuntimeUpdated}/>; return <div className="page"/>; }
function Catalog() {
  const entries = [
    { category: "apps", group: "内置能力", title: "Models", description: "模型与服务提供方", detail: "模型沿用数字员工和当前对话的有效配置，不会在应用中心创建第二套配置。" },
    { category: "skills", group: "内置能力", title: "Skills", description: "数字员工可调用的专业能力", detail: "Skills 会按任务需要加载专业说明，为数字员工提供可复用的工作流程。" },
    { category: "skills", group: "内置能力", title: "Plugins", description: "扩展数字员工和工作台", detail: "插件由 Runtime 管理；安装与启停能力将在真实插件 API 接入后开放。" },
    { category: "apps", group: "工作应用", title: "本地目录", description: "读取和修改项目文件", detail: "使用数字员工已获授权的工作目录，自动化不会扩大目录权限。" },
    { category: "apps", group: "工作应用", title: "终端", description: "运行命令和开发工具", detail: "命令在关联 Runtime 上运行，并遵循现有审批与目录限制。" },
    { category: "apps", group: "工作应用", title: "浏览器", description: "网页调研与信息采集", detail: "浏览能力由数字员工工具提供；连接器未配置前不会展示为可安装应用。" },
  ];
  const [selected, setSelected] = useState(entries[0]);
  const [tab, setTab] = useState<"apps" | "skills" | "connectors">("apps");
  const [query, setQuery] = useState("");
  const visible = entries.filter((entry) => entry.category === tab && `${entry.title} ${entry.description}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  const detail = visible.find((entry) => entry.title === selected.title) ?? visible[0];
  return <div className={`catalog-page ${detail ? "" : "without-detail"}`}><div className="catalog-list"><header className="catalog-toolbar"><nav><button type="button" className={tab === "apps" ? "active" : ""} onClick={() => setTab("apps")}>应用</button><button type="button" className={tab === "skills" ? "active" : ""} onClick={() => setTab("skills")}>技能</button><button type="button" className={tab === "connectors" ? "active" : ""} onClick={() => setTab("connectors")}>连接器</button></nav><div><label><Icon name="search" size={14}/><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索当前能力"/></label><button type="button" disabled>添加</button><button type="button" disabled>管理</button></div></header>{["内置能力", "工作应用"].map((group) => { const groupEntries = visible.filter((entry) => entry.group === group); return groupEntries.length ? <section className="catalog" key={group}><h2>{group}</h2><div>{groupEntries.map((entry, index) => <article className={detail?.title === entry.title ? "selected" : ""} key={entry.title}><span><Icon name={index === 0 ? "apps" : index === 1 ? "automation" : "database"}/></span><div><b>{entry.title}</b><small>{entry.description}</small></div><button type="button" onClick={() => setSelected(entry)}>查看</button></article>)}</div></section> : null; })}{visible.length === 0 && <div className="catalog-empty"><Icon name={tab === "connectors" ? "globe" : "search"} size={28}/><b>{tab === "connectors" ? "还没有可用连接器" : "没有匹配的能力"}</b><p>{tab === "connectors" ? "连接真实 Connector API 后再开放安装，不展示不可用的占位应用。" : "换一个关键词试试。"}</p></div>}</div>{detail && <aside className="catalog-detail"><span><Icon name="apps" size={24}/></span><small>能力详情</small><h2>{detail.title}</h2><p>{detail.detail}</p><div><b>当前状态</b><em>已内置</em></div><button type="button" disabled>配置入口将在能力 API 接入后开放</button></aside>}</div>;
}
