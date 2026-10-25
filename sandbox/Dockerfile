# Image for the server-side Python sandbox (SANDBOX_BACKEND=docker or auto).
# Build:  docker build -t paper2chapter-sandbox sandbox/
# The container runs with no network, a read-only filesystem, dropped capabilities,
# a non-root user and memory/CPU/PID limits (see backend/app/verify/sandbox.py).
FROM python:3.12-slim
RUN pip install --no-cache-dir numpy==2.3.3
USER 65534:65534
