# TabTin 前端与能力复刻方案

> 目标仓库：`multi-agent-`  
> 参考对象：同级 `TabTin/` 源码、macOS 客户端与 `tbot/` 根目录截图  
> 产品决策：`pi-web` 不再作为目标产品前端；新建完整的 TabTin 式 Agent 任务工作台。现有 pi-web 仅作为协议、事件归一化和成熟渲染逻辑的过渡参考，不保留其页面布局和交互构成。

## 1. 结论摘要

`multi-agent-` 已经有一条很有价值、可以承载完整任务工作台的后端主链路：

- Conversation / Channel / Thread；
- 每个 Conversation-Agent 独立 Pi `AgentSession`；
- 多 Agent 并行和顺序共享上下文；
- Mention / Reply / Inbox 自动唤醒；
- Agent/Runtime 状态与 Agent desired config；
- 流式 Thinking、工具调用、Markdown、Usage、Steering、Follow-up、Abort；
- SQLite 权威消息、Run/Event、重连和幂等恢复。

当前短板是整个前端产品层，而不只是外围样式：`ConversationShell.tsx` 把 Runtime 信息、Agent 配置、Channel/Thread 和聊天塞在一个工程化页面里，pi-web 的导航、会话模型、信息密度和交互组织也不适合作为最终 Agent 工作台。截图中的 TabTin 已形成更完整的桌面工作台信息架构。

修订后的策略：

1. **保留 multi-agent 的 Go Control + Runtime + Pi Session 内核。**
2. **新建完整 Workbench 前端，不再以 pi-web 页面为产品基线。**
3. **任务、工作空间、Agent、应用、自动化、导入、设置均按 TabTin 的信息架构组织。**
4. **聊天时间线、Composer、右侧 Canvas 也按 TabTin 重新实现视觉和交互。**
5. pi-web 只允许复用非视觉能力，例如事件归一化、Markdown/工具数据转换、断线合并和协议 adapter；这些能力应逐步下沉到 `lib`，不能让新前端继续依赖旧 AppShell。
6. 按“产品能力纵向闭环”推进，而不是只做一层相似皮肤。

目标不是“给 pi-web 套 TabTin 外壳”，而是：

> 用 multi-agent 后端实现一套布局、构成和工作方式与 TabTin 对齐的 Agent 任务工作台。

## 2. 截图体现的产品结构

### 2.1 全局框架

截图中稳定存在四层布局：

1. **macOS 顶栏**：账号/组织切换、窗口控制、连接状态；
2. **最左 Activity Rail**：首页/任务、Agent、消息、应用或云文档等一级入口，底部为支持、通知和头像；
3. **上下文 Sidebar**：随一级入口切换内容；
4. **主工作区**：列表、详情、对话或应用画布；对话场景可再打开右侧资产/工作空间管理栏。

任务页是最值得先复刻的三栏形态：

```text
Activity Rail | 工作空间/任务 Sidebar | Conversation | 可折叠资产/管理 Canvas
```

这与当前 `multi-agent-` 的 Conversation + Thread + Agent Run 非常契合。

### 2.2 截图功能清单

| 截图 | 功能 | 建议优先级 |
| --- | --- | --- |
| `首页.png` | 工作空间任务对话、Agent 回复、底部 Composer、右侧快捷入口 | P0 |
| `2.png` | IM/群聊列表、群会话、会话资产 | P2 |
| `3.png`、`5.png` | Agent 列表、Agent 详情、规则/Skills/Tools/记忆/最近任务 | P0/P1 |
| `4.png` | 从模板或空白创建 Agent、头像选择 | P0 |
| `6.png` | 云文档列表与分享筛选 | P2 |
| `7.png`～`12.png` | 账号、模型、用量、系统权限、版本等设置中心 | P1/P2 |
| `13.png`、`14.png` | 创建群组、添加外部联系人 | P2 |
| `16.png` | 应用/Skill/连接器市场 | P1 先做壳，P2 接真实能力 |
| `17.png`、`18.png` | 自动化列表和定时任务创建 | P2（依赖调度后端） |
| `19.png` | Claude/Codex/Cursor 等历史任务导入 | P2 |
| `22.png` | Conversation + 右侧工作空间管理 | P0 |
| `23.png` | 选择本地目录创建工作空间 | P0 |
| `24.png` | 工作台快捷入口：目录、云盘、浏览器、表格、文档、终端 | P1/P2 |

## 3. 源码评估：产品对齐，但实施方式要分层

TabTin renderer 的核心入口位于：

