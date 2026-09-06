# ADR 0001：产品与技术基线

- 状态：Superseded by [ADR 0002](0002-goal-driven-squad-leader.md)
- 日期：2026-09-04

> 本 ADR 保留最初 MVP 的历史基线。其中“第一版不引入 Thread”和早期的直接 Agent 分配模型仅描述当时范围；统一 Conversation/Thread、Goal 与 Squad Leader 的后续方向以 ADR 0002 为准。

## 决策

Multi Agent 采用以下基线：

1. **前端与 Session：pi-web v0.8.11**
   - 保留原生 AgentSession、流式输出、Markdown、Thinking、工具详情、Usage、Fork、Steering、Follow-up 和 Abort。
2. **Channel 与协作体验：参考 Raft**
   - Channel 是人类和 Agent 的共享空间。
   - HUMAN 与 AGENT 使用统一 Mention 体验。
   - 第一版不引入 Thread；一个主题使用一个 Channel，完成后归档或删除。
3. **Control、Runtime 与 Work Item：参考 Multica，独立轻量实现**
   - Runtime 主动连接 Control。
   - Agent 与 Runtime 分离。
   - 每个 `(channel, agent)` 对应独立、持续的 Native Session。
   - 不采用 Task-per-message 和一次性 Agent CLI 作为实时聊天主路径。

## 用户可见核心概念

```text
Workspace
└─ Channel
   ├─ Human Participants
   ├─ Agent A
   │  └─ Session A
   ├─ Agent B
   │  └─ Session B
   ├─ Messages
   └─ Optional Work Items
```

用户需要在页面看见 Channel、Agent 和 Session；Pi AgentSession、Codex Thread 和 ACP Session 是 Provider 实现细节。

## 下一阶段顺序

1. 将 Channel 和 Agent 持久化到 Go Control。
2. 加入 HUMAN + AGENT 统一 Mention。
3. 为 Agent 提供 Channel Roster。
4. 实现结构化 `send_agent_message`。
5. 增加最大自动轮数、时间/Token 预算和循环保护。
6. 实现结构化 `delegate_work` 与 Work Item。

## 约束

- 实时事件不等待数据库落库后才显示。
- 同一个 Channel 中，每个 Agent 最多一个活跃 Session Generation。
- Agent-to-Agent 自动协作默认关闭或受明确策略约束。
- 不因统一协议而削弱 Pi/Codex 的原生能力。
- 每阶段与原版 pi-web 做同模型、同 cwd、同 Prompt 的体验和延迟对比。
