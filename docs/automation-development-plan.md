# 自动化开发计划

> 状态：Draft
>
> 目标：把自动化建设为 Control Plane 的后台一级能力，使 Agent 在浏览器关闭后仍可由时间、手动操作和后续外部事件可靠唤醒，并将执行过程与结果纳入统一 Conversation、Run、Event 和 Message 体系。
>
> UI 参考：`tmp/自动化1.png`、`tmp/自动化2.png`、`tmp/自动化3.png`、`tmp/自动化任务4.png`。

## 1. 产品定位

自动化不是浏览器中的定时器，也不是简单的“Cron 到点发送一条 Prompt”。一条自动化由以下部分组成：

```text
Automation
  = Runbook
  + Action（Agent Run / Script Job）
  + Triggers
  + Output Mode
  + Session Policy
  + Concurrency Policy
  + Recovery Policy
  + Budget
  + Auditable Runs
```

自动化负责“何时唤醒”和“按什么策略启动”；Agent 或未来的 Squad Leader 负责“具体如何完成工作”。浏览器只负责配置、观察和控制，不参与后台调度。

第一阶段的产品闭环：

```text
用户创建自动化
  ↓
关闭浏览器
  ↓
Go Control Scheduler 到期领取 Trigger
  ↓
持久化创建 Automation Run
  ↓
创建普通任务 Conversation 或后台 Run
  ↓
通过 Runtime WebSocket 派发给 Agent
  ↓
Pi AgentSession 执行
  ↓
Thinking / Tool / Final Message / Usage 持久化
  ↓
用户回来查看、继续对话、重试或审核
```

## 2. 产品原则

1. **后台权威。** 浏览器关闭后自动化仍必须运行；`next_fire_at`、运行状态和恢复游标均以数据库为准。
2. **复用统一派发链路。** Browser Prompt、Agent Mention、Automation、Webhook 和未来 Leader Decision 共用 Control 内部 Dispatcher，不为自动化复制一套 Agent 协议。
3. **Conversation-first。** 需要协作或审核的自动化默认创建普通任务 Conversation；用户可以在结果上继续对话。
4. **触发与工作分离。** Trigger 只描述何时启动，Runbook 描述目标、背景、步骤、约束和交付要求。
5. **每次运行可审计。** 保存 Trigger、Rule Version、Action Snapshot（Runbook 或 Script Source）、Agent/Runtime、状态、错误、Usage 和结果引用。
6. **至少一次接收，业务幂等执行。** 调度和 Webhook 允许重试，但通过稳定幂等键保证同一计划或投递最多产生一次有效运行。
7. **默认保守。** 默认限制并发、补跑次数、等待时长、重试范围和 Token 预算。
8. **不隐藏失败。** `skipped`、`duplicate`、`coalesced`、`expired` 和 `blocked` 必须是明确状态，不能伪装成成功或一直运行。
9. **删除即归档。** 自动化归档后停止触发，但历史 Run 和关联 Conversation 保留。
10. **CLI 与 UI 同权威。** UI、Control CLI 和 Agent 调用同一套 HTTP API；CLI 不直连数据库，Agent 身份不能通过参数伪造。
11. **第一版不做通用 DAG。** 条件判断和执行步骤先由 Agent 使用 Skills/Tools 完成，不在早期复制 n8n/Zapier。

## 3. 当前基础与依赖

当前项目已有：

- Go Control Server 与 SQLite WAL；
- Channel、Turn、Run、Event、Message 持久化；
- Runtime 主动 WebSocket 连接、心跳、重连与能力注册；
- 每个 Conversation-Agent 独立 Pi AgentSession；
- Browser → Control → Runtime → Pi Host 的实时派发链路；
- Agent Mention/Inbox 唤醒；
- 顺序与并行多 Agent Run；
- Runtime source sequence、持久化去重、ACK 和进程存活期间 replay；
- Workbench Chat、Thinking、工具、Usage 和刷新恢复。

自动化实施前需要先完成或同步推进：

- 把 Browser WebSocket Handler 中的 Prompt 派发抽成 Control 内部 Dispatcher；
- 新增 Control API Client 与 `multi-agent` CLI，供人类、脚本和获权 Agent 使用；
- 建立 Agent 调用 Control 的身份凭据和细粒度能力，至少区分 `automation.read`、`automation.create_draft`、`automation.activate` 和 `automation.manage_own`；
- 统一 Agent/Runtime/Conversation API Contract；
- 明确 Desired Agent、Observed Runtime State 和 Effective Session Config；
- 为自动化 Scheduler 提供可注入 Clock，禁止测试依赖真实等待。

## 实施进度（持续更新）

### 2026-09-07 · M1 后台定时调度切片 1

已完成：

- [x] 标准 5 字段 Cron Parser，支持列表、范围、步长以及 DOM/DOW 语义；
- [x] IANA 时区校验、未来 5 次执行预览 API 与 Workbench 实时预览；
- [x] 参考 `自动化5.png` 将原始 Cron 默认输入改为当前 Dialog 内的“周期 / 间隔”可视化配置，支持每天、工作日、每周、每月、分钟/小时间隔及高级 Cron；
- [x] Schedule Trigger 创建、查询、更新、停用、删除 API 和持久化 `next_fire_at`；
- [x] Control 内常驻 Scheduler，启动立即恢复扫描，浏览器关闭后仍继续调度；
- [x] SQLite 事务 Claim 先推进 `next_fire_at`，并以 Trigger + planned time 唯一键双重防重；
- [x] `skip` / `latest` 基础 Misfire 恢复，避免停机后无限追赶；
- [x] 定时 Agent Action 复用统一 Conversation Dispatcher，生成普通任务并进入现有 Run 历史；
- [x] Cron、Trigger CRUD、原子 Claim、Scheduler 幂等和 HTTP API 测试；Go test/vet、Workbench typecheck/build 验证。

