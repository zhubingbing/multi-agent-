import { memo, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { presentAssistantTurn, type AgentMessage, type AssistantMessage, type GroupAgentRun, type ToolResultMessage, type UserMessage } from "@multi-agent/chat-core";
import { MarkdownMessage } from "./MarkdownMessage";
import type { AgentSummary } from "./contracts/control-api";

function formatTime(timestamp?: number) {
  if (!timestamp) return "";
  return new Date(timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
function usage(message: AssistantMessage) {
  const value = message.usage;
  if (!value) return "";
  const parts = [];
  if (value.input) parts.push(`${value.input.toLocaleString()} in`);
  if (value.output) parts.push(`${value.output.toLocaleString()} out`);
  if (value.cacheRead) parts.push(`${value.cacheRead.toLocaleString()} cache`);
  if (value.cost?.total) parts.push(`$${value.cost.total.toFixed(4)}`);
  return parts.join(" · ");
}
function textContent(message: AssistantMessage) {
  return message.content.filter((block) => block.type === "text").map((block) => block.type === "text" ? block.text : "").join("\n");
}
function resultText(result?: ToolResultMessage) {
  return result?.content.filter((block) => block.type === "text").map((block) => block.type === "text" ? block.text : "").join("\n") ?? "";
}
function writtenPath(input: Record<string, unknown>): string | null {
  for (const key of ["path", "file_path", "filePath"]) if (typeof input[key] === "string") return input[key] as string;
  return null;
}

function AssistantContent({ message, streaming, results }: { message: AssistantMessage; streaming?: boolean; results: Map<string, ToolResultMessage> }) {
  return <>{message.content.map((block, index) => {
    if (block.type === "text") return <MarkdownMessage key={index} streaming={streaming && index === message.content.length - 1}>{block.text}</MarkdownMessage>;
    if (block.type === "thinking") return <details className="thinking-block" open={streaming} key={index}><summary>思考过程{streaming ? " · 正在思考" : ""}</summary><div>{block.thinking}</div></details>;
    if (block.type === "image") {
      const src = block.source.url ?? (block.source.data ? `data:${block.source.media_type || "image/png"};base64,${block.source.data}` : "");
      return src ? <img className="message-image" src={src} loading="lazy" alt="消息图片" key={index}/> : null;
    }
    const result = results.get(block.toolCallId);
    const output = resultText(result);
    const path = writtenPath(block.input);
    return <details className="tool-block" key={index}><summary><span>工具</span>{block.toolName}{streaming ? " · 执行中" : result ? result.isError ? " · 失败" : " · 已完成" : ""}</summary><div className="tool-arguments"><b>参数</b><pre>{block.rawInput || JSON.stringify(block.input, null, 2)}</pre></div>{path && /(?:write|edit|patch)/i.test(block.toolName) && <div className="written-file">已修改：<code>{path}</code></div>}{output && <div className={`tool-result ${result?.isError ? "error" : ""}`}><b>{result?.isError ? "错误" : "结果"}</b><pre>{output}</pre></div>}</details>;
  })}</>;
}

export const UserMessageView = memo(function UserMessageView({ message, onEdit, onReply }: { message: UserMessage; onEdit?: (text: string) => void; onReply?: (text: string) => void }) {
  const text = typeof message.content === "string" ? message.content : message.content.filter((block) => block.type === "text").map((block) => block.type === "text" ? block.text : "").join("\n");
  return <article className="message user-message"><div><MarkdownMessage>{text}</MarkdownMessage></div><footer><time>{formatTime(message.timestamp)}</time><button type="button" onClick={() => void navigator.clipboard.writeText(text)}>复制</button>{onEdit && <button type="button" onClick={() => onEdit(text)}>编辑</button>}{onReply && <button type="button" onClick={() => onReply(text)}>回复</button>}</footer></article>;
});

function ProcessDetails({ count, tools, running, children }: { count: number; tools: number; running: boolean; children: ReactNode }) {
  const [expanded, setExpanded] = useState(running);
  return <div className="process-panel"><button type="button" onClick={() => setExpanded((value) => !value)}><span className={expanded ? "expanded" : ""}>›</span>执行过程 · {count} 条消息{tools ? ` · ${tools} 次工具调用` : ""}{running ? " · 运行中" : ""}</button>{expanded && <div>{children}</div>}</div>;
}

export function AgentRunView({ run, agent, onControl, onReply }: { run: GroupAgentRun; agent?: AgentSummary; onControl?: (agentId: string, type: "steer" | "follow_up" | "abort", message?: string) => void; onReply?: (text: string) => void }) {
  const results = useMemo(() => new Map(run.messages.filter((message): message is ToolResultMessage => message.role === "toolResult").map((message) => [message.toolCallId, message])), [run.messages]);
  const presentation = run.settled ? presentAssistantTurn(run.messages) : { processMessages: run.messages.filter((message) => message.role === "assistant"), finalProcessMessage: null, finalAnswerMessage: null };
  const process = [...presentation.processMessages, ...(presentation.finalProcessMessage ? [presentation.finalProcessMessage] : [])];
  const live = run.stream.streamingMessage;
  const toolCount = [...process, ...(live ? [live] : [])].reduce((count, message) => message.role === "assistant" ? count + message.content.filter((block) => block.type === "toolCall").length : count, 0);
  const final = run.finalMessage ?? presentation.finalAnswerMessage;
  const finalText = final ? textContent(final) : "";
  const finalError = final?.stopReason === "error" ? final.errorMessage || "模型请求失败" : "";
  const [controlType, setControlType] = useState<"steer" | "follow_up" | null>(null);
  const [controlText, setControlText] = useState("");
  const submitControl = (event: FormEvent) => {
    event.preventDefault();
    if (!controlType || !controlText.trim()) return;
    onControl?.(run.agentId, controlType, controlText.trim());
    setControlText(""); setControlType(null);
  };
  return <article className="conversation-run"><header><span className="run-avatar">◉</span><b>{agent?.name || run.agentId}</b><small>{agent?.runtime || "Runtime"}</small><em className={run.error || finalError ? "failed" : run.settled ? "done" : run.status || "running"}>{run.error || finalError ? "失败" : run.status === "queued" ? "等待中" : run.settled ? "已完成" : "运行中"}</em>{!run.settled && run.status !== "queued" && onControl && <div className="run-controls"><button type="button" className={controlType === "steer" ? "active" : ""} onClick={() => setControlType((value) => value === "steer" ? null : "steer")}>调整</button><button type="button" className={controlType === "follow_up" ? "active" : ""} onClick={() => setControlType((value) => value === "follow_up" ? null : "follow_up")}>继续</button><button type="button" className="danger" onClick={() => onControl(run.agentId, "abort")}>停止</button></div>}</header>
    {controlType && <form className="run-control-composer" onSubmit={submitControl}><input autoFocus value={controlText} onChange={(event) => setControlText(event.target.value)} placeholder={controlType === "steer" ? "输入调整要求，立即改变当前执行方向" : "输入后续要求，当前执行完成后继续"}/><button type="button" onClick={() => { setControlType(null); setControlText(""); }}>取消</button><button disabled={!controlText.trim()}>{controlType === "steer" ? "发送调整" : "加入后续"}</button></form>}
    {(process.length > 0 || live) && <ProcessDetails count={process.length + (live ? 1 : 0)} tools={toolCount} running={!run.settled}>{process.map((message: AgentMessage, index) => message.role === "assistant" ? <AssistantContent key={index} message={message} results={results}/> : null)}{live && <AssistantContent message={live} streaming results={results}/>}</ProcessDetails>}
    {final && <div className="final-answer"><AssistantContent message={final} results={results}/><footer><span>{[final.provider, final.model, usage(final), formatTime(final.timestamp)].filter(Boolean).join(" · ")}</span><button type="button" onClick={() => void navigator.clipboard.writeText(finalText)}>复制</button>{onReply && finalText && <button type="button" onClick={() => onReply(finalText)}>回复</button>}</footer></div>}
    {(run.error || finalError) && <div className="run-error">{run.error || finalError}</div>}
  </article>;
}
