FROM node:24-alpine AS build
WORKDIR /workspace
COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/package.json
COPY apps/gateway/package.json apps/gateway/package.json
COPY packages/api-client/package.json packages/api-client/package.json
RUN npm ci
COPY apps apps
COPY packages packages
ARG VITE_MAP_STYLE_URL=https://tiles.openfreemap.org/styles/liberty
ENV VITE_MAP_STYLE_URL=$VITE_MAP_STYLE_URL
RUN npm run build

FROM node:24-alpine AS runtime
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/gateway/package.json apps/gateway/package.json
RUN npm ci --omit=dev --workspace @glizzy/gateway && npm cache clean --force
COPY --from=build --chown=node:node /workspace/apps/gateway/dist apps/gateway/dist
COPY --from=build --chown=node:node /workspace/apps/web/dist apps/web/dist
USER node
EXPOSE 3000
CMD ["node", "apps/gateway/dist/server.js"]
