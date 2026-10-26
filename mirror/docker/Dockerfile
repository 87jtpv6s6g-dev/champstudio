# Pins Chromium so capture/verify are byte-identical everywhere and ready for
# the future private-server move (serve replica + panel behind HTTPS).
# Playwright image tag must match the "playwright" dependency added in M1.
FROM mcr.microsoft.com/playwright:v1.47.2-jammy

# mkcert for the --lan HTTPS path (M6). Not testable in the cloud container;
# documented in README under "Phone access".
RUN apt-get update \
 && apt-get install -y --no-install-recommends libnss3-tools wget ca-certificates \
 && wget -qO /usr/local/bin/mkcert \
      https://dl.filippo.io/mkcert/latest?for=linux/amd64 \
 && chmod +x /usr/local/bin/mkcert \
 && apt-get clean && rm -rf /var/lib/apt/lists/*

RUN corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

EXPOSE 8789
CMD ["node", "dist/cli/index.js", "--help"]
