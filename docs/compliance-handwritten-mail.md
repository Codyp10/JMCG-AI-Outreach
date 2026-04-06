# Compliance (blocking): handwritten / direct mail

Outbound **email** is in scope. **Handwritten or direct mail** for high-scoring leads is planned behind `channel_dispatch` and a fulfillment vendor.

- **Calls, ringless voicemail, SMS, and WhatsApp** are **not** automated by this system. **`handwritten-enqueue`** records pending mail in `channel_dispatch`; **`phone-enrich`** runs only after that exists and may store a number on `leads.phone` for **your** manual follow-up calls.
- **Handwritten / direct mail** still requires **legal review** (e.g. CAN-SPAM does not cover postal mail the same way as email; follow counsel on suppression lists, state rules, and opt-out handling) **before** enabling `channel_dispatch` or a mail vendor.

Status: **awaiting legal sign-off** — keep handwritten mail **off** in production until this TODO is cleared.
