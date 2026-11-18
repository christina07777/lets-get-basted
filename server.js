// Friendsgiving RSVP + potluck sign-up — "Let's Get Basted"
// Express server. Uses Postgres when DATABASE_URL is set (Render), otherwise a local JSON file (for testing).
const express = require("express");
const path = require("path");
const fs = require("fs");

const PORT = process.env.PORT || 3000;
const ADMIN_KEY = process.env.ADMIN_KEY || "";

// Potluck items, in order, by category. Categories listed in WRITE_IN also get a fill-in blank.
const POTLUCK = [
  ["Appetizers", ["Charcuterie board", "Chips & dip", "Veggie tray", "Deviled eggs", "Spinach-artichoke dip"]],
  ["Main Dishes", ["Turkey", "Ham", "Gravy", "Vegetarian main dish"]],
  ["Sides & Favorites", ["Mashed potatoes", "Mac & cheese", "Stuffing / dressing", "Sweet potato casserole", "Green bean casserole", "Vegetable side", "Salad", "Cranberry sauce", "Dinner rolls & butter"]],
  ["Desserts", ["Pumpkin pie", "Apple or pecan pie", "Cake / brownies / cookies", "Other dessert"]],
  ["Drinks", ["Wine / cocktails", "Beer / seltzers", "Soda / juice", "Water", "Ice", "Kava", "Kratom", "Coffee"]],
  ["Supplies & Extras", ["Plates & bowls", "Cups", "Napkins & utensils", "Serving utensils", "Take-home containers", "Coolers", "Trash bags", "Aluminum foil / plastic wrap", "Paper towels", "Chafing dishes / warming trays (with fuel)", "Tablecloths", "Bottle opener / wine opener", "Bug spray"]],
];
// Renamed items: old name -> new name (existing claims carry over).
const RENAMES = { "Water / sparkling water": "Water" };
const WRITE_IN = new Set(["Appetizers", "Sides & Favorites", "Desserts", "Drinks", "Supplies & Extras"]);
const ALL_ITEMS = POTLUCK.flatMap(([, items]) => items);
// Folding chairs: many people can pledge, each with a count. Shown at the top of Supplies & Extras.
const CHAIRS = "Folding chairs";
const CHAIRS_CATEGORY = "Supplies & Extras";
// Donations are private: stored with the extras but never shown on public pages.
const DONATION = "Donation";
const CASHTAGS = ["christinalarie", "ShannonMoceri"];
const CHAIRS_NOTE = "We need folding chairs for two spots: around the tables for dinner AND out on the lawn for hanging out. Bring as many as you can!";

// ---------- storage ----------
const clean = (v, max = 200) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const int = (v) => { const n = parseInt(v, 10); return Number.isFinite(n) && n >= 0 && n < 1000 ? n : 0; };

