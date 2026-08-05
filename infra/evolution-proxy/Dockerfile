FROM node:20-alpine
WORKDIR /app
RUN npm install express http-proxy-middleware axios
COPY server.js .
EXPOSE 3001
CMD ["node", "server.js"]
