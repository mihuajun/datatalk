---
name: web-search
description: Use the host-provided web search proxy when the user needs current web pages, news, public facts, or image search results.
---

# Web Search

Use the `datatalk-web-search` tool when the user asks for current information from the public web, news, public source lookup, or image search results.

## Rules

- Load this skill before performing a web search.
- Call `datatalk-web-search`; do not use shell, Python, curl, or another direct HTTP client for this capability.
- Never ask the user for a search API key and never put a credential in tool arguments, files, prompts, or output.
- Use `type: "web"` for pages and news. Use `type: "image"` only when the user explicitly needs image results.
- Keep the query focused and preserve important names, dates, locations, and constraints from the user's request.
- Use `timeRange` only when the user gives a time constraint or when recency is essential. Do not invent a date range.
- Present the returned title, URL, and summary as sources. Do not claim that a result proves more than its returned content supports.

## Parameter guidance

- `query` is required and must be concise.
- `count` defaults to 10. Use the smallest count that answers the request.
- `timeRange` accepts `OneDay`, `OneWeek`, `OneMonth`, `OneYear`, or an inclusive `YYYY-MM-DD..YYYY-MM-DD` range.
- `authLevel` and `queryRewrite` are optional. Leave them unset unless they improve the requested search.
