# Multi Agent 架构设计

## 系统边界

```text
Browser
  │ same-origin HTTP/WebSocket :30146
  ▼
Go Control & Realtime Gateway
  ├─ /api/multi-agent/*：控制与实时协议
  └─ /*：反向代理 pi-web
          │ loopback :30148
          ▼
       pi-web Next.js

Go Control
  ├─ Runtime A outbound WebSocket（宿主机）
  └─ Runtime B outbound WebSocket（Docker）
        │
        ▼
Go Runtime Supervisor
  ├─ Pi SDK Host（Node，多 AgentSession）
  ├─ Codex app-server Host（后续）
  └─ ACP Adapter（后续）
```

外部只暴露 30146。Next.js 仅监听 127.0.0.1:30148。Runtime 主动连接 Control，适应 NAT、Docker 和内网机器。

## 分层

### Web Experience Layer

基于 pi-web v0.8.11，保留：

- `AppShell`
- `SessionSidebar`
- `ChatWindow`
- `ChatInput`
- `MessageView`
- `MarkdownBody`
- `BranchNavigator`
- `FileViewer`
- `lib/streaming-message.ts`

新增 Goal、Squad、Leader、Plan、Channel、Thread、统一 Participant、Multi-Agent Interaction 和 Work Item 表面。Member 与 Agent 使用同一套 Message/Mention/Reply 体验；Provider 差异不得进入消息组件。

### Control Plane

Go Control Server负责：

- 身份与权限；
- Workspace、Channel、Conversation；
- Goal、Squad、Plan 和 Work Item；
- Leader 唤醒、决策记录、分派、验收与完成策略；
- Agent 和 Runtime 注册；
- Conversation-Agent Binding；
- Mention、Reply、Assignment、Handoff 和 Inbox 路由；
- Interaction 生命周期、角色和发言调度；
- Run 生命周期；
- Realtime Fan-out；
- Event 持久化和重放；
- 用户授权、互动预算与 Draft Freshness；
- Automation 的定时/事件触发、去重、重试、Lease 和预算。

Control 不执行模型和本地工具。

### Runtime Plane

Go Runtime负责：

- 出站连接、注册、心跳和重连；
- 本机 Provider 发现和能力报告；
- cwd allowlist；
- Session 路由和串行化；
- Provider Host 生命周期；
- 进程树管理、资源限制和日志；
- Agent Event 脱敏和转发。

### Participant 语义

Member 和 Agent 都是一等 Conversation Participant。两者发布的公开消息进入同一权威 Message 流，都可以 Mention、Reply、加入 Thread 和发起获权行为。Agent 不是一次 Provider 调用：其身份、Inbox、Binding、已读游标和参与状态长期存在，模型推理则由消息、任务、定时器或 Interaction 调度按需唤醒。

Agent 可以像独立成员一样主动选择发言、邀请另一 Agent 接话或保持沉默；Control 只负责身份、权限、预算、调度和审计，不替 Agent 决定观点，也不要求所有自然交流都伪装成 Handoff。

### Goal 与 Squad 编排语义

Conversation 是协作界面，Goal 是结果主线，Squad 是稳定组织，Plan 和 Work Item 是可执行状态。四者不能互相替代：聊天记录不等于计划，单次 Run 成功不等于 Work Item 验收，单个 Work Item 完成也不等于 Goal 达成。

当 Goal/Work Item 分配给 Squad 时，Control 只为 Leader 创建初始运行。Leader 读取 Goal、当前 Plan、未完成 Work Item、Squad Roster、成员角色和最新事件，作出下一步决定并通过 Assignment/Mention 分派。Leader 分派后停止；成员交付、失败、阻塞、Review、定时器或外部事件再将其唤醒。

Leader 是受平台协议约束的 Agent，而不是 Control 内的硬编码规划算法。其自然语言判断由模型完成，但以下不变量由 Control 强制：一次权威触发只产生幂等的一次 Leader 决策；只有获权成员可被调用；分派后不常驻轮询；计划和决策可审计；完成必须满足 Goal 的完成策略；预算耗尽或没有可行路径时停止并升级。

Leader 默认承担协调而非具体实现，以保留全局上下文和独立验收能力。Squad Instructions 可以允许小型工作由 Leader 直接完成。Leader 对 Worker 的内部验收与 Goal 的最终批准分离：最终批准可配置为 Leader、指定 Reviewer 或人类。

