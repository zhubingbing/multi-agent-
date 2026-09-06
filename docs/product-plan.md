# Multi Agent 产品计划

## 产品愿景

构建一个以 Conversation 为协作界面、以 Goal 为工作主线的人机协作空间：人类和多个 Agent 在 Channel、Thread 和私聊中实时交流，Agent 像团队成员一样拥有身份、职责、Inbox、Runtime 和持续会话；用户可以把目标交给单个 Agent 或由 Leader Agent 带领的 Squad，Leader 负责规划、分派、驱动、验收和交付。

产品体验组合：

- **pi-web**：持续 AgentSession、低延迟流式输出、Thinking、工具详情、Markdown、Usage、分支、Steering、Follow-up 和 Abort。
- **Raft**：Channel、Thread、DM、人和 Agent 共处、Agent Inbox、自主关注、Agent-to-Agent 协作、房间版本与草稿新鲜度。
- **Multica**：Workspace、Agent/Squad 配置、Leader 驱动、分布式 Runtime、权限、工作分配、审计、通知和自动化。

## 核心原则

1. **一个协作界面：Conversation。** 单 Agent 私聊和多 Agent 群聊只是参与者不同，不建立两套聊天系统；Goal、Plan 和 Work Item 的进展也通过绑定的 Conversation 可见。
2. **目标由负责人持续推进。** 用户可以把 Goal 交给单个 Agent，也可以交给由 Leader Agent 带领的 Squad。分配给 Squad 时只先唤醒 Leader；Leader 负责澄清目标、形成可见计划、选择成员、分派工作、检查交付、处理返工和向用户汇报。
3. **Leader 是事件驱动的协调者。** Leader 分派后停止运行，由成员交付、失败、阻塞、Review、定时器或外部事件重新唤醒；不通过常驻模型调用或轮询维持“持续管理”。
4. **每个 Agent 独立会话。** 同一 Conversation 中，每个 Agent 都有独立的 Pi AgentSession、Codex Thread 或 ACP Session。
5. **实时显示不等待数据库。** Agent Event 通过 Runtime WebSocket 和浏览器 WebSocket 直通；Control 对浏览器先 fan-out，再持久化、去重和 ACK，客户端用 Runtime cursor 消除重放重复。
6. **Agent 是独立的数字成员，不是模型按钮。** Agent 与 Member 都是一等 Participant；Agent 有名称、角色、运行环境、权限、Inbox、持续身份和独立会话，可以阅读获权上下文、主动发言、Mention、Reply、参与 Thread，并在用户授权的互动中与其他 Agent 连续交流。
7. **Context Acquisition 是 Agent 能力。** Agent 通过 Instructions、Skills、插件和获权工具从知识库、项目文档、文件、数据库、网络或外部服务获取上下文。平台负责权限、执行记录和必要的来源可追踪性，但不把特定知识库或业务数据源固化为核心模型。
8. **默认安静，明确路由。** Mention、回复、分配、Leader 调度、互动调度和订阅产生不同强度的信号；普通频道消息不启动所有 Agent。
9. **连续互动必须有用户授权且有界。** Agent-to-Agent 对话是正常能力，不局限于任务交接；相声、角色扮演、辩论、头脑风暴和工作协作均可持续多轮。每次 Interaction 都声明参与者、目标或主题、发言策略及时间/轮数/Token 等停止条件，用户可以随时暂停、调整或终止。
10. **最终消息要检查新鲜度。** Agent 基于 room version N 生成结果，提交前发现房间已更新时，必须修订、明确按原稿发送或保持沉默。
11. **不降低 pi-web 基线。** 新增控制能力不能破坏 Markdown、工具展示、流式平滑度、Session 连续性和中途控制。

## 用户概念

### Workspace

团队、成员、Channel、Agent 和 Runtime 的权限边界。

### Goal

用户希望达成的持久目标，包含结果描述、成功标准、约束、非目标、负责人、完成策略和当前状态。Goal 可以绑定一个 Agent 或一个 Squad，并通过 Plan 和 Work Item 推进；Conversation 保存围绕它发生的协作记录。

### Squad

