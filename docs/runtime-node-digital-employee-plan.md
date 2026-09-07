# Runtime Node 与数字员工实施计划

> 目标：先把 Runtime Node 建成可接入、可观察、可控制、可审计的“工位”，再开放数字员工动态创建；随后建立 Owner/Workspace、Skills/Tools、通讯录、私聊、群聊和有界员工间协作。

> 参考实现：`/mnt/data/code/code.bing.com/btc/multica`。重点参考其 Runtime detail/list/connect/rename/delete、Runtime model/skill inventory、Agent create/config/detail/access/activity，而不复制其品牌或与本项目不兼容的多 CLI 执行协议。

## 1. 参考代码地图

### Runtime UI

- `packages/views/runtimes/components/runtimes-page.tsx`
- `packages/views/runtimes/components/runtime-list.tsx`
- `packages/views/runtimes/components/runtime-detail-page.tsx`
- `packages/views/runtimes/components/runtime-detail.tsx`
- `packages/views/runtimes/components/connect-remote-dialog.tsx`
- `packages/views/runtimes/components/rename-machine-dialog.tsx`
- `packages/views/runtimes/components/delete-runtime-dialog.tsx`
- `packages/views/runtimes/components/runtime-settings-page.tsx`
- `packages/views/runtimes/components/machine-cli-section.tsx`

### Runtime 后端

- `server/internal/handler/runtime.go`
- `server/internal/handler/runtime_update.go`
- `server/internal/handler/runtime_models.go`
- `server/internal/handler/runtime_model_catalog.go`
- `server/internal/handler/runtime_local_skills.go`
- `server/cmd/server/runtime_sweeper.go`
- `server/pkg/db/queries/runtime.sql`

### 数字员工 UI

- `packages/views/agents/create/manual-create-agent-page.tsx`
- `packages/views/agents/create/agent-configuration-panel.tsx`
- `packages/views/agents/components/agent-detail-page.tsx`
- `packages/views/agents/components/agent-overview-pane.tsx`
- `packages/views/agents/components/agent-overview-summary.tsx`
- `packages/views/agents/components/agent-detail-inspector.tsx`
- `packages/views/agents/components/tabs/skills-tab.tsx`
- `packages/views/agents/components/tabs/mcp-config-tab.tsx`
- `packages/views/agents/components/agent-access-settings.tsx`

### 消息与协作参考

- `packages/views/chat/`
- `packages/views/agents/components/agent-presence-indicator.tsx`
- `packages/views/agents/components/agent-live-peek-card.tsx`
- `packages/views/common/actor-*`

## 2. 当前能力基线

### 已有

- Runtime 出站 WebSocket 注册；
- Runtime ID / Instance ID；
- 心跳、online/offline/stale；
- Node/Pi/Runtime 版本、OS/Architecture；
- Capability 基础字段；
- 活跃 Run 重连对账；
- Runtime 模型目录、模型配置、发现和测试；
- Runtime 注册数字员工；
- 每 `(conversation, employee)` 独立 Pi Session；
- 数字员工 Presence、Mention、Reply、Inbox 和多员工顺序/并行执行。

### 关键缺口

- 无 Runtime Node 详情和控制 API；
- 无 Pairing Code、一次性注册凭据、撤销和轮换；
- 无 active/draining/disabled 控制状态；
- 无容量、活跃 Session、错误和 Outbox 详情；
- 无 Runtime Skills/Tools/MCP Inventory；
- Runtime 只能从启动参数注册固定员工；
- 无数字员工 Create/Archive/Restore；
- 无 Owner、Workspace Membership 和 Access Principal；
- 无 Direct/Group Conversation 正式类型与通讯录。

## 3. 领域边界

```text
RuntimeNode       设备/进程，“工位”
DigitalEmployee   持久身份、职责、权限与能力主体
Conversation      私聊/群聊/任务/自动化的权威消息空间
SessionBinding    某员工在某 Conversation 的具体 Pi Session
Run               一次执行
```

Runtime 离线不能删除数字员工；数字员工改名不能改变 Runtime；Conversation 切模型只能替换该 Binding，不能修改其他 Conversation。

## 4. Runtime Node 数据模型

```text
runtime_nodes
  id
  owner_type / owner_id
  name
  control_state(active|draining|disabled|archived)
  observed_state(online|offline|stale)
  instance_id
  version / node_version / pi_version
  os / architecture
  capabilities_json
  capacity_json
  last_seen_at
  config_version
  created_at / updated_at / archived_at

runtime_pairing_tokens
  id
  token_hash
  expires_at
  used_at
  revoked_at
  created_by

runtime_capability_snapshots
  runtime_id / instance_id / version
  models_json / skills_json / tools_json / mcp_json
  captured_at
```

`control_state` 是用户意图，`observed_state` 是心跳事实，必须分开。

## 5. Runtime 分阶段

### R0：节点详情与控制（当前推进）