- `TabTin/apps/tabtin-electron/src/renderer/src/App.tsx`
- `TabTin/apps/tabtin-electron/src/renderer/src/components/layout/AppLayout.tsx`
- `TabTin/apps/tabtin-electron/src/renderer/src/components/layout/ActivityRail.tsx`
- `TabTin/apps/tabtin-electron/src/renderer/src/components/layout/SpaceSidebarGlobal.tsx`
- `TabTin/apps/tabtin-electron/src/renderer/src/components/chat/`
- `TabTin/apps/tabtin-electron/src/renderer/src/stores/`

它不是一套可独立复制的 UI kit，而是一整个 Electron 产品层：

- `AppLayout.tsx` 同时依赖认证、组织、Space、Project、IM、Chat、Canvas tabs 和大量 Zustand store；
- Electron 包依赖大量 `@tabtin/*` workspace 包；
- renderer 中大量组件直接或间接依赖 preload/IPC、桌面文件系统、系统权限和本地 runtime；
- TabTin 自带 Chat store/protocol，与现有 pi-web + `ConversationAdapter` 重叠；
- 整体移植会同时引入认证、协作服务、云资源、文档、表格、浏览器、终端等巨大依赖面。

因此目标虽然是完整产品对齐，但不应把整个目录机械复制后再修编译。正确实施方式是：

- **信息架构对齐**：一级导航、上下文 Sidebar、任务主区、右侧 Canvas、设置中心与各工作流保持一致；
- **组件构成对齐**：按 TabTin 的 Shell、Task Workspace、Agent Center、Apps、Automation、Import、Settings 分域实现；
- **交互行为对齐**：新任务、Agent 选择、三态视图、工作空间目录、任务资产和配置流程保持一致；
- **数据层替换**：所有页面连接 multi-agent Control API，不引入第二套 TabTin Chat/Space store；
- **实现分层**：若许可允许，可移植纯 UI 组件并建立 adapter；否则根据截图和行为 clean-room 重写；
- **pi-web 降级**：只迁移经过验证的非视觉逻辑，新页面不嵌入 `GroupChat` 作为长期方案。

这意味着聊天界面也要重新构成，而不是原样把 `GroupChat` 放在 TabTin 风格边框中。

## 4. 许可证与授权边界

已确认：项目已与 TabTin 作者沟通，当前用于内部开发，可以采用 AGPL，且已有相应商业授权。因此本项目可以直接参考或迁移 TabTin 的前端组件实现，不再以 clean-room 重写作为硬性约束。

实施时仍应：

- 在 `THIRD_PARTY_NOTICES.md` 和源码文件中保留适用的来源与版权说明；
- 建立迁移清单，记录直接迁移、修改和独立实现的文件；
- 优先迁移纯 UI、布局和交互组件，通过 adapter 连接 multi-agent Control；
- 不机械复制 TabTin 的 Django/Collab/Chat/Space 数据层，避免形成两套后端；
- 品牌名称、Logo、吉祥物和发布方式仍按双方授权范围处理。

本文后续按“**可直接参考/迁移 UI，实现完整产品对齐，数据层使用 multi-agent 后端**”推进。

## 5. 目标信息架构

建议把现有 `/conversations` 升级为统一 Workbench，路由可逐步扩展为：

```text
/workbench/tasks             新任务、工作空间与任务列表
/workbench/tasks/:id         Conversation 主界面
/workbench/agents            Agent 列表
/workbench/agents/:id        Agent 详情与配置
/workbench/apps              Apps / Skills / Connectors
/workbench/automations       自动化
/workbench/import            外部会话导入
/workbench/settings/models   模型配置
/workbench/settings/runtime  Runtime 与设备状态
/workbench/settings/usage    用量
```

早期也可维持 Next.js query 参数，避免一次性修改深链接：

```text
/conversations?conversation=<id>&panel=workspace
```

但一级导航状态、选中的 Conversation、右侧面板状态必须进入 URL 或可恢复 store，不能只留在组件局部 state。

## 6. P0：完整任务工作台主闭环

### 6.1 Workbench Shell

新增完整前端产品外壳，不继续膨胀 `ConversationShell.tsx`：

```text
components/workbench/
  WorkbenchShell.tsx
  WorkbenchTopBar.tsx
  ActivityRail.tsx
  ContextSidebar.tsx
  WorkbenchMain.tsx
  RightCanvas.tsx
  workbench-shell.module.css
```

第一版 Rail 只开放三个真实入口：

- 任务；
- Agent；
- 设置。

应用中心、自动化、消息、云文档可以显示为 `即将开放`，但不能伪装成已完成能力。

