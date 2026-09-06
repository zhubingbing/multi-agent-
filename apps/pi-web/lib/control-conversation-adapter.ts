import type {
  ConversationAdapter,
  ConversationAgent,
  ConversationBinding,
  ConversationCommand,
  PublicConversationMessage,
  ConversationSnapshot,
  ConversationWireEvent,
} from "./conversation-adapter";
import { applyAuthoritativeMessages } from "./authoritative-conversation";

function controlBase(): string {
  if (typeof window === "undefined") return "http://127.0.0.1:30146";
  return window.location.origin;
}

function controlSocket(conversationId: string): string {
  const base = new URL(controlBase());
  base.protocol = base.protocol === "https:" ? "wss:" : "ws:";
  base.pathname = "/api/multi-agent/conversation/ws";
  base.searchParams.set("conversationId", conversationId);
  return base.toString();
}

export class ControlConversationAdapter implements ConversationAdapter {
  private socket: WebSocket | null = null;

  constructor(private readonly conversationId: string) {}

  async loadAgents(): Promise<ConversationAgent[]> {
    const response = await fetch(`${controlBase()}/api/multi-agent/agents`, { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json() as { agents?: ConversationAgent[] };
    return data.agents ?? [];
  }

  async loadSnapshot(): Promise<ConversationSnapshot> {
    const base = `${controlBase()}/api/multi-agent/conversations/${encodeURIComponent(this.conversationId)}`;
    const [turnResponse, messageResponse, bindingResponse] = await Promise.all([
      fetch(`${base}/turns`, { cache: "no-store" }),
      fetch(`${base}/messages`, { cache: "no-store" }),
      fetch(`${controlBase()}/api/multi-agent/bindings?conversationId=${encodeURIComponent(this.conversationId)}`, { cache: "no-store" }),
    ]);
    if (!turnResponse.ok) throw new Error(`turns HTTP ${turnResponse.status}`);
    if (!messageResponse.ok) throw new Error(`messages HTTP ${messageResponse.status}`);
    if (!bindingResponse.ok) throw new Error(`bindings HTTP ${bindingResponse.status}`);
    const data = await turnResponse.json() as Partial<ConversationSnapshot>;
    const messageData = await messageResponse.json() as { messages?: PublicConversationMessage[]; currentVersion?: number };
    const bindingData = await bindingResponse.json() as { bindings?: ConversationBinding[] };
    const messages = messageData.messages ?? [];
    const turns = applyAuthoritativeMessages(data.turns ?? [], messages);
    return { turns, messages, bindings: bindingData.bindings ?? [], currentVersion: messageData.currentVersion ?? 0, cursors: data.cursors ?? [] };
  }

  connect(handlers: {
    onEvent: (event: ConversationWireEvent) => void;
    onStateChange: (state: "connecting" | "connected" | "reconnecting" | "closed") => void;
    onReconnect: () => void;
  }): () => void {
    let stopped = false;
    let connectedOnce = false;
    let retryDelay = 500;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    const open = () => {
      if (stopped) return;
      handlers.onStateChange(connectedOnce ? "reconnecting" : "connecting");
      const socket = new WebSocket(controlSocket(this.conversationId));
      this.socket = socket;
      socket.onopen = () => {
        if (stopped) return;
        const reconnect = connectedOnce;
        connectedOnce = true;
        retryDelay = 500;
        handlers.onStateChange("connected");
        if (reconnect) handlers.onReconnect();
      };
      socket.onmessage = ({ data }) => handlers.onEvent(JSON.parse(data) as ConversationWireEvent);
      socket.onclose = () => {
        if (this.socket === socket) this.socket = null;
        if (stopped) return;
        handlers.onStateChange("reconnecting");
        retryTimer = setTimeout(open, retryDelay);
        retryDelay = Math.min(retryDelay * 2, 10_000);
      };
      socket.onerror = () => handlers.onStateChange("reconnecting");
    };

    open();
    return () => {
      stopped = true;
      if (retryTimer) clearTimeout(retryTimer);
      const socket = this.socket;
      this.socket = null;
      socket?.close();
      handlers.onStateChange("closed");
    };
  }

  send(command: ConversationCommand): boolean {
    if (this.socket?.readyState !== WebSocket.OPEN) return false;
    this.socket.send(JSON.stringify(command));
    return true;
  }
}
