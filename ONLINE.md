# Play online (Cloudflare, free)

The game and the race rooms run on Cloudflare's free plan, on your own domain.
One-time setup, about 10 minutes. After that, every push to GitHub updates the site by itself.

## 1. Connect the repo

1. Cloudflare dashboard → **Workers & Pages** → **Create** → **Import a repository**.
2. Pick GitHub → `Laithalamo/XALXE---BLUR`.
3. Settings:
   - **Project name:** `xalxe` (must be exactly this)
   - **Production branch:** `claude/eager-dirac-ugk67q` (or `main` once it's merged)
   - **Build command:** `npm ci && npm run build`
   - **Deploy command:** `npx wrangler deploy`
4. **Deploy**. The first build takes a few minutes.

## 2. Use your domain

Worker `xalxe` → **Settings** → **Domains & Routes** → **Add** → **Custom domain** → `valve.ist`
(or `race.valve.ist` if the main domain already has a website). Cloudflare adds the DNS record.

## 3. Password (recommended)

Worker `xalxe` → **Settings** → **Variables and Secrets** → **Add**:
type **Secret**, name `SITE_PASSWORD`, value = your password. **Deploy**.
Everyone gets the password page once per browser. Without it the site is open to anyone with the link.

## Playing

1. Open the site → **Esc** → type your name → **CREATE ROOM**.
2. **COPY LINK** and send it to your friends (or tell them the 4-letter code → **JOIN**).
3. Host: choose AI cars and laps → **START RACE**.

- Up to 8 cars per race (players + AI). Every player drives their own car; the host's
  browser runs the AI cars, power-ups and race rules.
- If the host leaves, the next player becomes host and the room goes back to the menu.
- Friends who join during a race play the next one.

## Free plan limits

Rooms use Cloudflare Durable Objects: 100,000 requests a day (each player sends 20 updates a
second, counted 20 to 1; AI cars cost nothing). That is about **3½ hours of racing a day with
8 players, 7 hours with 4, 14 hours with 2**. Over the limit, online races stop until 03:00
(Istanbul time). The free plan never charges.

## On the home WiFi

`start.bat` (or `npm start`) also runs rooms: open the address it prints and use **CREATE ROOM** /
**JOIN** the same way.