function makeStore() {
  if (process.env.DATABASE_URL) {
    const { Pool } = require("pg");
    const pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.PGSSL === "off" ? false : { rejectUnauthorized: false },
    });
    const q = (text, params) => pool.query(text, params);
    return {
      async init() {
        await q(`CREATE TABLE IF NOT EXISTS rsvps (
          id SERIAL PRIMARY KEY, name TEXT NOT NULL, email TEXT, phone TEXT,
          attending BOOLEAN NOT NULL DEFAULT TRUE, party_size INT NOT NULL DEFAULT 0,
          guest_names TEXT, chairs INT NOT NULL DEFAULT 0, notes TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
        await q(`CREATE TABLE IF NOT EXISTS claims (
          item TEXT PRIMARY KEY, name TEXT NOT NULL, contact TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
        await q(`CREATE TABLE IF NOT EXISTS extras (
          id SERIAL PRIMARY KEY, name TEXT NOT NULL, dish TEXT NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
        await q(`ALTER TABLE extras ADD COLUMN IF NOT EXISTS category TEXT`);
        await q(`ALTER TABLE extras ADD COLUMN IF NOT EXISTS contact TEXT`);
        await q(`CREATE TABLE IF NOT EXISTS messages (
          id SERIAL PRIMARY KEY, name TEXT NOT NULL, excited TEXT, thankful TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
        for (const [from, to] of Object.entries(RENAMES))
          await q(`UPDATE claims SET item=$2 WHERE item=$1 AND NOT EXISTS (SELECT 1 FROM claims WHERE item=$2)`, [from, to]);
      },
      async addRsvp(r) {
        const { rows } = await q(
          `INSERT INTO rsvps (name,email,phone,attending,party_size,guest_names,chairs,notes)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
          [r.name, r.email, r.phone, r.attending, r.party_size, r.guest_names, r.chairs, r.notes]);
        return rows[0].id;
      },
      async claims() { return (await q(`SELECT item,name,created_at FROM claims ORDER BY created_at`)).rows; },
      async claim(item, name, contact) {
        const r = await q(`INSERT INTO claims (item,name,contact) VALUES ($1,$2,$3) ON CONFLICT (item) DO NOTHING`, [item, name, contact]);
        return r.rowCount === 1;
      },
      async unclaim(item) { await q(`DELETE FROM claims WHERE item=$1`, [item]); },
      async extras() { return (await q(`SELECT id,name,dish,category,contact,created_at FROM extras ORDER BY created_at`)).rows; },
      async addExtra(name, dish, category, contact) { await q(`INSERT INTO extras (name,dish,category,contact) VALUES ($1,$2,$3,$4)`, [name, dish, category || null, contact || null]); },
      async deleteExtra(id) { await q(`DELETE FROM extras WHERE id=$1`, [id]); },
      async messages() { return (await q(`SELECT id,name,excited,thankful,created_at FROM messages ORDER BY created_at`)).rows; },
      async setMessage(name, excited, thankful) {
        await q(`DELETE FROM messages WHERE lower(trim(name))=lower(trim($1))`, [name]);
        await q(`INSERT INTO messages (name,excited,thankful) VALUES ($1,$2,$3)`, [name, excited || null, thankful || null]);
      },
      async deleteMessage(id) { await q(`DELETE FROM messages WHERE id=$1`, [id]); },
      async clearChairs(name) { await q(`DELETE FROM extras WHERE category=$1 AND lower(trim(name))=lower(trim($2))`, [CHAIRS, name]); },
      async rsvps() { return (await q(`SELECT * FROM rsvps ORDER BY created_at`)).rows; },
      async deleteRsvp(id) { await q(`DELETE FROM rsvps WHERE id=$1`, [id]); },
      async allClaims() { return (await q(`SELECT * FROM claims ORDER BY created_at`)).rows; },
    };
  }

  // Local JSON-file store (testing only — Render's disk is wiped on redeploy, so use Postgres there).
  const file = process.env.DATA_FILE || path.join(__dirname, "data.json");
  let data = { rsvps: [], claims: [], extras: [], messages: [], seq: 1 };
  const save = () => fs.writeFileSync(file, JSON.stringify(data, null, 1));
  const now = () => new Date().toISOString();
  return {
    async init() {
      if (fs.existsSync(file)) data = JSON.parse(fs.readFileSync(file, "utf8"));
      data.claims.forEach((c) => { if (RENAMES[c.item]) c.item = RENAMES[c.item]; });
      data.messages = data.messages || [];
    },
    async addRsvp(r) { const id = data.seq++; data.rsvps.push({ id, ...r, created_at: now() }); save(); return id; },
    async claims() { return data.claims.map(({ item, name, created_at }) => ({ item, name, created_at })); },
    async claim(item, name, contact) {
      if (data.claims.some((c) => c.item === item)) return false;
      data.claims.push({ item, name, contact, created_at: now() }); save(); return true;
    },
    async unclaim(item) { data.claims = data.claims.filter((c) => c.item !== item); save(); },
    async extras() { return data.extras; },
    async addExtra(name, dish, category, contact) { data.extras.push({ id: data.seq++, name, dish, category: category || null, contact: contact || null, created_at: now() }); save(); },
    async deleteExtra(id) { data.extras = data.extras.filter((e) => e.id !== id); save(); },
    async messages() { return data.messages; },
    async setMessage(name, excited, thankful) {
      const n = name.trim().toLowerCase();
      data.messages = data.messages.filter((m) => String(m.name).trim().toLowerCase() !== n);
      data.messages.push({ id: data.seq++, name, excited: excited || null, thankful: thankful || null, created_at: now() }); save();
    },
    async deleteMessage(id) { data.messages = data.messages.filter((m) => m.id !== id); save(); },
    async clearChairs(name) { const n = name.trim().toLowerCase(); data.extras = data.extras.filter((e) => !(e.category === CHAIRS && String(e.name).trim().toLowerCase() === n)); save(); },
    async rsvps() { return data.rsvps; },
    async deleteRsvp(id) { data.rsvps = data.rsvps.filter((r) => r.id !== id); save(); },
    async allClaims() { return data.claims; },
  };
}

const store = makeStore();
const app = express();
app.use(express.json({ limit: "20kb" }));
app.use(express.static(path.join(__dirname, "public"), { extensions: ["html"] }));

const wrap = (fn) => (req, res) => fn(req, res).catch((e) => { console.error(e); res.status(500).json({ error: "Something went wrong. Please try again." }); });
const isAdmin = (req) => ADMIN_KEY && req.get("x-admin-key") === ADMIN_KEY;

// ---------- public API ----------
app.post("/api/rsvp", wrap(async (req, res) => {
  const b = req.body || {};
  const r = {
    name: clean(b.name, 100),
    email: clean(b.email, 120),
    phone: clean(b.phone, 40),
    attending: b.attending !== false,
    party_size: int(b.party_size),
    guest_names: clean(b.guest_names, 600),
    chairs: int(b.chairs),
    notes: clean(b.notes, 600),
  };
  if (!r.name) return res.status(400).json({ error: "Please add your name." });
  const id = await store.addRsvp(r);
  // Chairs from the RSVP go into the same pledge list the potluck page and dashboard use.
  if (r.attending && r.chairs) await setChairs(r.name, Math.min(r.chairs, 50), r.phone || r.email);
  res.json({ ok: true, id });
}));

// One chair pledge per person (by name): a new number replaces their old one, so nothing is double-counted.
async function setChairs(name, qty, contact) {
  await store.clearChairs(name);
  await store.addExtra(name, String(qty), CHAIRS, contact);
}

function chairInfo(extras) {
  const pledges = extras.filter((x) => x.category === CHAIRS).map((x) => ({ name: x.name, qty: int(x.dish) }));
  return { label: CHAIRS, note: CHAIRS_NOTE, pledges, total: pledges.reduce((n, p) => n + p.qty, 0) };
}

app.get("/api/potluck", wrap(async (_req, res) => {
  const claims = await store.claims();
  const extras = await store.extras();
  const byItem = Object.fromEntries(claims.map((c) => [c.item, c.name]));
  res.json({
    total: ALL_ITEMS.length,
    claimed: claims.filter((c) => ALL_ITEMS.includes(c.item)).length,
    categories: POTLUCK.map(([name, items]) => ({
      name, writeIn: WRITE_IN.has(name),
      items: items.map((item) => ({ item, by: byItem[item] || null })),
      extras: extras.filter((x) => x.category === name).map(({ name: n, dish }) => ({ name: n, dish })),
      chairs: name === CHAIRS_CATEGORY ? chairInfo(extras) : undefined,
    })),
    extras: extras.filter((x) => !WRITE_IN.has(x.category) && x.category !== CHAIRS && x.category !== DONATION).map(({ name, dish }) => ({ name, dish })),
  });
}));

app.post("/api/claim", wrap(async (req, res) => {
  const item = clean(req.body?.item, 100);
  const name = clean(req.body?.name, 100);
  const contact = clean(req.body?.contact, 120);
  if (!ALL_ITEMS.includes(item)) return res.status(400).json({ error: "That item isn't on the list." });
  if (!name) return res.status(400).json({ error: "Please add your name." });
  const ok = await store.claim(item, name, contact);
  if (!ok) return res.status(409).json({ error: "Someone just claimed that one. Pick another?" });
  res.json({ ok: true });
}));

// One submit: claim picked items + add fill-ins.
app.post("/api/signup", wrap(async (req, res) => {
  const name = clean(req.body?.name, 100);
  const contact = clean(req.body?.contact, 120);
  const items = Array.isArray(req.body?.items) ? [...new Set(req.body.items.map((i) => clean(i, 100)))].filter((i) => ALL_ITEMS.includes(i)).slice(0, 20) : [];
  const writeins = Array.isArray(req.body?.writeins) ? req.body.writeins
    .map((w) => ({ category: clean(w?.category, 60), dish: clean(w?.dish, 200) }))
    .filter((w) => w.dish && WRITE_IN.has(w.category)).slice(0, 10) : [];
  const chairs = Math.min(int(req.body?.chairs), 50);
  const excited = clean(req.body?.excited, 500);
  const thankful = clean(req.body?.thankful, 500);
  const hasMsg = !!(excited || thankful);
  const donation = Math.min(int(req.body?.donation), 1000);
  const payTo = CASHTAGS.includes(req.body?.payTo) ? req.body.payTo : "";
  if (!name) return res.status(400).json({ error: "Please add your name." });
  if (!items.length && !writeins.length && !chairs && !hasMsg && !donation) return res.status(400).json({ error: "Pick an item or type one in first." });
  const claimed = [], taken = [];
  for (const item of items) ((await store.claim(item, name, contact)) ? claimed : taken).push(item);
  for (const w of writeins) await store.addExtra(name, w.dish, w.category, contact);
  if (chairs) await setChairs(name, chairs, contact);
  if (hasMsg) await store.setMessage(name, excited, thankful);
  if (donation) await store.addExtra(name, String(donation), DONATION, [contact, payTo && `to $${payTo}`].filter(Boolean).join(" · "));
  if (!claimed.length && !writeins.length && !chairs && !hasMsg && !donation) return res.status(409).json({ error: `Someone just claimed ${taken.join(", ")}. Pick something else?`, taken });
  res.json({ ok: true, claimed, taken, message: hasMsg, donation, added: [...writeins.map((w) => w.dish), ...(chairs ? [`${chairs} folding chair${chairs > 1 ? "s" : ""}`] : [])] });
}));

app.post("/api/extra", wrap(async (req, res) => {
  const name = clean(req.body?.name, 100);
  const dish = clean(req.body?.dish, 200);
  if (!name || !dish) return res.status(400).json({ error: "Please add your name and what you're bringing." });
  await store.addExtra(name, dish);
  res.json({ ok: true });
}));

// Public "Who's coming" data. Never includes phone numbers, emails, contacts or private RSVP notes.
app.get("/api/public", wrap(async (_req, res) => {
  const [rsvps, claims, extras, messages] = await Promise.all([store.rsvps(), store.allClaims(), store.extras(), store.messages()]);
  const key = (n) => String(n || "").trim().toLowerCase();
  const people = new Map();
  const person = (name) => {
    const k = key(name); if (!k) return null;
    if (!people.has(k)) people.set(k, { name: String(name).trim(), coming: false, party: 0, guests: "", bringing: [], chairs: 0, excited: "", thankful: "" });
    return people.get(k);
  };
  for (const r of rsvps) {
    const p = person(r.name); if (!p) continue;
    if (r.attending) { p.coming = true; p.party = r.party_size || p.party; p.guests = r.guest_names || p.guests; }
  }
  for (const c of claims) { const p = person(c.name); if (p) p.bringing.push(c.item); }
  for (const x of extras) {
    const p = person(x.name); if (!p) continue;
    if (x.category === DONATION) continue; // private
    if (x.category === CHAIRS) p.chairs += int(x.dish); else p.bringing.push(x.dish);
  }
  for (const m of messages) { const p = person(m.name); if (p) { p.excited = m.excited || ""; p.thankful = m.thankful || ""; } }
  const list = [...people.values()].filter((p) => p.coming || p.bringing.length || p.chairs || p.excited || p.thankful);
  res.json({
    people: list,
    totals: {
      guests: rsvps.filter((r) => r.attending).reduce((n, r) => n + (r.party_size || 0), 0),
      parties: rsvps.filter((r) => r.attending).length,
      claimed: claims.filter((c) => ALL_ITEMS.includes(c.item)).length, items: ALL_ITEMS.length,
      chairs: chairInfo(extras).total,
    },
  });
}));

// ---------- host API (needs ADMIN_KEY) ----------
app.get("/api/admin", wrap(async (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ error: "Wrong host key." });
  const rsvps = await store.rsvps();
  const yes = rsvps.filter((r) => r.attending);
  res.json({
    rsvps, claims: await store.allClaims(), extras: await store.extras(), messages: await store.messages(), totalItems: ALL_ITEMS.length,
    guests: yes.reduce((n, r) => n + (r.party_size || 0), 0),
    chairs: chairInfo(await store.extras()).total,
    donations: (await store.extras()).filter((x) => x.category === DONATION).reduce((n, x) => n + int(x.dish), 0),
  });
}));
app.delete("/api/admin/claim", wrap(async (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ error: "Wrong host key." });
  await store.unclaim(clean(req.body?.item, 100)); res.json({ ok: true });
}));
app.delete("/api/admin/rsvp/:id", wrap(async (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ error: "Wrong host key." });
  await store.deleteRsvp(int(req.params.id)); res.json({ ok: true });
}));
app.delete("/api/admin/message/:id", wrap(async (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ error: "Wrong host key." });
  await store.deleteMessage(int(req.params.id)); res.json({ ok: true });
}));
app.delete("/api/admin/extra/:id", wrap(async (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ error: "Wrong host key." });
  await store.deleteExtra(int(req.params.id)); res.json({ ok: true });
}));

store.init().then(() => app.listen(PORT, () => console.log(`Let's Get Basted on :${PORT}`)))
  .catch((e) => { console.error("Database setup failed:", e); process.exit(1); });