下一步：`skip_if_active` / `queue_one`、Runtime 离线队列与 TTL、Script Runtime 协议和执行。

### 2026-09-07 · M0 Workbench UI 切片 3

已完成：

- [x] 自动化与应用中心收回“任务”一级 Sidebar，在当前 Workbench 主区原位打开，不再切换整套导航或刷新页面；
- [x] 关闭能力面板后恢复原任务上下文，运行记录打开 Conversation 改为工作台内状态切换；
- [x] 应用中心按参考图补齐“应用 / 技能 / 连接器”、搜索和原位详情，未接入的连接器保持明确空状态；
- [x] 运行记录状态会从权威 Conversation Run 自动对账：dispatched → running → succeeded/failed，并识别 Provider terminal error；
- [x] 运行记录按参考图改为紧凑状态卡片、中文状态、状态筛选、耗时和明确失败原因；
- [x] Automation Run 成功与关联任务删除分开保存；任务删除后显示“任务已删除 / 运行结果：成功”，不再把历史成功误解为任务仍存在；
- [x] “查看任务”在当前 Workbench 打开对应 Conversation，并自动展开右侧运行详情，不进行页面跳转；
- [x] 自动化新增编辑 Dialog，复用真实 PATCH API，并保留已有状态；
- [x] 自动化行操作收纳到 `•••` 菜单，提供编辑、立即运行、启用/暂停和删除；删除按领域规则归档并保留历史 Run；
- [x] 工作空间任务列表新增 `•••` 与二次确认删除，删除 Conversation 后清理 Automation Run 的失效跳转引用；
- [x] Workbench typecheck、生产构建和 `git diff --check` 验证。

下一步继续 M1：Cron/Timezone、下次运行预览和持久 Scheduler。

### 2026-09-07 · M0 Workbench UI 切片 2

已完成：

- [x] 按 `tmp/自动化1.png`～`tmp/自动化3.png` 建立自动化专用 Sidebar、列表页和创建 Dialog；
- [x] 主区提供“定时任务 / 运行记录”Tab、搜索、批量管理和“添加自动化”下拉结构；
- [x] 创建 Dialog 支持 AI Agent 与 Shell/Python/Go Script 两种 Action，并连接真实 Automation Create API；
- [x] 自动化列表连接真实 List API，显示 Action、目标 Agent/Runtime、状态和更新时间；
- [x] Pause/Resume/Archive 与批量归档连接真实 Control API；
- [x] 未完成的 Run Now、Cron 和 Lark 入口明确禁用并标注开发阶段，不伪装为可用；
- [x] Workbench typecheck、生产构建、Go test/vet 与 Vite 模块 HTTP 200 验证。

仍未完成的 UI 闭环：

- [x] Automation 编辑 Dialog；
- [x] 真实 Automation Run 记录；
- [x] Run Now 与工作台内打开 Conversation；
- [x] Cron/Timezone 编辑和下次执行预览；
- [ ] Lark Channel 设置和通知选择。

### 2026-09-07 · M0 基础切片 1

已完成：

- [x] 新增 `internal/automation` 领域模型和 SQLite Store；
- [x] 创建 `automations`、`automation_actions`、`automation_triggers`、`automation_runs` 表及索引；
- [x] 支持 Agent Prompt 与 Shell/Python/Go Script 两种 Action 定义和校验；
- [x] Automation Create/List/Get/Update/Pause/Resume/Archive Store 与 HTTP API；
- [x] 新增 `internal/controlclient` HTTP Client；
- [x] 新增 `multi-agent automation list|get|create|update|pause|resume|archive` CLI，支持表格和 JSON 输出；
- [x] Host 启动脚本、Dev Runtime 和生产 Runtime 镜像包含 `multi-agent` CLI；
- [x] 修复生产 Runtime 镜像依赖被 `.dockerignore` 排除的既有构建问题，改为镜像内构建 Pi Host；
- [x] Store、HTTP API、CLI 参数测试，Go test/vet 和 Control/Runtime Docker build 验证；
- [x] Dev Runtime 内实际执行 `multi-agent automation list --output json` 并成功访问 Control。

尚未完成，不得视为可运行自动化：

- [ ] Agent 身份令牌和 automation 权限；
- [ ] 统一 Conversation Dispatcher；
- [ ] 手动 Run Now；
- [ ] Agent/Script Runtime 实际执行；
- [ ] Trigger CRUD 与 Cron Scheduler；
- [ ] Lark Notification Outbox；
- [ ] Workbench 自动化执行与通知闭环。

## 4. 系统架构

```text
Browser / Desktop
  │ Automation CRUD / Run Now / Pause / History
  ▼
Go Control
  ├── Automation HTTP API
  ├── Automation Service
  ├── Persistent Scheduler
  ├── Trigger Admission & Policy
  ├── Conversation Dispatcher
  ├── Runtime Registry
  └── SQLite Store
          │ outbound Runtime WebSocket
          ▼
Go Runtime Supervisor
  └── Pi SDK Host
        └── AgentSession
```

### 4.1 进程边界

第一版 Scheduler 运行在 `cmd/control` 进程内，但业务代码独立放置，避免继续扩大 `cmd/control/main.go`：

```text
internal/automation/
  model.go
  store.go
  service.go
  scheduler.go
  dispatcher.go
  cron.go
  policy.go
  recovery.go
  webhook.go          # M2

internal/notification/
  model.go
  store.go
  outbox.go
  service.go
  lark.go             # M0：Lark/飞书群机器人出站通知

internal/controlclient/
  client.go           # Workbench、CLI 与脚本共享的 Control API Client

cmd/cli/
  main.go             # 构建为 multi-agent CLI
```

Control 只负责组装与生命周期：

