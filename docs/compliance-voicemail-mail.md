# Compliance (blocking): voicemail and direct mail

Per **Section 3** of the implementation plan:

- **SMS and WhatsApp** are out of scope — do not add channels or consent fields for them.
- **Prerecorded voicemail** and **handwritten / direct mail** require **legal review** (TCPA, state rules, DNC/suppression) before enabling `channel_dispatch` or vendor integrations.
- Enrichment-sourced phone numbers are **not** consent; use counsel-approved `voice_consent` / suppression when activating voicemail.

Status: **awaiting legal sign-off** — keep voicemail and mail **off** in production until this TODO is cleared.
