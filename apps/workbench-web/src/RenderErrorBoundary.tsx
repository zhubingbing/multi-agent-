import { Component, type ErrorInfo, type ReactNode } from "react";

type BoundaryVariant = "application" | "run";

type Props = {
  children: ReactNode;
  variant: BoundaryVariant;
  resetKey?: string;
};

type State = { error: Error | null };

/** Keeps malformed remote content scoped to its surface instead of blanking the Workbench. */
export class RenderErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`Workbench ${this.props.variant} render failed`, error, info);
  }

  componentDidUpdate(previous: Props) {
    if (this.state.error && previous.resetKey !== this.props.resetKey) {
      this.setState({ error: null });
    }
  }

  private retry = () => this.setState({ error: null });

  render() {
    if (!this.state.error) return this.props.children;
    if (this.props.variant === "run") {
      return <div className="run-render-error" role="alert">
        <b>这条执行记录暂时无法显示</b>
        <span>其他对话内容不受影响。</span>
        <button type="button" onClick={this.retry}>重试</button>
      </div>;
    }
    return <main className="workbench-crash" role="alert">
      <div>
        <h1>工作台遇到显示问题</h1>
        <p>会话和执行数据仍保存在 Control Server 中。</p>
        <details><summary>错误详情</summary><pre>{this.state.error.message}</pre></details>
        <button type="button" onClick={() => window.location.reload()}>刷新工作台</button>
      </div>
    </main>;
  }
}