```go
automationService := automation.NewService(...)
scheduler := automation.NewScheduler(...)
scheduler.Start(ctx)
defer scheduler.Stop()
```

未来拆成独立 Scheduler 进程时，应复用相同 Service、Store 和 Claim 协议。

## 5. 统一 Conversation Dispatcher

自动化不能模拟浏览器建立 WebSocket。需要先抽取服务端派发入口：

```go
type DispatchRequest struct {
    Source           string
    ConversationID   string
    Message          string
    AgentIDs         []string
    ExecutionMode    string
    TriggerRefID     string
    IdempotencyKey   string
}

type DispatchResult struct {
    ConversationID string
    TurnID         string
    RunIDs         map[string]string
}

type ConversationDispatcher interface {
    Dispatch(context.Context, DispatchRequest) (DispatchResult, error)
}
```

以下入口共用 Dispatcher：

```text
Browser Prompt ─┐
Agent Mention  ──┤
Automation     ──┼──▶ Conversation Dispatcher ──▶ Runtime
Webhook        ──┤
Leader Decision──┘
```

Dispatcher 负责：

- 校验 Conversation、Agent roster、Agent 状态和 Runtime；
- 创建或复用 Turn；
- 创建 Run；
- 应用顺序/并行策略；
- 持久化触发来源和幂等键；
- 注册活跃路由；
- 向 Runtime 下发命令；
- 广播浏览器状态；
- 派发失败时留下明确、可恢复的状态。

## 6. 核心数据模型

### 6.1 Automation

描述“长期要做什么”。

```text
id
workspace_id
name
description
runbook
status(active|paused|archived)

action_type(agent_prompt|script)
action_id

output_mode(create_task|run_only|continue_conversation)
conversation_id?
session_policy(fresh|conversation|continue)

concurrency_policy(skip_if_active|queue_one|coalesce|always_enqueue)
misfire_policy(skip|latest|catch_up)
offline_policy(queue|skip|fail)
queue_ttl_seconds

timeout_seconds
max_attempts
token_budget

rule_version
created_by
created_at
updated_at
archived_at?
```

第一版限制：

- `action_type` 开放 `agent_prompt` 与 `script`；
- `agent_prompt` 的 `target_type` 只开放 `agent`，Squad 后续接入；
- `script` 开放 Shell、Python 和 Go，并且只能在指定 Runtime 执行；
- `output_mode` 先开放 `create_task` 与 `run_only`;
- `session_policy` 先开放 `fresh`；
- `concurrency_policy` 先开放 `skip_if_active` 与 `queue_one`；
- `misfire_policy` 先开放 `skip` 与 `latest`。

### 6.2 AutomationAction

描述自动化触发后执行什么。创建者与执行器是两个独立维度：

```text
created_by_type(member|agent|api)
created_by_id

             AutomationAction
              ├── agent_prompt
              └── script(shell|python|go)
```

M0 每条 Automation 只绑定一个 Action，不实现 Action DAG。Action 单独版本化，更新后新 Run 使用新版本，历史 Run 保留旧快照。

通用字段：

```text
id
automation_id
kind(agent_prompt|script)
version
enabled
created_at
updated_at
```

Agent Action：

```text
target_type(agent|squad)
target_id
runbook
session_policy
execution_mode
```

Script Action：

```text
runtime_id
language(shell|python|go)
source
entrypoint?
cwd
env_secret_refs?
arguments?
expected_output_mode(text|json|files)
```

脚本设计约束：

- Control 不执行用户脚本，只保存、版本化、调度和审计；
- Runtime 声明 `script.shell`、`script.python`、`script.go` 以及解释器/工具链版本能力；
- Runtime 在独立工作目录或后续沙箱中执行，必须应用 cwd allowlist；
- 默认不向脚本注入 Control Token、Provider Key 或宿主环境变量；
- Secret 只通过显式 `env_secret_refs` 授权，日志必须脱敏；
- Shell 使用明确解释器，不拼接未经转义的用户参数；
- Python 使用配置的解释器；Go 第一版使用 `go run` 或受控构建目录，不在 Control 编译；
- 捕获 stdout、stderr、exit code、耗时和资源使用；
- stdout/stderr 设置内存和持久化上限，超限内容截断并保存诊断标记；
- 支持声明 Artifact 输出目录，但必须阻止路径穿越；
- 超时后终止完整进程树；
- Script 非零退出是 Script Run 失败，而不是 Agent Tool Error；
- 未确认副作用前不自动重试脚本。

建议 Runtime 命令：

```text
runtime.script.run
  actionRunId
  language
  sourceSnapshot
  cwd
  arguments
  secretRefs
  timeout
  artifactPolicy
```

Script Run 仍进入统一 AutomationRun，并可按 `output_mode`：

- 创建普通任务 Conversation，以 Automation 身份写入状态、输出和 Artifact；
- 仅保留在运行记录；
- 后续把摘要追加到指定 Conversation。

### 6.3 AutomationTrigger

描述“什么时候启动”。一条 Automation 可以拥有多个 Trigger，但 M1 UI 可以先限制一个 Schedule Trigger。

```text
id
automation_id
kind(schedule|webhook|api|external_event)
enabled
label?

cron_expression?
timezone?
next_fire_at?

webhook_public_id?
webhook_secret_encrypted?
webhook_signing_mode?
replay_window_seconds?
event_filters?

last_fired_at?
last_result?
created_at
updated_at
```

### 6.4 AutomationRun

描述“一次逻辑运行”。

```text
id
automation_id
trigger_id?
source(manual|schedule|webhook|api|external_event)
status

planned_at?
triggered_at
admitted_at?
dispatched_at?
started_at?
completed_at?

action_type
action_version
action_snapshot
target_type?
target_id?
resolved_agent_id?
runtime_id?
trigger_payload?
resolved_variables?

conversation_id?
turn_id?
agent_run_id?

idempotency_key
attempt
coalesced_into_run_id?

failure_code?
failure_reason?
usage?
created_at
updated_at
```