由一个 Leader Agent 和若干 Agent/Member 组成的稳定团队。成员有角色描述，Squad 有工作方式和路由规则。工作分配给 Squad 时只先唤醒 Leader，而不是并行启动所有成员。

### Plan

Leader 为 Goal 形成的可见、可版本化执行计划。Plan 由相互依赖的 Work Item 组成；修订计划时保留原因和历史，避免只把关键规划留在 Agent 的私有 Session 中。

### Channel

长期多人协作空间，例如 `#engineering`、`#product`。Agent 可以作为 Channel 成员。

### Conversation

消息容器。形态包括 Channel 顶层、Thread 和 DM。产品层统一处理消息、参与者和运行状态。

### Thread

围绕一条顶层消息的聚焦讨论。工程场景推荐“一项变更一个 Thread”。

### Agent

独立的数字成员，而不是一次模型调用。配置包含身份、指令、Provider、模型、Thinking、Skills、Runtime、工作目录和权限；运行时拥有持续身份、独立 Native Session、Inbox、已读游标和参与状态。Agent 可以在权限与用户授权范围内主动发言、回复、Mention 其他 Member/Agent，或选择保持沉默。

### Interaction

由用户或获权参与者发起的多 Agent 连续互动。它统一承载任务协作、角色扮演、相声/表演、辩论、模拟面试、圆桌讨论和头脑风暴，并记录参与者角色、共享主题、发言策略、进度、预算和停止条件。

### Runtime

Agent 实际执行的位置，可以是宿主机、远程机器或 Docker。Runtime 主动连接中心服务，不开放入站 Agent 端口。

### Work Item

Goal 或讨论中产生的正式工作，包含负责人、状态、优先级、依赖、验收条件、Review 和执行记录。Worker 交付后由 Leader 或指定 Reviewer 验收；未通过可返工、重新分派或触发 Replan。Work Item 完成不自动等于整个 Goal 完成。

### Context Acquisition

Agent 在执行中获取所需上下文的通用阶段。具体来源可以是 Workspace 知识库、项目文档、文件系统、数据库、网络搜索或外部服务，由 Agent 的 Skills、插件、Runtime 和访问权限决定。它不是一种固定知识库，也不要求必须存在专用“检索 Agent”。

### Inbox

成员和 Agent 的待处理信号：Mention、Thread 更新、Assignment、Review Request 和订阅事件。

## 关键用户流程

### 目标驱动的 Squad 协作

1. 用户创建 Goal，说明期望结果、成功标准、约束、非目标和完成策略，并选择一个 Squad。
2. Control 只唤醒 Squad Leader。Leader 判断信息是否足够；必要时向用户提出最少且关键的澄清问题。
3. Leader 创建可见 Plan，将目标拆成有负责人、依赖和验收条件的 Work Item，并记录本轮决策理由。
4. Leader 通过 Assignment/Mention 把下一步交给合适成员，然后停止，不在后台持续轮询。
5. Worker 使用自己的 Skills 和插件进行 Context Acquisition 和执行，提交结果、证据、变更或阻塞说明。
6. Worker 的交付、失败、阻塞、Review 结果或相关外部事件重新唤醒 Leader。
7. Leader 对照验收条件决定接受、要求返工、改派、补充 Review、修订 Plan、升级给用户或继续下一阶段。
8. 所有 Work Item 满足整体成功标准后，Leader 提交 Goal 交付。低风险目标可按策略由 Leader 完成；高影响目标进入人类或指定 Reviewer 的最终审批。

Leader 默认只协调而不替 Worker 实现，避免协调上下文被具体执行耗尽；但 Squad Instructions 可允许小型目标由 Leader 直接完成。

### 单 Agent 对话

1. 新建 Conversation。
2. 选择一个 Agent。
3. 像 pi-web 一样持续多轮聊天。
4. 运行中可 Steering、Follow-up、Abort。
5. Conversation 可重命名、归档、分支和删除。

### 多 Agent 群聊

1. 创建 Channel 或 Thread。
2. 添加一个或多个 Agent。
3. 通过选择器、Mention 或回复指定目标。
4. 多 Agent 各自在独立原生 Session 中执行，结果显示在同一时间线。
5. 用户可对单个 Agent 或全部 Agent 进行 Steering、Follow-up 和 Abort。

