# Moving homework messages to WhatsApp (free Meta test number)

Homework, circulars and the 8 PM summary go to WhatsApp (all numbers). ⚠️ error alerts stay on Telegram.
If a WhatsApp send fails for any number (e.g. templates still in review), that message also goes to Telegram,
so you can finish this setup before Meta approves the templates.
Takes about 30–45 minutes on a computer. Meta's screens change now and then, so labels may differ slightly.

## 1. Create a Meta developer app
1. Go to **developers.facebook.com** → log in with your Facebook account → **Get started**
   (accept terms, verify phone/email).
2. **My Apps → Create app**.
3. Use case: **Connect with customers through WhatsApp** (or "Other → Business") → **Next**.
4. Name it e.g. `Homework Notifier`. If asked for a business portfolio, create one (any name, e.g. your family name).
5. **Create app**.

## 2. Get the test number and add your WhatsApp number
1. Left menu: **WhatsApp → API Setup** (sometimes "Quickstart → API Setup").
2. Under **From** you'll see a test number. Write down:
   - **Phone number ID**
   - **WhatsApp Business Account ID**
3. Under **To** → **Manage phone number list** → add your WhatsApp number (and your spouse's if needed, max 5).
   Enter the code that arrives on WhatsApp.

## 3. Create the 5 message templates
Open **business.facebook.com/wa/manage/message-templates** (or API Setup → "Manage message templates").
Make sure the test WhatsApp account is selected at the top. For each one: **Create template** →
Category **Utility** → type **Default/Custom** → name exactly as below → Language **English** →
fill in the content and the sample values → **Submit**.

**Template 1: `homework_image`**
- Header: **Media → Image** (upload any sample picture, e.g. a screenshot)
- Body:
  `New homework: {{1}}, posted on {{2}}, due on {{3}}. The details are in the image above.`
- Samples: `Mathematics`, `05-11-2026`, `06-11-2026`

**Template 2: `homework_document`**
- Header: **Media → Document** (upload any sample PDF)
- Body:
  `Attachment for {{1}} homework posted on {{2}}. Original link: {{3}} - a PDF copy is attached.`
- Samples: `English`, `05-11-2026`, `https://docs.google.com/document/d/example`

**Template 3: `homework_status`**
- Header: none
- Body:
  `Homework update: {{1}} - sent by your homework notifier.`
- Sample: `Final check, 6:00 PM, Mon (10-11-2026): No homework today.`

**Template 4: `circular_image`**
- Header: **Media → Image** (upload any sample picture)
- Body:
  `New school circular: {{1}}, published on {{2}}. The full circular is in the image above.`
- Samples: `Parent Teacher Meeting (PTM) Regarding`, `10-11-2026`

**Template 5: `circular_document`**
- Header: **Media → Document** (upload any sample PDF)
- Body:
  `Attachment for the school circular {{1}} published on {{2}}. Original link: {{3}} - a PDF copy is attached.`
- Samples: `Weekly Menu`, `05-11-2026`, `https://docs.google.com/spreadsheets/d/example`

Approval usually takes minutes, sometimes a few hours. Until a template is approved, those messages
automatically arrive on Telegram instead. Status shows on the templates page.

## 4. Create a token that never expires
(The token shown on API Setup expires in 24 hours, so don't use that one.)
1. Go to **business.facebook.com → Settings** (gear icon) → **Users → System users** → **Add**.
2. Name `homework-bot`, role **Admin** → **Create system user**.
3. **Assign assets**:
   - **Apps** → your app → **Full control**
   - **WhatsApp accounts** → the test account → **Full control**
4. **Generate new token** → choose your app → expiry **Never** → tick
   `whatsapp_business_messaging` and `whatsapp_business_management` → **Generate**.
5. Copy the token (it's shown only once). Don't paste it into chats or email.

## 5. Connect it on your computer
In PowerShell:

    cd "$HOME\homework-notifier"
    node src/setup-whatsapp.js

It asks for the token (hidden), Phone number ID, Business Account ID and your WhatsApp number
(with country code, e.g. `919876543210`), shows whether each template is approved, and sends a test message.

Then test a real one:

    node src/notify.js friday

## Troubleshooting
- `node src/doctor.js` checks the token, templates and sends a test message.
- **"Template name does not exist in the translation"**: template not approved yet, or created in
  "English (US)" instead of "English" — re-run `node src/setup-whatsapp.js`, which picks up the language.
- **Accepted but nothing arrives**: your number isn't verified in the **To** list (step 2.3).
- **Go back to Telegram for everything**: delete the `SENDER=` line in `.env`.
