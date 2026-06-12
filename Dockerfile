FROM oven/bun:1.2-alpine

WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

COPY src ./src
COPY tsconfig.json ./

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000
ENV VECTOR_STORE=lance
ENV VECTOR_STORE_PATH=/data/vector

EXPOSE 3000
VOLUME ["/data/vector"]

CMD ["bun", "run", "src/index.ts"]