Run 状态：

```text
received
admitted
queued
dispatched
running
succeeded
failed
skipped
duplicate
coalesced
expired
blocked
cancelled
```

### 6.5 WebhookDelivery（M2）

Webhook 投递和 Automation Run 分离：

```text
id
trigger_id
received_at
event
action
dedupe_key?
dedupe_source?
signature_status
status
selected_headers?
payload
automation_run_id?
replayed_from_delivery_id?
response_status?
error?
```

同一投递可能被拒绝、忽略、去重或创建 Run；重放创建新的 Delivery/Run，不改写原记录。

## 7. 输出模式

### 7.1 create_task（默认）

每次触发创建一个普通任务 Conversation：

```text
Automation Run
  └── Task Conversation
        ├── System：由哪条自动化、哪个计划触发
        ├── Trigger 摘要
        ├── Agent Thinking / Tool / Run
        ├── Final Message
        └── Artifact / Written Files
```

适用：日报、周报、巡检、发布检查、研究、需要审核或继续讨论的工作。

Runtime 离线时仍创建任务并进入 `queued`，在 TTL 内等待 Runtime 上线。

### 7.2 run_only

不进入普通任务列表，只在自动化运行历史中保留完整 Run Detail。

适用：无异常保持安静、后台同步、数据整理和定期清理。

Runtime 离线时默认 `skipped(runtime_offline)`，可配置短时间等待。

### 7.3 continue_conversation（后续）

将每次触发写入指定 Conversation，并使用对应 Agent Binding。适用长期研究、项目汇报和客户跟进。启用前必须完成上下文增长控制、Compaction 和 Session Replace。

## 8. Session 策略

- `fresh`：每次运行创建新 Native Session；确定性更高，默认策略。
- `conversation`：使用指定 Conversation-Agent Binding。
- `continue`：复用 Automation 专属 Session；适合纵向跟踪，但必须限制上下文增长。

每个 Run 记录实际使用的：

```text
runtime_id
native_session_id
native_session_generation
effective_provider
effective_model
effective_thinking_level
effective_cwd
```

## 9. Scheduler 与持久化 Claim

### 9.1 扫描流程

```text
Ticker（建议 15～30 秒）
  ↓
读取 next_fire_at <= now 的 Trigger
  ↓
事务性 Claim
  ↓
先推进 next_fire_at
  ↓
创建 AutomationRun
  ↓
执行 Admission Policy
  ↓
Dispatch 或进入 queued/skipped/blocked
```

成功 Claim 后必须先推进 `next_fire_at`，再执行耗时派发，避免慢 Runtime 导致下一个 Tick 重复触发。

### 9.2 SQLite 阶段

使用短事务和 compare-and-swap 条件：

```sql
BEGIN IMMEDIATE;

UPDATE automation_triggers
SET next_fire_at = ?, last_fired_at = ?
WHERE id = ?
  AND enabled = 1
  AND next_fire_at = ?;

COMMIT;
```

通过受影响行数判断 Claim 是否成功。计划运行使用唯一约束：

```text
(automation_id, trigger_id, planned_at)
```

### 9.3 PostgreSQL 阶段

多 Control 实例使用行锁或 Lease：

- `FOR UPDATE SKIP LOCKED`；
- `lease_owner`；
- `lease_expires_at`；
- 唯一幂等约束。

## 10. Cron 与时区

M1 使用标准 5 字段 Cron：

```text
分 时 日 月 星期
```

要求：

- IANA 时区，如 `Asia/Shanghai`；
- 保存前校验表达式与时区；
- UI 预览接下来至少 5 次运行；
- Scheduler 内统一使用 UTC 时间戳；
- UI 按 Trigger 时区和用户本地时区展示；
- 明确定义夏令时重复/缺失时间的处理；
- 单元测试使用注入 Clock，不依赖真实 sleep。

UI 默认提供人类可读选项：

```text
单次
每天
工作日
每周
每月
自定义 Cron
```

## 11. 并发、错过和离线策略

### 11.1 并发策略

- `skip_if_active`：已有活跃运行时跳过。
- `queue_one`：只保留一个后续运行；第一版默认。
- `coalesce`：合并多次 Trigger payload；Webhook 阶段实现。
- `always_enqueue`：每次都排队，必须设置队列上限和 TTL。

### 11.2 错过调度策略

- `skip`：不补跑，直接计算下一次。
- `latest`：只补最近一次；第一版默认。
- `catch_up`：按顺序补跑，必须限制 `max_catch_up_runs`，建议上限 10。

### 11.3 Runtime 离线策略

- `create_task`：默认创建任务并 `queued`，超过 TTL 后 `expired`。
- `run_only`：默认 `skipped(runtime_offline)`。
- Agent 被归档、无 Runtime 或权限不足：进入 `blocked`，不无限重试。

## 12. 重试与错误分类

只自动重试明确安全的临时错误：

```text
infrastructure
provider_transient
```

默认不自动重试：

```text
provider_permanent
permission
configuration
agent_execution
side_effect_unknown
cancelled
```

工具命令非零退出不等于 Automation Run 失败；Agent 可以继续推理并完成任务。重试前必须确认未发生或可安全重复副作用。

建议退避：

```text
30s → 2m → 10m
```

并设置最大尝试次数。每次 Attempt 单独留审计记录或至少在 AutomationRun 中记录 attempt 与事件。

## 13. Control 重启恢复

Control 启动时：

1. 加载 active Trigger；
2. 检查过期 `next_fire_at`；
3. 按 `misfire_policy` 生成有限补跑计划；
4. 恢复 queued/dispatched/running Run；
5. 与 Runtime 活跃 Run 对账；
6. 将无法恢复的状态转为明确失败或重新排队；
7. 重新计算后续计划。

