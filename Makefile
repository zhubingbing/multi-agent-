SHELL := /bin/bash

.PHONY: install start stop status check

install:
	cd apps/pi-web && npm ci --ignore-scripts
	cd services/pi-host && npm install
	go mod download

start:
	bash scripts/start.sh

stop:
	bash scripts/stop.sh

status:
	@curl -fsS http://127.0.0.1:30146/api/multi-agent/healthz && echo
	@curl -fsS http://127.0.0.1:30146/api/multi-agent/agents && echo
	@curl -fsS -o /dev/null -w 'web=%{http_code}\n' http://127.0.0.1:30146/conversations

check:
	cd services/pi-host && npm test
	cd services/pi-host && npm run typecheck
	cd apps/pi-web && node --experimental-strip-types --test lib/authoritative-conversation.test.mjs lib/control-conversation-adapter.test.mjs lib/conversation-minimap.test.mjs lib/conversation-navigation.test.mjs lib/conversation-turn-presentation.test.mjs lib/group-conversation-state.test.mjs
	cd apps/pi-web && ./node_modules/.bin/tsc --noEmit
	cd apps/pi-web && ./node_modules/.bin/eslint components/AppShell.tsx components/ChatWindow.tsx components/ConversationAgentRunView.tsx components/ConversationProcessDetails.tsx components/ConversationShell.tsx components/ConversationTimeline.tsx components/GroupChat.tsx components/WorkspaceModeNav.tsx app/conversations/page.tsx app/group/page.tsx lib/authoritative-conversation.ts lib/conversation-turn-presentation.ts lib/conversation-adapter.ts lib/control-conversation-adapter.ts lib/conversation-minimap.ts lib/conversation-navigation.ts lib/group-conversation-state.ts
	GOMAXPROCS=1 go test -race -p 1 ./cmd/control ./cmd/runtime ./internal/host
	go vet ./cmd/control ./cmd/runtime ./internal/host
