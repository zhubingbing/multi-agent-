import type { GroupConversationTurn } from "@multi-agent/chat-core";

export type RuntimeStatus = "online" | "stale" | "offline" | "disabled" | string;
export type AgentPresence = "available" | "working" | "waiting" | "offline" | string;

export interface ChannelSummary {
  id: string;
  title: string;
  agentIds: string[];
  createdAt: number;
}

export interface AgentSummary {
  id: string;
  name: string;
  runtime: string;
  runtimeId?: string;
  provider: string;
  cwd: string;
  online: boolean;
  description?: string;
  handle?: string;
  instructions?: string;
  desiredProvider?: string;
  desiredModel?: string;
  desiredThinkingLevel?: string;
  desiredCwd?: string;
  presence?: AgentPresence;
  inboxUnread?: number;
  configVersion?: number;
}

export interface RuntimeCapabilities {
  [capability: string]: boolean;
}

export interface RuntimeSummary {
  id: string;
  name: string;
  status: RuntimeStatus;
  controlState?: "active" | "draining" | "disabled";
  instanceId?: string;
  version?: string;
  nodeVersion?: string;
  piVersion?: string;
  os?: string;
  architecture?: string;
  capabilities?: RuntimeCapabilities;
  lastSeenAt?: number;
  configVersion?: number;
}

export interface ConversationBinding {
  agentId: string;
  nativeSessionId: string;
  generation: number;
  state: string;
  effectiveModel?: string;
  effectiveProvider?: string;
  effectiveThinkingLevel?: string;
  effectiveCwd?: string;
}

export interface RuntimeCursor {
  runtimeId: string;
  instanceId: string;
  sequence: number;
}

export interface ModelSummary {
  provider: string;
  id: string;
  name: string;
  reasoning?: boolean;
  contextWindow?: number;
  maxTokens?: number;
  runtimeId?: string;
}

export interface ModelListResponse {
  models: ModelSummary[];
  error?: string;
}

export interface AgentConfigPatch {
  name: string;
  handle: string;
  description: string;
  instructions: string;
  desiredProvider: string;
  desiredModel: string;
  desiredThinkingLevel: string;
  desiredCwd: string;
}

export interface AgentResponse { agent: AgentSummary }
export interface ChannelListResponse { channels?: ChannelSummary[] }
export interface AgentListResponse { agents?: AgentSummary[] }
export interface ActiveRuntimeRun {
  conversationId: string;
  agentId: string;
  runId: string;
}

export interface RuntimeSkillSummary {
  name: string;
  description?: string;
  filePath?: string;
  source?: string;
  disableModelInvocation?: boolean;
}
export interface RuntimeToolSummary { name: string; description?: string; source?: string }

export interface RuntimeDetailResponse {
  runtime: RuntimeSummary;
  employees: AgentSummary[];
  models: ModelSummary[];
  activeRuns: ActiveRuntimeRun[];
  skills: RuntimeSkillSummary[];
  tools: RuntimeToolSummary[];
  mcpServers: Array<Record<string, unknown>>;
  mcpSupported: boolean;
  modelError?: string;
}

export interface RuntimeListResponse { runtimes?: RuntimeSummary[] }
export interface BindingListResponse { bindings?: ConversationBinding[] }
export interface ConversationTurnsResponse {
  turns?: GroupConversationTurn[];
  cursors?: RuntimeCursor[];
}
export interface CreateChannelResponse { channel: ChannelSummary }
