FROM rust:1.80 as builder
WORKDIR /app
COPY . .
RUN cargo build --release

FROM debian:bookworm-slim
WORKDIR /app
COPY --from=builder /app/target/release/flare-server /app/flare-server
ENTRYPOINT ["/app/flare-server"]
