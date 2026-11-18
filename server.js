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
  ["Drinks", ["Wine to share", "Beer / seltzers to share", "Soda / juice", "Water", "Ice", "Kava", "Kratom", "Coffee"]],
  ["Supplies & Extras", ["Folding chairs", "Plates & bowls", "Cups", "Napkins & utensils", "Serving utensils", "Take-home containers", "Coolers", "Trash bags", "Aluminum foil / plastic wrap", "Paper towels", "Chafing dishes / warming trays (with fuel)", "Tablecloths", "Bottle opener / wine opener", "Bug spray"]],
];
// Renamed items: old name -> new name (existing claims carry over).
const RENAMES = { "Water / sparkling water": "Water", "Wine / cocktails": "Wine to share", "Beer / seltzers": "Beer / seltzers to share" };
const WRITE_IN = new Set(["Appetizers", "Sides & Favorites", "Desserts", "Drinks", "Supplies & Extras"]);
const ALL_ITEMS = POTLUCK.flatMap(([, items]) => items);

// Goals scale with the guest count: at least 30, or more once RSVPs go past 30.
const MIN_GUESTS = 30;
const CHAIRS = "Folding chairs";
const CHAIRS_NOTE = "We need folding chairs for two spots: around the tables for dinner AND out on the lawn for hanging out. Bring as many as you can!";
// Count items: anyone can pledge a number toward a goal of 1 per `per` guests.
const COUNTS = {
  [CHAIRS]: { unit: "chairs", per: 1, note: CHAIRS_NOTE },
  "Ice": { unit: "bags", per: 5 },
  "Water": { unit: "cases", per: 10 },
  "Soda / juice": { unit: "packs or 2-liters", per: 8 },
  "Coolers": { unit: "coolers", per: 8 },
  "Tablecloths": { unit: "tablecloths", per: 8 },
  "Chafing dishes / warming trays (with fuel)": { unit: "trays", per: 8 },
  "Serving utensils": { unit: "sets", per: 4 },
  "Take-home containers": { unit: "packs", per: 15 },
};
// Multi items: more than one person can claim; 1 spot per 15 guests (2 spots at 30).
const MULTI = new Set(["Pumpkin pie", "Dinner rolls & butter", "Mac & cheese", "Mashed potatoes", "Salad", "Coffee"]);
const MULTI_PER = 15;
const CLAIMABLE = ALL_ITEMS.filter((i) => !COUNTS[i]);
// Donations are private: stored with the extras but never shown on public pages.
const DONATION = "Donation";
const CASHTAGS = ["christinalarie", "ShannonMoceri"];

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
        // Older single-claim water/soda/ice etc. become count pledges.
        for (const item of Object.keys(COUNTS)) {
          const { rows } = await q(`SELECT name,contact FROM claims WHERE item=$1`, [item]);
          for (const r of rows) await q(`INSERT INTO extras (name,dish,category,contact) VALUES ($1,'1',$2,$3)`, [r.name, item, r.contact]);
          await q(`DELETE FROM claims WHERE item=$1`, [item]);
        }
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
      async clearCategory(name, category) { await q(`DELETE FROM extras WHERE category=$1 AND lower(trim(name))=lower(trim($2))`, [category, name]); },
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
      for (const c of data.claims.filter((c) => COUNTS[c.item])) data.extras.push({ id: data.seq++, name: c.name, dish: "1", category: c.item, contact: c.contact || null, created_at: now() });
      data.claims = data.claims.filter((c) => !COUNTS[c.item]); save();
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
    async clearCategory(name, category) { const n = name.trim().toLowerCase(); data.extras = data.extras.filter((e) => !(e.category === category && String(e.name).trim().toLowerCase() === n)); save(); },
    async rsvps() { return data.rsvps; },
    async deleteRsvp(id) { data.rsvps = data.rsvps.filter((r) => r.id !== id); save(); },
    async allClaims() { return data.claims; },
  };
}

const store = makeStore();
const app = express();
app.use(express.json({ limit: "20kb" }));
// Keep the party pages out of search engines (address + guest names).
app.use((_req, res, next) => { res.set("X-Robots-Tag", "noindex, nofollow"); next(); });
app.use(express.static(path.join(__dirname, "public"), { extensions: ["html"] }));

const wrap = (fn) => (req, res) => fn(req, res).catch((e) => { console.error(e); res.status(500).json({ error: "Something went wrong. Please try again." }); });
const isAdmin = (req) => ADMIN_KEY && req.get("x-admin-key") === ADMIN_KEY;

