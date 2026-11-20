FROM node:22-bookworm-slim

# Install build essentials for better-sqlite3 native addon if prebuild is missing
RUN apt-get update && apt-get install -y python3 make g++ git && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

COPY . .

RUN mkdir -p /data/auth_info_baileys /data/backups /data/uploads && chmod -R 777 /data /app

ENV NODE_ENV=production
ENV PORT=7860

EXPOSE 7860 3000

CMD ["node", "index.js"]
