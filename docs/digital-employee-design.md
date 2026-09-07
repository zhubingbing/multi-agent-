# 数字员工产品与领域设计

> 状态：设计基线。本文把 UI 中的“AI 分身”统一定义为“数字员工”，借鉴 Multica 的 Agent 配置、Runtime、Skill、权限和活动信息架构，但复用本项目已有 Control / Runtime / Pi Session / Conversation 权威链路。

## 1. 定义

**数字员工（Digital Employee）是持久身份，不是模型、Session、聊天机器人或一次 Run。**

一个数字员工应长期拥有：

- 身份：名称、头像、Handle、简介；
- 归属：Owner、可管理成员、所属 Workspace；
- 人设：Instructions、职责、工作方式和边界；
- 工位：绑定的 Runtime，以及 Runtime 在线/离线和版本；
- 能力：获配 Skills、可用 Tools/MCP、可用模型范围；
- 权限：可访问 Workspace、目录、工具、Secret 和其他数字员工的范围；
- 工作状态：available、working、waiting、offline、disabled；
- 工作记录：参与的任务、Conversation、Run、Usage、失败和审计；
- 通信身份：可以私聊、加入群聊、被 @、Reply，也能在策略允许时联系其他数字员工。

以下概念必须分开：

| 概念 | 含义 |
| --- | --- |
| 数字员工 | 稳定身份、职责、能力和权限主体 |
| Runtime | 数字员工执行工作的设备/进程，即“工位” |
| Model | Runtime 提供的推理能力；每个 Conversation 可选不同模型 |
| Session | `(conversation_id, employee_id)` 的具体模型会话 |
| Conversation | 人与数字员工通信的权威消息空间 |
| Task | 有目标、状态和交付物的工作，可关联 Conversation |
| Run | 数字员工在一次触发下的具体执行 |
| Skill | 可分配、可启停、带来源和版本的专业工作法 |
| Tool | Runtime 实际提供且受策略约束的执行能力 |

## 2. 数字员工详情信息架构

详情页按以下层次呈现：

### 顶部身份与实时状态

- 头像、名称、Handle、简介；
- Presence 与当前活动；
- Owner；
- “发消息”“分配任务”“更多”操作；
- 正在执行时可查看当前任务和 Run。

### 概览

- 人设与职责摘要；
- 所属 Workspace 和权限范围；
- Runtime 名称、ID、在线状态、版本、平台；
- 最近任务、成功率、最近活动；
- 当前排队 Inbox 和需要处理事项。

### 配置 Tab

1. **常规**：身份、Owner、可见性、并发上限；
2. **人设**：Instructions、行为边界、回复风格；
3. **工作空间**：所属 Workspace、默认 cwd、每个 Workspace 的角色；
4. **Skills**：已分配 Skill、Runtime 本地 Skill、启停和版本；
5. **Tools / MCP**：工具清单、风险等级、审批策略和来源；
6. **Runtime**：绑定设备、能力、健康、迁移和离线策略；
7. **模型**：只显示该 Runtime 可用模型和默认回退；具体对话独立选模型；
8. **权限**：private/workspace/members、允许调用者和 Secret 范围；
9. **活动与用量**：任务、Run、Token、失败、审计。

## 3. 状态模型

```text
offline   Runtime 不在线
disabled  数字员工被停用
available 在线且无工作
working   至少一个 Run 正在执行
waiting   有排队消息、任务、审批或离线等待
```

Presence 是派生状态，不允许仅由前端按钮伪造。详情页同时显示原因，例如“正在执行任务 X”“等待审批”“Runtime 30 秒未心跳”。

数字员工可以配置 `max_concurrent_runs`。不同 Conversation 的 Session 相互隔离，但共享 Runtime、目录和外部配额；同 cwd 并发写文件必须通过 Worktree/沙箱或冲突策略治理。

## 4. Workspace 与归属

需要正式数据关系：

```text
employees
  owner_type(member|workspace|system)
  owner_id

employee_workspace_memberships
  employee_id
  workspace_id
  role
  default_cwd
  enabled

employee_access_principals
  employee_id
  principal_type(member|employee|squad)
  principal_id
  capability
```