### Context Acquisition

Context Acquisition 是 Agent 执行中的通用能力，不是 Control Plane 的领域数据模型。Agent 根据 Instructions、Skills、插件、cwd 和 Access Policy，从 Workspace 知识库、项目文档、文件系统、数据库、网络搜索或外部服务获取上下文；也可以由 Leader 把检索工作委派给专门成员。

平台不理解“行情”“客户资料”或某一种知识库的业务语义，只负责工具能力声明、权限检查、执行记录、敏感信息处理、失败披露和必要的来源可追踪性。缺少内部资料时是否允许网络查询、优先级和引用规范由 Agent/Squad Instructions 与 Workspace Policy 决定。

### Provider Session Plane

每个 `(workspace_id, conversation_id, agent_id)` 映射一个 Native Session：

```text
Pi      → AgentSession / JSONL
Codex   → app-server Thread
ACP     → ACP Session
```

统一能力接口：

```go
type Session interface {
    Open(context.Context, Config) error
    Prompt(context.Context, Input) error
    Steer(context.Context, Input) error
    FollowUp(context.Context, Input) error
    Abort(context.Context) error
    Snapshot(context.Context) (State, error)
    Close(context.Context) error
    Events() <-chan Event
}
```

能力不齐时由 Runtime 报告，前端禁用而不是伪造行为。

## 核心数据模型

### Goal

```text
id, workspace_id, conversation_id?
title, description, success_criteria, constraints, non_goals
assignee_type(agent|squad), assignee_id, leader_agent_id?
status(draft|clarifying|planning|in_progress|in_review|blocked|completed|cancelled)
completion_policy(leader_can_complete|require_reviewer|require_human_approval)
current_plan_version, created_by, started_at, target_at, completed_at
```

### Squad

```text
id, workspace_id, name, description
leader_agent_id, instructions
created_by, created_at, archived_at
```

### SquadMember

```text
squad_id, participant_type(member|agent), participant_id
role_description, joined_at, left_at
```

角色描述供 Leader 选人，不授予权限。Leader 必须是 Agent，并自动成为 Squad 成员。

### Plan

```text
id, goal_id, version, summary, status
created_by_agent_id, reason, supersedes_plan_id?, created_at
```

Plan 是权威、可见、可版本化的执行计划，不能只存在于 Leader Native Session 中。

### WorkItem

```text
id, goal_id, plan_id, conversation_id?
parent_work_item_id?, title, description
assignee_type(member|agent|squad), assignee_id
status(backlog|todo|in_progress|in_review|blocked|done|cancelled)
priority, dependencies, acceptance_criteria, reviewer_ids
created_by, started_at, due_at, completed_at
```

### LeaderDecision

```text
id, goal_id, work_item_id?, leader_agent_id
trigger_event_id, plan_version
type(clarify|plan|delegate|accept|request_changes|replan|wait|escalate|deliver|block|cancel)
reason, target_participant_ids, created_work_item_ids, created_at
```

`(leader_agent_id, trigger_event_id)` 唯一，防止同一事件重复产生分派。

### Automation

```text
id, workspace_id, name
assignee_type(agent|squad), assignee_id
trigger_type(cron|interval|webhook|external_event)
trigger_config, instructions, enabled
retry_policy, timeout, cooldown, budget_policy
last_fired_at, next_fire_at, created_by
```

Automation 指向 Squad 时只唤醒 Leader，由 Leader 决定是否创建/更新 Goal 或 Work Item、委派成员、保持沉默或升级。

### Agent

```text
id, workspace_id, name, handle, avatar
instructions, provider, model, thinking_level
runtime_id, cwd, access_policy
created_by, archived_at
```

### Runtime

```text
id, owner_id, name, machine_fingerprint
status, capabilities, provider_versions
last_seen_at, created_at
```

### Channel

```text
id, workspace_id, name, visibility
created_by, archived_at
```

### Conversation

```text
id, workspace_id, channel_id?, parent_message_id?
type(channel|thread|dm), title
version, created_by, archived_at, deleted_at
```

### ConversationParticipant

```text
conversation_id, participant_type(member|agent)
participant_id, role, joined_at, left_at
```

