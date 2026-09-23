FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run check && npm test && npm run build

# Runtime needs no node_modules: the server uses only built-in modules and Node runs .ts directly.
FROM node:24-alpine
WORKDIR /app
COPY package.json server.ts ./
COPY --from=build /app/dist dist
ENV DB_PATH=/data/timetester.db
EXPOSE 8787
CMD ["node", "server.ts"]
