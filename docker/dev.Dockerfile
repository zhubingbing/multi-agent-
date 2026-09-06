FROM node:22-bookworm AS node

FROM golang:1.23-bookworm

COPY --from=node /usr/local/ /usr/local/

RUN go install github.com/air-verse/air@v1.61.7

WORKDIR /workspace
