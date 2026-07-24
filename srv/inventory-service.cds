using kitchen.inventory as db from '../db/schema';

service InventoryService {

  entity Items as projection on db.Items actions {
    // Bound action on a single Item: record that some quantity was
    // consumed/restocked (§4, §6.5). Bound (not unbound) because it always
    // acts on one specific Item row - the UI invokes it via bindContext bound
    // to that row's context, per §5.
    action recordStockChange(deltaAmount: Decimal, reason: String) returns Items;
  };

  // Unbound function: dashboard summary, called on app launch (§4, §4.3)
  function getDashboard() returns array of Items;

  // Unbound action: resolve a scanned barcode to a product name via external
  // lookup (§4.4), WITHOUT creating the item yet - lets the UI show a
  // confirm/edit dialog first. The only legitimate external REST call in
  // this app (Open Food Facts) - called server-side, never from the browser.
  action lookupBarcode(barcode: String) returns {
    found        : Boolean;
    suggestedName: String;
  };

  // Unbound action: create a new item - packaged (barcode) or loose (no barcode).
  // For loose items, the service generates the unique ID; the client never invents one (§4.2).
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

// Generated List Report (§6.1) - annotation-driven, no hand-rolled UI logic.
// `criticality` (RED=1/YELLOW=2/GREEN=3) drives Fiori Elements' built-in
// red/yellow/green ObjectStatus rendering for the `status` column.
annotate InventoryService.Items with @UI: {
  HeaderInfo: {
    TypeName      : 'Item',
    TypeNamePlural: 'Items',
    Title         : { Value: name }
  },
  LineItem: [
    { Value: name },
    { Value: category },
    { Value: currentStockValue },
    { Value: baseUnit },
    { Value: daysRemaining },
    { Value: status, Criticality: criticality, CriticalityRepresentation: #WithIcon }
  ],
  PresentationVariant: {
    SortOrder: [
      { Property: criticality, Descending: false },
      { Property: name, Descending: false }
    ],
    Visualizations: ['@UI.LineItem']
  },
  // Object Page (§6.2/§6.5) - generated from @UI.FieldGroup/@UI.Facets.
  // recordStockChange is exposed via @UI.Identification (not a hand-rolled
  // Custom Section) so Fiori Elements generates the action button *and* the
  // parameter input dialog (deltaAmount/reason) entirely from the action's
  // own signature - per §5's own guidance to prefer annotations over manual
  // bindContext JS wherever the template already supports it.
  Identification: [
    { $Type: 'UI.DataFieldForAction', Action: 'InventoryService.recordStockChange', Label: 'Log Consumption' }
  ],
  FieldGroup#GeneralInfo: {
    Data: [
      { Value: name },
      { Value: category },
      { Value: barcode },
      { Value: isLooseItem },
      { Value: currentStockValue },
      { Value: baseUnit },
      { Value: consumptionAmount },
      { Value: consumptionUnit },
      { Value: consumptionFreq },
      { Value: daysRemaining },
      { Value: status, Criticality: criticality, CriticalityRepresentation: #WithIcon }
    ]
  },
  Facets: [
    {
      $Type: 'UI.ReferenceFacet',
      ID: 'GeneralInformation',
      Label: 'General Information',
      Target: '@UI.FieldGroup#GeneralInfo'
    }
  ]
};
