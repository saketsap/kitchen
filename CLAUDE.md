# Kitchen Inventory App — Build Instructions for Claude Code

## 0. Read this first (ground rules for Claude Code)

- This is a **learning project**. The goal is not just a working app, but idiomatic
  **SAP CAP (Node.js)** and **SAP UI5 / Fiori Elements** code that follows SAP's own
  patterns — not generic Express/React patterns wearing an SAPUI5 skin.
- **No generic REST `POST` calls for business operations.** Every write/business
  operation (record consumption, generate unique ID for a loose item, resolve a
  barcode, etc.) must be modeled as a CDS **action** or **function**, exposed via
  **OData V4**, and invoked from UI5 using the **`ODataModel#bindContext()` +
  `.execute()`** pattern (see §5). Plain `$.ajax`/`fetch` calls to hand-rolled
  endpoints are not acceptable, except for the one-time external barcode lookup
  described in §4.4, which is a genuine external REST API, not "my own backend
  action in REST disguise."
- Everything must run on **free infrastructure**: no SAP BTP trial, no HANA, no
  paid tier of anything. See §7 for the exact free stack.
- Work in small, verifiable phases (§8). After each phase, run the app locally
  and show it works before moving to the next.
- **Use Fiori Elements everywhere, and reach every custom/flexible part of
  the app through SAP's own extensibility mechanism — never eject into a
  fully freestyle UI5 app.** This is what "flexible programming model" means
  in practice on both tiers of this stack, and it's how real SAP projects
  are built:
  - **Backend (CAP):** CAP's *flexible programming model* means every custom
    piece of logic (barcode lookup, stock calculation, ID generation) is
    added as an **event handler** (`srv.on/before/after`) layered on top of
    the generic, annotation-driven CRUD service CAP gives you for free — not
    a bespoke Express route bolted on the side. See §4.
  - **Frontend (Fiori Elements):** every custom screen or piece of behavior
    (barcode scanner, "add loose item" form, consumption logging) is added
    using one of Fiori Elements' **documented extension points** — Custom
    Pages, Custom Sections, Custom Columns/Fields, Custom Actions, and
    Controller Extensions, wired through `manifest.json` — layered on top of
    the generated List Report / Object Page. See §6. This keeps the app
    fully flexible while staying inside the Fiori Elements framework
    (routing, OData binding, theming, message handling all stay standard).

---

## 1. Project summary

A kitchen inventory tracker.

- On launch, show a list of kitchen items with a **traffic-light status**
  (red / yellow / green) based on how soon each item will run out, computed from
  current stock and the item's daily/weekly consumption rate.
- Add new items two ways:
  - **Packaged item**: scan the barcode with the device camera → look up product
    name → user enters consumption (daily or weekly, in tablespoon / gram /
    millilitre depending on the item type) and starting stock quantity.
  - **Loose item** (no barcode, e.g. loose spices from a local shop): user types
    the name, the system **auto-generates a unique item ID**, then user enters
    consumption rate and stock quantity the same way.
- All data is persisted online (not local-only) in a free-tier cloud Postgres
  database (see §7.2) so the app is usable from phone and desktop.

---

## 2. Tech stack

