FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY . .
ENV AGENDAFLOW_DB=/data/agendaflow.db
VOLUME /data
EXPOSE 3111
CMD ["node", "server.js"]
