import { Component, createContext, memo, useContext, useEffect, useMemo, useState, type ComponentProps, type ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { MermaidBlock } from "./MermaidBlock";

const ANSI_ESCAPE = /\u001B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~]|\][^\u0007]*(?:\u0007|\u001B\\))/g;
const CONTROL_CHAR = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
const CODE_FENCE = /^(`{3,}|~{3,})/;
const MAX_MARKDOWN_CHARS = 100_000;

function normalizeMarkdown(value: string): string {
  return value
    .replace(/\r\n?/g, "\n")
    .replace(ANSI_ESCAPE, "")
    .replace(CONTROL_CHAR, "")
    .replace(/^(\d+\.)[ \t]*\n\n+(?=\S)/gm, "$1 ");
}

function splitStreamingMarkdown(content: string): { stable: string; tail: string } {
  if (content.length < 200) return { stable: "", tail: content };
  const boundary = content.lastIndexOf("\n\n");
  if (boundary < 100) return { stable: "", tail: content };
  let splitAt = boundary + 2;
  const candidate = content.slice(0, splitAt);
  const lines = candidate.split("\n");
  const fences: number[] = [];
  let offset = 0;
  for (const line of lines) {
    if (CODE_FENCE.test(line.trimStart())) fences.push(offset);
    offset += line.length + 1;
  }
  if (fences.length % 2 !== 0) {
    const openFence = fences.at(-1) ?? 0;
    if (openFence <= 0) return { stable: "", tail: content };
    splitAt = openFence;
  }
  return { stable: content.slice(0, splitAt), tail: content.slice(splitAt) };
}

function nodeText(value: ReactNode): string {
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (Array.isArray(value)) return value.map(nodeText).join("");
  if (value && typeof value === "object" && "props" in value) return nodeText((value as { props: { children?: ReactNode } }).props.children);
  return "";
}

const StreamingMarkdownContext = createContext(false);

function Code({ className, children }: { className?: string; children?: ReactNode }) {
  const streaming = useContext(StreamingMarkdownContext);
  const [copied, setCopied] = useState(false);
  const raw = nodeText(children).replace(/\n$/, "");
  const language = className?.replace(/^language-/, "") || "text";
  const block = Boolean(className?.startsWith("language-") || raw.includes("\n"));
  if (!block) return <code className="markdown-inline-code">{children}</code>;
  if (language === "mermaid") return <MermaidBlock code={raw} streaming={streaming}/>;
  const copy = async () => {
    await navigator.clipboard.writeText(raw);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };
  return <div className="markdown-code"><header><span>{language}</span><button type="button" onClick={() => void copy()}>{copied ? "已复制" : "复制"}</button></header><pre><code className={className}>{children}</code></pre></div>;
}

const components: Components = {
  code: Code,
  pre: ({ children }) => <>{children}</>,
  a: ({ href, children }) => <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>,
  img: ({ src, alt }) => <img src={src} alt={alt ?? ""} loading="lazy"/>,
  table: ({ children }) => <div className="markdown-table-wrap"><table>{children}</table></div>,
};

type RehypePlugin = NonNullable<ComponentProps<typeof ReactMarkdown>["rehypePlugins"]>[number];
type RemarkPlugin = NonNullable<ComponentProps<typeof ReactMarkdown>["remarkPlugins"]>[number];
let loadedHighlight: RehypePlugin | null = null;
let loadedKatex: RehypePlugin | null = null;
let loadedMath: RemarkPlugin | null = null;
const highlightPromise = import("rehype-highlight").then((module) => loadedHighlight = module.default as RehypePlugin);
const katexPromise = import("rehype-katex").then((module) => loadedKatex = module.default as RehypePlugin);
const mathPromise = import("remark-math").then((module) => loadedMath = module.default as RemarkPlugin);

function useMarkdownPlugins() {
  // Unified plugins are functions, so lazy initialization prevents React from
  // invoking them as state initializer callbacks.
  const [highlight, setHighlight] = useState<RehypePlugin | null>(() => loadedHighlight);
  const [katex, setKatex] = useState<RehypePlugin | null>(() => loadedKatex);
  const [math, setMath] = useState<RemarkPlugin | null>(() => loadedMath);
  useEffect(() => { if (!highlight) void highlightPromise.then((value) => setHighlight(() => value)); }, [highlight]);
  useEffect(() => { if (!katex) void katexPromise.then((value) => setKatex(() => value)); }, [katex]);
  useEffect(() => { if (!math) void mathPromise.then((value) => setMath(() => value)); }, [math]);
  return { highlight, katex, math };
}

const MarkdownChunk = memo(function MarkdownChunk({ content }: { content: string }) {
  const { highlight, katex, math } = useMarkdownPlugins();
  if (!content) return null;
  return <ReactMarkdown remarkPlugins={[remarkGfm, ...(math ? [math] : [])]} rehypePlugins={[...(katex ? [katex] : []), ...(highlight ? [highlight] : [])]} components={components}>{content}</ReactMarkdown>;
});

class MarkdownBoundary extends Component<{ content: string; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidUpdate(previous: { content: string }) {
    if (this.state.failed && previous.content !== this.props.content) this.setState({ failed: false });
  }
  render() {
    return this.state.failed ? <pre className="markdown-fallback">{this.props.content}</pre> : this.props.children;
  }
}

/** GFM renderer styled from pi-web and TabTin, with a cheap streaming tail. */
export function MarkdownMessage({ children, streaming = false }: { children: string; streaming?: boolean }) {
  const [showLarge, setShowLarge] = useState(false);
  const normalized = useMemo(() => normalizeMarkdown(children), [children]);
  const parts = useMemo(() => streaming ? splitStreamingMarkdown(normalized) : { stable: normalized, tail: "" }, [normalized, streaming]);
  if (normalized.length > MAX_MARKDOWN_CHARS && !showLarge) return <button type="button" className="large-message" onClick={() => setShowLarge(true)}>消息较大（{Math.round(normalized.length / 1000)} KB），点击以纯文本查看</button>;
  if (normalized.length > MAX_MARKDOWN_CHARS) return <pre className="markdown-fallback large">{normalized}</pre>;
  return <MarkdownBoundary content={normalized}><StreamingMarkdownContext.Provider value={streaming}><div className="markdown-body"><MarkdownChunk content={parts.stable}/><MarkdownChunk content={parts.tail}/>{streaming && <span className="stream-caret"/>}</div></StreamingMarkdownContext.Provider></MarkdownBoundary>;
}
