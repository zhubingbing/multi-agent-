# Multi Agent MVP

A distributed multi-agent workbench built from:

- a dedicated Vite/React Agent Workbench in `apps/workbench-web`;
- a shared, product-owned Chat Core migrated from the proven `agegr/pi-web` behavior;
- a Go control server inspired by Multica's outbound-runtime model;
- one Go runtime on the host and one in Docker;
- one persistent multi-session Pi SDK host per runtime.

## Running topology

```text
workbench-web /conversations :30146 (public Go same-origin gateway)
        │ browser WebSocket
        ▼
Go control :30146 ──HTTP proxy──▶ Vite Workbench :30148 (container/loopback only)
    ┌───┴────────────────┐
    ▼                    ▼
Host Runtime         Docker Runtime
Host Pi              Docker Pi
    │                    │
Pi SDK Host          Pi SDK Host
AgentSession         AgentSession
```

Each `(conversation, agent)` pair owns an independent Pi `AgentSession`. `apps/workbench-web` is the primary product UI. Its streaming reducer, Runtime event projection, message normalization, turn presentation, replay deduplication, and lazy-scroll behavior live in `packages/chat-core`, migrated from pi-web's proven implementation. `apps/pi-web` is now a compatibility and regression reference while its remaining message renderer and composer capabilities are moved into the Workbench; no new product UI should be built there. The target product treats both humans and agents as first-class conversation participants and adds goal-driven squads: work assigned to a squad first wakes its Leader Agent, which plans, delegates to members, stops while they execute, and is re-awakened by results to review, replan, or deliver. Agents can acquire context through their configured skills and plugins, and can also be awakened by mentions, replies, assignments, timers, or an explicitly authorized multi-agent interaction such as role-play, debate, brainstorming, or a timed performance.

## Start

```bash
make install
make start
```

For containerized development (no local Go installation required), use:

```bash
make dev
```

This mounts the repository into the containers. Vite hot-reloads the Web UI,
and Air rebuilds/restarts Control or Runtime when their Go/TypeScript sources
change. Dependencies, build caches, Runtime data, and SQLite data live in
named Docker volumes. Follow or stop the stack with `make dev-logs` and
`make dev-down`.

Open:

```text
http://127.0.0.1:30146/conversations
```

`/group` remains a compatibility diagnostic route for the distributed conversation protocol.

On another machine in the LAN, replace `127.0.0.1` with this host's address.

Check status:

```bash
make status
```

Stop:

```bash
make stop
```

Logs are under `.run/`. Docker Runtime logs:

```bash
docker-compose -f compose.yaml logs -f runtime-b
```

## Current MVP behavior

- Channel metadata, authoritative member/Agent messages, and Run events are persisted by the control server in a local SQLite database (`data/control.db`). Agent final answers or terminal provider errors are committed idempotently when the Run settles; thinking and tool activity remain Run events. SQLite runs in WAL mode. Runtime events carry a process-instance ID and monotonic source sequence; Control deduplicates them durably and acknowledges only after persistence, while a live Runtime process replays unacknowledged events after reconnect. Runtime-process crash recovery still requires a disk-backed outbox.
- Both online Agent chips are shown at the top; only the first online Agent is selected by default so baseline latency tests do not accidentally issue two simultaneous provider requests.
- Sending dispatches to the selected online Agent set; an explicit `@agent` mention narrows and orders the targets. Multi-Agent turns can run as `Sequential shared context` (default) or `Parallel independent`; sequential runs inject prior authoritative Agent results into the next Agent prompt.
- Runtime nodes report process instance, Runtime/Node/Pi versions, OS/architecture and capabilities. Durable Agent desired config (provider/model/thinking/cwd/instructions) is separated from observed Runtime state; Conversation-Agent bindings expose native session ID, effective config and generation, and support message-preserving Session replacement.
- Responses stream into the same Conversation. The Workbench already shares pi-web's event projection, streaming reducer, normalization, replay cursor handling, lazy history window, and tail-follow behavior through `packages/chat-core`; rich tool/result presentation and composer controls are being migrated next.
- Running Agent turns can receive per-employee or bulk steering, follow-up, and abort commands.
- Agent-authored `@employee` mentions are persisted to a durable employee Inbox and can wake an idle digital employee for a direct, message-linked reply. Ordinary employee communication does not require a formal Interaction; duplicate source/recipient delivery, self-wake, busy employees and per-root auto-hop limits provide the initial safety boundary.

