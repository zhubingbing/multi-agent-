# ADR 0002：目标驱动的 Squad 与 Leader Agent

- 状态：Accepted
- 日期：2026-09-04
- 取代：[ADR 0001](0001-product-foundation.md) 中“第一版不引入 Thread”和以直接 Agent 分配为主的产品组织决策；ADR 0001 的 Runtime、Session 与实时链路基线继续有效。

## 背景

Conversation、Mention 和 Multi-Agent Interaction 可以让多个 Agent 交流，但不能单独承担一个长期目标的规划、分工、验收和持续驱动。如果用户必须在每次 Worker 交付后手工 Mention 下一个 Agent，协调本身仍由用户承担。

目标驱动的工作还可能由定时器、Webhook 或外部事件继续推进。让一个模型永久运行或持续轮询既浪费预算，也难以恢复和审计。知识库、网络查询、文件、数据库和第三方服务的差异，则应由 Agent Skills 和插件吸收，而不是变成 Control Plane 的领域模型。

## 决策

### 1. 引入 Goal

Goal 表示用户希望达成的持久结果，至少包含：

- 结果描述；
- 成功标准；
- 约束与非目标；
- 负责人（单 Agent 或 Squad）；
- 完成策略；
- 当前状态和 Plan 版本。

Conversation 是 Goal 的协作与事件表面，不替代 Goal 的权威状态。

### 2. 引入 Squad 和 Leader Agent

Squad 是由一个 Leader Agent 和若干 Agent/Member 组成的稳定团队。每个成员有供 Leader 选人的角色描述，Squad 有工作方式和路由规则。

Goal 或 Work Item 分配给 Squad 时，Control 只先唤醒 Leader，不并行启动所有成员。Leader 负责：

1. 澄清目标；
2. 创建或修订可见 Plan；
3. 将计划拆成带负责人、依赖和验收条件的 Work Item；
4. 选择成员并分派；
5. 检查 Worker 交付；
6. 接受、返工、改派、补充 Review 或 Replan；
7. 在满足整体成功标准后交付，或按策略请求最终审批；
8. 在越权、关键风险、持续失败或没有可行路径时升级并停止。

Leader 默认协调而不替 Worker 实现，以保留全局上下文和独立验收能力；Squad Instructions 可以允许小型工作由 Leader 直接完成。

### 3. Leader 采用事件驱动运行

Leader 每次只执行一次有界决策：

```text
Goal/Work Item/Automation 触发
        ↓
      Leader
        ↓ 记录决策并分派
      Worker
        ↓ 交付、失败或阻塞
  重新唤醒 Leader
        ↓
验收、返工、Replan、升级或交付
```

Leader 分派后停止，不常驻轮询。成员交付、失败、阻塞、Review、定时器和外部事件可以重新唤醒 Leader。Control 必须对触发和 Leader Decision 去重，阻止 Leader 自己的分派重新触发自己，并限制并发、重试、时间和 Token 预算。

### 4. 计划和决策必须可见

Plan 是可版本化的权威状态，不能只存在于 Leader 的 Native Session。Leader 的澄清、规划、分派、接受、返工、Replan、等待、升级、交付和取消均记录为结构化 Leader Decision，并关联触发事件和 Plan 版本。

单个 Run 成功只表示执行结束，不表示 Work Item 已验收；单个 Work Item 完成也不表示 Goal 已达成。

### 5. 内部验收与最终批准分离

Leader 负责 Worker 层面的内部验收，也可以委派独立 Reviewer。Goal 的最终完成使用显式策略：

```text
leader_can_complete
require_reviewer
require_human_approval
```

部署、消费、对外发布、敏感数据、权限变更和破坏性操作等高影响行为仍可由 Workspace Policy 强制要求人类批准。

### 6. Context Acquisition 由 Skills 和插件承载

Context Acquisition 是 Agent 的通用执行能力。Agent 根据 Instructions、Skills、插件、cwd 和 Access Policy，从知识库、项目文档、文件系统、数据库、网络搜索或外部服务获取上下文；Leader 也可以将检索委派给专门成员。

Control Plane 不为某一种知识库或业务数据源建立核心领域模型，只负责：

- 工具能力声明与权限检查；
- Run/Event 执行记录；
- 敏感信息处理；
- 插件失败的明确披露；
- Workspace Policy 要求的来源可追踪性。

内部知识优先、网络查询 fallback 和引用规范由 Agent/Squad Instructions 与 Workspace Policy 配置。

### 7. Automation 先路由给负责人

Cron、Interval、Webhook 和外部事件形成可审计、可去重的 Automation Trigger。Automation 指向单 Agent 时直接唤醒该 Agent；指向 Squad 时只唤醒 Leader，由 Leader 判断是否创建或更新工作、委派成员、保持沉默或升级。

## 结果

### 正面

- 用户可以只描述目标和验收结果，不必手工衔接每个 Agent；
- Leader 的计划、分派与验收过程可见、可恢复、可审计；
- Worker 可以并行使用不同 Runtime、Provider、Skills 和插件；
- 长期目标通过持久状态和事件继续推进，不依赖永久模型循环；
- 同一抽象可用于研发、研究、内容、运营、客服、运维和其他知识工作；
- Context Acquisition 保持通用，不把平台耦合到特定知识库或业务领域。

### 代价

- Control 需要新增 Goal、Squad、Plan、Work Item、Leader Decision 和 Automation 状态；
- 必须处理重复触发、并发分派、迟到结果、计划版本变化和 Leader 更换；
- Leader Prompt 不能单独保证生命周期不变量，需要 Control 强制去重、权限、预算和完成策略；
- UI 需要同时呈现 Conversation 时间线与 Goal/Plan 的结构化进展。

## 不变量

1. 分配给 Squad 的工作只先唤醒 Leader。
2. Leader 的分派不能触发自身循环。
3. 同一权威触发至多产生一个有效 Leader Decision。
4. Leader 分派后停止，由新事件重新唤醒。
5. Plan 和关键 Leader Decision 不只保存在 Native Session。
6. Worker Run 成功不自动改变 Work Item/Goal 为完成。
7. Goal 完成必须满足成功标准和 completion policy。
8. Skills 和插件不能绕过 Agent、Workspace、Runtime 或高影响动作权限。
