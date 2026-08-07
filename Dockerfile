# ---- Build ----
# Vite 8 needs Node >= 22.12.
FROM node:22-alpine AS build

WORKDIR /app

# Copied separately so the dependency layer survives source-only changes.
COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

# ---- Serve ----
# The app is a static SPA that talks to the Radio Browser API straight
# from the browser, so nothing needs to run server-side.
FROM nginx:alpine

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1/ >/dev/null 2>&1 || exit 1

CMD ["nginx", "-g", "daemon off;"]
