FROM node:22

WORKDIR  /jave

COPY package*.json ./

RUN npm install

COPY . .

CMD ["node", "index.js"]
