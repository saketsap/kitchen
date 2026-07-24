sap.ui.define(["sap/ui/core/mvc/ControllerExtension"], function (ControllerExtension) {
  "use strict";

  // Controller Extension (§6.2) - the documented Fiori Elements mechanism for
  // augmenting the generated List Report controller itself (lifecycle hooks
  // like onInit/onAfterRendering, or methods invoked from elsewhere in the
  // extension) without touching generated template code. Wired via
  // manifest.json's sap.ui.controllerExtensions.
  //
  // Note: the "Add Loose Item" toolbar button's own press handler is
  // resolved through a *separate* mechanism - the plain module referenced by
  // manifest.json's controlConfiguration action `press` string
  // (ListReportExt.js, alongside this file) - not through this extension.
  return ControllerExtension.extend("kitchen.inventory.ext.controller.ListReportExt", {});
});