### Agent-to-Agent 交流与互动

普通交流不要求伪装成任务交接，三类语义必须区分：

- **Mention / Reply**：和另一位参与者说话或邀请其接话；
- **Assignment**：请求对方负责有交付物的工作；
- **Handoff**：转交当前责任、上下文或处理权。

离散交流流程：

1. Member 或 Agent 发布带 Mention/Reply 的权威 Message。
2. Control 为目标 Agent 创建 Inbox 信号并检查权限、订阅策略和协作边界。
3. Agent 读取自己尚未看到的 Conversation 增量，自主决定回复、创建工作、继续 Mention 或保持沉默。
4. Agent 回复与 Member 消息进入同一条权威消息流，并可按相同规则唤醒其他 Agent。
5. 最终回复提交前检查 Conversation Version。

连续互动流程：

1. 用户创建 Interaction，选择 Agent、分配角色并声明主题。
2. 用户选择 `round_robin`、`mention_driven`、`moderated`、`free_form` 或 `scripted` 发言策略。
3. Control 每轮把共享 Conversation 增量和角色约束交给当前 Agent，而不是让各 Agent 只看到自己的输出。
4. Agent 发言成为权威 Message，调度器选择或唤醒下一位参与者。
5. 用户可随时 Steering、暂停、继续、跳过当前 Agent或停止全部。
6. 达到内容目标、截止时间、轮数、Token 预算或其他停止条件后结束。

例如“Host Pi 做逗哏、Docker Pi 做捧哏，表演约 5 分钟相声”属于正常的 `performance` Interaction，而不是异常循环。产品必须区分“内容朗读时长约 5 分钟”和“现实时间直播 5 分钟”：前者转换为篇幅/轮次目标并可快速完成，后者由服务端按时钟持续调度。

### 从讨论安排工作

1. 选择一条消息或 Thread，可选择创建新 Goal 或加入现有 Goal。
2. 创建 Work Item 并选择 Agent 或 Squad 负责人；选择 Squad 时只先唤醒 Leader。
3. Agent/Leader 使用当前 Conversation Binding 继续上下文。
4. 执行过程继续显示在原 Thread，Plan 和 Work Item 状态同步更新。
5. Worker 交付后由 Leader 或 Reviewer 验收；整个 Goal 按 completion policy 最终完成。

## 产品路线

### Phase 0：体验基线（已完成）

- 固定 pi-web v0.8.11。
- 保留原版 `/`。
- 建立 `/group` 实验页。
- Go Control Server。
- Host Runtime 和 Docker Runtime。
- 两个独立 Pi AgentSession。
- 原始 Pi Event 流式转发。

### Phase 1：Conversation Shell

- Channel 和 Thread 导航。
- 新建、切换和删除 Conversation。
- Conversation 参与者选择。
- 单 Agent与多 Agent发送。
- Mention 句法和目标预览。
- 每个 Agent 独立运行状态与控制。
- Channel 内按 Agent 管理 Native Session：停止、重连、查看信息和“保留 Channel/消息但新建 Session”。

### Phase 2：持久化和恢复

- PostgreSQL 保存 Workspace、Channel、Conversation、Message、Agent、Runtime、Binding 和 Run。
- 页面刷新恢复 Conversation。
- Control Server 重启恢复路由状态。
- Event seq/ack、断线重放和幂等提交。
- Runtime 离线时 Conversation 保持可读。
- 持久化 `native_session_id` 与 `native_session_generation`，刷新或重启后可对账；替换卡住的单 Agent Session 不删除 Channel。

### Phase 3：Agent 和 Runtime 管理

- Runtime 配对、心跳、能力注册和版本信息。
- Agent CRUD、归档、头像、指令、模型、Thinking、Skills、cwd 和 Runtime 绑定。
- cwd allowlist 和权限。
- Runtime/Agent 在线、忙碌和错误状态。

### Phase 4：Inbox 与多 Agent Interaction

