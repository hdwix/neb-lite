FROM node:24.11.0-alpine3.21

WORKDIR /usr/src/app

COPY package*.json ./

RUN npm cache clean --force

RUN npm install rimraf

RUN npm i -g @nestjs/cli

RUN npm ci

COPY . .

RUN npm run build

EXPOSE 3000

CMD [ "node", "dist/main.js" ]