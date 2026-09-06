FROM golang:1.23-bookworm AS build
ENV GOPROXY=https://goproxy.cn,direct
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY cmd/control ./cmd/control
RUN GOMAXPROCS=2 CGO_ENABLED=0 go build -p 1 -trimpath -o /out/multi-agent-control ./cmd/control

FROM golang:1.23-bookworm
WORKDIR /app
COPY --from=build /out/multi-agent-control /usr/local/bin/multi-agent-control
VOLUME ["/app/data"]
EXPOSE 30146
ENTRYPOINT ["multi-agent-control"]
CMD ["-addr", "0.0.0.0:30146", "-web-upstream", "http://host.docker.internal:30148", "-db", "/app/data/control.db"]
