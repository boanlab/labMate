# 1) Node 빌드 스테이지 (호스트에 node가 없어도 docker가 처리)
FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build

# 2) Nginx 서빙 스테이지
FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
# 배포가 바뀌어도 옛 화면이 받아 가던 조각은 남겨 둔다(/srv/keep 에 쌓고 없으면 그쪽에서 낸다)
COPY keep-assets.sh /usr/local/bin/keep-assets.sh
RUN chmod +x /usr/local/bin/keep-assets.sh
ENTRYPOINT ["/usr/local/bin/keep-assets.sh"]
CMD ["nginx", "-g", "daemon off;"]
EXPOSE 80
