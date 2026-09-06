import type { AgentEventLike } from "./agent-event-wire";
import type { GroupConversationTurn } from "./group-conversation-state";
import type { AgentMessage } from "./types";

export type ConversationAgent = {
  id: string;
  name: string;
  runtimeId: string;
  runtime: string;
  provider: string;
  cwd: string;
  online: boolean;
  handle?: string;
  description?: string;
  instructions?: string;
  desiredProvider?: string;
  desiredModel?: string;
  desiredThinkingLevel?: string;
  desiredCwd?: string;
  configVersion: number;
  presence: "available" | "working" | "waiting" | "offline";
  inboxUnread: number;
};

export type ConversationCursor = {
  runtimeId: string;
  instanceId: string;
  sequence: number;
};

export type PublicConversationMessage = {
  id: string;
  conversationId: string;
  turnId: string;
  authorType: "member" | "agent" | "system";
  authorId: string;
  runId?: string;
  replyToMessageId?: string;
  mentions: string[];
  content: AgentMessage;
  createdAt: number;
};

export type ConversationBinding = {
  conversationId: string;
  agentId: string;
  runtimeId: string;
  nativeSessionId: string;
  generation: number;
  state: string;
  effectiveProvider?: string;
  effectiveModel?: string;
  effectiveThinkingLevel?: string;
  effectiveCwd?: string;
  lastActiveAt: number;
};

export type ConversationSnapshot = {
  turns: GroupConversationTurn[];
  messages: PublicConversationMessage[];
  bindings: ConversationBinding[];
  currentVersion: number;
  cursors: ConversationCursor[];
};

export type ConversationWireEvent = {
  type: string;
  runtimeId?: string;
  instanceId?: string;
  runtimeSeq?: number;
  agentId?: string;
  agentIds?: string[];
  runId?: string;
  turnId?: string;
  event?: AgentEventLike;
  error?: string;
  eventType?: string;
};

export type ConversationCommand = {
  type: "prompt" | "steer" | "follow_up" | "abort";
  message: string;
  agentIds: string[];
  turnId?: string;
  createdAt?: number;
  runIds?: Record<string, string>;
  replyToTurnId?: string;
  replyToMessageId?: string;
  executionMode?: "parallel" | "sequential";
};

export type ConversationConnectionState = "connecting" | "connected" | "reconnecting" | "closed";

export interface ConversationAdapter {
  loadAgents(): Promise<ConversationAgent[]>;
  loadSnapshot(): Promise<ConversationSnapshot>;
  connect(handlers: {
    onEvent: (event: ConversationWireEvent) => void;
    onStateChange: (state: ConversationConnectionState) => void;
    onReconnect: () => void;
  }): () => void;
  send(command: ConversationCommand): boolean;
}
