# jq-outreach · Prospección por WhatsApp con Baileys

Sistema para contactar ~100 prospectos al día, seguirlos por etapas y enviar hasta 3 seguimientos automáticos, con hasta 2 números de WhatsApp (reparto desigual, p. ej. 70/30) y panel web.

- **web**: dashboard Next.js (importar contactos, pipeline, cola manual, plantillas, errores, números, ajustes).
- **worker**: conecta los números por Baileys, envía, detecta respuestas y programa los seguimientos.
- **Postgres**: única fuente de verdad (también hace de cola). Si el worker se reinicia no se pierde ni se duplica nada.

Web y worker salen del **mismo repositorio y la misma imagen**; solo cambia el comando de inicio.

## Despliegue en Easypanel (VPS)

1. **Sube el repo a GitHub** (privado).
2. En Easypanel crea un proyecto y dentro un servicio **Postgres**. Copia su *connection string interna* (`postgres://usuario:clave@host:5432/db`).
3. Crea el servicio **App `web`**
   - Source: GitHub → este repo, rama `main`. **Build Path: `/`**. Build: Dockerfile.
   - Puerto: `3000`. Asigna un dominio (HTTPS automático).
   - Variables de entorno (ver `.env.example`): `DATABASE_URL`, `DASHBOARD_PASSWORD`, `SESSION_SECRET` (`openssl rand -hex 32`).
   - Comando de inicio: el de la imagen (`npm run start:web`). Aplica las migraciones solo.
4. Crea el servicio **App `worker`** desde el mismo repo
   - Mismas variables de entorno.
   - En *Advanced → Command* pon: `npm run start:worker`.
   - No necesita dominio ni puerto. Déjalo en **una sola réplica**.
5. Entra al dominio de `web`, inicia sesión con `DASHBOARD_PASSWORD`.
6. **Números** → “Agregar un número”, y luego vincúlalo escaneando el QR (WhatsApp → Dispositivos vinculados) o con código de 8 caracteres.
7. **Monitoreo**: apunta UptimeRobot a `https://tu-dominio/api/health` (200 = base y worker vivos). Configura además el webhook de Discord en *Ajustes*.

> La sesión de WhatsApp vive en Postgres: no necesitas volúmenes para el worker. Haz respaldos periódicos de la base desde Easypanel (si pierdes la base, debes volver a vincular los números).

## Flujo de uso

1. **Importar**: sube CSV, Excel (.xlsx) o TXT. Elige una campaña por archivo: **Venta de páginas web** para leads sin web, o **Automatización de WhatsApp** para negocios con web. Importa cada grupo por separado; los contactos que ya existían conservan su campaña. Ambas campañas usan los intervalos de seguimiento configurados en *Ajustes*, pero sus plantillas están separadas. El sistema detecta columnas (nombre, negocio, teléfono, dirección, Instagram…), muestra una vista previa y te deja corregir el mapeo. Los teléfonos fijos o inválidos con dígitos se guardan en **Errores y revisión** con el perfil y enlace a Google Maps; corrige el teléfono desde el perfil para que se vuelva a verificar. Las filas sin ningún teléfono se informan como rechazadas.
2. **Plantillas**: revisa/edita las variantes de cada paso. Siempre deja una que funcione sin datos.
3. **Modo prueba** (Ajustes): recorre todo el flujo sin enviar nada y con los días de espera convertidos en minutos. Al terminar, “Limpiar datos de prueba”.
4. **Cola manual**: el primer mensaje lo envías tú (más seguro). Pulsa “Traer contactos”, abre cada chat con “Abrir WhatsApp”, envía; el worker detecta el envío y desde ahí gestiona los seguimientos. Si prefieres automático, cambia el modo del número.
5. **Pipeline / Contactos**: etapas, respuestas, notas y resultado (cliente, no interesado…). Quien responde o pide no recibir más mensajes (“baja”, “no me escribas”…) deja de recibir seguimientos.
6. **Errores**: todo lo que no pudo enviarse o requiere decisión (sin WhatsApp, timeout, plantilla sin datos…) con botón de reintentar.

## Reparto entre números

En *Números*, el cupo de **contactos nuevos por día** de cada uno define el reparto (p. ej. 70 y 30). El número viejo puede llegar a 100/día. Si un número cae (baneo, sesión cerrada, proxy caído), sus cupos se redistribuyen al otro y, pasado el tiempo configurado, sus contactos pendientes pasan al otro número.

## Anti-baneo (lo que hace el sistema)

Ventana horaria por zona horaria, esperas aleatorias entre mensajes, pausas largas, tope por hora y por día, textos con variables y variantes (spintax) para que no haya dos iguales, guardia contra texto repetido, interruptor de emergencia, circuit breaker por número y **proxy por número** (recomendado: uno distinto por cada número; sin proxy ambos salen por la IP del VPS).

## Desarrollo local

```bash
cp .env.example .env          # edita DATABASE_URL, DASHBOARD_PASSWORD
npm ci
npm run migrate
npm run dev:web               # http://localhost:3000
npm run dev:worker            # en otra terminal
npm test
```

O todo junto: `docker compose up --build`.

Para probar sin WhatsApp real: crea un número marcado como **simulado** y activa el **modo prueba**.

## Límites que debes conocer

- Baileys es una librería no oficial: WhatsApp puede banear números en cualquier momento. El sistema reduce el riesgo, no lo elimina.
- El comportamiento real frente a restricciones de WhatsApp (límite de chats nuevos, bloqueos temporales) solo se puede validar con un número real; el sistema las detecta y pausa, y lo verás en *Errores* y en las alertas.
- Respeta la normativa local sobre mensajes comerciales y atiende las solicitudes de baja (el sistema las detecta automáticamente).