- [x] Runtime Node 详情 API；
- [x] Runtime Node 列表页与详情页分离，参考 `tmp/节点管理1.png` 使用居中节点行、状态列和详情箭头；
- [x] 详情 API/UI 显示数字员工、模型、Capabilities 和活跃 Run；
- [x] `active / draining / disabled` 持久控制状态；
- [x] Drain 后拒绝新 Prompt，但允许正在运行的 Run、Steer、Abort 完成；
- [x] Disable 后拒绝新 Session；
- [x] Resume 恢复接收任务；
- [x] Rename；
- [x] Store 状态持久与重注册测试；Workbench typecheck/build 和 1440×900 浏览器走查。

### R1：安全接入

- [x] 创建一次性 Pairing Code；
- [x] Token 只保存 Hash；
- [x] 过期、单次消费和 Runtime Credential 撤销；轮换待补；
- [x] Workbench 添加节点 Dialog、凭据一次显示和启动命令；Docker/Host 完整安装器待补；
- [ ] 首次注册审批；
- [x] Runtime Credential 绑定 Runtime ID，并与 Instance ID 分离。

### R2：能力清单

- [ ] Models 持久快照（已有实时目录）；
- [x] Skills Inventory 实时上报；持久快照待补；
- [x] Tools Inventory 实时上报（Pi built-in）；Extension Tool 待补；
- [x] MCP Inventory Contract 与 unsupported 状态；真实 MCP Server 发现待补；
- [x] Skill/Tool 名称、描述、来源、文件和诊断基础字段；
- [x] Runtime Node 与数字员工详情展示真实 Inventory；“员工已分配”和有效能力计算待 E2。

### R3：容量和运维

- [ ] 最大并发、当前并发和队列；
- [ ] CPU/内存/磁盘（可选采集）；
- [ ] 活跃 Session/Run；
- [ ] 最近错误、重连、事件 Outbox；
- [ ] 诊断导出；
- [ ] Runtime 升级和兼容性提示。

## 6. 数字员工分阶段

### E0：CRUD 与 Runtime 动态绑定

- [ ] Create/Get/List/Update/Archive/Restore；
- [ ] 头像、名称、Handle、简介、Instructions；
- [ ] 创建时选择在线 active Runtime；
- [ ] Control 向 Runtime 动态下发员工配置；
- [ ] 一个 Runtime 承载多个数字员工；
- [ ] Runtime 重连恢复 Desired Employees；
- [ ] 归档员工停止新触发但保留历史。

### E1：Owner、Workspace 和权限

- [ ] Owner；
- [ ] Workspace Membership；
- [ ] 默认 cwd 和 allowlist；
- [ ] private/workspace/members 可见性；
- [ ] 可调用、可配置、可分配权限；
- [ ] Secret 和高风险 Tool 权限。

### E2：Skills、Tools、MCP

- [ ] Workspace Skill 分配；
- [ ] Runtime 本地 Skill 启停；
- [ ] Tool/MCP 策略；
- [ ] 有效能力 = 分配 ∩ Runtime 实际清单 ∩ Workspace 权限；
- [ ] Run 保存能力快照。

## 7. 消息与协作分阶段

### C0：通讯录与私聊

- [ ] 联系人统一 Member / Digital Employee；
- [ ] Direct Conversation 创建/复用；
- [ ] Presence、未读、Typing/Working；
- [ ] 私聊中创建任务或继续普通对话。

### C1：群聊

- [ ] Group Conversation；
- [ ] 混合成员管理；
- [ ] `@数字员工`、Reply、Assignment；
- [ ] 未被触发的员工不自动抢答；
- [ ] 群聊资产和任务关联。

### C2：员工间协作

- [ ] 复用 Message → Mention → durable Inbox；
- [ ] Handoff 和 Assignment；
- [ ] 最大 auto-hop、去重和循环检测；
- [ ] 离线/忙碌队列与预算；
- [ ] 有限轮次 Interaction（研讨、辩论、相声）；
- [ ] Goal/Squad/Leader 负责计划、验收和终止。

## 8. R0 验收标准

1. 节点详情展示数据库和在线 Hub 的真实信息；
2. Control 重启后 control state 保留；
3. draining/disabled 节点不接受新 Prompt；
4. Drain 不破坏已运行的 Steer/Abort；
5. Resume 后可再次派发；
6. Runtime 重连不能绕过 disabled；
7. UI 不把 stale、offline、disabled 混为一个状态；
8. 所有 API 有 Store/HTTP 测试；
9. 未完成 Pairing、Skill/Tool 清单明确标注，不能伪装可用。

## 9. 紧接着的执行顺序

1. 给 `runtime_nodes` 增加持久 `control_state`；
2. 在 Hub 派发入口强制 active gate；
3. 新增 Runtime Get/Rename/Drain/Resume/Disable API；
4. Workbench 设置页改为节点列表 + 原位详情；
5. 补测试；
6. 再开始 Pairing 与数字员工动态创建。
