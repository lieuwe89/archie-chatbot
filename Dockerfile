FROM node:20-bookworm-slim AS base
WORKDIR /app
ENV NODE_ENV=production

FROM base AS build
RUN apt-get update -qq && apt-get install --no-install-recommends -y build-essential node-gyp pkg-config python3
COPY package-lock.json package.json ./
RUN npm ci --include=dev
COPY . .
RUN npm run build

FROM base
RUN apt-get update -qq && apt-get install --no-install-recommends -y python3 make g++
COPY --from=build /app /app
RUN npm rebuild node-pty --build-from-source
EXPOSE 4008
CMD [ "node", "server/index.js" ]
