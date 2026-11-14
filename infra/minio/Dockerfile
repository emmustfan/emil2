# syntax=docker/dockerfile:1
# Official source release; public prebuilt images are no longer reliably available.
FROM golang:1.24-bookworm AS build
WORKDIR /src
ENV GOPROXY=https://proxy.golang.org GOSUMDB=sum.golang.org
RUN --mount=type=secret,id=proxy_ca \
    if [ -f /run/secrets/proxy_ca ]; then export SSL_CERT_FILE=/run/secrets/proxy_ca GIT_SSL_CAINFO=/run/secrets/proxy_ca; fi; \
    git init . && \
    git remote add origin https://github.com/minio/minio.git && \
    git fetch --depth=1 origin 07c3a429bfed433e49018cb0f78a52145d4bedeb && \
    git checkout --detach FETCH_HEAD && \
    test "$(git rev-parse HEAD)" = 07c3a429bfed433e49018cb0f78a52145d4bedeb
RUN --mount=type=secret,id=proxy_ca \
    if [ -f /run/secrets/proxy_ca ]; then export SSL_CERT_FILE=/run/secrets/proxy_ca; fi; \
    CGO_ENABLED=0 go build -p=2 -trimpath -o /out/minio .
FROM debian:bookworm-slim
COPY --from=build /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/ca-certificates.crt
COPY --from=build /out/minio /usr/local/bin/minio
EXPOSE 9000 9001
ENTRYPOINT ["minio"]
