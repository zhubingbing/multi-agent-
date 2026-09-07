import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from "react";

type Mention = { id: string; label: string; description?: string; online?: boolean };
type QueueItem = { id: string; kind: "steer" | "follow_up"; text: string };

export function ChatComposer({ draftKey, mentions, selectedLabel, modelLabel, streaming, connected, initialValue = "", reply, onCancelReply, onSend, onAbort, onControl, onAgentSettings, onModelSettings }: {
  draftKey: string;
  mentions: Mention[];
  selectedLabel: string;
  modelLabel: string;
  streaming: boolean;
  connected: boolean;
  initialValue?: string;
  reply?: string;
  onCancelReply?: () => void;
  onSend: (message: string) => void;
  onAbort: () => void;
  onControl: (type: "steer" | "follow_up", message: string) => void;
  onAgentSettings?: () => void;
  onModelSettings?: () => void;
}) {
  const storageKey = `workbench-chat-draft:${draftKey}`;
  const [value, setValue] = useState(() => localStorage.getItem(storageKey) ?? initialValue);
  const [behavior, setBehavior] = useState<"steer" | "follow_up">("steer");
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [history, setHistory] = useState<string[]>(() => { try { return JSON.parse(localStorage.getItem("workbench-chat-history") || "[]") as string[]; } catch { return []; } });
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [beforeHistory, setBeforeHistory] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { setValue(localStorage.getItem(storageKey) ?? initialValue); setQueue([]); }, [storageKey]);
  useEffect(() => { if (initialValue) { setValue(initialValue); textareaRef.current?.focus(); } }, [initialValue]);
  useEffect(() => { if (value) localStorage.setItem(storageKey, value); else localStorage.removeItem(storageKey); }, [storageKey, value]);
  useEffect(() => { if (!streaming) setQueue([]); }, [streaming]);

  const mentionQuery = useMemo(() => {
    const before = value.slice(0, textareaRef.current?.selectionStart ?? value.length);
    const match = before.match(/(?:^|\s)@([^\s@]*)$/);
    return match ? match[1].toLocaleLowerCase() : null;
  }, [value]);
  const matches = mentionQuery === null ? [] : mentions.filter((mention) => mention.online !== false && (`${mention.label} ${mention.id}`).toLocaleLowerCase().includes(mentionQuery)).slice(0, 6);
  const insertMention = (mention: Mention) => {
    const textarea = textareaRef.current;
    const cursor = textarea?.selectionStart ?? value.length;
    const before = value.slice(0, cursor).replace(/@[^\s@]*$/, `@${mention.label} `);
    setValue(before + value.slice(cursor));
    requestAnimationFrame(() => textarea?.focus());
  };
  const submit = (event?: FormEvent) => {
    event?.preventDefault();
    const message = value.trim();
    if (!message || !connected) return;
    if (streaming) {
      onControl(behavior, message);
      setQueue((current) => [...current, { id: crypto.randomUUID(), kind: behavior, text: message }]);
    } else onSend(message);
    setHistory((current) => {
      const next = [...current.filter((item) => item !== message), message].slice(-50);
      localStorage.setItem("workbench-chat-history", JSON.stringify(next));
      return next;
    });
    setHistoryIndex(-1); setBeforeHistory("");
    setValue("");
  };
  const keyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing) return;
    if ((event.key === "ArrowUp" || event.key === "ArrowDown") && !event.shiftKey && history.length) {
      if (event.key === "ArrowUp" && (historyIndex >= 0 || !value || event.currentTarget.selectionStart === 0)) {
        event.preventDefault();
        const nextIndex = historyIndex < 0 ? history.length - 1 : Math.max(0, historyIndex - 1);
        if (historyIndex < 0) setBeforeHistory(value);
        setHistoryIndex(nextIndex); setValue(history[nextIndex]);
        requestAnimationFrame(() => event.currentTarget.setSelectionRange(history[nextIndex].length, history[nextIndex].length));
        return;
      }
      if (event.key === "ArrowDown" && historyIndex >= 0) {
        event.preventDefault();
        const nextIndex = historyIndex + 1;
        if (nextIndex >= history.length) { setHistoryIndex(-1); setValue(beforeHistory); }
        else { setHistoryIndex(nextIndex); setValue(history[nextIndex]); }
        return;
      }
    }
    if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); submit(); }
  };

  return <div className="composer-wrap">
    {queue.length > 0 && <div className="composer-queue"><b>已排队 {queue.length}</b>{queue.map((item) => <span key={item.id}><i>{item.kind === "steer" ? "调整" : "继续"}</i>{item.text}</span>)}</div>}
    <form className="composer" onSubmit={submit}>
      {reply && <div className="composer-reply"><span>回复：{reply}</span><button type="button" onClick={onCancelReply}>×</button></div>}
      {matches.length > 0 && <div className="mention-menu">{matches.map((mention) => <button type="button" key={mention.id} onMouseDown={(event) => { event.preventDefault(); insertMention(mention); }}><b>@{mention.label}</b><small>{mention.description || mention.id}</small></button>)}</div>}
      <textarea ref={textareaRef} value={value} onChange={(event) => setValue(event.target.value)} placeholder={streaming ? behavior === "steer" ? "输入调整内容，立即改变执行方向…" : "输入后续要求，当前任务完成后执行…" : "提个问题，我来查找和分析…"} onKeyDown={keyDown}/>
      <div className="composer-toolbar">
        {streaming ? <div className="stream-actions"><button type="button" className={behavior === "steer" ? "active" : ""} onClick={() => setBehavior("steer")}>立即调整</button><button type="button" className={behavior === "follow_up" ? "active" : ""} onClick={() => setBehavior("follow_up")}>完成后继续</button></div> : <div className="composer-options"><button type="button" onClick={onAgentSettings}>{selectedLabel}⌄</button><button type="button" className="model" onClick={onModelSettings}>{modelLabel}⌄</button><button type="button">按需确认⌄</button></div>}
        {streaming && <button className="stop-generation" type="button" onClick={onAbort} title="停止生成">■</button>}
        <button className="send-message" disabled={!value.trim() || !connected} title={streaming ? behavior === "steer" ? "发送调整" : "加入后续队列" : "发送"}>➤</button>
      </div>
    </form>
  </div>;
}