### Message

```text
id, conversation_id, version
author_type, author_id
content, reply_to_id?, created_at, edited_at
```

### AgentBinding

```text
conversation_id, agent_id, runtime_id
provider, native_session_id, native_session_generation
last_seen_version, state, last_active_at
```

### Run

```text
id, conversation_id, agent_id
goal_id?, work_item_id?
trigger_type(message|work_item|leader_decision|interaction|automation|system)
trigger_ref_id?, trigger_message_id?
input_mode(prompt|steer|follow_up)
status, started_at, first_event_at, completed_at
base_conversation_version, final_conversation_version
usage, stop_reason, error
```

### Event

```text
run_id, seq, event_type, payload
emitted_at, persisted_at
```

`(run_id, seq)` 唯一，用于幂等、重放和断线恢复。

### Multi-Agent Interaction

Agent-to-Agent 不只用于任务交接。系统用统一的 Interaction 表示经用户授权的连续多方活动：

```text
kind: task_collaboration | role_play | performance | debate | brainstorming | moderated_discussion
conversation_id, initiator_type, initiator_id
participants[{participant_id, role}]
topic, instructions
turn_policy, current_speaker_id
turn_count, max_turns
token_used, token_budget
started_at, deadline, status, stop_reason
```

典型发言策略：

```text
round_robin       固定轮流
mention_driven    被点名者接话
moderated         主持人选择下一位
free_form         Agent 自主申请发言
scripted          按角色和剧情节点推进
```

例如用户授权 Host Pi（逗哏）与 Docker Pi（捧哏）表演约 5 分钟相声，就是正常的 `performance` Interaction。若“5 分钟”表示内容朗读时长，Control 将其换算为篇幅/轮次目标并可快速生成；若表示现实时间直播，服务端调度器按时钟推进，浏览器断开不能中止活动。

每轮 Agent 都获得共享 Conversation 的获权增量、自己的角色与活动目标。公开输出只写一次权威 Message 流；Agent 私有 Native Session 保存其自身推理和工具状态，不能成为其他参与者看不到公开台词的孤岛。

用户可以 Steering、暂停、继续、跳过当前 Agent、替换卡住的 Agent Session 或停止全部。单个 Agent 超时/失败时按策略重试、跳过或暂停请求用户决定，不应删除整个 Channel。

### InteractionRun

```text
id, interaction_id, root_message_id, started_by
turn_count, max_turns, token_used, token_budget, deadline
active_agents, visited_edges, repeated_content_fingerprint
status, stop_reason
```

限制的对象是无授权或失控调用，不是正常的多轮交流。用户明确给定参与者、主题、角色和范围后，Agent 可以在该授权内连续接话，无需每一句重新申请。停止条件包括：

- completed
- needs_user_input
- max_turns
- budget_exhausted
- deadline_exceeded
- loop_detected（仅用于重复、无进展或越界循环，不得误伤获权表演）
- runtime_offline
- user_paused / user_stopped
- agent_failed

### InboxEvent

```text
id, workspace_id, recipient_type, recipient_id
type, source_conversation_id, source_message_id
strength, state, created_at, consumed_at
```

## Leader Operating Protocol

每次 Leader Run 必须遵循：

1. 读取 Goal、成功标准、约束、当前 Plan、Work Item 状态、Squad Roster 和触发事件。
2. 信息不足且无法安全假设时，记录 `clarify` 并请求最少的关键输入。
3. 创建或修订可见 Plan；每个可执行 Work Item 都有负责人、依赖和验收条件。
4. 选择当前可推进的下一步，检查目标成员权限、Runtime 可用性和预算。
5. 发布一次权威分派并记录 `LeaderDecision`，随后停止本轮。
6. 被成员结果重新唤醒后，对照验收条件接受、返工、改派、补充 Review 或 Replan。
7. Worker 或 Run 的“成功”只表示执行结束，不自动表示验收通过。
8. 整体成功标准满足后按 `completion_policy` 交付、请求审批或完成 Goal。
9. 遇到目标冲突、关键风险、越权、持续失败或无可行路径时进入 `blocked/escalate`，不得无限重试。