浏览器是否在线不得影响以上流程。

Runtime 进程崩溃恢复仍依赖后续磁盘 outbox；自动化不得宣称跨 Runtime 进程 exactly-once，必须通过 Run 幂等与结果提交约束降低重复副作用。

## 14. Webhook 安全（M2）

Webhook 第一版即要求：

- 不以 Automation ID 作为凭据；
- 随机 Public ID；
- Secret 只显示一次；
- Secret 加密保存或保存不可逆校验值；
- Bearer 或 HMAC-SHA256；
- 时间戳与重放窗口；
- `Idempotency-Key`；
- 支持 `X-GitHub-Delivery` 等来源去重键；
- Payload 限制 256 KiB；
- JSON 对象或数组校验；
- Event/Action 过滤；
- 每 Trigger/IP 限流；
- Secret 轮换，旧值立即失效；
- 只保存白名单 Header；
- Payload 脱敏策略；
- Delivery 列表、详情和手动 Replay。

业务性忽略（暂停、过滤、重复）返回 2xx 和机器可读状态，避免发送方无意义重试；认证失败、超限和服务故障使用对应 4xx/5xx。

## 15. API 草案

### Automation

```text
GET    /api/multi-agent/automations
POST   /api/multi-agent/automations
GET    /api/multi-agent/automations/:id
PATCH  /api/multi-agent/automations/:id
POST   /api/multi-agent/automations/:id/pause
POST   /api/multi-agent/automations/:id/resume
POST   /api/multi-agent/automations/:id/archive
POST   /api/multi-agent/automations/:id/run
```

### Trigger

```text
GET    /api/multi-agent/automations/:id/triggers
POST   /api/multi-agent/automations/:id/triggers
PATCH  /api/multi-agent/automations/:id/triggers/:triggerId
DELETE /api/multi-agent/automations/:id/triggers/:triggerId
POST   /api/multi-agent/automations/cron-preview
```

### Run

```text
GET    /api/multi-agent/automation-runs
GET    /api/multi-agent/automation-runs/:id
POST   /api/multi-agent/automation-runs/:id/cancel
POST   /api/multi-agent/automation-runs/:id/retry
```

### Webhook（M2）

```text
POST   /api/automation-hooks/:publicId
POST   /api/multi-agent/automations/:id/triggers/:triggerId/rotate-secret
GET    /api/multi-agent/automations/:id/deliveries
GET    /api/multi-agent/automation-deliveries/:id
POST   /api/multi-agent/automation-deliveries/:id/replay
```

### Notification Channel（M0）

```text
GET    /api/multi-agent/notification-channels
POST   /api/multi-agent/notification-channels
PATCH  /api/multi-agent/notification-channels/:id
POST   /api/multi-agent/notification-channels/:id/test
POST   /api/multi-agent/notification-channels/:id/disable
GET    /api/multi-agent/notification-deliveries
GET    /api/multi-agent/notification-deliveries/:id
POST   /api/multi-agent/notification-deliveries/:id/retry
```

## 16. Control CLI 与 Agent 自助管理

CLI 属于 M0。它是 Control HTTP API 的正式客户端，不读取 SQLite，也不绕过权限。建议构建二进制名：

```text
multi-agent
```

连接配置：

```text
MULTI_AGENT_CONTROL_URL
MULTI_AGENT_TOKEN
MULTI_AGENT_WORKSPACE_ID
```

Runtime 中已有的 `MULTI_AGENT_SERVER_URL=ws(s)://.../runtime/ws` 仅表示 Runtime WebSocket；CLI 优先使用 `MULTI_AGENT_CONTROL_URL`。为兼容开发环境，CLI 可以从 Runtime WebSocket URL 推导同源 HTTP(S) Control URL。

人类默认使用表格输出，Agent 和脚本使用稳定 JSON：

```bash
multi-agent context show --output json
multi-agent agent self --output json
multi-agent runtime list --output json

multi-agent automation list --output json
multi-agent automation get <id> --output json
multi-agent automation create --file automation.yaml --output json
multi-agent automation update <id> --file automation.yaml --output json
multi-agent automation run <id> --output json
multi-agent automation runs <id> --output json
multi-agent automation pause <id>
multi-agent automation resume <id>
multi-agent automation archive <id>
```

Agent Action 示例：

```bash
multi-agent automation create \
  --name "每日项目巡检" \
  --agent dev-pi \
  --runbook-file ./daily-review.md \
  --cron "0 9 * * 1-5" \
  --timezone Asia/Shanghai \
  --output-mode create_task
```

Script Action 示例：

```bash
multi-agent automation create \
  --name "每小时磁盘巡检" \
  --runtime runtime-dev \
  --script ./check-disk.py \
  --language python \
  --cron "0 * * * *" \
  --timezone Asia/Shanghai \
  --output-mode run_only
```

Agent 感知 Control 的最小能力：

- 查询自己的身份、权限、Runtime 和 Workspace；
- 查询可用 Agent/Runtime capabilities；
- 查询、创建草稿和管理自己创建的 Automation；
- 查看下次运行、最近 Run、失败原因和关联 Conversation；
- 通过 `--output json` 获得稳定机器格式；
- 错误输出提供稳定 `code`、简短 message 和可选 detail。

权限必须按身份令牌在服务端判断，不能接受 `--as-agent` 之类的身份伪造参数：

```text
automation.read
automation.create_draft
automation.activate
automation.manage_own
automation.manage_all
automation.script.create
notification.channel.use
```

推荐安全默认值：

