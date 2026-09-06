import { INITIAL_STREAMING_STATE, type StreamingState } from "./streaming-message";
import type { AgentMessage, AssistantMessage, UserMessage } from "./types";

export type GroupAgentRun = {
  id: string;
  agentId: string;
  status?: "queued" | "running" | "settled" | "failed";
  finalMessageId?: string;
  finalMessage?: AssistantMessage;
  messages: AgentMessage[];
  stream: StreamingState;
  settled: boolean;
  error?: string;
};

export type GroupConversationTurn = {
  id: string;
  user: UserMessage;
  runs: GroupAgentRun[];
};

/** Merge an authoritative persisted snapshot without discarding newer live state. */
export function mergeGroupConversationTurns(
  current: GroupConversationTurn[],
  stored: GroupConversationTurn[],
): GroupConversationTurn[] {
  const currentTurns = new Map(current.map((turn) => [turn.id, turn]));
  const merged = stored.map((turn) => {
    const liveTurn = currentTurns.get(turn.id);
    if (!liveTurn) {
      return {
        ...turn,
        runs: turn.runs.map((run) => ({ ...run, stream: INITIAL_STREAMING_STATE })),
      };
    }
    currentTurns.delete(turn.id);
    const liveRuns = new Map(liveTurn.runs.map((run) => [run.id, run]));
    const runs = turn.runs.map((run) => {
      const liveRun = liveRuns.get(run.id);
      if (!liveRun) return { ...run, stream: INITIAL_STREAMING_STATE };
      liveRuns.delete(run.id);
      const settled = run.settled || liveRun.settled;
      return {
        ...liveRun,
        ...run,
        messages: run.messages.length >= liveRun.messages.length ? run.messages : liveRun.messages,
        settled,
        stream: settled ? INITIAL_STREAMING_STATE : liveRun.stream,
        error: run.error || liveRun.error,
      };
    });
    return { ...liveTurn, ...turn, runs: [...runs, ...liveRuns.values()] };
  });
  return [...merged, ...currentTurns.values()];
}