Leader 自己发布的分派不能重新触发自己；同一成员结果在 Leader 已有 queued/dispatched Run 时合并为增量，避免唤醒风暴。用户的明确 Mention/Assignment 优先于 Leader 的默认路由，但不绕过权限和 Goal 边界。

## Automation 与长期驱动

Automation 负责“何时唤醒”，Leader 负责“下一步做什么”。Cron、Interval、Webhook 或外部事件必须先形成可审计、可去重的触发记录；分配给 Squad 时只唤醒 Leader，不直接广播给所有成员。

长期目标不依靠永久 Agent Session 盯守。每次运行都是有界决策或执行，状态保存在 Goal、Plan、Work Item、Conversation 和 Run 中。调度至少支持幂等键、Cooldown、超时、重试上限、并发限制、分布式 Lease、错过调度策略和时间/Token 预算。

## 实时协议

### 浏览器到 Control

```json
{
  "type": "prompt",
  "conversationId": "conv-1",
  "agentIds": ["agent-a"],
  "message": "请分析方案"
}
```

运行中控制：

```text
steer, follow_up, abort
```

### Control 到 Runtime

```json
{
  "type": "session.prompt",
  "requestId": "req-1",
  "runId": "run-1",
  "conversationId": "conv-1",
  "agentId": "agent-a",
  "baseVersion": 12,
  "message": "请分析方案"
}
```

### Runtime Event

```json
{
  "type": "session.event",
  "runId": "run-1",
  "agentId": "agent-a",
  "seq": 42,
  "event": {
    "type": "message_update",
    "assistantMessageEvent": {
      "type": "text_delta",
      "delta": "正在分析"
    }
  }
}
```

Control 先广播到在线浏览器，同时排队持久化。最终消息提交需要事务性检查 Conversation Version。

## 路由与发言规则

1. Member 和 Agent 的公开 Message 使用同一套路由入口。
2. 明确 Mention：为被 Mention Agent 创建 Inbox 信号；在活跃 Interaction 中也可影响下一发言者。
3. 明确 UI 选择：触发选中的 Agent。
4. 回复 Agent 消息：默认路由给被回复 Agent。
5. Assignment：强信号，请目标承担有交付物的工作。
6. Handoff：强信号，转移责任、上下文或处理权；不等同于普通聊天。
7. 已参与 Thread 的 Agent：接收中强度更新，自主决定处理。
8. 普通 Channel 消息：除非订阅策略或 Interaction 规则要求，否则不自动启动所有 Agent。
9. Agent 发出的 `@name` 是合法的候选 Mention；Control 在权限和当前用户授权范围内可直接投递。只有越出 Interaction 范围或可能造成无界调用时，才暂停、拒绝或请求用户扩大授权。
10. Interaction 调度产生的下一轮不要求文本中重复写 `@name`，由 `turn_policy` 选择发言者。
11. Work Item/Goal 分配给 Squad：只触发该 Squad 的 Leader；Leader 后续通过结构化分派选择成员。
12. Worker 对 Squad 工作的交付、失败或阻塞：在去重后重新触发 Leader 评估；Leader 自己的分派不自触发。
13. Automation 指向 Squad：只触发 Leader，由 Leader 读取触发证据并决定行动。

## Agent-to-Agent 授权与安全

普通 Mention/Reply、正式 Assignment、责任 Handoff 和持续 Interaction 是不同语义。Control 对它们使用不同的唤醒强度、上下文和审计记录，不把所有 Agent-to-Agent 交流都压缩成 Handoff。

每次连续互动都关联一个 Interaction Run 并继承用户授权。Control 必须检查参与者和工具权限，累计时间/轮数/Token/并发预算，识别重复且无进展的往返，并支持用户随时暂停或停止。`loop_detected` 只适用于失控或越界调用；仅仅因为两个 Agent 连续多轮发言，不得判定为循环。具体进度与停止原因记录在 `InteractionRun`。

## Draft Freshness

Agent 在 `base_version=N` 上开始工作。最终答案准备提交时：

- 当前版本仍是 N：直接提交。
- 当前版本大于 N：进入 `held_for_refresh`。
- Control 将新增消息作为 Steering 或 Follow-up 送入原 Session。
- Agent 修订后基于新版本提交，或结构化决定原稿仍有效/保持沉默。

