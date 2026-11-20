# Una sola imagen para web y worker. El rol se elige con la variable APP_ROLE:
#   APP_ROLE=worker  -> npm run start:worker
#   (sin variable)   -> npm run start:web
FROM node:22-bookworm-slim

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    TZ=America/Santiago

WORKDIR /app

COPY package.json package-lock.json ./
# Se instalan también las devDependencies: el build las necesita y tsx corre el worker.
RUN npm ci --include=dev && npm cache clean --force

COPY . .

# El build no toca la base de datos; estas variables solo evitan avisos de configuración.
RUN DATABASE_URL=postgres://build:build@localhost:5432/build DASHBOARD_PASSWORD=build SESSION_SECRET=build npm run build

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD [ "$APP_ROLE" = "worker" ] || node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.status<=503?0:1)).catch(()=>process.exit(1))"

CMD ["sh", "-c", "if [ \"$APP_ROLE\" = \"worker\" ]; then exec npm run start:worker; else exec npm run start:web; fi"]