# Let’s Get Basted! — Friendsgiving RSVP + Potluck Sign-Up

Pages:
- `/` is the invite and RSVP form. After someone RSVPs “Count me in”, they get a button to the potluck sign-up.
- `/potluck` is the live potluck list. Guests claim items, and a claimed item shows who’s bringing it, so nothing gets doubled up.
- `/host` is the private hosts’ dashboard: every RSVP, guest count, chairs pledged and dish claims, plus a “Copy everything as text” button. It’s protected by a host key.

Colors, fonts and decorations follow the **Let’s Get Basted** brand guide (`public/brand.css` has the tokens).

## Put it online (Render, free)

1. **Make a GitHub repo.** On github.com, click **New repository**, name it `lets-get-basted` and create it. Click **uploading an existing file**, drag in everything from this folder (including the `public` folder), and click **Commit changes**.
2. **Create it on Render.** On render.com, sign in with GitHub, then click **New → Blueprint**. Pick the `lets-get-basted` repo and click **Apply**. Render reads `render.yaml` and creates both the website and a free Postgres database. Wait for it to say **Live**, which takes a few minutes.
3. **Get your link.** It looks like `https://lets-get-basted.onrender.com`. That’s the link to text guests.
4. **Get your host key.** In Render, open the **lets-get-basted** service, go to **Environment**, and copy the value of `ADMIN_KEY`. Open `your-link/host`, paste the key, and you’ll see everything. Share it only with your co-host.

## Good to know

- **Free sleep.** On the free plan the site goes to sleep after 15 minutes without visitors, so the first visit after that takes about 30–50 seconds to load. To avoid this, upgrade the web service to the **Starter** plan ($7/month) for the week of the party.
- **Free database limit.** Render’s free database expires 30 days after you create it, which is fine for a party on Nov 21. Copy your list from `/host` afterwards if you want to keep it.
- **Change the menu.** Edit the `POTLUCK` list at the top of `server.js`, commit it on GitHub, and Render redeploys automatically.
- **Release a dish.** If someone needs to give back an item they claimed, use **Release** on `/host`.
- **Test locally (optional).** Run `npm install` and then `ADMIN_KEY=test npm start`, then open http://localhost:3000. Without a database it saves to `data.json`.
