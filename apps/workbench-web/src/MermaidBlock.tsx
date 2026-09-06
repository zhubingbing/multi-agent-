import { useEffect, useState } from "react";

export function MermaidBlock({ code, streaming }: { code: string; streaming?: boolean }) {
  const [preview, setPreview] = useState(false);
  const [svg, setSvg] = useState("");
  const [error, setError] = useState(false);
  useEffect(() => {
    if (!preview || streaming) return;
    let cancelled = false;
    setError(false);
    void import("mermaid").then(async ({ default: mermaid }) => {
      mermaid.initialize({ startOnLoad: false, securityLevel: "strict", theme: "default", suppressErrorRendering: true });
      const valid = await mermaid.parse(code, { suppressErrors: true });
      if (!valid) throw new Error("invalid diagram");
      const result = await mermaid.render(`mermaid-${crypto.randomUUID()}`, code);
      if (!cancelled) setSvg(result.svg);
    }).catch(() => { if (!cancelled) setError(true); });
    return () => { cancelled = true; };
  }, [code, preview, streaming]);
  return <div className="mermaid-view"><header><span>mermaid</span><button type="button" disabled={streaming} onClick={() => setPreview((value) => !value)}>{preview ? "源码" : "预览"}</button></header>{preview && !streaming ? error ? <div className="mermaid-error">无法渲染该图表</div> : svg ? <div className="mermaid-svg" dangerouslySetInnerHTML={{ __html: svg }}/> : <div className="mermaid-loading">正在渲染…</div> : <pre><code>{code}</code></pre>}</div>;
}
