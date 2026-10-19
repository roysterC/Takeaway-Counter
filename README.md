# Takeaway Counter

Phone ordering for Chinese takeaways, starting with **Hixon Chinese Takeaway**
(2A Smithy Lane, Hixon, ST18 0PP). Built on the same foundations as
call-assistant (the salon CRM), with the booking parts swapped for ordering.

Two parts:

1. **The phone receptionist.** It answers *"Hello, it's Hixon Chinese
   Takeaway. Is it for collection or delivery?"*, confirms the caller's name
   (and address, for delivery), and takes the order from the real menu.
   A new delivery customer is only asked for their postcode and house
   number: the address is looked up (Ideal Postcodes, `IDEAL_POSTCODES_API_KEY`).
   It confirms each dish with just the quantity and name ("One Chicken Chow
   Mein."). When the caller says that's everything, it checks the order for
   rice, chips or noodles and, if there are none, asks "Would you like any
   rice or chips with that?" once. Then it sends the order to the
   kitchen and reads it back with the total, the time and "See you soon!"
   before hanging up.
   Regulars are recognised by their number ("Is that to 14 Smithy Lane
   again?"). It also tells callers where their order is, and takes messages
   for the staff.
2. **The counter CRM.**
   - **Orders**: a live board (New → Cooking → Ready → Out for delivery),
     with a chime for new phone orders. You can pause phone orders, change the
     quoted wait times and see tonight's takings, plus history by day.
   - **Customers**: name, phone, address, order history and what they usually
     have.
   - **Calls & messages**: the call log and messages callers left.
   - **Menu**: prices, dishes and "sold out tonight".
   - **Settings**: hours, delivery zones and fees, and the greeting.
   - **Receptionist lab**: test calls by typing or talking.

Payment is cash only, as the shop's leaflet says. Printing is not built yet.

## How a phone order works

```
caller ─► Twilio number ─► POST /api/twilio/voice (CRM: checks signature, finds the shop)
       ◄─ TwiML <Connect><Stream> ─► voice server /voice/phone (npm run voice)
            Deepgram (speech → text) ─► Claude + order tools ─► ElevenLabs (text → speech)
            place_order ─► orders table ─► appears on the Orders board within 5 seconds
```

The receptionist does the talking; the code keeps the books.

- **Prices, totals and delivery fees** come from tool results computed from
  the menu and settings, never from the model's own arithmetic.
- **Order placement** goes through `placeOrder`, which re-checks everything
  against the database: prices, sold-out dishes, opening hours, the pause
  switch and the delivery zone.
- **Rice or chips.** Which dishes count as rice, chips or noodles is worked
  out from the dish name and its menu section (fried rice, chow mein,
  omelettes with chips, set meals), and can be set per dish in **Menu**.
  The question is asked once, only after the caller has finished ordering,
  and never when correcting an order already sent.
- **Corrections after the read-back.** There is no "is that right?": the
  order goes to the kitchen when the caller says they've finished. If they
  speak up during the read-back ("no, I said two"), the line stays open and
  the order already sent is corrected in place, keeping its number, as long
  as it is still New on the board (`src/lib/order-draft.ts`, `amendOrder` in
  `src/lib/orders.ts`). Once the kitchen has started it, the change becomes a
  message for the staff.
- **Nothing that was said is stored.** Each call is logged only as what it
  came to: ordered, checked an order, left a message, enquiry or hung up.

## Running it locally

```bash
npm install
cp .env.example .env.local          # fill in AUTH_SECRET at least
docker compose up -d                # Postgres on :5432 (or use your own)
npm run db:push                     # create the tables
npm run seed -- --demo              # Hixon's settings, menu (191 dishes), owner login, 3 demo orders
npm run dev                         # http://localhost:3000
```

The seed prints the owner login (`owner@hixonchinese.co.uk`, with a
generated password unless `SEED_ADMIN_PASSWORD` is set). It only fills in
what's missing, so it is safe to run again and never overwrites a menu or
settings edited in the CRM.

**Trying the receptionist without a phone:** set `ANTHROPIC_API_KEY` and open
**Receptionist lab**. *Type* tests what it says and does, with no voice
accounts needed; the order builds up on the right and lands on the board
marked TEST. *Talk* needs the voice server (`npm run voice`) with
`DEEPGRAM_API_KEY` and `ELEVENLABS_API_KEY`. With `VOICE_FAKES=1` the voice
server runs with stand-ins for all three services, to try the audio path with
no accounts.

```bash
npm test            # menu matching, money, hours, delivery, the order flow, voice turn-taking
npm run typecheck
npm run lint
```

## Deployment

Production runs on the same netcup VPS as call-assistant, deployed the same
way: a GitHub Action checks the code on GitHub's runner, then SSHes into the
box, updates the checkout, syncs the schema, builds and restarts the services.
See `.github/workflows/deploy-netcup.yml`.

| | call-assistant | Takeaway Counter |
|---|---|---|
| Box | netcup, `v2202609416356518198.megasrv.de` (89.58.45.110) | same |
| Checkout | `/home/deploy/call-assistant` | `/home/deploy/takeaway-counter` |
| CRM | `call-assistant.service`, port 3000 | `takeaway-counter.service`, port 3100 |
| Voice server | `call-assistant-voice`, port 4610 | `takeaway-counter-voice`, port 4620 |
| Database | its own | `takeaway_counter`, same Postgres |
| Public URL | <https://89-58-45-110.nip.io> | <https://takeaway.89-58-45-110.nip.io> |

nip.io answers any name ending in `89-58-45-110.nip.io` with the box's IP,
so `takeaway.` needs no DNS setup. Caddy gets its own Let's Encrypt
certificate for it, the same way it did for call-assistant's address.

**How a deploy runs.** Every push to `main` deploys, and so does Actions →
Deploy to netcup → Run workflow. Deploys are queued, never overlapped.

- Typecheck, lint, tests and a build run first, on GitHub's runner. If any
  fails, nothing touches the box.
- Schema changes that only add things are applied automatically. Anything
  that would drop or narrow data stops the deploy and prints the SQL, as in
  call-assistant.
- The build waits on a box-wide lock (`/var/lock/netcup-build.lock`), so it
  never runs at the same moment as another build that takes the same lock.
  call-assistant's deploy doesn't take it yet. Wrapping its build line in
  `flock -w 1200 /var/lock/netcup-build.lock …` stops the two apps building
  at once and running the box out of memory.
- The deploy copies in and enables the units from `deploy/` every time.
- The CRM must answer `/api/health` after its restart, or the deploy fails.
- The voice server is restarted only once no calls are in progress, waiting
  up to ten minutes.
- It warns about any phone-line settings that are missing.

### One-time setup on the box (as root)

1. **Database**, on the Postgres call-assistant already uses:

   ```bash
   sudo -u postgres createuser takeaway --pwprompt
   sudo -u postgres createdb -O takeaway takeaway_counter
   ```

2. **Checkout**, owned by `deploy`. If the repo is private, the box needs a
   read-only deploy key for *this* repo. GitHub won't accept the same key on
   two repos, so call-assistant's can't be reused.

   ```bash
   sudo -u deploy ssh-keygen -t ed25519 -N "" -f /home/deploy/.ssh/takeaway_counter
   cat /home/deploy/.ssh/takeaway_counter.pub   # add in GitHub: repo Settings → Deploy keys (read-only)
   sudo -u deploy tee -a /home/deploy/.ssh/config <<'CFG'
   Host github-takeaway
     HostName github.com
     IdentityFile ~/.ssh/takeaway_counter
     IdentitiesOnly yes
   CFG
   sudo -u deploy git clone git@github-takeaway:roysterC/Takeaway-Counter.git /home/deploy/takeaway-counter
   ```

3. **Settings**, in `/home/deploy/takeaway-counter/.env` (owned by
   `deploy`). Start from `.env.example`. The deploy refuses to run without
   the first three:

   ```bash
   DATABASE_URL=postgresql://takeaway:<password>@localhost:5432/takeaway_counter
   AUTH_SECRET=<openssl rand -base64 32>
   AUTH_URL=https://takeaway.89-58-45-110.nip.io
   AUTH_TRUST_HOST=true
   ANTHROPIC_API_KEY=...
   RECEPTIONIST_VOICE_SECRET=<openssl rand -hex 32>
   RECEPTIONIST_VOICE_URL=wss://takeaway.89-58-45-110.nip.io/voice
   DEEPGRAM_API_KEY=...
   ELEVENLABS_API_KEY=...
   TWILIO_AUTH_TOKEN=...
   ```

4. **Tables, menu and owner login.** Run this once on the box rather than in
   the Action, because the seed prints the owner's password and GitHub
   keeps workflow logs:

   ```bash
   sudo -u deploy -H bash -lc 'cd /home/deploy/takeaway-counter && npm ci && npx prisma db push && npm run seed'
   ```

5. **Caddy.** Add a site to `/etc/caddy/Caddyfile`, then run
   `systemctl reload caddy`. Websockets for the voice server need nothing
   extra in Caddy.

   ```caddy
   takeaway.89-58-45-110.nip.io {
   	handle /voice/* {
   		reverse_proxy 127.0.0.1:4620
   	}
   	reverse_proxy 127.0.0.1:3100
   }
   ```

6. **GitHub secret.** In this repo, add `NETCUP_SSH_KEY`. It's the same key
   call-assistant uses (the private half of `~/.ssh/netcup-ca`, whole file).
   Secrets on a personal account aren't shared between repos.

7. **First deploy.** Push to `main`, or Actions → Deploy to netcup → Run
   workflow. Then check `https://takeaway.89-58-45-110.nip.io/api/health`
   and `https://takeaway.89-58-45-110.nip.io/voice/health`.

### Putting the receptionist on the phone

1. Buy a UK number in Twilio. In the console, set its voice webhook to
   `https://takeaway.89-58-45-110.nip.io/api/twilio/voice` (HTTP POST).
2. In the CRM, add the number under **Settings → Twilio number(s)** and
   tick "Answer the phone with the receptionist".
3. Ring it. `journalctl -u takeaway-counter-voice -f` shows
   `[VOICE] phone call CA…`, and the call appears in **Calls & messages**.

The shop's existing number (01889 270870) can forward to the Twilio number,
or be ported into Twilio so the leaflet number *is* the receptionist's line.

## Still to decide with the shop

- **Delivery zones and fees** are placeholders: Hixon £1.50, the other ST18
  villages £2.50, Stafford (ST16/ST17) £3.50, with a £15 minimum. All of
  these are editable in Settings.
- **Wait times** default to 20 minutes for collection and 45 for delivery.
  Staff can change them on the Orders board during service.
- **Allergies.** The receptionist never says a dish is safe. It puts any
  allergy on the order as a kitchen note, and takes a message for anything
  the menu doesn't answer.
- **Printing** kitchen tickets is postponed.
