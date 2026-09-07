# Multi Agent 实施状态

本文跟踪 [`product-plan.md`](product-plan.md) 的实际工程进度。产品方向与不变量仍以产品计划、架构和 ADR 为准；这里记录当前证据、缺口和下一步。

## 当前阶段

**产品文案已统一采用“数字员工”；代码、协议和数据库中继续使用稳定的 `agent` 技术名。数字员工的 Owner/Workspace/Runtime/Skills/Tools、私聊/群聊与有界员工间协作定义见 [`digital-employee-design.md`](digital-employee-design.md)。**

**当前优先后端基础：权威数据模型、数字员工调度、恢复与安全边界；前端只保持可通信、可工作和必要控制。Phase 0 在线链路已收口，Phase 1/2 后端能力持续推进。**

最终产品入口是 pi-web 正式页面中的统一 Conversation，不是 `/group`。`/group` 继续作为 Control/Runtime/多 Agent 协议诊断页，直到正式 Conversation 数据源接入 pi-web 主页面。

## 已验证

- [x] pi-web v0.8.11 基线与原版 `/`
- [x] `/group` 实验页
- [x] Go Control Server 与同源 Web Gateway
- [x] Host Runtime 和 Docker Runtime 出站连接
- [x] 每个 `(conversation, agent)` 独立、持续的 Pi AgentSession
- [x] 单 Agent和多 Agent Prompt
- [x] Pi Event 实时转发到浏览器
- [x] Steering、Follow-up 和 Abort 基础链路
- [x] SQLite WAL 保存 Channel、Turn、Run 和 Event
- [x] Channel 创建、切换、删除和参与 Agent 选择原型
- [x] TypeScript、ESLint、Go race test 和 Go vet 基线通过

## Milestone A：协议正确性与实验页收口

- [x] Pi Host 在事件产生时绑定不可变 `runId`
- [x] 迟到的旧 Run 终止事件不能清除新 Run
- [x] 活跃 Run 未结束时拒绝同 Session 的新 Prompt
- [x] Control 仅在终止事件匹配当前 Run 时清理活跃路由
- [x] Group 使用 pi-web `toClientAgentEvent()` 投影原始 SDK 事件
- [x] Group 历史加载保留数据库返回的真实 Run 状态
- [x] Host/Docker Runtime 使用新协议重建并上线
- [x] 真实 Prompt 验证：12 个事件全部归属同一 Run，最终状态为 `settled`
- [x] Runtime 注册时上报仍在执行的 Run，Control 恢复活跃路由
- [x] Runtime 重连时把未上报的遗留 `running` Run 标记为明确失败
- [x] 运行中重启 Control 的真实验证：Run 重连后继续并最终 `settled`
- [x] Runtime process instance ID 与单调递增 Event source sequence
- [x] Control 使用 `(runtime_id, instance_id, runtime_seq)` 持久化去重
- [x] Control 仅在事件持久化后 ACK；同一 Runtime 进程保留未 ACK 事件并在重连后 replay
- [x] 浏览器 WebSocket 自动重连，并在重连后与持久化历史合并
- [x] 重连合并保留更晚的本地流式消息和尚未持久化的乐观 Turn
- [x] 历史接口返回每个 Runtime instance 的持久化 cursor，浏览器按 sequence 幂等处理
- [x] 已有幽灵 `running` Run 已经重连对账并消除
- [x] 真实断线 replay 验证：Control 停机期间缓存 16 个事件，重连后 sequence 全部唯一并最终 `settled`
- [x] 双 Agent并行真实回归：Host/Docker 各自事件归属正确并 `settled`
- [x] 同一 Host AgentSession 连续两轮真实回归：两条 Run 均独立 `settled`
- [x] 工具执行中的 Abort 真实回归：收到终止链路与 `agent_settled`
- [ ] Production `next build` 完整验收（当前主机在 Next build worker/trace 阶段被 SIGKILL；编译与独立 TypeScript 检查已通过）
- [ ] Runtime 进程崩溃后的磁盘 outbox（转入 Milestone C）
- [ ] 同模型、同 cwd、同 Prompt 的 pi-web 体验与延迟基准