Owner 表示谁能修改、迁移、停用或删除数字员工；Workspace Membership 表示它在哪里工作；Access Principal 表示谁能私聊、分配或触发它。三者不能混成一个字段。

当前单用户 MVP 显示 `local-user` 与“默认工作空间”，但在正式表建立前必须明确标注为单用户模式，不伪装成完整组织权限。

## 5. Skill、Tool 与 Runtime

- Skill 是 Control 中可分配的领域对象，记录来源、版本和启用状态；
- Runtime 启动时上报本地 Skills、Tools、MCP、模型和平台能力；
- 数字员工的有效能力是“分配策略 ∩ Runtime 实际能力 ∩ Workspace 权限”；
- UI 必须区分“已分配但 Runtime 缺失”“Runtime 已发现但未授权”“已启用”；
- Run 保存能力快照，历史审计不随之后配置变化。

## 6. 消息、私聊和群聊

消息系统统一使用 Conversation，不为数字员工另造聊天协议：

```text
Conversation
  kind: direct | group | task | automation

ConversationParticipant
  participant_type: member | employee
  participant_id
  role: owner | member | observer
```

### 私聊

成员从通讯录选择数字员工 A，创建/复用 direct Conversation。每个数字员工在该 Conversation 中有独立 Binding 与 Session，可持续对话。

### 群聊

群成员可以混合：

- 人类成员；
- 数字员工 A/B/C；
- 后续外部联系人。

`@数字员工`、Reply、Assignment 和明确的编排策略才触发执行。未被触发的数字员工只读取其权限范围内的权威消息，不应全部自动抢答。

### 数字员工互相沟通

现有 Agent Message → Mention → durable `employee_inbox` → 唤醒目标员工链路可作为基础，但必须保留：

- 来源 Message 和 Reply 关系；
- 去重键；
- 最大 auto-hop；
- Token/时间/次数预算；
- 禁止自唤醒；
- 循环检测；
- 忙碌、离线和排队策略；
- 所有消息可审计。

“数字员工讲相声/辩论/研讨”不是无限互相唤醒，而是显式 Interaction：参与者、主持人、轮次、结束条件和预算都必须先定义。推进任务则由 Task/Goal/Leader 决定何时继续、验收、返工和结束。

## 7. 与当前实现的映射

已有基础：

- Agent Desired Config 与 Runtime Observed State；
- Runtime 心跳和 Presence；
- Conversation roster；
- 每 `(conversation, agent)` 独立 Pi Session；
- Member/Agent 权威 Message、Mention、Reply；
- `employee_inbox` 与 Agent-to-Agent 自动唤醒；
- Sequential/Parallel 多员工执行；
- Automation 创建任务并派发数字员工；
- Runtime 模型目录和对话级模型切换。

仍缺：

- 数字员工 CRUD 与头像；
- Owner、Workspace Membership 和细粒度 Access；
- Runtime Skill/Tool/MCP Inventory；
- Skill 分配和有效能力计算；
- Direct/Group Conversation 正式数据模型与通讯录；
- 群成员管理、未读、通知和全局 Presence；
- Interaction/Goal/Leader 预算化编排；
- 跨任务 cwd 隔离和并发治理。

## 8. 实施顺序

1. 统一“数字员工”文案，建立详情页真实概览；
2. 完成 Employee CRUD、Owner、Workspace Membership；
3. Runtime 上报 Skills/Tools/MCP，并展示有效能力；
4. 建通讯录与 Direct Conversation；
5. 建 Group Conversation 和成员管理；
6. 复用 Mention/Inbox 完成数字员工间通信；
7. 增加 Interaction Policy，支持有限轮次研讨、辩论和表演；
8. 接 Goal/Squad/Leader，让多数字员工协作有计划、验收和结束条件。

## 9. 产品约束

- 数字员工不是一个固定模型；同一员工在不同 Conversation 可以使用不同模型；
- Runtime 不是员工身份；设备离线时身份、历史和 Inbox 仍存在；
- 群聊不是所有员工自动执行；触发和预算必须明确；
- 人设不能替代权限，Instructions 不能扩大工具或数据访问；
- 删除默认归档，历史 Message/Run/Task 保留可追溯性；
- 未接入的 Owner、Skill、Tool 或 Workspace 数据必须显示“尚未接入/未知”，不能使用静态假数据。
