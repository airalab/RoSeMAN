FROM node:24-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY dist/ ./dist/

EXPOSE ${PORT:-3000}

CMD ["node", "dist/main.js"]
