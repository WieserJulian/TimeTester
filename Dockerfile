FROM node:24-alpine
WORKDIR /app
COPY . .
ENV DB_PATH=/data/timetester.db
EXPOSE 8787
CMD ["node", "server.js"]
