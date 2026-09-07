export type AutomationStatus = "draft" | "active" | "paused" | "archived";
export type AutomationActionKind = "agent_prompt" | "script";
export type ScriptLanguage = "shell" | "python" | "go";

export interface AutomationAction {
  id?: string;
  automationId?: string;
  kind: AutomationActionKind;
  version?: number;
  agentId?: string;
  runtimeId?: string;
  runbook?: string;
  language?: ScriptLanguage;
  source?: string;
  cwd?: string;
  arguments?: string[];
  sessionPolicy?: string;
}

export interface AutomationRecord {
  id: string;
  name: string;
  description?: string;
  status: AutomationStatus;
  actionType: AutomationActionKind;
  outputMode: "create_task" | "run_only";
  concurrencyPolicy: string;
  misfirePolicy: string;
  offlinePolicy: string;
  ruleVersion: number;
  createdByType: string;
  createdById: string;
  createdAt: number;
  updatedAt: number;
  action: AutomationAction;
}

export interface AutomationTrigger {
  id: string;
  automationId: string;
  kind: "schedule";
  enabled: boolean;
  label?: string;
  cronExpression: string;
  timezone: string;
  nextFireAt?: number;
  lastFiredAt?: number;
  createdAt: number;
  updatedAt: number;
}

export interface AutomationCreateRequest {
  name: string;
  description?: string;
  status?: AutomationStatus;
  outputMode?: "create_task" | "run_only";
  action: AutomationAction;
}

export interface AutomationRun {
  id: string;
  automationId: string;
  source: string;
  status: string;
  actionType: AutomationActionKind;
  conversationId?: string;
  agentRunId?: string;
  conversationDeleted?: boolean;
  failureCode?: string;
  failureReason?: string;
  triggeredAt: number;
  startedAt?: number;
  completedAt?: number;
}

export interface AutomationListResponse { automations: AutomationRecord[] }
export interface AutomationResponse { automation: AutomationRecord }
export interface AutomationRunResponse { run: AutomationRun }
export interface AutomationRunListResponse { runs: AutomationRun[] }
export interface AutomationTriggerListResponse { triggers: AutomationTrigger[] }
export interface AutomationTriggerResponse { trigger: AutomationTrigger }
export interface CronPreviewResponse { nextFireAt: number[] }

