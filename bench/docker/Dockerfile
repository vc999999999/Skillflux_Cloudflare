# Container for L2 benchmark runs. Trials run Claude Code with every
# permission granted, so they only ever run in here.
#
#   docker build -f bench/docker/Dockerfile --build-arg CLAUDE_CODE_VERSION=<exact version> -t skillflux-bench .
#   docker run --rm -e ANTHROPIC_API_KEY -v "$PWD":/repo -w /repo skillflux-bench \
#     npm run bench -- run --model <model id> --repeats 5 --budget-usd 150
#
# The repository is mounted so results land in bench/runs/ on the host.
FROM node:22-bookworm-slim

ARG CLAUDE_CODE_VERSION
RUN test -n "$CLAUDE_CODE_VERSION" || (echo "Pass --build-arg CLAUDE_CODE_VERSION=<exact version>" && exit 1)

RUN apt-get update \
 && apt-get install -y --no-install-recommends git python3 python3-openpyxl python3-pypdf poppler-utils unzip ca-certificates \
 && rm -rf /var/lib/apt/lists/*

RUN npm install -g "@anthropic-ai/claude-code@${CLAUDE_CODE_VERSION}" && npm cache clean --force

ENV SKILLFLUX_IN_CONTAINER=1 \
    DISABLE_AUTOUPDATER=1 \
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1

# Claude Code refuses bypassPermissions as root; trials run as an unprivileged user.
USER node
WORKDIR /repo
