---
name: Workflow secret input format
description: Managed workflows reject secret values that contain unmatched quotation marks.
---

Enter workflow secrets as raw values without surrounding quotes or backticks.

**Why:** The managed workflow secret loader parses values and can fail before the application starts when a value contains an unmatched quote.

**How to apply:** When requesting or documenting API keys, tokens, or URLs, explicitly tell the user not to wrap the value in quotation marks.