- Agent 可读取允许范围内的自动化；
- Agent 可创建 `draft`；
- 只有显式获得 `automation.activate` 后才能创建或切换为 `active`；
- Script Action 额外要求 `automation.script.create`；
- Agent 只能引用已授权的 Notification Channel ID，不能读取 Lark Webhook URL/Secret；
- 激活高频、长期有效、高预算或带 Secret 的自动化可要求人类批准；
- CLI 的所有变更记录 `created_by_type/id` 和审计事件。

自动化 YAML/JSON 应使用版本化 schema，例如：

```yaml
apiVersion: multi-agent/v1alpha1
kind: Automation
metadata:
  name: daily-ai-news
spec:
  status: draft
  action:
    kind: agent_prompt
    agentId: dev-pi
    runbook: |
      搜索当天 AI 领域的重要更新，筛选 3-5 条并给出来源。
  trigger:
    kind: schedule
    cron: "0 9 * * *"
    timezone: Asia/Shanghai
  output:
    mode: create_task
  notifications:
    - channelId: lark-team
      events: [succeeded, failed, blocked]
```

## 17. Lark Bot 第一阶段通知

M0 首个外部渠道采用 Lark/飞书群机器人 Webhook，只实现 Control → Lark 出站通知。完整双向 Bot、二维码绑定、群聊 @Agent、事件订阅和长连接放到后续阶段。

M0 目标：

```text
Automation/Task 状态事件
  ↓
Notification Outbox
  ↓
Lark Adapter
  ↓
Lark/飞书群机器人
```

通知事件：

```text
succeeded
failed
blocked
approval_required
queue_expired
consecutive_failures
```

默认只推送最终状态、最终答案摘要、耗时、Agent、Usage、Artifact 元数据和 Workbench 链接，不推送 Thinking、完整工具参数、原始环境变量或 Secret。

建议数据模型：

```text
notification_channels
  id, workspace_id, kind(lark_webhook), name
  endpoint_encrypted, secret_encrypted?
  region(feishu|lark), status, created_by
  created_at, updated_at, disabled_at?

notification_subscriptions
  id, automation_id, channel_id
  events, template, enabled

notification_deliveries
  id, channel_id, event_id, automation_run_id?
  status(pending|sending|sent|failed|dead)
  attempt, available_at, sent_at?
  response_code?, error?, payload_snapshot
```

发送使用持久 Outbox，Automation Run 提交成功与 Notification Delivery 入队在同一事务中完成，外部 HTTP 请求在事务外异步执行。Control 崩溃后继续发送未完成 Delivery。

投递幂等键建议：

```text
(event_id, channel_id, template_version)
```

失败策略：

- HTTP 429/5xx 和网络超时按退避重试；
- 明确的 4xx 配置错误不无限重试；
- 达到上限后进入 `dead` 并在 Workbench 显示；
- 通知失败不把已成功的 Automation Run 改为失败，而是标记 `notification_warning`；
- 提供“发送测试消息”和“重试投递”。

安全约束：

- Webhook URL/Secret 在 Control 加密保存，不下发 Runtime；
- Agent 和 Script 只能引用 Channel ID；
- 默认只允许 Lark/飞书官方 HTTPS Webhook Host，防止 SSRF；
- 禁止把完整 Webhook URL 写入 Conversation、CLI JSON 或日志；
- 日志脱敏 URL Token；
- 设置请求超时、响应体上限和消息长度上限；
- `MULTI_AGENT_PUBLIC_URL` 用于生成可点击的 Workbench 任务链接。

消息第一版使用简洁卡片：

```text
每日 AI 新闻推送 · 已完成
Agent：Dev Pi
耗时：4m48s
摘要：今天筛选出 5 条重要动态……
产物：ai-daily-briefing.html
[打开任务]
```

UI 对应 `tmp/自动化1.png` 的“完成后推送”区域：选择已配置的 Lark Channel，并选择成功、失败、阻塞等事件。未配置渠道时提供“前往设置 Lark Bot”，不能展示一个无效开关。

## 18. Workbench UI 计划

UI 参考 `tmp/自动化*.png`，借鉴其信息架构、留白、层级和低干扰操作，不复制品牌资产。

### 18.1 自动化 Sidebar

```text
＋ 新建自动化
全部自动化
运行记录
需要处理
已暂停
```

### 18.2 自动化列表

顶部：

```text
[定时任务] [运行记录]              [搜索] [批量管理] [添加自动化⌄]
```

每行展示：

- 名称；
- 执行器（Agent 或 Script Runtime）；
- 工作空间；
- Trigger 摘要；
- 下次运行；
- 最近状态和耗时；
- 启用开关；
- 立即运行；
- 更多操作。

### 18.3 创建/编辑 Dialog

保持单页基础配置：

1. 名称；
2. Action 类型（Agent Run / Script Job）；
3. Agent 与 Runbook，或 Script Language/Source/Runtime；
4. 工作空间；
5. 权限；
6. 执行频率；
7. 有效期；
8. 输出模式；
9. Lark 通知。

高级设置折叠展示：

- Cron 与时区；
- 下五次运行预览；
- 并发策略；
- 错过策略；
- Runtime 离线策略；
- TTL；
- 超时；
- 重试；
- Token 预算。

“专家模板、Skill 模板、连接器模板”只有存在真实模板和后端闭环后才开放；M0 只开放“从空白创建”。

### 18.4 运行记录

筛选：

```text
全部
等待中
运行中
成功
失败
已跳过
需要处理
```

每条显示：

- 自动化名称；
- Trigger Source；
- 计划/实际触发时间；
- Action 类型、Agent/Script Runtime；
- 状态；
- 耗时；
- Usage；
- 错误原因；
- 对应任务。

`create_task` 点击后进入普通 Conversation；`run_only` 打开只读 Run Detail。

### 18.5 自动化生成的任务

对应 `tmp/自动化任务4.png`：