### 6.2 工作空间与任务 Sidebar

把当前工程化 Channel/Thread 导航改成截图风格：

- 顶部：`新任务`；
- 固定入口：应用中心、自动化、导入数据；
- 分组：工作空间；
- 工作空间下展示 Conversation/任务；
- hover 操作：重命名、设置、删除；
- Thread 保留为任务内讨论，避免在一级导航中与任务抢层级。

P0 可以先做语义映射：

| UI 概念 | 当前数据 |
| --- | --- |
| 工作空间 | Channel 的上层展示分组，或暂时按 cwd 分组 |
| 任务 | Conversation/Channel |
| 任务讨论 | Thread |
| 执行成员 | Channel `agentIds` |
| 工作目录 | Agent desired cwd / 后续 Workspace cwd |

但这只是过渡。正式版本应补 `workspaces` 表，不能永久把 Workspace 和 Channel 当成同一对象。

### 6.3 新任务流程

截图的核心体验不是“新建 Channel”，而是“新建任务并马上开始工作”。建议流程：

1. 点击新任务；
2. 选择工作空间/本地目录；
3. 输入任务标题（可空，首条消息后自动命名）；
4. 选择一个或多个 Agent；
5. 选择执行模式：单 Agent、顺序共享、并行独立；
6. 创建 Conversation 并聚焦 Composer。

当前 `ConversationShell.tsx` 的创建 Channel modal 可演进为该流程，先不改后端 endpoint 名称也可以。

### 6.4 对话工作台

聊天产品层重新实现，页面不再直接使用 `GroupChat`。建议拆成：

```text
TaskConversation.tsx
  TaskHeader.tsx
  ParticipantBar.tsx
  MessageTimeline.tsx
    UserMessage.tsx
    AgentTurn.tsx
    ThinkingBlock.tsx
    ToolCallBlock.tsx
    ArtifactBlock.tsx
  TaskComposer.tsx
    AgentSelector.tsx
    ModeSelector.tsx
    PermissionSelector.tsx
    ModelBar.tsx
  RunControlDock.tsx
```

数据仍通过 `ConversationAdapter` 和 Control WebSocket 获取。可以迁移 pi-web 已验证的事件归一化、Markdown 安全处理、工具数据转换和流式合并逻辑，但必须放入无 UI 的 domain/presentation 层，再由新组件消费。

工作台行为对齐 TabTin：

- 顶部显示任务名、成员、共享和三态视图切换；
- 用户消息靠右，Agent 结果按正文工作流展示；
- Thinking 和工具过程使用低干扰、可折叠结构；
- Composer 底栏展示 Agent、模型、模式、授权策略、cwd；
- 运行控制显示在 Agent 粒度；
- 支持 Reply、Mention、Thread、附件和任务资产；
- 右侧 Canvas 能与对话组成“对话 / 分栏 / 工作台”三态布局。

新前端达到等价能力后，旧 `GroupChat`、`ConversationShell` 和 pi-web AppShell 从正式路由移除，只保留诊断或迁移期入口。

### 6.5 右侧 Canvas

P0 只实现三个 Tab：

1. **运行**：每个 Agent 的状态、Runtime、模型、session generation、Steer/Abort/Replace；
2. **工作空间**：cwd、授权策略、成员、归档/删除；
3. **资产**：本轮写入文件、上传附件、打开的文件标签。

已有 `FileExplorer`、`FileViewer`、`TurnWrittenFiles`、Binding 信息可直接组合。先实现可折叠固定宽面板，第二阶段再做可拖拽三栏。

### 6.6 Agent 中心

替换当前 `configureAgent()` 的四次 `window.prompt`：

- Agent 列表卡片：头像、名称、角色、presence、Runtime；
- 创建 Agent modal：模板/空白、名称、描述、Runtime、模型、cwd；
- Agent 详情：规则、Skills、Tools、记忆占位、最近任务；
- 编辑采用普通表单和保存状态；
- 明确提示配置需要 Replace Session 才作用于已打开 Session。

现有 `/api/multi-agent/agents` 和 desired config 已能支撑配置主体；创建/归档、头像和模板需要补 API。

## 7. P1：形成产品感

### 7.1 设计系统

先抽 token，不要在页面里散落 TabTin 色值：

```css
--wb-topbar-h: 36px;
--wb-rail-w: 44px;
--wb-sidebar-w: 256px;
--wb-canvas-w: 360px;
--wb-bg: #ffffff;
--wb-sidebar-bg: #f7f8fa;
--wb-topbar-bg: #edf3fa;
--wb-border: #e8eaed;
--wb-selected: #eaf2ff;
--wb-primary: #2f74dc;
--wb-success: #31b26f;
--wb-radius-sm: 6px;
--wb-radius-md: 10px;
```