生成过程中的 Thinking、工具和文字可以作为临时流实时显示，但只有通过新鲜度检查的最终 Message 成为权威历史。

## Runtime 归属、Session 生命周期和恢复

Native Session 首期固定绑定创建它的 Runtime：

- Runtime 在线：热 Session 直接复用。
- Host 冷却淘汰：从本地 Session 文件恢复。
- Runtime 离线：历史可读，发送被阻止或排队。
- Runtime 重连：按 Binding 恢复并向 Control 报告实际状态，浏览器在加载、重连和重新获得焦点时对账。
- 不静默迁移到另一 Runtime，避免 cwd、凭据和文件状态不一致。

Channel/Conversation、公开消息和 Agent Native Session 是不同生命周期。删除 Channel、停止 Run、关闭内存中的 Session 与删除 Session 文件不能互相冒充：

```text
abort run          保留 Channel、消息、Binding 和 Native Session
close hot session  仅释放进程内对象，Binding 可从原文件恢复
replace session    保留 Channel 和消息，归档旧 Session，generation + 1
archive channel    停止相关 Run 并关闭 Session，按保留策略保存历史
delete session     显式危险操作，产生审计记录和 Tombstone
```

单 Agent 卡住时，用户应在 Channel 内针对该 Agent 执行 Abort、重试、跳过或 Replace Session，而不是删除整个 Channel。替换流程先限时 Abort/Dispose，保留旧 JSONL，创建新 Native Session，原子更新 `native_session_id` 与 `native_session_generation`，再广播 `session_replaced`。旧 generation 的迟到事件必须丢弃，防止污染新 Session。

状态查询至少返回 `agent_id`、`native_session_id`、`generation`、`state`、`run_id`、`last_event_at` 和错误。浏览器不能只依赖当前 WebSocket 是否收过终止事件来判断 Running；刷新、断线恢复和 Abort 超时后都要向 Control/Runtime 对账。

## 安全边界

生产前必须完成：

- Runtime 一次性配对和可轮换凭据；
- WSS；
- Workspace 级授权；
- cwd allowlist 和规范化路径检查；
- Agent Event 离开 Runtime 前脱敏，Control 再脱敏；
- 每 Agent/Runtime 并发，以及每 Interaction、Goal/Automation 的时间、轮数和 Token 预算；
- Squad Leader、成员分派、Goal 完成策略和高影响动作审批权限；
- Agent-to-Agent Mention、Assignment、Handoff 和 Interaction 权限；
- Docker 凭据和 Volume 隔离；
- 审计日志和删除 Tombstone。

## 当前 MVP 与目标差距

当前已有：

- Go 同源 Gateway；
- 本地 SQLite WAL 持久化 Channel、Agent 绑定、用户消息、Run 和事件；
- Runtime Event 携带进程实例 ID 与单调 source sequence；Control 使用 `(runtime_id, instance_id, runtime_seq)` 持久化去重并在落库后 ACK；
- 浏览器实时 fan-out 不等待数据库，浏览器按 Runtime cursor 幂等合并；同一 Runtime 进程在 Control/WebSocket 中断后重放未 ACK 事件；
- Host/Docker 两个 Runtime；
- Runtime 出站连接；
- 两个 Agent 注册；
- 独立 Pi SDK Host；
- Conversation 中单/多 Agent流式运行；
- pi-web 消息组件复用。

当前缺少：

- PostgreSQL 多实例控制平面（当前 SQLite 仅面向单节点）；
- 完整的 Thread 权威模型；
- durable Agent CRUD；
- Runtime 进程崩溃后的磁盘 outbox/replay（当前 replay 只覆盖 Runtime 进程存活时的 Control/WebSocket 中断）；
- Inbox/Mention/Assignment/Handoff；
- Agent 主动发言与统一 Participant 路由；
- Multi-Agent Interaction 及角色扮演、表演、辩论等持续调度；
- 共享 Conversation 增量上下文和按事件唤醒；
- Draft Freshness；
- Work Item；
- Goal、Plan 和完成策略；
- Squad、Leader Operating Protocol、Leader Decision 与事件驱动的分派/验收；
- Cron/Webhook/外部事件 Automation；
- Skills/插件驱动的 Context Acquisition 策略与来源追踪；
- Codex/ACP；
- 生产鉴权和隔离。
