---
name: form-design
description: Design and implement reusable form controls for web-based BI reports, especially searchable multi-select dropdowns with dynamic options, cascading filters, and the report filter contract.
metadata:
  short-description: Build reusable report form controls
---

# Form Design

Use this skill when a web report needs a polished filter toolbar or a reusable form control. The primary pattern is a compact searchable multi-select dropdown that can load options from `window.reportRuntime.query`, preserve selected values while searching, and cascade parent selections into child options.

## Source Pattern

This skill is distilled from the production report `宝马售后西区日报` (`6dd662d251b14d41aee9121ebe82d4ac`). Its form uses three dependent `multiSelect` fields:

- 企业名称: dynamic options from `bmw-filter-options`.
- 门店名称: options constrained by the selected enterprises.
- 项目名称: options constrained by the selected enterprises and stores.

The visual language is a light blue-gray canvas, white controls, blue primary action (`#2F78C4`), 40px control height, 7px control radius, a first-value summary, and a `+N` badge for additional selections. Keep this direction when the report is a sibling of the source pattern; do not force it onto an existing report with a different design system.

## Implementation Workflow

1. Read [references/searchable-multi-select.md](references/searchable-multi-select.md) before changing a report form. Confirm the report's existing `report.json`, `page.html`, `app.js`, and `server.js` conventions.
2. Copy the smallest useful pieces from [assets/searchable-multi-select/](assets/searchable-multi-select/): `searchable-multi-select.js` for behavior, `searchable-multi-select.css` for styling, and `markup.html` for the field shell.
3. Declare every business filter in the root `report.json.filters`. A multi-select uses an array `defaultValue`, a `urlKey`, and the same `key` in page state, `reportRuntime.query`, and the server handler. Dynamic option query inputs such as `type`, `keyword`, `page`, or parent selections must also be declared; hide internal inputs with `visible: false`.
4. Initialize page state from `window.__DATATALK_REPORT_CONTEXT__.filters`, not from a duplicated hardcoded default. Keep selected values as arrays in browser state. Serialize to a delimited string only at a server boundary that explicitly requires it.
5. For cascading fields, clear descendants immediately when a parent changes, reload options with the new parent values, and keep already-selected values in the result list so a user can remove them after searching.
6. Use parameterized `IN` predicates or equivalent bound parameters in `server.js`. Allow-list dynamic option types and columns; never interpolate a field name or raw user input into SQL.
7. Validate the no-value, one-value, many-value, search-hit, no-result, loading, error, clear, parent-reset, URL-initialized, and mobile states. Run the skill validator and JavaScript syntax checks before reporting completion.

## Interaction Requirements

- The trigger is a real button with `aria-expanded` and `aria-controls`; the clear control is a separate button, never a button nested inside another button.
- Opening focuses the search input. Escape closes the menu and returns focus to the trigger. Clicking outside closes it.
- Selecting an option toggles it without closing the menu. The trigger shows the first selected label and an additional-count badge; clearing emits an empty array.
- Search results are debounced and stale asynchronous responses cannot overwrite newer results.
- The menu has a bounded scroll area, a visible loading state, an explicit no-result state, and a bounded option count.
- Use stable control dimensions and visible `:focus-visible` styling. Respect `prefers-reduced-motion` and keep the toolbar usable down to a 320px viewport.

## References

- Read [references/searchable-multi-select.md](references/searchable-multi-select.md) for the production decomposition, filter manifest examples, cascading semantics, and server integration notes.
- Copy [assets/searchable-multi-select/searchable-multi-select.js](assets/searchable-multi-select/searchable-multi-select.js) and [assets/searchable-multi-select/searchable-multi-select.css](assets/searchable-multi-select/searchable-multi-select.css) when a report does not already have an equivalent component.
