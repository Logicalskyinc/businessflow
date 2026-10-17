# businessflow
Enterprise business intelligence and operations platform for organizations of all sizes. Built to turn business data into actionable insights through AI-assisted reasoning, planning, experimentation, decision support, and controlled automation, with integration paths for HackyTech EMAN and Oyosky.

## EMAN Content Studio

The `feat/eman-content-studio` branch adds a Content Studio UI with a business brief, goal and topic fields, language and platform choices, a demo preview, copyable drafts, and an explicit human-review notice.

- The **Preview demo** button creates example copy in the browser and does not call an AI provider.
- **Generate with EMAN** calls the same-origin path `/api/eman/content/drafts`. That route is an integration contract only until a trusted server endpoint is implemented and deployed.
- Do not add EMAN credentials or AI-provider keys to `index.html`, `script.js`, `content-studio.js`, or any other browser asset.
- Before enabling real generation, the server must authenticate the signed-in user, authorize access to the requested business, apply per-user rate and spend limits, validate the EMAN response, and record approval/audit information. The endpoint must not forward arbitrary URLs or expose secrets.
- The Content Studio does not publish to social networks. Users must verify factual claims, prices, offers, availability, and contact information before using a draft.

The static GitHub Pages deployment cannot securely call EMAN directly with a secret. Connect a server-side gateway (for example, a protected Render service) before treating AI generation as live.
