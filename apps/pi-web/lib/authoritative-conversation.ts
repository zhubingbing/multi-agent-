import type { PublicConversationMessage } from "./conversation-adapter";
import type { GroupConversationTurn } from "./group-conversation-state";
import type { AssistantMessage, UserMessage } from "./types";

function replyTurnId(messageId: string | undefined): string | undefined {
  return messageId?.startsWith("message-") ? messageId.slice("message-".length) : undefined;
}

/** Overlay the public authoritative Message stream onto Run-oriented presentation data. */
export function applyAuthoritativeMessages(
  turns: GroupConversationTurn[],
  messages: PublicConversationMessage[],
): GroupConversationTurn[] {
  const byTurn = new Map<string, PublicConversationMessage[]>();
  for (const message of messages) {
    const existing = byTurn.get(message.turnId);
    if (existing) existing.push(message);
    else byTurn.set(message.turnId, [message]);
  }
  const publicById = new Map(messages.map((message) => [message.id, message]));

  return turns.map((turn) => {
    const authoritative = byTurn.get(turn.id) ?? [];
    const member = authoritative.find((message) => message.authorType === "member" && message.content.role === "user");
    const user = member
      ? {
          ...(member.content as UserMessage),
          authorType: member.authorType,
          authorId: member.authorId,
          replyToTurnId: replyTurnId(member.replyToMessageId),
          replyToMessageId: member.replyToMessageId,
          replyToText: member.replyToMessageId
            ? (() => {
                const target = publicById.get(member.replyToMessageId)?.content;
                return target?.role === "user" && typeof target.content === "string" ? target.content : undefined;
              })()
            : undefined,
        }
      : turn.user;

    return {
      ...turn,
      user,
      runs: turn.runs.map((run) => {
        const agent = authoritative.find((message) => (
          message.authorType === "agent" && message.runId === run.id && message.content.role === "assistant"
        ));
        return agent
          ? { ...run, finalMessageId: agent.id, finalMessage: agent.content as AssistantMessage }
          : run;
      }),
    };
  });
}
