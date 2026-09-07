import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { RenderErrorBoundary } from "./RenderErrorBoundary";
import "katex/dist/katex.min.css";
import "./styles.css";
import "./new-task.css";
import "./chat.css";
import "./chat-experience.css";
import "./rich-content.css";
import "./error-boundary.css";
import "./workbench/agents/agent-center.css";
import "./workbench/automation/automation.css";
import "./workbench/models/model-config.css";
import "./workbench/runtime/runtime-center.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RenderErrorBoundary variant="application">
      <App />
    </RenderErrorBoundary>
  </StrictMode>,
);
