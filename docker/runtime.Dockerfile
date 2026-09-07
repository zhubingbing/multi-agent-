FROM golang:1.23-bookworm AS go-build
ENV GOPROXY=https://goproxy.cn,direct
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY cmd/runtime ./cmd/runtime
COPY cmd/cli ./cmd/cli
COPY internal/host ./internal/host
COPY internal/automation ./internal/automation
COPY internal/controlclient ./internal/controlclient
RUN GOMAXPROCS=2 CGO_ENABLED=0 go build -p 1 -trimpath -o /out/multi-agent-runtime ./cmd/runtime \
    && GOMAXPROCS=2 CGO_ENABLED=0 go build -p 1 -trimpath -o /out/multi-agent ./cmd/cli

FROM node:22-bookworm AS pi-build
WORKDIR /src
COPY services/pi-host/package.json ./package.json
RUN npm install --package-lock=false
COPY services/pi-host/tsconfig.json ./tsconfig.json
COPY services/pi-host/src ./src
RUN npm run build

FROM node:22-bookworm-slim
WORKDIR /app
COPY services/pi-host/package.json ./package.json
RUN npm install --omit=dev \
    && node -p "require('./node_modules/@earendil-works/pi-coding-agent/package.json').version" > /app/pi-version
COPY --from=pi-build /src/dist ./pi-host
COPY --from=go-build /out/multi-agent-runtime /usr/local/bin/multi-agent-runtime
COPY --from=go-build /out/multi-agent /usr/local/bin/multi-agent
ENV MULTI_AGENT_ROOT=/app \
    MULTI_AGENT_PI_HOST=/app/pi-host/index.js \
    MULTI_AGENT_DATA_DIR=/data \
    MULTI_AGENT_PI_VERSION_FILE=/app/pi-version \
    MULTI_AGENT_AGENT_CWD=/workspace
VOLUME ["/data", "/workspace"]
ENTRYPOINT ["multi-agent-runtime"]