同时保留 pi-web dark mode token 映射。截图是极浅、低对比度界面，但不能因追求“白”而牺牲文本对比度和键盘焦点。

### 7.2 Apps / Skills / Connectors

应用中心第一版应只展示真实能力：

- Skills：来自现有 `/api/skills`；
- Plugins：来自现有 `/api/plugins`；
- Models/Providers：来自现有模型 API；
- Runtime capabilities：来自 Control runtime inventory。

`Notion`、`GitHub`、`Supabase` 等连接器只有在存在认证、权限和调用闭环后才能标记“已安装”。否则只作为 catalog/roadmap 项。

### 7.3 模型与 Runtime 设置

现有 pi-web 已有 `ModelsConfig`、`ModelSelector`、`SettingsUi` 等组件，可以包进新的设置页面，而不是照 TabTin 再实现一套模型层。

Runtime 页面对应截图里的“设备状态/登录信息/性能监控”：

- Runtime online/stale/offline；
- Node/Pi/OS/arch/version；
- capabilities；
- 当前运行 Agent；
- 心跳与最后在线时间；
- 后续加入配对和权限。

### 7.4 本地目录工作空间

创建 Workspace modal 复刻 `23.png` 的交互：

- 拖入目录；
- 点击目录选择器；
- 自动建议工作空间名称；
- 显示路径与 allowlist 检查；
- 创建后使用该 cwd 启动 Agent Session。

Web 版不能直接假定 Electron IPC，应基于现有安全目录浏览 API/`DirectoryPicker` 实现；未来桌面壳再提供原生目录选择 adapter。

## 8. P2：依赖新后端的能力

以下功能不是单纯前端复制，必须先设计数据模型和服务：

### 自动化

至少需要：

- automation CRUD；
- cron/interval/timezone；
- Agent/Squad target；
- execution instruction；
- lease、幂等、重试、超时、暂停；
- 执行历史和通知。

### 云文档/表格/演示

TabTin 这部分背后有独立文档、表格、协作和资源系统。`multi-agent-` 不应把“文件列表页面”误当成功能完成。早期先提供本地文件资产与 Markdown 预览；真正云文档放在独立里程碑。

### IM/组织/外部联系人

需要 Workspace member、身份认证、Conversation participant 权限、群成员和资源分享模型。当前无用户/组织授权，不适合先做。

### 用量与账单

当前可以先展示 Pi Run usage；credits、账单、成员配额需要独立计量口径和账务后端。

### 外部任务导入

先定义统一 importer：

```ts
interface ConversationImporter {
  discover(): Promise<ImportSource[]>;
  preview(source: ImportSource): Promise<ImportPreview>;
  import(source: ImportSource, targetWorkspaceId: string): Promise<ImportResult>;
}
```

Claude Code、Codex、Cursor 分别实现 adapter，导入结果应生成权威 Conversation/Message，并记录 provenance，不能直接拼接到 Pi session 文件。

## 9. 前后端缺口矩阵

| 能力 | 当前后端 | 当前前端 | 下一动作 |
| --- | --- | --- | --- |
| Conversation/Thread | 已有 | 已有但工程化 | 换 Workbench Shell |
| 多 Agent Run | 已有 | 已有 | 优化选择器与运行面板 |
| Mention/Reply/Inbox | 已有基础 | 基础展示 | 加成员/Agent 统一交互 |
| Agent desired config | 已有 PATCH | `window.prompt` | Agent Center 表单化 |
| Agent 创建/归档/头像 | 不完整 | 无 | 补 CRUD/API |
| Runtime inventory | 已有 | details 文本 | 独立设备状态页 |
| Workspace | 仅概念/cwd | 无正式模型 | 新表和 CRUD |
| 文件资产 | pi-web 本地能力已有 | 分散 | 组合到右侧 Canvas |
| Skills/Plugins | pi-web API 已有 | 设置页已有 | 接入应用中心 |
| Models | 已有 | 已有设置组件 | 换壳复用 |
| Automation | 未实现 | 无 | P2 后端优先 |
| 云文档/表格 | 未实现 | 无 | 独立里程碑 |
| IM/组织 | 未实现 | 无 | 权限模型之后 |
| Import | 未实现 | 无 | adapter + provenance |
| Usage | Run usage 基础 | 消息内显示 | 先做聚合报表 |

## 10. 推荐代码演进方式

### 不做