- 左侧任务树正常显示；
- 顶部标注自动化来源；
- Agent Thinking、Tool 和 Final Message 使用现有 Chat 体验；
- Artifact/Written Files 在正文与右侧 Canvas 可见；
- 用户可以继续对话、Reply、Steer 或创建后续工作；
- 自动化详情可以反向跳转到任务。

## 19. 权限、预算与通知

M0/M1 至少检查：

- 创建者仍有 Workspace 权限；
- 目标 Agent 未归档；
- 创建者/Automation 获准使用该 Agent；
- Agent 的 Runtime、cwd 和工具权限仍有效；
- 自动化不能扩大创建者原有权限；
- 高风险工具仍受审批策略约束。

预算至少支持：

```text
每次最大时长
每次 Token 上限
每日运行次数
每日 Token 上限
最大排队数
```

通知事件：

```text
run_failed
run_blocked
approval_required
consecutive_failures
queue_expired
```

第一版外部通知使用 Lark/飞书群机器人 Webhook，并通过持久 Notification Outbox 发送。其他邮件、企业微信和 Slack 等渠道必须等 Connector 后端真正可用后再开放。

## 20. 分阶段实施

### M0：手动运行闭环

后台：

- [ ] 抽取统一 Conversation Dispatcher；
- [x] 新增 Automation、Action、Trigger、Run 表与 Store；
- [x] Automation CRUD；
- [x] `multi-agent` Control CLI 与 JSON 输出；
- [ ] Agent 身份的 read/create-draft/activate/script-create 权限；
- [ ] Agent Prompt Action 与单 Agent Target；
- [ ] Shell/Python/Go Script Action 与 Runtime capability 校验；
- [ ] Runbook/Script Source、Rule Version 与 Action Snapshot；
- [ ] `create_task` 和 `run_only`；
- [ ] 手动“立即运行”；
- [ ] 运行状态与历史；
- [x] 暂停、恢复、归档；
- [ ] Runtime 离线 Admission；
- [ ] Automation Run 与 Conversation/Turn/Agent Run 或 Script Run 关联；
- [ ] Notification Channel、Subscription、Delivery 与持久 Outbox；
- [ ] Lark/飞书群机器人 Webhook 配置、测试和完成/失败/阻塞推送。

前端：

- [x] 自动化列表；
- [x] 运行记录 Tab 基础布局；
- [x] 创建 Dialog（Agent/Script 两种 Action）；
- [x] 编辑 Dialog；
- [ ] Lark Channel 设置、测试消息与自动化通知选择；
- [x] 启用、暂停和归档；
- [x] 立即运行；
- [x] 从运行在当前 Workbench 打开 Conversation；

### M1：Cron 后台调度

- [x] 5 字段 Cron Parser；
- [x] IANA 时区；
- [x] 下次运行预览；
- [x] 持久化 `next_fire_at`；
- [x] 后台 Scheduler；
- [x] SQLite 事务 Claim；
- [x] 计划唯一幂等约束；
- [ ] `skip_if_active` / `queue_one`；
- [x] `skip` / `latest`；
- [ ] Runtime 离线排队与 TTL；
- [x] Control 重启恢复；
- [x] Fake Clock 测试。

### M2：Webhook

- [ ] Webhook Trigger；
- [ ] Public ID 与 Secret；
- [ ] Bearer/HMAC；
- [ ] Idempotency Key；
- [ ] Event/Action Filter；
- [ ] Delivery 审计；
- [ ] Rate Limit；
- [ ] Payload 限制与脱敏；
- [ ] Secret Rotation；
- [ ] Delivery Replay；
- [ ] `coalesce` / `always_enqueue`。

### M3：治理与运营

- [ ] 分类重试；
- [ ] 超时；
- [ ] Token/次数预算；
- [ ] 连续失败自动暂停；
- [ ] Workbench Inbox 通知；
- [ ] 审批；
- [ ] Usage 聚合；
- [ ] 批量管理；
- [ ] API Trigger。

### M4：Goal/Squad/Leader

- [ ] Target Squad；
- [ ] Automation 指向 Squad 时只唤醒 Leader；
- [ ] 创建或继续 Goal；
- [ ] Worker 结果重新唤醒 Leader；
- [ ] Leader Decision 幂等；
- [ ] Goal/Work Item 完成策略；
- [ ] Automation/Goal/Squad 联合预算。

## 21. 测试计划

### Store/Service

- [ ] CRUD、暂停、归档和 Rule Version；
- [ ] 每个历史 Run 保留原 Rule、Runbook 或 Script Action Snapshot；
- [ ] Agent 与 Script Action 都能通过手动 Run Now 执行；
- [ ] Script capability、cwd allowlist、超时、进程树终止和输出截断正确；
- [ ] Agent 创建草稿、激活和脚本权限由服务端强制；
- [ ] 同一 Idempotency Key 不重复运行；
- [ ] 同一计划时间只产生一次有效 Run；
- [ ] Agent 不存在、归档、无权限或 Runtime 离线状态正确；
- [ ] `queue_one` 不无限堆积；
- [ ] 归档后历史仍可读。

### Control CLI / Agent

- [ ] 人类表格输出与 Agent JSON 输出稳定；
- [ ] CLI 只调用 HTTP API，不读取数据库；
- [ ] Token 身份不能通过命令参数伪造；
- [ ] Agent 可查询自身、Runtime、Automation 和 Run 状态；
- [ ] 无 `automation.activate` 时只能创建 draft；
- [ ] 无 `automation.script.create` 时拒绝 Script Action；
- [ ] CLI 错误包含稳定 code、简短 message 和可选 detail；
- [ ] CLI 创建结果与 Workbench UI 立即一致。

### Lark Notification

