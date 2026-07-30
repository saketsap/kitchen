const cds = require('@sap/cds')

// Single source of truth for the traffic-light calculation (§4.1) - reused by
// the Items READ handler and the getDashboard function so the status logic
// lives in exactly one place, per project conventions (see db/schema.cds).
function computeStatus({ currentStockValue, dailyConsumptionBase }) {
  if (!dailyConsumptionBase || dailyConsumptionBase <= 0) {
    // guard divide-by-zero: no consumption rate recorded yet
    return { daysRemaining: null, status: 'GREEN', criticality: 3 }
  }
  const daysRemaining = currentStockValue / dailyConsumptionBase
  const status = daysRemaining < 7 ? 'RED' : daysRemaining <= 14 ? 'YELLOW' : 'GREEN'
  const criticality = { RED: 1, YELLOW: 2, GREEN: 3 }[status]
  return { daysRemaining, status, criticality }
}

const SEVERITY = { RED: 0, YELLOW: 1, GREEN: 2 }

// A tablespoon is ~15g / ~15ml - good enough for a kitchen app (§3 assumption).
const TABLESPOON_TO_BASE_UNIT = 15

function convertToBaseUnit(amount, unit) {
  return unit === 'TBSP' ? amount * TABLESPOON_TO_BASE_UNIT : amount
}

function computeDailyConsumptionBase({ consumptionAmount, consumptionUnit, consumptionFreq }) {
  const perOccurrence = convertToBaseUnit(consumptionAmount, consumptionUnit)
  return consumptionFreq === 'WEEKLY' ? perOccurrence / 7 : perOccurrence
}

