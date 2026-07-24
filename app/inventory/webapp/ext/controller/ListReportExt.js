// Fiori Elements custom-action `press` handlers (manifest.json
// controlConfiguration) are resolved as a plain module path + function name -
// a separate resolution mechanism from `sap.ui.controllerExtensions`
// (ListReportExt.controller.js), which augments the List Report controller
// itself rather than serving as an action handler target.
sap.ui.define([], function () {
  "use strict";
  return {
    // Fiori Elements binds `this` to the List Report's ExtensionAPI when
    // invoking a manifest-declared custom action `press` handler (a separate
    // resolution path from sap.ui.controllerExtensions, see the .controller.js
    // file alongside this one) - so navigation is one call away, no lookup needed.
    onAddLooseItem: function () {
      this.getRouting().navigateToRoute("addLooseItem");
    },

    onScanBarcode: function () {
      this.getRouting().navigateToRoute("scanBarcode");
    }
  };
});