- 不把 `TabTin/apps/tabtin-electron/src/renderer` 不加选择地整目录复制到现有 pi-web；
- 不保留 pi-web AppShell、ConversationShell 或 GroupChat 作为最终产品界面；
- 不引入与 Control 并行的第二套 TabTin Chat/Space 数据源；
- 不在一个超大组件中继续加入 Agent、Workspace、Runtime 和设置逻辑；
- 不用静态假数据把未完成连接器显示成可用。

### 要做

1. 冻结旧 `ConversationShell.tsx` 的产品功能扩展，只修协议回归；
2. 新建完整 `WorkbenchShell` 和任务工作台组件；
3. 把 `ConversationAdapter`、事件归一化、重连合并等逻辑抽成无 UI domain 层；
4. 重新实现 Task Timeline、Agent Turn、Tool/Thinking Block 和 Composer；
5. 将所有 `prompt/confirm/alert` 替换为 Dialog/Toast；
6. 添加 Agent Center、Right Canvas 和 Settings；
7. 再逐步补 Workspace、Automation、Import 等数据模型与路由。

建议组件边界：

```text
components/workbench/
  shell/
  navigation/
  tasks/
  agents/
  runtime/
  settings/
  apps/
  shared/

lib/workbench/
  workbench-types.ts
  workbench-navigation.ts
  workbench-client.ts
  workbench-state.ts
```

服务端类型不要重复手写在每个组件顶部；应从 `lib/api-types.ts` 或新的 contract 层统一导出。

## 11. 可执行迭代顺序

### Iteration 1：工作台骨架与新聊天面

- WorkbenchTopBar；
- ActivityRail；
- TabTin 风格任务 Sidebar；
- 新 `TaskConversation`、`MessageTimeline` 和 `TaskComposer`；
- 右侧 Canvas 与展开/折叠；
- 响应式降级；
- URL 状态保持；
- Control Adapter 接入。

**验收：** 不再展示 pi-web 页面；现有 Conversation 的发送、流式、Thinking、工具、回复、多 Agent 和 Abort 在新工作台回归通过。

### Iteration 2：任务与 Agent 主流程

- 新任务 Dialog；
- 创建本地工作空间 Dialog；
- Agent Center 列表/详情；
- Agent config 表单；
- Runtime 状态页；
- 移除主路径所有浏览器原生 prompt/alert。

### Iteration 3：右侧工作画布

- Run details；
- 工作空间配置；
- 文件树/文件预览；
- written files；
- 可拖拽宽度和布局持久化。

### Iteration 4：能力中心

- Skills；
- Plugins；
- Models；
- Runtime capabilities；
- 安装/启停/配置状态。

### Iteration 5：新后端能力

- Workspace 正式模型；
- Agent CRUD；
- Usage 聚合；
- Automation；
- Importer；
- 最后再评估云文档和 IM。

## 12. P0 验收标准

- 1440×900 与截图的结构、密度和层级接近；
- 任务、Agent、设置三个入口可用；
- 新建任务不再暴露“Channel”工程术语；
- 单 Agent/多 Agent 选择与执行模式清楚；
- 中途 Steering/Follow-up/Abort 不退化；
- Thinking、Tool、Markdown、Usage、复制不退化；
- 刷新后工作空间、任务、右栏和选中 Conversation 可恢复；
- Runtime 离线时状态明确，历史仍可读；
- 键盘焦点、对比度、缩放和移动端可用；
- 未实现入口有明确状态，不制造假功能；
- 不复制 TabTin 商标/品牌资产；
- 代码许可策略有书面确认。

## 13. 建议立即开始的第一刀

第一刀建立新工作台正式路由，同时把旧页面降级为迁移入口：

1. 冻结 `ConversationShell.tsx`，不再追加产品功能；
2. 抽出 `workbench-client`、`ConversationAdapter` 与事件 presentation model；
3. 新建 `WorkbenchShell`、`ActivityRail`、`TaskSidebar`、`TaskConversation`、`RightCanvas`；
4. 新建消息时间线和 Composer，而非嵌入旧 `GroupChat`；
5. 用 Dialog 实现“新任务”和“创建工作空间”；
6. 右栏接入已有 Binding/Runtime/Agent/文件信息；
7. 新正式路由达到能力等价后，将旧 `/conversations` 页面切到新 Workbench，旧 UI 仅保留诊断入口；
8. 添加视觉回归截图和消息协议回归测试。

这样得到的不是“pi-web 换皮”，而是一套真正按 TabTin 产品结构构建、由 multi-agent 后端驱动的 Agent 任务工作台。
