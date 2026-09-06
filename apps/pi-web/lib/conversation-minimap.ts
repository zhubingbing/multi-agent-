import { presentAssistantTurn } from "./conversation-turn-presentation";
import type { GroupConversationTurn } from "./group-conversation-state";
import type { AgentMessage } from "./types";

export type ConversationMinimapAnchor = {
  user: number;
  runs: Map<string, number>;
};

export function buildConversationMinimap(turns: GroupConversationTurn[]): {
  messages: AgentMessage[];
  anchors: Map<string, ConversationMinimapAnchor>;
} {
  const messages: AgentMessage[] = [];
  const anchors = new Map<string, ConversationMinimapAnchor>();
  for (const turn of turns) {
    const anchor: ConversationMinimapAnchor = {
      user: messages.length,
      runs: new Map<string, number>(),
    };
    messages.push(turn.user);
    for (const run of turn.runs) {
      if (!run.settled) continue;
      const answer = presentAssistantTurn(run.messages).finalAnswerMessage;
      if (!answer) continue;
      anchor.runs.set(run.id, messages.length);
      messages.push(answer);
    }
    anchors.set(turn.id, anchor);
  }
  return { messages, anchors };
}
