# Searchable Multi-Select Reference

## What Was Extracted

The source report uses a form toolbar with two date inputs, three compact multi-select controls, a query button, and a reset button. Each picker follows the same DOM and state model:

| Concern | Source pattern | Reusable rule |
| --- | --- | --- |
| Trigger | `.native-control` with a summary value and count | Use a button trigger plus a separate clear button. |
| Search | An input inside `.native-dropdown` | Focus it when opening; debounce remote searches. |
| Options | Buttons with `.native-option` and a check mark | Use `role="option"` and `aria-selected`; keep selected values in the rendered list. |
| Selection | `selected.enterprise`, `selected.store`, `selected.project` arrays | Keep one array per field and toggle values rather than replacing the whole selection. |
| Cascade | Enterprise clears store/project; store clears project | Clear descendants immediately and reload their option lists. |
| Data | `bmw-filter-options` returns `{ options: [{ label, value }] }` | Normalize both an array response and an `{ options }` response. |
| Query | Selected arrays are joined with commas before `query` | Prefer arrays through the runtime; only join at a handler boundary that requires CSV. |
| SQL | Dynamic `IN` predicates use named parameters | Keep the allow-list and bound-parameter pattern. |
| Visuals | `#f3f6fa`, `#fff`, blue accents, 40px controls, 7px radius | Reuse the tokens for sibling reports, otherwise follow the host report style. |

The source's main form files were `report.json`, `page.html`, `app.js`, `styles.css`, and `server.js`. The source is a useful behavioral reference, but its defaults are repeated in `app.js`, its control is not fully keyboard-described, and its clear button is nested inside a clickable control container. The asset template corrects those issues.

## Filter Manifest

The host reads the root `filters` array in `report.json`. Keep the manifest as the source of truth and preserve all existing report metadata. A minimal dependent setup looks like this:

```json
{
  "filters": [
    {
      "key": "enterprise_name",
      "urlKey": "enterprise_name",
      "label": "企业名称",
      "type": "multiSelect",
      "defaultValue": [],
      "visible": true
    },
    {
      "key": "store_name",
      "urlKey": "store_name",
      "label": "门店名称",
      "type": "multiSelect",
      "defaultValue": [],
      "visible": true
    },
    {
      "key": "project_name",
      "urlKey": "project_name",
      "label": "项目名称",
      "type": "multiSelect",
      "defaultValue": [],
      "visible": true
    },
    {
      "key": "type",
      "urlKey": "type",
      "label": "选项类型",
      "type": "text",
      "defaultValue": "",
      "visible": false
    },
    {
      "key": "keyword",
      "urlKey": "keyword",
      "label": "选项搜索词",
      "type": "text",
      "defaultValue": "",
      "visible": false
    }
  ]
}
```

For a dynamic filter, the source report also records `optionDataId`, `optionType`, `searchable`, `maxOptions`, `valueSeparator`, and `dependsOn`. Those are useful local metadata when the report generator understands them, but they do not replace `key`, `urlKey`, `type`, `defaultValue`, and `visible`. Do not create a separate `filter.json` or `filters.json` file as a substitute for `report.json.filters`.

The current host resolves repeated URL values for `multiSelect` into an array and also accepts comma-separated URL values. Keep the browser state and URL semantics array-shaped. This matters for empty arrays, repeated values, and future server handlers that can bind arrays directly.

## Component Contract

The asset component exposes:

```js
const picker = createSearchableMultiSelect({
  root: document.querySelector("#enterprise-picker"),
  label: "企业名称",
  placeholder: "搜索企业名称",
  values: filterState.enterprise_name || [],
  maxOptions: 30,
  fetchOptions: ({ keyword, values }) => {
    return window.reportRuntime.query("bmw-filter-options", {
      type: "enterprise",
      keyword,
      enterprise_name: values.join(",")
    });
  },
  onChange: (values) => {
    filterState.enterprise_name = values;
    void loadSummary();
  }
});
```

`fetchOptions` may return `[{ value, label }]` or `{ options: [{ value, label }] }`. The component normalizes string values into `{ value, label }`, deduplicates values, merges selected values into the current result set, and ignores stale responses.

The returned object has `getValues()`, `setValues(values)`, `refresh()`, `setDisabled(disabled)`, `close()`, and `destroy()` methods. Use `setValues` when a parent filter invalidates a child; do not mutate a component's internal state from outside.

## Cascade Rules

The source report's dependency graph is:

```text
enterprise_name -> store_name -> project_name
enterprise_name ----------------> project_name
```

When `enterprise_name` changes:

1. Replace the enterprise array.
2. Set `store_name` and `project_name` to `[]` immediately.
3. Call `storePicker.setValues([])` and `projectPicker.setValues([])`.
4. Reload the store options with all selected enterprise values.
5. Reload the project options only after the store selection is available.

When `store_name` changes, clear only `project_name` and reload project options. If a parent request fails, keep the user's parent selection, show an explicit option-load error, and avoid presenting stale child options as current.

## Page and Runtime Wiring

Use one filter state object initialized from the host:

```js
const context = window.__DATATALK_REPORT_CONTEXT__ || {};
const filterState = { ...(context.filters || {}) };
filterState.enterprise_name = Array.isArray(filterState.enterprise_name)
  ? filterState.enterprise_name
  : [];
```

Do not read business filter values directly from `location.search`, and do not re-declare `defaultValue` in `app.js`. The initial state must honor URL overrides resolved by the host. Every later query should use the same state object.

If the current handler accepts arrays:

```js
await window.reportRuntime.query("bmw-summary-table", {
  start_date: filterState.start_date,
  end_date: filterState.end_date,
  enterprise_name: filterState.enterprise_name,
  store_name: filterState.store_name,
  project_name: filterState.project_name
});
```

If a legacy handler expects comma-separated strings, serialize only in the call or handler boundary:

```js
const csv = (value) => Array.isArray(value)
  ? value.map((item) => String(item).trim()).filter(Boolean).join(",")
  : String(value || "").trim();
```

Do not let a CSV string become the page's canonical state. Do not include a search keyword in the summary query unless the product explicitly defines it as a business filter; option-search state normally belongs only to the option query.

## Server Integration

Use an allow-list for dynamic option types and columns, then bind all values:

```js
const optionColumns = {
  enterprise: "enterprise_name",
  store: "store_name",
  project: "project_name"
};

const type = optionColumns[filters.type] ? filters.type : "enterprise";
const column = optionColumns[type];
const keyword = String(filters.keyword || "").trim();
const params = {};
const conditions = [`${column} IS NOT NULL`, `btrim(${column}) <> ''`];

if (keyword) {
  conditions.push(`${column} ILIKE :keyword`);
  params.keyword = `%${keyword}%`;
}
```

For selected values, create one named parameter per value and combine them with `OR` or `IN`. Never construct SQL by concatenating a raw comma-separated selection. Bound parameters also handle quotes and other characters in store names.

## Acceptance Checklist

- `report.json` parses; every visible picker is a `multiSelect` with an array default and a unique `urlKey`.
- `app.js` initializes from `window.__DATATALK_REPORT_CONTEXT__.filters` and uses the same filter keys for options and summary queries.
- Selected options remain visible while a search term hides the rest; a no-result state is explicit.
- Search results are bounded, debounced, and stale responses are ignored.
- Clear, toggle, Escape, outside click, focus-visible, and mobile behavior are present.
- Parent changes clear descendants and reload dependent options.
- `server.js` uses an option-type allow-list and bound query parameters.
- Default URL, valid URL, invalid URL, user interaction, empty arrays, and no-data scenarios are checked.
