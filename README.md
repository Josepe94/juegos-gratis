# Radar de Juegos Gratis — bot de Telegram + web, coste 0

Cada 3 horas, GitHub busca los juegos de PC gratis (Epic Games Store, Steam, GOG, Ubisoft, itch.io), publica los nuevos en tu canal de Telegram (y Discord si quieres) y actualiza una web pública con la lista. Todo corre gratis en GitHub Actions y GitHub Pages: no hay servidor ni ordenador encendido.

**Cómo genera ingresos (pequeños, automáticos):**
- Cada 5 publicaciones el bot añade tu enlace de afiliado (`PROMO_URL`), por ejemplo una tienda de claves con programa de afiliados.
- La web (`docs/index.html`) posiciona para búsquedas tipo "juegos gratis epic esta semana" y lleva el mismo enlace.
- Un canal con audiencia abre otras vías: reparto de anuncios de Telegram para canales grandes (verifica requisitos y disponibilidad), patrocinios, o empujar tus propios productos.

## Puesta en marcha (≈15 minutos)

1. **Crea el repositorio**: en GitHub, *New repository* → público → nombre p. ej. `juegos-gratis`. Sube todo el contenido de esta carpeta (botón *Add file → Upload files*, arrastrando también la carpeta `.github`).
2. **Crea el bot**: en Telegram habla con **@BotFather** → `/newbot` → elige nombre → copia el **token**.
3. **Crea el canal**: Telegram → Nuevo canal → público → `@tu_canal`. Añade tu bot como **administrador** con permiso para publicar.
4. **Configura el repo** (*Settings → Secrets and variables → Actions*):
   - Pestaña *Secrets* → `TELEGRAM_BOT_TOKEN` = el token.
   - Pestaña *Variables* → `TELEGRAM_CHAT_ID` = `@tu_canal`.
   - Opcionales (*Variables*): `BRAND_NAME`, `SITE_URL`, `PROMO_TEXT`, `PROMO_URL`. Opcional (*Secret*): `DISCORD_WEBHOOK_URL`.
5. **Activa la web**: *Settings → Pages* → Source: *Deploy from a branch* → rama `main`, carpeta `/docs`. Tu web será `https://TU_USUARIO.github.io/juegos-gratis/`. Ponla en la variable `SITE_URL`.
6. **Primera ejecución**: pestaña *Actions* → *Radar de juegos gratis* → *Run workflow*. En un minuto deberías ver los juegos en tu canal.

A partir de ahí no hay que tocar nada. Si un día falla, GitHub te avisa por email.

## Ajustes (variables opcionales)

| Variable | Para qué |
|---|---|
| `BRAND_NAME` | Nombre que aparece en la web y en Discord |
| `PROMO_TEXT` / `PROMO_URL` | Texto y enlace de afiliado que se añade cada 5 publicaciones y en la web |
| `SITE_URL` | URL de tu web (para SEO) |
| `MIN_WORTH` | No publicar juegos de menos de X € de precio normal |
| `GAMERPOWER_PLATFORMS` | `pc` por defecto; p. ej. `pc,ps5,switch` |

## Legal y buenas prácticas

- La web y las publicaciones marcan el enlace de afiliado como tal (LSSI y normas de cada programa).
- Se cita a GamerPower como fuente de datos de sorteos; no lo quites.
- No es una web oficial de ninguna tienda.

## Probarlo en tu ordenador

```bash
node test/test.js              # prueba sin conexión, no publica nada
DRY_RUN=1 node src/bot.js      # descarga datos reales y muestra lo que publicaría
```
