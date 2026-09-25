# Mimoza: building accounts

**https://valve.ist/mimoza**. It tracks the building's aidat (dues), payments, expenses and income for
6 flats and 2 shops. Only the flats pay aidat.

- **Everyone** can view the pages. Names and phone numbers are hidden, following KVKK, the Turkish data-protection law.
- **The manager** (Yönetici button) signs in to add and edit records.

## Pages

| Page | What it shows |
|---|---|
| Özet | Total cash + bank, this month's collections and expenses, every flat's status this month, how to pay (IBAN) |
| Aidat Çizelgesi | Flats × months: paid / partly paid / not paid / late / paid in advance, with totals and collection rate |
| Gelir - Gider | All money in and out by month and category, a chart, balances; filters by year / month / type |
| Borç Durumu | What each flat was charged, paid and still owes, with the oldest unpaid month; WhatsApp reminder (manager) |
| Daire Ekstresi | One flat's statement: every charge and payment with the running balance |
| Rapor | Printable monthly / yearly report: opening balance, income, expenses by category, closing balance, signatures |

Every table has **Yazdır** (print, or save as PDF) and **Excel'e aktar** (opens in Turkish Excel).

Manager pages:
- **Tahsilat:** payments, with receipts that show which months each payment paid off.
- **Giderler:** expenses.
- **Gelirler:** other income, plus transfers between kasa (cash) and banka (bank).
- **Ek Borç:** one-off charges such as a roof repair, per flat or a total split between flats.
- **Banka Aktar:** Garanti import, described below.
- **Daireler:** flats: names, phone, own aidat amount, opening balance, bank matching words.
- **Duyurular:** notices.
- **Ayarlar:** settings.
- **İşlem Geçmişi:** a log of every change.

## How the bookkeeping works (same as the usual apartment programs)

- **Monthly charge:** every month from the start month, each flat that pays aidat is charged the rate for that month.
- **Changing the aidat:** in Ayarlar, add a new amount with the month it starts. Earlier months keep the old amount.
- **Oldest debt first:** a payment always pays off the oldest open debt first. Extra money is credit toward the coming months.
- **Late fee:** KMK md. 20 (Turkish condominium law) sets 5% a month, counted per day. Turn it on in Ayarlar. It is shown for information only; to actually charge it, add it as an Ek Borç.
- **Opening balances:** enter the cash and bank amounts on the day you start. In Daireler, enter each flat's old debt or credit.

## Garanti BBVA: automatic matching of who paid

1. Garanti BBVA Internet or Mobile: Hesaplar → hesap hareketleri → choose the dates → **Excel'e aktar**.
   You can also copy the rows and paste them.
2. Mimoza → **Banka Aktar** → choose the file.

   **Money in** becomes a payment from the flat whose owner or tenant name, bank matching word, or "D3" / "Daire 3" appears in the transfer text.

   **Money out** becomes an expense with a guessed category:
   - ENERJISA → Elektrik
   - İSKİ → Su
   - İGDAŞ → Doğalgaz
   - Bank fees → Banka Masrafı
3. Check the list, choose a flat for any sender it doesn't know, then **Seçilenleri kaydet**.
   It remembers new senders for next time. Importing the same file twice adds nothing.

Tip: ask residents to write the text shown on the Özet page (for example `MIMOZA D3 EYLÜL`) in the transfer description.

**Fully automatic (no file)?** Garanti's hesap hareketleri API (API Store) only works for **corporate** accounts.
If the building gets a tax number and a corporate account, the API can be added later with Garanti's approval.

## Security and data

- **Sign-in:** username + password. The password is stored only as a salted PBKDF2 hash in the Cloudflare D1 database `mimoza`. It is never in this public repository.
- **Changing the password:** Ayarlar → Güvenlik. This signs out every other browser.
- **Lockout:** 8 wrong tries lock that connection for 15 minutes.
- **Sessions:** 30 days, HttpOnly + SameSite=Strict cookie. Every change needs the app's own request header.
- **Backup:** Ayarlar → Yedek. Download it now and then. Cloudflare D1 also keeps 7 days of history on the free plan.

## For developers

- `mimoza/`: the web app, built with Preact and Vite into `client/dist/mimoza/`.
- `mimoza/src/schema.ts`: the data model, shared by the app and the Worker.
- `mimoza/src/calc.ts`: the bookkeeping logic.
- `worker/src/mimoza.ts`: the API on D1.
- Tests: `npx tsx mimoza/test/calc.test.ts`.
- Dev: `npm run build`, then `wrangler dev`. The local D1 needs a row in `admin`: username, PBKDF2-SHA256 hash, salt, 10000 iterations.
