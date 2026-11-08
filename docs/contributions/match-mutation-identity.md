# Match-bound mutations: compatibility contract

Browsers must send the ID of the displayed match with input, surrender, messages and call dismissal. Agents should bind input and calls to the match whose state informed the decision. Receivers reject a supplied ID that differs from the current match, within the same atomic operation as the mutation. Local handlers must also check that the session did not change while a request body was arriving.

Compatibility: existing HTTP and MCP consumers can omit match identity. Accepting those requests preserves their protocol but cannot prevent an old request reaching a later match. Full isolation requires a versioned, breaking protocol that requires an explicit decision-bound match ID, including on each MCP tool call; deriving it from mutable client state at send time cannot identify an old agent decision after a new join. Do not claim complete protection for legacy callers or unbound agent decisions.

Verification target: delayed old requests after rematch must be refused without changing new match state or notifications, on local and online paths; valid same-match actions and legacy compatibility remain covered. A concurrent online transaction must retry against current session identity before committing.