// ---------- public API ----------
const baseItem = (key) => String(key).replace(/ #\d+$/, "");
const spotKey = (item, k) => (k === 1 ? item : `${item} #${k}`);
const headcount = (rsvps) => Math.max(MIN_GUESTS, rsvps.filter((r) => r.attending).reduce((n, r) => n + (r.party_size || 0), 0));
const spotsFor = (H) => Math.ceil(H / MULTI_PER);
const goalFor = (item, H) => Math.ceil(H / COUNTS[item].per);

function countInfo(item, extras, H) {
  const pledges = extras.filter((x) => x.category === item).map((x) => ({ name: x.name, qty: int(x.dish) }));
  return { item, type: "count", unit: COUNTS[item].unit, note: COUNTS[item].note || "", goal: goalFor(item, H),
    pledges, total: pledges.reduce((n, p) => n + p.qty, 0) };
}
// One pledge per person per item (by name): a new number replaces their old one, so nothing is double-counted.
async function setCount(name, item, qty, contact) {
  await store.clearCategory(name, item);
  if (qty > 0) await store.addExtra(name, String(qty), item, contact);
}
async function claimItem(item, name, contact, H) {
  if (!MULTI.has(item)) return (await store.claim(item, name, contact)) ? item : null;
  for (let k = 1; k <= spotsFor(H); k++) if (await store.claim(spotKey(item, k), name, contact)) return item;
  return null;
}
function slotTotals(claims, H) {
  const total = CLAIMABLE.reduce((n, i) => n + (MULTI.has(i) ? spotsFor(H) : 1), 0);
  const filled = CLAIMABLE.reduce((n, i) => n + Math.min(claims.filter((c) => baseItem(c.item) === i).length, MULTI.has(i) ? spotsFor(H) : 1), 0);
  return { total, filled };
}

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
  if (r.attending && r.chairs) await setCount(r.name, CHAIRS, Math.min(r.chairs, 50), r.phone || r.email);
  const donation = Math.min(int(b.donation), 1000);
  const payTo = CASHTAGS.includes(b.payTo) ? b.payTo : "";
  if (donation) await store.addExtra(r.name, String(donation), DONATION, [r.phone || r.email, payTo && `to $${payTo}`].filter(Boolean).join(" · "));
  res.json({ ok: true, id, donation });
}));

app.get("/api/potluck", wrap(async (_req, res) => {
  const [claims, extras, rsvps] = await Promise.all([store.claims(), store.extras(), store.rsvps()]);
  const H = headcount(rsvps), spots = spotsFor(H);
  const byBase = {};
  for (const c of claims) (byBase[baseItem(c.item)] ||= []).push(c.name);
  const t = slotTotals(claims, H);
  res.json({
    headcount: H, total: t.total, claimed: t.filled,
    categories: POTLUCK.map(([name, items]) => ({
      name, writeIn: WRITE_IN.has(name),
      items: items.map((item) => COUNTS[item] ? countInfo(item, extras, H)
        : MULTI.has(item) ? { item, type: "multi", spots, by: (byBase[item] || []).slice(0, Math.max(spots, (byBase[item] || []).length)) }
        : { item, type: "single", by: (byBase[item] || [])[0] || null }),
      extras: extras.filter((x) => x.category === name).map(({ name: n, dish }) => ({ name: n, dish })),
    })),
    extras: extras.filter((x) => !WRITE_IN.has(x.category) && !COUNTS[x.category] && x.category !== DONATION).map(({ name, dish }) => ({ name, dish })),
  });
}));

app.post("/api/claim", wrap(async (req, res) => {
  const item = clean(req.body?.item, 100);
  const name = clean(req.body?.name, 100);
  const contact = clean(req.body?.contact, 120);
  if (!CLAIMABLE.includes(item)) return res.status(400).json({ error: "That item isn't on the list." });
  if (!name) return res.status(400).json({ error: "Please add your name." });
  const ok = await claimItem(item, name, contact, headcount(await store.rsvps()));
  if (!ok) return res.status(409).json({ error: "Someone just claimed that one. Pick another?" });
  res.json({ ok: true });
}));

