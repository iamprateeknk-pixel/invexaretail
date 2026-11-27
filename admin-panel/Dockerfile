# Control Plane image: build the static login shell, serve it with Nginx.
# VITE_API_BASE / VITE_WEB_APP_URL are baked in at build time
# (docker compose passes them as build args; defaults are the production hosts).
FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm install --ignore-scripts --no-audit --no-fund
COPY . .
ARG VITE_API_BASE=https://invexaretail.com
ARG VITE_WEB_APP_URL=https://invexaretail.com
ENV VITE_API_BASE=$VITE_API_BASE VITE_WEB_APP_URL=$VITE_WEB_APP_URL
RUN npm run build

FROM nginx:1.27-alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