- Agent Inbox，以及按事件按需唤醒的长期身份。
- Member 与 Agent 使用统一的 Message、Mention、Reply 和参与者协议。
- Mention、回复、订阅和职责相关信号。
- 明确区分普通 Mention、Assignment 与结构化 Handoff。
- Thread/Conversation 增量上下文和 `last_seen_version`。
- Multi-Agent Interaction：`task_collaboration`、`role_play`、`performance`、`debate`、`brainstorming` 和 `moderated_discussion`。
- `round_robin`、`mention_driven`、`moderated`、`free_form` 和 `scripted` 发言调度。
- 共享公开上下文、角色约束、暂停/继续/跳过/停止和单 Agent 失败恢复。
- Draft Freshness / Held Draft。
- 用户授权范围、时间/轮数/Token/并发预算和失控循环检测。

### Phase 5：Goal、Squad 与 Work Item

- Goal、成功标准、约束、非目标和完成策略。
- Squad、Leader、成员角色描述和 Squad Instructions。
- 工作分配给 Squad 时只先唤醒 Leader。
- 可见且可版本化的 Plan，以及 Work Item 父子关系和依赖。
- Leader Operating Protocol：澄清、规划、分派、停止等待、验收、返工、Replan、升级和交付。
- Worker 结果、失败、阻塞和 Review 事件重新唤醒 Leader。
- 结构化 Leader Decision 和决策理由。
- Agent 负责人、状态、验收条件、Review 和执行记录。
- 可配置的 `leader_can_complete`、`require_reviewer` 和 `require_human_approval` 完成策略。
- 工作执行绑定 Conversation Run，Inbox 通知和审计。

### Phase 6：Automation 与 Context Acquisition

- Cron、Interval、Webhook 和外部事件触发。
- Automation 可以指向 Agent 或 Squad；指向 Squad 时由 Leader 判断下一步。
- 触发去重、Cooldown、重试、超时、Lease、错过调度策略和预算。
- Agent 通过 Skills 和插件获取知识库、项目文档、文件、数据库、网络和外部服务上下文。
- 工具权限、调用审计、失败披露和必要的来源追踪。

### Phase 7：Codex 与 ACP

- 常驻 Codex app-server Adapter。
- ACP 通用 Adapter。
- Provider Capability 协商。
- 保持统一 Conversation UX。

## 非目标（早期阶段）

- 不在第一阶段实现完整企业权限矩阵。
- 不在第一阶段实现无授权、无目标或无停止条件的无限 Agent 自由调用；明确授权且有界的 Agent 连续聊天是目标能力。
- 不把 Leader 实现为永久运行、持续轮询或拥有无限预算的模型循环。
- 不要求每个 Goal 都建立 Squad；边界清晰的工作可以直接交给单个 Agent。
- 不把某一种知识库、搜索服务或领域数据源固化成核心产品模型。
- 不让多个 Agent 共享同一个底层 Provider Session。
- 不支持原生 Session 在 Runtime 间静默迁移。
- 不以数据库轮询替代实时事件通道。
- 不重写 pi-web 已成熟的消息和 Markdown 组件。

## 体验质量门槛

所有阶段都要与原版 pi-web 使用相同模型、Thinking、cwd、Skills 和 Prompt 对比。

- 平台热路径额外延迟：p95 小于 150ms（不含 Provider 首 Token）。
- Agent Event 到浏览器显示：p95 小于 100ms。
- 流式文字无固定 500ms 分块等待。
- 第二轮复用同一原生 Session。
- Thinking、工具参数/结果、Usage、模型和时间完整。
- Steering、Follow-up 和 Abort 行为与 Provider 能力一致。
- 断线后不重复最终消息。
- 经用户授权的 Interaction 必须允许 Agent 连续互相接话，不能把正常角色扮演或表演误判为循环。
- Interaction 达到预算或停止条件后必须停止并给出明确原因。
- 分配给 Squad 的工作只先唤醒 Leader，不得默认启动全部成员。
- Leader 分派后必须停止；只有权威事件才能重新唤醒，重复事件不得产生重复分派。
- Leader 的 Plan、分派、验收、返工、升级和完成判断必须在公开状态或审计记录中可追踪。
- Goal 只有满足成功标准和完成策略后才能完成；单个 Worker Run 成功不得冒充 Goal 完成。