- [ ] Webhook URL/Secret 加密保存且输出脱敏；
- [ ] 官方 Host 校验和 SSRF 防护；
- [ ] 测试消息；
- [ ] succeeded/failed/blocked 事件正确入 Outbox；
- [ ] Control 重启后继续 pending Delivery；
- [ ] 429/5xx 退避重试，配置类 4xx 不无限重试；
- [ ] 同一事件和 Channel 不重复推送；
- [ ] 通知失败不篡改已成功 Automation Run；
- [ ] 消息不包含 Thinking、Secret 和完整工具参数；
- [ ] 卡片中的 Workbench 链接指向正确 Conversation。

### Scheduler

- [ ] 到期 Trigger 只领取一次；
- [ ] 两次扫描不会重复触发；
- [ ] Claim 后先推进下一次时间；
- [ ] 暂停/归档 Trigger 不运行；
- [ ] Control 重启按 `latest` 有限补跑；
- [ ] `skip` 不补跑；
- [ ] 时间跳变和时区计算；
- [ ] Runtime 上线后 queued Run 继续；
- [ ] TTL 到期进入 expired；
- [ ] 所有测试使用 Fake Clock。

### Dispatch/Recovery

- [ ] Browser 和 Automation 复用同一 Dispatcher；
- [ ] 自动化创建的 Conversation 可刷新恢复；
- [ ] Runtime 重连后不重复最终消息；
- [ ] AutomationRun 与 Agent Run 状态最终一致；
- [ ] Control 重启后不会把已完成 Run 再派一次；
- [ ] 无浏览器连接时完整执行。

### Webhook（M2）

- [ ] 签名有效/无效/缺失；
- [ ] 重放窗口；
- [ ] Payload 超限；
- [ ] Event Filter；
- [ ] 幂等投递；
- [ ] Secret 轮换；
- [ ] Rate Limit；
- [ ] Replay 创建新记录且不改写原记录。

### Browser E2E

- [ ] 创建自动化；
- [ ] 立即运行并生成任务；
- [ ] 关闭页面后 Cron 仍运行；
- [ ] 运行记录状态实时更新；
- [ ] 点击运行进入 Conversation；
- [ ] 暂停后不再触发；
- [ ] Runtime 离线显示等待/跳过原因；
- [ ] Control 重启后计划恢复；
- [ ] 工具错误不冒充页面级错误。

## 22. 第一版默认决策

| 决策 | 默认值 |
| --- | --- |
| Action | `agent_prompt` 或单个 `script`（Shell/Python/Go） |
| Creator | Human / 获权 Agent / API |
| Agent-created status | 默认 `draft`，需 `automation.activate` 才可直接启用 |
| Notification | Lark/飞书群机器人 Webhook |
| Trigger | Manual + Schedule |
| Cron | 标准 5 字段 |
| Timezone | 用户选择的 IANA 时区，默认浏览器时区 |
| Output | `create_task` |
| Session | `fresh` |
| Concurrency | `queue_one` |
| Misfire | `latest` |
| create_task Runtime Offline | 排队并设置 TTL |
| run_only Runtime Offline | `skipped` |
| Retry | 仅基础设施和 Provider 临时错误 |
| Delete | Archive |
| Audit | 每次 Run 保存 Rule 与 Action Snapshot（Runbook/Script Source） |
| DAG | 第一版不实现 |

## 23. M1 验收标准

达到以下条件才可称为“后台自动化可用”：

1. 浏览器关闭后 Cron 仍按时触发；
2. Control 重启后自动恢复未来计划，并按策略有限补跑；
3. 同一计划时间不会重复创建有效 Run；
4. 每次运行都可追溯到 Automation、Trigger、Rule Version、Action Snapshot、Agent 或 Script Runtime，以及关联 Conversation；
5. Runtime 离线时不会静默丢任务；
6. 自动化结果可以进入普通 Conversation 并继续对话；
7. 暂停和归档立即阻止未来触发；
8. 更新 Runbook 或 Script 不修改历史运行证据；
9. 工具错误、Agent 错误和平台错误分级正确；
10. Scheduler 测试不依赖真实等待；
11. 自动化列表、运行记录和任务详情状态一致；
12. CLI 可由获权 Agent 创建草稿、查询状态和触发运行，且不能绕过激活/脚本权限；
13. Shell/Python/Go Script 在 Runtime 而非 Control 执行；
14. Automation 完成、失败或阻塞可通过持久 Outbox 推送到 Lark，通知失败不会篡改任务结果；
15. 未实现的入站 Webhook、双向 Lark Bot、其他 Connector、Squad 和 DAG 不伪装为可用。

## 24. 明确非目标

M0/M1 不实现：

- 通用可视化工作流 DAG；
- 多 Action 可视化工作流 DAG；
- 自动化之间递归调用；
- 无预算无限循环；
- 跨 Workspace 自动化；
- Squad/Leader 调度；
- Lark 之外的外部 Connector 推送；
- Lark 双向会话、事件订阅和群聊 @Agent；
- 自动执行未经审批的高风险动作；
- 多 Control 实例生产调度；
- exactly-once 外部副作用承诺。

## 25. 推荐执行顺序

```text
1. 抽取统一 Dispatcher
2. Automation/Action/Trigger/Run 数据表与 Store
3. Control API Client 与 multi-agent CLI
4. Agent Prompt + Shell/Python/Go Script 的手动 Run Now
5. create_task → Conversation 闭环
6. Lark Notification Channel 与持久 Outbox
7. 自动化列表、运行记录和创建 Dialog UI
8. Cron/Timezone/Preview
9. Scheduler Claim 与恢复
10. 并发、错过、离线和 TTL 策略
11. Browser/CLI E2E 与无浏览器运行验证
12. 入站 Webhook 与治理
13. Goal/Squad/Leader 集成
```

自动化是当前核心主线之一，但不能绕过 Agent/Runtime 管理基础。建议与 Agent 注册、Runtime 状态和 Chat 稳定性并行推进，共用统一 Contract、Dispatcher、Run 和 Error Classification。
