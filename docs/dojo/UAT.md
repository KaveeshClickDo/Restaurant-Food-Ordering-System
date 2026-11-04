# Dojo UAT script — partner product accreditation

The step-by-step script for the click-through before booking, and for the UAT
session itself, where Dojo watches us run their Pay at Counter checklist on the
virtual terminals. What each step proves is in brackets. How the code does it
is in [README.md](./README.md).

---

## 1. Before the session

**The environment: demo.directdine.tech.** It was deployed from `development`
on 2026-11-04 (server 167.233.73.103, service `demo-directdine-tech`, code in
`/var/www/direct-dine/app`) with `DOJO_MODE=live` and a **sandbox** key,
`DOJO_API_KEY=sk_sandbox_…`, in its `.env.local`. They're server settings only,
never in the APK. Demo uses its own database, so the test card payments show in
its sales. Its settings from before (the simulator) are saved in
`/root/demo.env.backup-2026-11-04`.

- In demo's admin, for the script: a **manager** POS login (can refund), a
  **cashier** POS login (can't), a collection login, a waiter, a **VIP table**
  with a £10 booking fee, and an inactive £25 gift card (Gift Cards → Create
  inactive).
- Admin → Integrations → Card Terminal: **on** ("Active · sandbox/test").
- Share only the browser window. Keep the SSH window and any `.env.local` off
  screen: both can show secrets.

**Run the checks** the morning of the session (from `app/`):

```bash
npm run dojo:demo      # simulator, about 1 minute
npm run dojo:sandbox   # the payment logic against the sandbox, about 9 minutes
npm run dojo:routes    # the routes as the tablet calls them, about 4 minutes
```

All three must end with "passed".

**Have ready for Dojo:**

- API version: `2026-02-27`.
- Our POS version (decide the number; package.json still says `0.1.0`). The
  checklist lets us skip it while only one version exists.
- Which refund method we use: the payment intent refund (Dojo's recommended
  one).
- MOTO: keyed payments are offered only for a phone booking's VIP fee, the
  one payment where the guest isn't there. The virtual machines ignore
  `cardHolderNotPresent` (they still ask for a card), so step 15 shows the
  flag on Dojo's side, not the machine's card number screen.
- Who enters the API key (the checklist asks): it's a server setting
  (`DOJO_API_KEY`), never in the app or hard-coded, so we enter it when we set
  up a restaurant. The restaurant only switches the card machine on or off
  (Admin → Integrations).
- Polling: the till asks for the payment's status 1.2 seconds after each
  answer (the checklist says about once a second).
- Not built, if they ask: item lines, cashback, webhooks (the endpoint and its
  signature check exist, but nothing is subscribed: that needs the live
  server's address), pre-auth, and cancelling, searching or changing payment
  intents (those four are optional in the checklist). We don't refund on the
  card machine: the payment intent refund is our refund path, which meets
  their "at least one refund method" rule.

**Open demo 15 minutes early:** log in to the till and to admin (second tab),
open Dojo's portal (step 21), and take one payment on SIP0.

---

## 2. The virtual terminals

The payment screen shows a "Test mode" badge and always asks which machine,
listing each one by its TID:

| TID | What it does |
|---|---|
| `VCMSEEKSIP0` | chip & PIN, approved |
| `VCMSEEKSCN0` | contactless, approved |
| `VCMSEEKSIS0` | asks for a signature check |
| `VCMSEEKDIS0` | signature check, as SIS0 |
| `VCMSEEKDIP0` | declined |
| `VCMSEEKUIP0` | unsuccessful: ends cancelled |
| `VCMSEEKTIP0` | times out: result unknown after about 90 seconds |
| `VCMSEEKCIP0` | cancelled on the machine |
| `VCMSEEKSIP1` | approved with a 10% tip |

The list also shows `62410185` as **Offline**: an 8-digit TID is a real
machine, probably the physical test device. It's greyed out and can't be
picked. That's the answer if they ask about an offline machine (the
checklist's 404 case); `dojo:routes` also checks that an unknown machine gets
"The card machine can't be reached. Check it's switched on and connected, then
try again."

---

## 3. The script

Log in to the till with the **manager** login unless a step says otherwise. "Pay
by card machine" means: add an item, Charge → Card → Card machine (Dojo), pick
the machine, Send.

| # | Do this | You should see | Checklist item |
|---|---|---|---|
| 1 | Pay by card machine on **SIP0**. | The machine's prompts (Present card, Enter PIN, Remove card), then Approved and the receipt. | Successful sale; prompts shown to staff |
| 2 | Same on **SCN0**. | Approved after Present card / Please wait. | Contactless |
| 3 | Pay on **SIS0**, press **Accept**. | "Signature verification", then Approved. | Signature accepted |
| 4 | Pay on **SIS0** or **DIS0**, press **Reject**. | "Signature rejected — payment reversed." | Signature rejected |
| 5 | Pay on **SIS0** and don't answer for 80 seconds. Then try to reject. | Dojo accepts it by itself and the Accept/Reject buttons go, so a late reject can't be sent. Approved follows (on the sandbox it can take about another 90 seconds). A reject that reaches Dojo just too late gets "The signature check has already finished…" and the sale stays Approved (`dojo:routes` checks this). | Signature timeout; late rejection |
| 6 | Pay on **DIP0**. | "Card declined". | Declined |
| 7 | From the declined screen: "Use another" → **SIP0** → Send. | Approved, on the same Dojo payment. | Retry reuses the payment intent |
| 8 | Pay on **UIP0**. | "Payment cancelled. Nothing was charged." | Unsuccessful result |
| 9 | Pay on **CIP0**. | "Payment cancelled". | Cancelled on the PDQ |
| 10 | Pay on **SIP0** and press **Cancel** straight away, while it says "Present card" (the virtual card arrives after about 4 seconds). | "Payment cancelled". | Cancel from the POS |
| 11 | Pay on **SIP0**, press **Cancel** after "Enter PIN". | "Cancel sent… wait for the result", then the real outcome (on the sandbox, Approved). | Cancel after the card is in |
| 12 | Pay on **TIP0** and wait about 90 seconds. | "Result unconfirmed": check the machine, then **Record as paid by card** or **Retry**. | Timed out / result unknown |
| 13 | Start a payment on **TIP0** in a second browser tab (it stays busy for 90 seconds), then pay on TIP0 in the first. | "The card machine isn't available: it's busy or offline…". | Busy terminal |
| 14 | Pay on **SIP1**. | Approved, "Includes a £1.00 tip added on the card machine" (on £10). | Gratuity (optional) |
| 15 | Reservations → **Add Walk-in** → **Phone booking**, the **VIP table**, a name and phone number → VIP fee **Card** → **Collect £10.00 & Book** → **Key in card** → **SIP0** → Send. | "Key in the card number", then Approved and the booking saved. The virtual machine ignores the flag and still runs chip & PIN; Dojo holds the payment as card not present (`cardHolderNotPresent: true`). | MOTO (CNP) |
| 16 | Dashboard → Transactions → the sale from step 1 → Void & Refund → **To card** → full amount → Void & Refund. | On the sandbox: "Dojo refused the request: Your refund request was not successful", and the sale stays as it was. Dojo has confirmed that's expected and the request is correct. | Refund, full |
| 17 | Same with a smaller amount. | As step 16, for the partial amount. | Refund, partial |
| 18 | Log in with the **cashier** login and try Void & Refund. | Refused: no permission. | Refunds need permission |
| 19 | Admin → Card Terminal **off**, then try to pay. | No "Card machine" option. Back **on** afterwards. | Feature switch |
| 20 | Break the API key on the server (the note below the table), try to pay. Then fix it. | "The card machine isn't set up correctly. Ask an admin to check the Dojo API key." | Wrong API key |
| 21 | In Dojo's portal, find the step 1 payment by its reference, `POS sale XXXXXXXX`; search those 8 characters in the dashboard's Transactions. | The same sale. | Reconciliation |

**Step 20 on demo, without showing the key.** Run these in the SSH window
without sharing it (its scrollback shows earlier output). The first adds
`WRONG` to the end of the key, as Dojo's checklist suggests ("input an extra
character in the API key"), and restarts demo: a few seconds, no rebuild.

```bash
cd /var/www/direct-dine/app && sed -i 's/^\(DOJO_API_KEY=.*\)$/\1WRONG/' .env.local && systemctl restart demo-directdine-tech && echo "key broken"
```

Try to pay: you should get the message above. Then put the key back and take
one payment on SIP0:

```bash
cd /var/www/direct-dine/app && sed -i 's/^\(DOJO_API_KEY=.*\)WRONG$/\1/' .env.local && systemctl restart demo-directdine-tech && echo "key fixed"
```

Other screens, once each: the **waiter** app (settle a table on SCN0), the
**collection** login (pay a ready collection order), a **gift card sale** at
the till, and a **VIP table** booking fee. Each should end on its own success
screen.

---

## 4. If something goes wrong during the session

- **"Paid, but not saved yet"** — the card payment went through but the sale
  didn't save (usually the connection). Press **Try saving again**: it never
  charges the card twice.
- **"Couldn't start the card payment"** — read the line under it. "Nothing was
  charged" means Dojo refused before anything began. Otherwise look at the
  machine before trying again.
- **A machine shows "Busy"** — wait for it to finish, or pick another.
- **A signature payment stays on its last prompt** — on the sandbox, Dojo can
  take about 90 seconds to finish one after the signature is accepted. Keep
  waiting: it ends Approved.

---

## 5. After a pass

Dojo issues the production `software-house-id`. Then, with the signed partner
agreement: `sk_prod_…` key, that id, the merchant's real terminals, and the
webhooks (README §7).
