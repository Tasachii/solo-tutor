# Usage events mirror to Google Sheets

This optional mirror copies the four existing aggregate usage events from the
server to a private Google Sheet **only when the app event is in real mode**.
Demo and missing/unknown-mode events remain in Supabase and are never mirrored.
It sends only:

- `random_id`: the random UUID already created by the browser
- `event`: `app_open`, `students_changed`, `invoice_issued`, or `payment_recorded`
- `count`: the aggregate count supplied by the existing collector
- `at`: the server timestamp

It does not send names, email, account/provider ID, mode, student data, money,
routes, browser details, or error text. Supabase remains the primary collector.
A missing or unavailable Sheet mirror does not reject an accepted Supabase event.
`random_id` identifies a browser installation, so multiple devices belonging to
one teacher can appear as multiple IDs. Do not present it as an exact teacher count.

## Create the private Sheet

1. Create a dedicated Google Sheet and keep it private.
2. Open **Extensions → Apps Script** and replace the editor contents with
   [`Code.gs`](./Code.gs).
3. In the Apps Script editor, select `setupSheetId` and click **Run** once.
   Approve spreadsheet access. This stores the bound spreadsheet ID as the
   `USAGE_SHEET_ID` Script Property; web requests later open that exact file with
   `SpreadsheetApp.openById` instead of relying on editor-only active context.
4. In **Project Settings → Script properties**, add `USAGE_WEBHOOK_SECRET` with
   a random value of at least 24 characters.
5. Choose **Deploy → New deployment → Web app** with these exact settings:

   - **Execute as:** Me
   - **Who has access:** Anyone

   “Anyone” is required because the Supabase Edge Function is a server call and
   cannot complete a Google login. The long shared secret in the request body is
   the receiver's authentication boundary. If a Workspace administrator does not
   allow anonymous web apps, use a Google account/domain where this deployment
   setting is available or leave the optional mirror disabled.
6. Copy the deployed `/exec` URL. A `/dev` test URL is intentionally rejected.
7. Keep the URL and secret outside the repository in a private file:

   ```sh
   mkdir -p ~/.config/solo-tutor
   umask 077
   cat > ~/.config/solo-tutor/usage-sheets.env <<'EOF'
   USAGE_SHEETS_WEBHOOK_URL='https://script.google.com/macros/s/REPLACE_WITH_DEPLOYMENT_ID/exec'
   USAGE_SHEETS_WEBHOOK_SECRET='replace-with-the-generated-secret'
   EOF
   ```

8. Load that private file and store both values as Supabase Edge Function secrets:

   ```sh
   set -a
   source ~/.config/solo-tutor/usage-sheets.env
   set +a
   supabase secrets set \
     USAGE_SHEETS_WEBHOOK_URL="$USAGE_SHEETS_WEBHOOK_URL" \
     USAGE_SHEETS_WEBHOOK_SECRET="$USAGE_SHEETS_WEBHOOK_SECRET"
   supabase functions deploy usage
   ```

The receiver validates the exact payload shape, holds a script lock while
appending, ignores duplicate rows for six hours, and caps each random ID at 120
rows per minute. Rotate both secret values if the deployment URL or secret leaks.

Creating the Sheet and deploying Apps Script require the owner's Google account;
the repository contains no Google credentials and cannot perform those steps.

## Export the current Supabase events

For a one-time CSV in the Supabase SQL editor, run the query below and use the
editor's CSV download. It intentionally omits `provider_id` and `mode`.

```sql
select teacher_id as random_id, event, count, at
from public.usage_events
where mode = 'real'
order by at;
```

The repository also includes a read-only CLI export. If no database URL and
`psql` are available, it uses the already authenticated and linked Supabase CLI:

```sh
scripts/export-usage-events.sh ./usage-events-real.csv
```

The linked CLI runs a fixed `SELECT` through the Supabase Management API. Its
status output remains on stderr; a strict JSON parser whitelists the four fields
before producing CSV, so setup text cannot enter the artifact. If a database URL
is supplied instead, the script forces PostgreSQL transactions into read-only
mode. Both paths create the CSV with owner-only file permissions.