## Milestone B：迁移到 pi-web 正式 Conversation

- [x] 定义统一 `ConversationAdapter` / Conversation Event / Snapshot / Command 模型
- [x] 新增 Go Control `ControlConversationAdapter`，封装历史、Agent 列表、重连和命令传输
- [x] `/group` 已改用 Adapter，不再直接拥有 fetch/WebSocket 传输实现
- [ ] 将现有本地 Pi Session 接口适配到统一边界
- [x] 抽取并复用 `ChatWindow` 的最终答案、Process Details 分组逻辑与折叠组件
- [x] 在正式 pi-web 导航加入 `/conversations` 工作区，与原生 Pi Sessions 并列
- [x] `/group` 降级并标记为兼容诊断入口
- [x] 抽取可复用 `ConversationAgentRunView`，`GroupChat` 不再拥有 Agent 消息展示实现
- [x] 抽取 `ConversationTimeline`，复用 pi-web lazy-load、滚动尾随和加载更早消息策略
- [x] 接入 pi-web `ChatMinimap`，支持一个 Turn 中多个 Agent 最终答案预览与定位
- [x] Minimap 对隐藏历史调用 reveal-all 后再完成目标导航；运行中和仅 Process 的 Run 不伪造答案节点
- [x] 正式 Conversation 支持 `?conversation=` 深链接、刷新恢复和浏览器前进/后退
- [x] Channel 创建、切换、重命名和删除；重命名保持 Conversation ID、深链接和 Session
- [x] 移动端隐藏侧栏时仍可切换和新建 Channel
- [x] 在正式 Conversation 工作区加入 Thread 创建、嵌套导航、深链接、删除和移动端选择
- [x] 支持从 Channel 用户 Turn 发起 Thread；后端校验 root Turn 属于该 Channel，禁止跨 Conversation 关联
- [x] Rooted Thread 首轮 Prompt 注入根消息上下文，公开历史仍只保存用户原文；后续轮次依赖持续 Native Session，不重复注入
- [x] Thread 顶部展示根消息卡片，并可跳回父 Channel 的精确 Turn 锚点（自动展开隐藏历史）
- [x] Channel 与 Thread 历史严格隔离；每个 Thread 使用独立 `(thread, agent)` Native Session
- [x] 真实 Thread Prompt 验证：Thread Run `settled`，Thread 1 Turn，父 Channel 0 Turn
- [x] Runtime heartbeat 每 10 秒刷新 last seen；30 秒无心跳进入 stale、断开旧连接并将员工置 offline
- [x] 真实 heartbeat 验证：暂停 Docker → stale/offline；恢复 → 自动重连 online/available
- [x] Replace 完成后 Runtime 立即回报无 Run `session_state`，Control 将 Binding `replacing → ready` 并广播 `binding_updated`
- [x] 真实即时 Replace 验证：无需下一 Prompt，Session ID 立即改变、generation=2、state=ready
- [x] Conversation-Agent Binding 持久化与查询：Native Session ID、generation、state、effective provider/model/thinking/cwd、last active
- [x] Replace Session：运行中拒绝；保留 Conversation/Message；generation+1；删除旧恢复元数据并创建全新 Native Session
- [x] 真实 Replace 验证：Native Session ID 改变、generation 1→2、替换前后 4 条权威消息保留
- [x] Runtime Node durable inventory：instance、Runtime/Node/Pi 版本、OS/arch、capabilities、online/offline、last seen
- [x] Agent desired config 与 Runtime actual registration 分离：名称/handle/description/instructions/provider/model/thinking/cwd/config version
- [x] Runtime 注册只更新实际状态，不覆盖用户配置；Agent PATCH API 与正式页面配置入口
- [x] 新 Native Session 按 desired provider/model/thinking/cwd 明确打开，不再依赖 Pi 默认模型回落
- [x] 正式页面展示 Binding 详情并提供 Replace 按钮；Agent 运行中或 Runtime 离线时禁用
- [x] Provider 403 已修复并真实验证：`custom-openai/gpt-5.6-sol`、`stopReason=stop`、正文 `PROVIDER_OK`
- [x] 已打开 Session 的配置变更通过 Replace Session/generation 生效
- [x] Agent 最终 Message 默认 Reply 触发它的 Member Message；用户可直接 Reply Agent 最终答案
- [x] Member/Agent Message 中 `@agent-id`、`@name`、`@handle` 事务性解析为权威 Mention 元数据，并校验 Channel roster
- [x] Agent Mention 事务性写入 durable `employee_inbox`；目标数字员工空闲时自动创建 Reply Run
- [x] 普通员工沟通无需 Interaction：Docker → Host → Docker 已真实自动完成，用户不再搬运消息
- [x] 自动回复 Message 精确 Reply 来源 Agent Message，而不是统一 Reply 根用户 Turn
- [x] 轻量安全边界：同一来源消息/接收员工唯一、禁止自唤醒、同一根 Turn 最多 4 个 auto-hop
- [x] 数字员工忙碌时 Inbox 保持 `queued`（reason=waiting），当前 Run 结束后自动领取最早待办，不再永久 suppressed
- [x] Presence 查询：`available / working / waiting / offline`，并返回 `inboxUnread`；前端仅做基础展示
- [x] Conversation Message 单调 `version` 与权威 `currentVersion`
- [x] Member/Agent durable read cursor，只能单调前进且不能越过当前 Conversation version
- [x] Inbox 消费时自动推进数字员工 read cursor 到来源 Message version；网页读取快照后推进 Member cursor
- [x] Inbox 唤醒 Prompt 注入 `(last_seen_version,current trigger version]` 的权威 Conversation 增量，而非只注入单条来源消息
- [x] 增量上限：最近 50 条权威 Message、最大 64 KiB，并显式标记 truncation
- [x] 真实版本验证：Member v1、Agent v2、currentVersion=2、Member cursor=2
- [x] Inbox 查询 API 可审计 queued/consumed/suppressed/reason
- [ ] Workspace 日常 Token/Cooldown 配额和 queued Inbox 的延迟重试
- [x] 多 Agent 执行模式明确区分 `Sequential shared context` 与 `Parallel independent`
- [x] Sequential 模式按 Mention 文本顺序运行；后续 Agent Prompt 自动注入原始请求和已完成 Agent 权威结果
- [x] 真实顺序协作验证：Docker 先检查容器，Host 自动获得 Docker 完整结果并完成宿主机复核，不再要求用户复制输出
- [ ] 特殊连续 Interaction（表演/辩论/限时活动）的 turn policy、时间/Token 预算；普通员工 Mention 沟通已经可用
- [x] 用户 Turn 持久化权威作者 `author_type/author_id` 与同 Conversation Reply 关系
- [x] 正式时间线支持选择 Reply、输入区预览/取消，并展示被回复消息摘要
- [x] Agent `agent_settled` 时事务性提交权威 Conversation Message；Thinking/工具过程只保留为 Run Event
- [x] 权威消息 API `GET /api/multi-agent/conversations/:id/messages` 返回 Member/Agent 作者、Run、Reply 与内容
- [x] Agent 最终消息按 Run 幂等；tool-use 前导文字不提交，Provider terminal error 作为公开终止消息
- [x] 前端 Adapter 并行读取 `/turns` 与权威 `/messages`：正文、作者、Reply、Agent Final 以 Message 流为准，Run Event 只补 Process Details
- [x] Control 在权威事务完成后发送 `conversation_committed`，前端再对账，避免 `agent_settled` 早于持久化的竞态
- [x] 真实权威对账验证：Member Message + Agent Message 共 2 条，Agent Message ID/Run ID 与 Turn `finalMessageId` 一致
- [x] 在同一时间线呈现不同 Agent 作者、Runtime 和独立 Run 状态
- [x] 将 Steer、Follow-up、Abort 精确路由到单个 Agent，并保留批量控制
- [x] 保持 Markdown、Thinking、工具、Usage、文件写入提示和流式体验
- [x] 模型详情恢复 pi-web 的真实“测试”按钮：以当前未保存的 Provider/Model 表单创建隔离 ModelRuntime，发出最小请求并显示延迟、响应或兼容性错误；真实验证 `model-test-ok=true`
- [x] Workbench Chat 输入区支持独立点击模型，按当前 Agent 所在 Runtime 发现真实可用模型，支持搜索、Provider 筛选和能力/上下文展示；Chat 内切换通过带模型覆盖参数的 Binding Replace 仅替换当前 Conversation，不修改 Agent 默认模型或其他任务 Session；Agent 页面只展示该数字员工所在 Runtime 的可用模型
- [x] Chat 模型选择器按 `chat-模型切换.png` 改为输入框上方紧凑浮层，并提供“配置自定义模型”入口
- [x] 按 `模型.png` / `模型2.png` 迁移 Runtime 模型配置面板：Provider/Model 树、Base URL、API 协议、API Key、模型能力与 token 规格
- [x] 按 `模型3.png` 接通设置 → 模型配置总览和“我的模型服务”，Agent 详情也提供明确的添加/切换模型入口
- [x] 模型配置通过 Control → Runtime → Pi Host 写入对应设备的 `~/.pi/agent/models.json` 并刷新 ModelRuntime；API Key 返回浏览器前脱敏，空值保存保留既有密钥
- [x] Provider 配置支持根据 Base URL、API 协议和已有/新 API Key 调用 `/models` 发现 Model ID，结果进入“模型详情表单”的可用模型下拉框，由用户选择后自动填充 ID/Name，不在 Chat 中承担模型导入；真实自定义端点验证发现 55 个模型
- [x] 模型详情支持覆盖 Provider API 协议，解决同一 OpenAI-compatible 网关中 Responses 与 Chat Completions 模型兼容性不同的问题；Assistant terminal error 在 Chat 中显示为失败和真实 Provider 错误，不再显示空白“已完成”
- [x] Workbench Chat 的 Agent 按钮与模型按钮职责分离；Agent 按钮打开分身设置，模型按钮只打开模型目录
- [x] Chat 输入历史迁移：保存最近 50 条去重输入，支持上下方向键召回
- [x] Run 的 Steer/Follow-up 从浏览器原生 `prompt` 迁移为当前时间线内的控制输入框
- [ ] 图片/文件附件、Slash Command、Compaction、Minimap、文件跳转与 Tool Preset/授权策略完整迁移

## 后续里程碑

1. **Milestone C：可靠持久化与恢复** — snapshot/replay、Binding、Native Session ID/generation、Control/Runtime 重启恢复、幂等提交，再迁移 PostgreSQL。
2. **Milestone D：Agent/Runtime 管理** — 配对、心跳、CRUD、模型、Thinking、Skills、cwd allowlist 和权限。
3. **Milestone E：Participant/Inbox/Interaction** — Mention、Reply、Assignment、Handoff、共享增量、连续互动和预算。
4. **Milestone F：Goal/Squad/Leader** — Goal、Plan、Work Item、Leader Decision、分派、验收、返工和完成策略。
5. **Milestone G：Automation/Codex/ACP** — 定时与外部触发、Context Acquisition 治理及其他 Provider Adapter。

## 当前下一步

Milestone A 的在线协议与端到端主路径已经收口；磁盘 outbox 和正式性能基准作为 Milestone C/持续质量工作。现在开始 Milestone B，先定义并接入统一 Conversation Adapter，再迁移正式 AppShell/ChatWindow。不得继续把 `/group` 扩展成第二套 `ChatWindow`。
