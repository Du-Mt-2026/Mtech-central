# ============================================
# OctupusZap Deploy Receiver (minimal)
# ============================================
# Isolated HTTP webhook receiver that triggers Docker rebuilds.
# Owns the docker.sock so the app container doesn't have to.
#
# See: docs/design-docker-sock-removal.md (P0.6)
# ============================================

FROM python:3.12-alpine

# Install only what we need: git + docker-cli (for compose commands)
RUN apk add --no-cache git docker-cli docker-compose curl

WORKDIR /app

# Copy receiver script
COPY receiver.py /app/receiver.py

# Create non-root user
RUN adduser -D -u 1001 receiver && \
    mkdir -p /opt/octupuszap && \
    chown -R receiver:receiver /app /opt/octupuszap

USER 1001

EXPOSE 3001

# Healthcheck — receiver should respond to GET with JSON
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
    CMD curl -sf http://localhost:3001/api/deploy || exit 1

CMD ["python3", "/app/receiver.py"]