## Deliberate MVP limitations

This is an architecture and UX proof, not a production service:

- control runtime/connection state is in memory; Channel and conversation history are stored in local SQLite, but there is not yet a multi-node PostgreSQL control plane;
- the runtime token is a development shared secret;
- no user/workspace authorization yet;
- no disk-backed Runtime event outbox yet; seq/ack/replay survives Control/WebSocket interruption while the Runtime process stays alive, but not a Runtime process crash;
- no Goal, versioned Plan, Squad/Leader orchestration, Work Item, durable Inbox, or Agent-to-Agent Interaction scheduler yet;
- no cron/webhook/event Automation layer yet; Agent skills and tools work through Pi, but platform-level Context Acquisition policy and provenance are not yet implemented;
- no Codex adapter yet;
- Docker currently mounts the host Pi configuration and this repository;
- a session remains pinned to the runtime that created its local files.

The next production step is authenticated pairing, durable runtime/agent configuration, sequence/ack event replay, and then a persistent Codex app-server adapter. SQLite is intentionally the single-node persistence layer for the current implementation; PostgreSQL remains the target when the control plane needs multiple replicas.

## Design documents

- [`docs/workbench-ui-guidelines.md`](docs/workbench-ui-guidelines.md) — Workbench 企业中后台字体、字号、行高、表单和列表详情一致性规范。
- [`docs/runtime-node-digital-employee-plan.md`](docs/runtime-node-digital-employee-plan.md) — 参考 Multica 的 Runtime Node 管理、能力清单、数字员工动态绑定和消息协作分阶段实施计划。
- [`docs/digital-employee-design.md`](docs/digital-employee-design.md) — 数字员工的持久身份、Owner/Workspace/Runtime、Skills/Tools、Presence、私聊/群聊和有界员工间协作设计。
- [`docs/automation-development-plan.md`](docs/automation-development-plan.md) — Automation 后台调度、统一派发、数据模型、恢复治理、Workbench UI 和分阶段验收计划。
- [`docs/product-plan.md`](docs/product-plan.md) — product principles, concepts, phases, and UX quality gates.
- [`docs/tabtin-replication-plan.md`](docs/tabtin-replication-plan.md) — screenshot/source audit and the phased plan for a TabTin-style workbench without replacing the existing conversation runtime.
- [`docs/implementation-status.md`](docs/implementation-status.md) — current verified progress, open gaps, and execution order.
- [`docs/architecture.md`](docs/architecture.md) — control/runtime/session architecture, goal-driven Squad/Leader orchestration, data model, unified participant routing, and bounded user-authorized Agent interactions.
- [`docs/decisions/0002-goal-driven-squad-leader.md`](docs/decisions/0002-goal-driven-squad-leader.md) — decision to add Goal, Squad, event-driven Leader coordination, and skill/plugin-based Context Acquisition.

## Legacy reference

`apps/pi-web` is based on `agegr/pi-web` v0.8.11 and is retained temporarily as a compatibility route, regression suite, and migration source. `apps/workbench-web` is the product frontend and must not import runtime code from `apps/pi-web`; reusable behavior moves into `packages/chat-core` or into Workbench-owned components first. See `apps/pi-web/LICENSE`, `apps/pi-web/UPSTREAM_COMMIT`, and `THIRD_PARTY_NOTICES.md`.