| Layer | Choice | Why |
|---|---|---|
| Backend | **SAP CAP for Node.js** (`@sap/cds`) | No HANA required; Node runtime works on all free hosts |
| Protocol | **OData V4** (CAP default) | Needed for proper bound actions/functions in UI5 |
| Frontend | **SAPUI5 (OpenUI5-compatible CDN)** with **Fiori Elements** (List Report + Object Page), extended via **Custom Pages / Custom Sections / Controller Extensions** | Learning goal; standard SAP way to build CRUD + status-driven apps *and* stay flexible for non-standard screens |
| Dev DB | **SQLite** (`cds-sqlite`, in-memory / file) | Zero-config local dev, CAP default |
| Prod DB | **PostgreSQL** via `@cap-js/postgres`, hosted free on **Neon** | HANA is out of scope; Postgres is CAP's officially supported non-HANA production DB |
| Barcode scanning | Browser `BarcodeDetector` API with a `zxing-wasm` (or `html5-qrcode`) JS fallback, delivered as a Fiori Elements **Custom Page** reached via a **Custom Action** on the List Report toolbar | SAP's supported extensibility mechanism for "the generated floorplan can't do this natively" — not a reason to leave Fiori Elements |
| Barcode → product name lookup | **Open Food Facts API** (free, no key) as primary; manual name entry as fallback | Free, keyless, good enough for a home kitchen app |
| Hosting (app) | **Render free Web Service** (or Koyeb free web service as backup) | Actually-free, no credit card, good enough for a personal app despite cold starts |
| Hosting (db) | **Neon free Postgres** | Genuinely free indefinitely (not a 90-day trial like Render's Postgres), serverless, scale-to-zero |

> Note on "free": free hosts spin down after inactivity (cold start ~30–60s on
> first request). That's an acceptable tradeoff for a personal kitchen app and
> should be explained to the user in the README, not hidden.

---

## 3. Domain model (CDS)

Create `db/schema.cds`. Key design points:

- Store **quantity in a base unit per item** (grams, millilitres, or "pieces")
  so math is consistent; keep the *display* unit for consumption input, and
  convert tablespoon → grams/millilitres at entry time using a conversion table
  (a tablespoon is ~15g / ~15ml — good enough for a kitchen app; note this
  assumption in code comments).
- Consumption is stored as **quantity per day** internally (convert weekly
  input ÷ 7), so the days-remaining calculation is a single formula.

```cds
namespace kitchen.inventory;

using { cuid, managed } from '@sap/cds/common';

type UnitOfMeasure : String enum {
  GRAM        = 'G';
  MILLILITRE  = 'ML';
  TABLESPOON  = 'TBSP';
  PIECE       = 'PC';
}

type ConsumptionFrequency : String enum {
  DAILY  = 'DAILY';
  WEEKLY = 'WEEKLY';
}

type StockStatus : String enum {
  RED    = 'RED';     // < 7 days left
  YELLOW = 'YELLOW';  // 7–14 days left
  GREEN  = 'GREEN';   // > 14 days left (your "3+ weeks" comfortable zone)
}

entity Items : cuid, managed {
  name               : String(100) not null;
  barcode            : String(50);               // null for loose items
  isLooseItem        : Boolean default false;
  currentStockValue  : Decimal(10,2) not null;    // stored in base unit (g/ml/pc)
  baseUnit           : UnitOfMeasure not null;
  consumptionAmount  : Decimal(10,2) not null;    // as entered by user
  consumptionUnit    : UnitOfMeasure not null;    // unit the user typed in (g/ml/tbsp/pc)
  consumptionFreq    : ConsumptionFrequency not null;
  dailyConsumptionBase : Decimal(10,2) not null;  // NORMALIZED: per day, in baseUnit — computed on create/update
  daysRemaining      : Decimal(10,2) virtual;     // computed in a handler, not persisted
  status             : StockStatus virtual;       // computed in a handler, not persisted
  category           : String(40);                // e.g. Spice, Dairy, Grain — optional, for grouping
}
```

Design note for Claude Code: keep `daysRemaining` and `status` as **virtual
elements**, computed in a CAP `after READ` handler (not stored), so the status
is always fresh. This is the idiomatic CAP way to expose derived values.

---

## 4. Service layer — actions & functions (no generic POST)

This is where CAP's **flexible programming model** shows up concretely: the
`.cds` file below declares a generic, fully-working OData service (CRUD on
`Items`, plus typed actions/functions) with *zero business logic*. All the
custom behavior is then layered on in `.js` **event handlers** that plug into
that generic service (`srv.on(...)`, `srv.before(...)`, `srv.after(...)`).
Nothing here is a hand-built Express route — every custom operation is still
a first-class, typed, discoverable OData action/function that Fiori Elements
and UI5 understand natively.

Create `srv/inventory-service.cds`:

```cds
using kitchen.inventory as db from '../db/schema';

service InventoryService {

  entity Items as projection on db.Items;

  // Unbound function: dashboard summary, called on app launch
  function getDashboard() returns array of Items;

  // Bound action on a single Item: record that some quantity was consumed/restocked
  action recordStockChange(deltaAmount: Decimal, reason: String) returns Items;

  // Unbound action: resolve a scanned barcode to a product name via external lookup,
  // WITHOUT creating the item yet (lets the UI show a confirm/edit dialog first)
  action lookupBarcode(barcode: String) returns {
    found        : Boolean;
    suggestedName: String;
  };

  // Unbound action: create a new item — packaged (barcode) or loose (no barcode).
  // For loose items, the service generates the unique ID; the client never invents one.
  action createItem(
    name              : String,
    barcode           : String,       // pass null/empty for loose items
    isLooseItem       : Boolean,
    currentStockValue : Decimal,
    baseUnit          : String,
    consumptionAmount : Decimal,
    consumptionUnit   : String,
    consumptionFreq   : String,
    category          : String
  ) returns Items;
}

annotate InventoryService.Items with @odata.draft.enabled; // Fiori Elements draft handling (optional but idiomatic)
```

Implement handlers in `srv/inventory-service.js` using the CAP Node.js
programming model (`cds.service.impl`), e.g. `srv.on('createItem', ...)`,
`srv.on('recordStockChange', ...)`, `srv.on('lookupBarcode', ...)`,
`srv.on('getDashboard', ...)`. Put the days-remaining/status calculation in a
shared helper function and reuse it in both the `getDashboard` function and the
`Items` entity's `READ` handler, so the traffic-light logic lives in exactly
one place.

### 4.1 Status calculation logic (implement exactly this)

```
dailyConsumptionBase =
    consumptionFreq === 'WEEKLY'
        ? convertToBaseUnit(consumptionAmount, consumptionUnit) / 7
        : convertToBaseUnit(consumptionAmount, consumptionUnit)

daysRemaining = currentStockValue / dailyConsumptionBase   // guard divide-by-zero

status =
    daysRemaining < 7          -> RED
    daysRemaining <= 14        -> YELLOW
    daysRemaining > 14 (~3wk+) -> GREEN
```

### 4.2 Unique ID generation for loose items

Use the `cuid` aspect already applied to `Items` (CAP auto-generates a UUID for
`ID` on every insert, packaged or loose). Do **not** build a separate custom ID
generator — that would be reinventing what CAP already gives you for free. If
a human-readable short code is also wanted later (e.g. `LOOSE-0007`), add that
as a second phase, not in the MVP.

### 4.3 On-launch dashboard sort order

`getDashboard` should return items sorted RED → YELLOW → GREEN, then
alphabetically within each group, so the most urgent items are always on top —
this is business logic that belongs in the service, not the UI.

### 4.4 Barcode → product name lookup (the one legitimate external REST call)

Inside the `lookupBarcode` action handler (server-side, not from the browser),
call `https://world.openfoodfacts.org/api/v2/product/{barcode}.json` (free, no
API key). This is calling a **third-party** REST API from CAP — that's fine
and normal. What's disallowed is exposing *your own* CAP backend as ad-hoc REST
POST endpoints instead of CDS actions.

---

## 5. Calling actions/functions from UI5 — the SAP way (mandatory pattern)

**Never** do this:
```javascript
// ❌ WRONG — generic REST, do not do this anywhere in this app
fetch("/odata/v4/inventory/createItem", { method: "POST", body: JSON.stringify(data) });
```

**Always** do this — bind an operation on the OData V4 model and execute it:

```javascript
// ✅ Unbound action example: createItem
onCreateItem: function () {
    const oModel = this.getView().getModel(); // v4.ODataModel
    const oOperation = oModel.bindContext("/createItem(...)");

    oOperation.setParameter("name", this._name);
    oOperation.setParameter("barcode", this._barcode || null);
    oOperation.setParameter("isLooseItem", !this._barcode);
    oOperation.setParameter("currentStockValue", this._stockValue);
    oOperation.setParameter("baseUnit", this._baseUnit);
    oOperation.setParameter("consumptionAmount", this._consumptionAmount);
    oOperation.setParameter("consumptionUnit", this._consumptionUnit);
    oOperation.setParameter("consumptionFreq", this._consumptionFreq);
    oOperation.setParameter("category", this._category);

    oOperation.execute().then(() => {
        const oCreatedContext = oOperation.getBoundContext();
        MessageToast.show("Item added: " + oCreatedContext.getObject().name);
        this.byId("itemsList").getBinding("items").refresh();
    }).catch((oError) => {
        MessageBox.error("Could not create item: " + oError.message);
    });
}
```

```javascript
// ✅ Bound action example: recordStockChange, bound to a specific Item context
onRecordConsumption: function (oItemContext) {
    const oModel = this.getView().getModel();
    const oOperation = oModel.bindContext(
        "InventoryService.recordStockChange(...)",
        oItemContext   // <-- bound to the row's context, this is what makes it a BOUND action
    );
    oOperation.setParameter("deltaAmount", -this._usedAmount);
    oOperation.setParameter("reason", "consumption");

    oOperation.execute().then(() => {
        oItemContext.refresh(); // re-read the row so status/daysRemaining update
    });
}
```

```javascript
// ✅ Unbound FUNCTION example: getDashboard, called on app launch
onInit: function () {
    const oModel = this.getOwnerComponent().getModel();
    const oOperation = oModel.bindContext("/getDashboard(...)");
    oOperation.execute().then(() => {
        const oContext = oOperation.getBoundContext();
        // bind the resulting collection to the dashboard list
    });
}
```

Key points Claude Code must follow:
- Unbound operation path starts with `/`; bound operation path is the fully
  qualified `<Service>.<action>(...)` string, and is bound to an existing
  entity **context** (row), not called on the raw model.
- Always call `.setParameter(name, value)` for each declared CDS parameter —
  never send a raw JSON blob.
- Always call `.execute()`, which returns a Promise; handle `.then`/`.catch`.
- After a bound action mutates data, `refresh()` the affected context (or the
  list binding) so the UI re-reads server-computed virtual fields like
  `status` and `daysRemaining`.
- In Fiori Elements List Report/Object Page, prefer exposing actions via
  `@UI.LineItem` / `@UI.Identification` annotations with `com.sap.vocabularies.UI.v1.IsActionCritical`
  etc. so the toolbar button is generated by the template — only write the
  manual `bindContext` JS (above) inside the custom barcode-scan
  extension controller, where Fiori Elements has no template support.

---

## 6. UI structure — Fiori Elements + documented extension points

Every screen below is either a **generated Fiori Elements floorplan** or a
**Fiori Elements extension**, wired declaratively in `webapp/manifest.json`.
None of it is a standalone freestyle UI5 app; all of it still lives inside
the `sap.fe` routing/binding/lifecycle, which is the whole point of using
Fiori Elements to learn the SAP way.

| Screen | Type | Extension mechanism used |
|---|---|---|
| Item list / dashboard | Generated **List Report** | `@UI.LineItem` + `@UI.Criticality` annotations only — no extension needed |
| Item detail | Generated **Object Page** | `@UI.FieldGroup` + a **Custom Section** for the consumption log |
| Scan Barcode | **Custom Page** (own route) | Reached via a **Custom Action** (toolbar button) on the List Report |
| Add Loose Item | **Custom Section on a Custom Page**, or an **Object Page Create dialog extension** | Reached via a second **Custom Action** on the List Report |
| Consumption logging | **Custom Section** on the Object Page | Section's own fragment calls the bound `recordStockChange` action |

### 6.1 List Report — generated, annotation-driven

- Table columns: Name, Category, Current Stock, Days Remaining, Status.
- `status` virtual field rendered via `@UI.LineItem` with a `criticality`
  annotation mapped to the enum (RED/YELLOW/GREEN → SAP's
  `Negative/Critical/Positive` criticality) so Fiori Elements draws the
  standard red/yellow/green traffic-light `ObjectStatus` control natively —
  do **not** hand-roll colored `<Text>` controls for this.
- Default sort/group by `status` (reuse §4.3 ordering).

### 6.2 Custom Actions on the List Report toolbar

Add two toolbar buttons — "Scan Barcode" and "Add Loose Item" — using Fiori
Elements' **Custom Action** extension point, declared in `manifest.json`
under the List Report's `controlConfiguration`:

```json
"sap.ui.generic.app": {},
"sap.ui5": {
  "routing": {
    "targets": {
      "ItemsList": {
        "options": {
          "settings": {
            "controlConfiguration": {
              "@com.sap.vocabularies.UI.v1.LineItem": {
                "actions": {
                  "ScanBarcode": {
                    "id": "ScanBarcodeAction",
                    "text": "Scan Barcode",
                    "press": "kitchen.inventory.ext.controller.ListReportExt.onScanBarcode"
                  },
                  "AddLooseItem": {
                    "id": "AddLooseItemAction",
                    "text": "Add Loose Item",
                    "press": "kitchen.inventory.ext.controller.ListReportExt.onAddLooseItem"
                  }
                }
              }
            }
          }
        }
      },
      "ScanBarcodePage": {
        "type": "Component",
        "id": "ScanBarcodePage",
        "name": "kitchen.inventory.ext.scanner",
        "options": { "settings": { "entitySet": "Items" } }
      }
    },
    "routes": [
      { "pattern": "scan-barcode", "target": "ScanBarcodePage", "name": "scanBarcode" }
    ]
  },
  "extends": {
    "extensions": {
      "sap.ui.controllerExtensions": {
        "sap.fe.templates.ListReport.ListReportController": {
          "controllerName": "kitchen.inventory.ext.controller.ListReportExt"
        }
      }
    }
  }
}
```

`ListReportExt.controller.js` is a **Controller Extension**
(`sap.ui.core.mvc.ControllerExtension`) — the SAP-documented way to add
custom event handlers to a generated Fiori Elements page without touching
generated code:

```javascript
sap.ui.define(["sap/ui/core/mvc/ControllerExtension"], function (ControllerExtension) {
  "use strict";
  return ControllerExtension.extend("kitchen.inventory.ext.controller.ListReportExt", {
    onScanBarcode: function () {
      this.base.getExtensionAPI().getRouting().navigateToRoute("scanBarcode");
    },
    onAddLooseItem: function () {
      this.base.getExtensionAPI().getRouting().navigateToRoute("addLooseItem");
    }
  });
});
```

### 6.3 Scan Barcode — Fiori Elements Custom Page

A **Custom Page** is a small, freestyle-authored `sap.ui.core.UIComponent`
that Fiori Elements mounts as a normal routing target (as wired above) — it
still gets the shared `sap.fe` shell, back-navigation, message handling, and
the same `ODataModel` instance as the generated pages. This is the correct,
documented place for genuinely non-templated UI (the camera view), rather
than a reason to step outside Fiori Elements entirely.

- `webapp/ext/scanner/Component.js`, `View.view.xml`, `Controller.controller.js`.
- Use the browser's native `BarcodeDetector` API where available
  (`window.BarcodeDetector`); feature-detect and fall back to a small JS
  barcode library (`html5-qrcode` or `zxing-wasm`, both free/MIT), loaded
  only inside this component — don't pull it into the global UI5 bootstrap.
- On a successful scan: call the `lookupBarcode` action (§4.4/§5) to get a
  suggested name, show an inline confirm/edit form (name, stock,
  consumption), then call `createItem` (§5) with the scanned barcode, and
  navigate back to the List Report (`navigateToRoute` back or `historyBack()`).

### 6.4 Add Loose Item — same pattern, no camera

Reuse the identical Custom Page pattern (§6.3) minus the camera step: a
plain form for name/category/stock/consumption, submitting via `createItem`
with `barcode: null`. Consider making this a shared base component with the
scan flow (`AddItemBase`) since both end at the same confirm form — this
also teaches component composition, which is a real UI5 skill.

### 6.5 Object Page — Custom Section for consumption logging

Add a **Custom Section** (not a Custom Page — this one stays anchored to the
existing item's context, which Custom Sections are built for) via
`manifest.json`:

```json
"@com.sap.vocabularies.UI.v1.FieldGroup#ConsumptionLog": {
  "sections": {
    "ConsumptionLogSection": {
      "template": "kitchen.inventory.ext.fragment.ConsumptionLog",
      "title": "Log Consumption",
      "position": { "placement": "After", "anchor": "GeneralInformation" }
    }
  }
}
```

`ConsumptionLog.fragment.xml` contains a small form (amount, reason) and a
button whose handler calls the **bound** `recordStockChange` action exactly
as shown in §5, using `this.base.getExtensionAPI().getBindingContext()` to
get the current Object Page context to bind the action to.

---

## 7. Deployment — completely free stack

### 7.1 Local development
```bash
npm install -g @sap/cds-dk
cds init kitchen-inventory --add fiori
cds watch
```
Uses SQLite automatically in dev profile — no external DB needed to develop.

### 7.2 Database — Neon (free Postgres)
1. Create a free Neon project at neon.tech (no credit card required for the
   free tier). Free tier: ~0.5 GB storage per project, auto-suspend/scale-to-
   zero compute, no expiry date (unlike Render's Postgres, which is free for
   only 90 days — do not use Render Postgres for this reason).
2. `cds add postgres` in the project to wire up `@cap-js/postgres`.
3. Put the Neon connection string in an environment variable
   (`process.env.VCAP_SERVICES` / `.cdsrc-private.json` for local testing,
   real env var in production) — never commit credentials to git.
4. Deploy schema with `cds deploy --to postgres` against the Neon connection
   string.

### 7.3 App hosting — Render free Web Service (primary) or Koyeb (backup)
1. Push the CAP project to a GitHub repo.
2. On Render: "New Web Service" → connect repo → build command `npm install`
   → start command `npm start` (CAP's default `cds-serve`) → select the Free
   instance type.
3. Set environment variables on Render for the Neon connection string and
   `NODE_ENV=production`.
4. Note for the user: Render's free tier spins the service down after 15
   minutes idle; the first request after that takes 30–60s to wake up. This
   is an acceptable tradeoff for a personal app and should be mentioned in the
   README, not silently hidden.
5. Koyeb's free web service (1 vCPU / 512 MB, no credit card) is a good
   backup if Render's limits change — same deployment steps (connect repo,
   auto-detect Node).

### 7.4 What NOT to use
- No SAP BTP trial/free tier account, no HANA Cloud, no XSUAA — none of these
  are needed for a personal single-user app and they add operational
  complexity for no benefit here.
- No Fly.io/Railway — both dropped their meaningful free tiers as of 2026 and
  require a credit card or only offer short trial credits.

---

## 8. Suggested build phases for Claude Code

Work through these in order; verify each phase runs before starting the next.

1. **Scaffold**: `cds init` + Fiori Elements List Report app shell, SQLite dev DB,
   `Items` entity with sample data (`db/data/*.csv`), no business logic yet —
   confirm the raw table renders.
2. **Status logic**: implement `getDashboard` function + virtual
   `status`/`daysRemaining` fields + criticality-based traffic-light rendering.
3. **Manual add-item flow**: `createItem` action + "Add Loose Item" dialog,
   wired with `bindContext`/`.execute()` per §5. No barcode yet.
4. **Consumption logging**: `recordStockChange` bound action + Object Page
   footer button.
5. **Barcode scanning**: `lookupBarcode` action (Open Food Facts), camera
   scanner fragment, pre-fill + confirm flow.
6. **Postgres + Neon**: swap dev SQLite for Neon Postgres locally, confirm
   `cds deploy` works end-to-end.
7. **Deploy**: push to GitHub, stand up Render (or Koyeb) web service pointed
   at the Neon DB, smoke-test the live URL end to end.
8. **Polish**: empty states, loading states for the cold-start delay,
   basic input validation, README explaining the free-tier tradeoffs.

---

## 9. Learning-goal reminders for Claude Code

Since the user is learning UI5/CAP, when generating code:
- Prefer CDS annotations over hand-written UI logic wherever Fiori Elements
  supports it (list columns, criticality colors, footer actions, filters).
- Add short comments explaining *why* a CAP/UI5 idiom is used where it isn't
  obvious (e.g. why an action is bound vs. unbound, why `virtual` instead of
  a stored column).
- When a piece of UI needs to be hand-authored (the scanner, the add-item
  forms), name the exact extension mechanism used (Custom Page, Custom
  Section, Custom Action, Controller Extension) in a comment, so the user
  learns to recognize where Fiori Elements' generated templates end and its
  *documented* extension points begin — this is a different, more valuable
  skill than knowing how to write freestyle UI5 from scratch.
- If Claude Code is ever tempted to solve a UI requirement by generating a
  standalone freestyle UI5 app/component that bypasses `sap.fe` routing
  entirely, stop and re-check §6 for the matching extension point first —
  there almost always is one (Custom Page, Custom Section, Custom Column,
  Custom Action, Controller Extension, Building Block).

---

## 10. Working with this file in VS Code via Claude Code

See the companion answer in chat for the step-by-step VS Code + Claude Code
workflow (installation, opening the project, how Claude Code discovers and
uses this file automatically, and how to drive the §8 build phases from the
integrated terminal).