// One submit: claim picked items, quantities, fill-ins, comment and donation.
app.post("/api/signup", wrap(async (req, res) => {
  const name = clean(req.body?.name, 100);
  const contact = clean(req.body?.contact, 120);
  const items = Array.isArray(req.body?.items) ? [...new Set(req.body.items.map((i) => clean(i, 100)))].filter((i) => CLAIMABLE.includes(i)).slice(0, 25) : [];
  const writeins = Array.isArray(req.body?.writeins) ? req.body.writeins
    .map((w) => ({ category: clean(w?.category, 60), dish: clean(w?.dish, 200) }))
    .filter((w) => w.dish && WRITE_IN.has(w.category)).slice(0, 10) : [];
  const counts = {};
  const rawCounts = req.body?.counts && typeof req.body.counts === "object" ? req.body.counts : {};
  for (const [k, v] of Object.entries(rawCounts)) if (COUNTS[k] && int(v)) counts[k] = Math.min(int(v), 50);
  if (int(req.body?.chairs) && !counts[CHAIRS]) counts[CHAIRS] = Math.min(int(req.body.chairs), 50);
  const excited = clean(req.body?.excited, 500);
  const thankful = clean(req.body?.thankful, 500);
  const hasMsg = !!(excited || thankful);
  const donation = Math.min(int(req.body?.donation), 1000);
  const payTo = CASHTAGS.includes(req.body?.payTo) ? req.body.payTo : "";
  const hasCounts = Object.keys(counts).length > 0;
  if (!name) return res.status(400).json({ error: "Please add your name." });
  if (!items.length && !writeins.length && !hasCounts && !hasMsg && !donation) return res.status(400).json({ error: "Pick an item or type one in first." });
  const H = headcount(await store.rsvps());
  const claimed = [], taken = [];
  for (const item of items) ((await claimItem(item, name, contact, H)) ? claimed : taken).push(item);
  for (const w of writeins) await store.addExtra(name, w.dish, w.category, contact);
  for (const [item, qty] of Object.entries(counts)) await setCount(name, item, qty, contact);
  if (hasMsg) await store.setMessage(name, excited, thankful);
  if (donation) await store.addExtra(name, String(donation), DONATION, [contact, payTo && `to $${payTo}`].filter(Boolean).join(" · "));
  if (!claimed.length && !writeins.length && !hasCounts && !hasMsg && !donation) return res.status(409).json({ error: `Someone just claimed ${taken.join(", ")}. Pick something else?`, taken });
  res.json({ ok: true, claimed, taken, message: hasMsg, donation,
    added: [...writeins.map((w) => w.dish), ...Object.entries(counts).map(([i, q]) => `${q} ${COUNTS[i].unit} (${i})`)] });
}));

app.post("/api/extra", wrap(async (req, res) => {
  const name = clean(req.body?.name, 100);
  const dish = clean(req.body?.dish, 200);
  if (!name || !dish) return res.status(400).json({ error: "Please add your name and what you're bringing." });
  await store.addExtra(name, dish);
  res.json({ ok: true });
}));

// Public "Who's coming" data. Never includes phone numbers, emails, contacts, donations or private RSVP notes.
app.get("/api/public", wrap(async (_req, res) => {
  const [rsvps, claims, extras, messages] = await Promise.all([store.rsvps(), store.allClaims(), store.extras(), store.messages()]);
  const H = headcount(rsvps);
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
  for (const c of claims) { const p = person(c.name); if (p) p.bringing.push(baseItem(c.item)); }
  for (const x of extras) {
    if (x.category === DONATION) continue; // private
    const p = person(x.name); if (!p) continue;
    if (x.category === CHAIRS) p.chairs += int(x.dish);
    else if (COUNTS[x.category]) p.bringing.push(`${x.category} (${int(x.dish)})`);
    else p.bringing.push(x.dish);
  }
  for (const m of messages) { const p = person(m.name); if (p) { p.excited = m.excited || ""; p.thankful = m.thankful || ""; } }
  const list = [...people.values()].filter((p) => p.coming || p.bringing.length || p.chairs || p.excited || p.thankful);
  const t = slotTotals(claims, H);
  res.json({
    people: list,
    totals: {
      guests: rsvps.filter((r) => r.attending).reduce((n, r) => n + (r.party_size || 0), 0),
      parties: rsvps.filter((r) => r.attending).length,
      claimed: t.filled, items: t.total,
      chairs: countInfo(CHAIRS, extras, H).total, chairsGoal: goalFor(CHAIRS, H),
    },
  });
}));

// ---------- host API (needs ADMIN_KEY) ----------
app.get("/api/admin", wrap(async (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ error: "Wrong host key." });
  const rsvps = await store.rsvps();
  const yes = rsvps.filter((r) => r.attending);
  const [claims, extras, messages] = await Promise.all([store.allClaims(), store.extras(), store.messages()]);
  const H = headcount(rsvps), t = slotTotals(claims, H);
  res.json({
    rsvps, claims, extras, messages, headcount: H, claimedSlots: t.filled, totalItems: t.total,
    countItems: Object.keys(COUNTS),
    counts: Object.keys(COUNTS).map((item) => ({ ...countInfo(item, extras, H),
      pledges: extras.filter((x) => x.category === item).map((x) => ({ id: x.id, name: x.name, qty: int(x.dish), contact: x.contact })) })),
    guests: yes.reduce((n, r) => n + (r.party_size || 0), 0),
    chairs: countInfo(CHAIRS, extras, H).total,
    donations: extras.filter((x) => x.category === DONATION).reduce((n, x) => n + int(x.dish), 0),
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