module.exports = cds.service.impl(function () {
  const srv = this
  const { Items } = srv.entities

  // Items is served through the generic, annotation-driven CRUD handler CAP
  // provides for free - only the derived virtual fields need enrichment here.
  // `currentStockValue`/`dailyConsumptionBase` drive the computation but
  // aren't always in the client's own $select (e.g. `dailyConsumptionBase`
  // isn't shown in any UI field) - force both into the query here and strip
  // out whichever the client didn't actually ask for, so the response still
  // honors the requested $select.
  const COMPUTE_INPUTS = ['currentStockValue', 'dailyConsumptionBase']
  const VIRTUAL_FIELDS = ['criticality', 'status', 'daysRemaining']

  srv.before('READ', Items, (req) => {
    const { SELECT } = req.query
    const { columns, orderBy } = SELECT
    if (!columns) return
    req._stripComputeInputs = COMPUTE_INPUTS.filter((col) => !columns.some((c) => c.ref?.[0] === col))
    for (const col of req._stripComputeInputs) columns.push({ ref: [col] })

    // criticality/status/daysRemaining don't exist as real DB columns - they're
    // computed below, after the DB query already ran - so the database can't
    // ORDER BY them (silently ignored, e.g. Fiori Elements' RED-first sort
    // otherwise does nothing). Pull the sort/pagination out of the DB query
    // and redo both in JS, after the virtual fields actually exist.
    if (orderBy?.some((o) => VIRTUAL_FIELDS.includes(o.ref?.[0]))) {
      req._virtualOrderBy = orderBy.filter((o) => o.ref?.length === 1 && !o.implicit)
      delete SELECT.orderBy
      if (SELECT.limit) {
        req._virtualLimit = SELECT.limit
        delete SELECT.limit
      }
    }
  })

  srv.after('READ', Items, (rows, req) => {
    let list = Array.isArray(rows) ? rows : [rows]
    for (const row of list) {
      if (!row) continue
      Object.assign(row, computeStatus(row))
      for (const col of req._stripComputeInputs || []) delete row[col]
    }

    if (req._virtualOrderBy) {
      list.sort((a, b) => {
        for (const { ref, sort } of req._virtualOrderBy) {
          const [key] = ref
          const dir = sort === 'desc' ? -1 : 1
          if (a[key] < b[key]) return -1 * dir
          if (a[key] > b[key]) return 1 * dir
        }
        return 0
      })
      if (req._virtualLimit) {
        const start = req._virtualLimit.offset?.val || 0
        const rowsWanted = req._virtualLimit.rows?.val
        const page = list.slice(start, rowsWanted != null ? start + rowsWanted : undefined)
        list.length = 0
        list.push(...page)
      }
    }
  })

  // Unbound function: dashboard summary, sorted RED -> YELLOW -> GREEN then
  // alphabetically within each group (§4.3), so the most urgent items are
  // always on top - this ordering is business logic and belongs in the
  // service, not in hand-rolled client-side sorting.
  srv.on('getDashboard', async () => {
    const items = await SELECT.from(Items)
    return items
      .map((item) => Object.assign(item, computeStatus(item)))
      .sort((a, b) => SEVERITY[a.status] - SEVERITY[b.status] || a.name.localeCompare(b.name))
  })

  // Unbound action: create a packaged (barcode) or loose (no barcode) item.
  // The client never invents an ID - cuid's auto-generated UUID is the only
  // ID a loose item ever gets (§4.2), no separate short-code generator needed.
  srv.on('createItem', async (req) => {
    const {
      name, barcode, isLooseItem, currentStockValue, baseUnit,
      consumptionAmount, consumptionUnit, consumptionFreq, category
    } = req.data

    const entry = {
      ID: cds.utils.uuid(),
      name,
      barcode: barcode || null,
      isLooseItem: !!isLooseItem,
      currentStockValue,
      baseUnit,
      consumptionAmount,
      consumptionUnit,
      consumptionFreq,
      category: category || null,
      dailyConsumptionBase: computeDailyConsumptionBase({ consumptionAmount, consumptionUnit, consumptionFreq })
    }

    await INSERT.into(Items).entries(entry)
    return Object.assign(entry, computeStatus(entry))
  })

  // Bound action: adjust one Item's stock (negative deltaAmount = consumed,
  // positive = restocked). `reason` is accepted per §4's signature but not
  // persisted - there's no consumption-log entity in the schema (§3), so it's
  // informational only. `req.params[0]` is CAP's handle for "the key of the
  // entity instance this action was called on" (from
  // InventoryService.recordStockChange(...) bound to a row's context, per §5).
  srv.on('recordStockChange', Items, async (req) => {
    const key = req.params[0]
    const deltaAmount = Number(req.data.deltaAmount)
    // CAP returns Decimal columns as strings (to preserve precision) - must
    // convert before arithmetic, or `+` silently concatenates instead of adding.
    const item = await SELECT.one.from(Items, key)
    const currentStockValue = Math.max(0, Number(item.currentStockValue) + deltaAmount)

    await UPDATE(Items, key).with({ currentStockValue })

    const updated = await SELECT.one.from(Items, key)
    return Object.assign(updated, computeStatus(updated))
  })

  // Bound action: edit any of an item's own fields at any time (§5 pattern -
  // invoked from a custom pre-filled dialog, see ext/edititem). Recomputes
  // dailyConsumptionBase inline (same helper createItem uses) rather than via
  // a before('UPDATE') hook - an UPDATE() issued from inside another action
  // handler doesn't re-enter this service's own generic handler pipeline.
  srv.on('editItem', Items, async (req) => {
    const key = req.params[0]
    const {
      name, category, barcode, currentStockValue, baseUnit,
      consumptionAmount, consumptionUnit, consumptionFreq
    } = req.data

    await UPDATE(Items, key).with({
      name,
      category: category || null,
      barcode: barcode || null,
      currentStockValue,
      baseUnit,
      consumptionAmount,
      consumptionUnit,
      consumptionFreq,
      dailyConsumptionBase: computeDailyConsumptionBase({ consumptionAmount, consumptionUnit, consumptionFreq })
    })

    const updated = await SELECT.one.from(Items, key)
    return Object.assign(updated, computeStatus(updated))
  })

  // Unbound action: the one legitimate external REST call in this app (§4.4) -
  // calling a *third-party* API from CAP server-side is fine; what's
  // disallowed is exposing our own backend as ad-hoc REST endpoints instead
  // of CDS actions. Never called directly from the browser.
  srv.on('lookupBarcode', async (req) => {
    const { barcode } = req.data
    try {
      const response = await fetch(`https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(barcode)}.json`)
      const data = await response.json()
      const suggestedName = data.status === 1 && data.product
        ? (data.product.product_name || data.product.product_name_en || data.product.generic_name || '')
        : ''
      return { found: !!suggestedName, suggestedName }
    } catch (e) {
      return { found: false, suggestedName: '' }
    }
  })
})
