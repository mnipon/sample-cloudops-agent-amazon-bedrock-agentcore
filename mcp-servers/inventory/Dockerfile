# Use ECR Public mirror of the official Python image to avoid Docker Hub
# anonymous pull rate limits (429 Too Many Requests) in CodeBuild.
FROM public.ecr.aws/docker/library/python:3.12-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    gcc \
    libffi-dev \
    && rm -rf /var/lib/apt/lists/*

COPY pyproject.toml .
COPY src/ src/

RUN pip install --no-cache-dir . && \
    apt-get purge -y --auto-remove gcc libffi-dev

ENV MCP_TRANSPORT=streamable-http
ENV PYTHONUNBUFFERED=1

EXPOSE 8000

HEALTHCHECK --interval=10s --timeout=5s --start-period=10s --retries=3 \
    CMD curl -sf http://localhost:8000/mcp || exit 1

CMD ["inventory-mcp-server"]
