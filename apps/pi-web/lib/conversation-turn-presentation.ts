import {
  getAssistantErrorMessage,
  getDisplayableAssistantBlocks,
  splitFinalAssistantBlocks,
} from "./message-display";
import type { AgentMessage, AssistantContentBlock, AssistantMessage } from "./types";

export function hasFinalAssistantAnswer(message: AgentMessage): boolean {
  if (message.role !== "assistant") return false;
  return splitFinalAssistantBlocks(message as AssistantMessage).answerBlocks.some((block) => (
    block.type === "image" || (block.type === "text" && block.text.trim().length > 0)
  ));
}

export function findFinalAssistantIndex(
  messages: AgentMessage[],
  userIdx: number,
  endIdx: number,
): number {
  for (let candidateIdx = endIdx - 1; candidateIdx > userIdx; candidateIdx--) {
    if (hasFinalAssistantAnswer(messages[candidateIdx])) return candidateIdx;
  }
  for (let candidateIdx = endIdx - 1; candidateIdx > userIdx; candidateIdx--) {
    if (messages[candidateIdx]?.role === "assistant") return candidateIdx;
  }
  return -1;
}

export function hasDisplayableProcessMessage(message: AgentMessage): boolean {
  if (message.role === "assistant") {
    return getDisplayableAssistantBlocks(message as AssistantMessage).length > 0;
  }
  return message.role === "custom";
}

export function withAssistantBlocks(
  message: AssistantMessage,
  content: AssistantContentBlock[],
  options: { omitUsage?: boolean } = {},
): AssistantMessage {
  const next = { ...message, content };
  if (options.omitUsage) next.usage = undefined;
  return next;
}

export type AssistantTurnPresentation = {
  processMessages: AgentMessage[];
  finalProcessMessage: AssistantMessage | null;
  finalAnswerMessage: AssistantMessage | null;
};

/**
 * Apply pi-web's completed-turn presentation rules to one Agent run.
 * Tool results remain outside the rendered list and are associated by call ID.
 */
export function presentAssistantTurn(messages: AgentMessage[]): AssistantTurnPresentation {
  const finalAssistantIdx = findFinalAssistantIndex(messages, -1, messages.length);
  if (finalAssistantIdx < 0) {
    return {
      processMessages: messages.filter(hasDisplayableProcessMessage),
      finalProcessMessage: null,
      finalAnswerMessage: null,
    };
  }

  const processMessages = messages
    .slice(0, finalAssistantIdx)
    .filter(hasDisplayableProcessMessage);
  const finalAssistant = messages[finalAssistantIdx] as AssistantMessage;
  const finalSplit = splitFinalAssistantBlocks(finalAssistant);
  const finalProcessMessage = finalSplit.processBlocks.length > 0
    ? withAssistantBlocks(finalAssistant, finalSplit.processBlocks, { omitUsage: true })
    : null;
  const finalAnswerMessage = finalSplit.answerBlocks.length > 0 || getAssistantErrorMessage(finalAssistant)
    ? withAssistantBlocks(finalAssistant, finalSplit.answerBlocks)
    : null;

  return { processMessages, finalProcessMessage, finalAnswerMessage };
}
