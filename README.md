# Takeaway Counter

Phone ordering for Chinese takeaways, starting with **Hixon Chinese Takeaway**
(2A Smithy Lane, Hixon, ST18 0PP). Built on the same foundations as
call-assistant (the salon CRM), with the booking parts swapped for ordering.

Two parts:

1. **The phone receptionist.** It answers *"Hello, it's Hixon Chinese
   Takeaway. Is it for collection or delivery?"*, confirms the caller's name
   (and address, for delivery), takes the order from the real menu, reads it
   back with the total, and sends it to the kitchen once the caller says yes.
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
- **The read-back rule** is enforced in code (`src/lib/order-draft.ts`). An
  order can't be placed unless it has been read back unchanged *and* the
  caller has spoken since.
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

## Going live on the phone

1. **Accounts.** Get keys from Anthropic, Deepgram and ElevenLabs, and a
   Twilio account with a UK number.
2. **Environment.** In `.env` on the server, set `RECEPTIONIST_VOICE_SECRET`
   (the same value for the CRM and the voice server),
   `RECEPTIONIST_VOICE_URL=wss://<your host>/voice` and `TWILIO_AUTH_TOKEN`.
3. **Services.** Run the CRM and the voice server as separate services
   (`deploy/*.service`), so deploying the CRM never hangs up on a caller.
4. **Web server.** Route `/voice/` to the voice server with websocket
   upgrades. For Caddy: `handle /voice/* { reverse_proxy 127.0.0.1:4610 }`.
   Check it with `curl https://<host>/voice/health`.
5. **Settings.** Add the Twilio number in **Settings → Twilio number(s)**,
   and tick "Answer the phone with the receptionist".
6. **Twilio.** In the console, set the number's voice webhook to
   `https://<host>/api/twilio/voice` (HTTP POST).
7. **Test.** Ring the number. The voice server logs `[VOICE] phone call CA…`
   and the call appears in **Calls & messages**.

The shop's existing number (01889 270870) can forward to the Twilio number,
so customers keep dialling the number on the leaflet.

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
