sap.ui.define(["sap/ui/core/UIComponent"], function (UIComponent) {
  "use strict";

  // Custom Page (§6.3) - the camera scanner is genuinely non-templated UI,
  // so it's authored as a small freestyle UIComponent mounted as a normal
  // Fiori Elements routing target, same mechanism as the Add Loose Item page.
  return UIComponent.extend("kitchen.inventory.ext.scanner.Component", {
    metadata: {
      rootView: {
        viewName: "kitchen.inventory.ext.scanner.View",
        type: "XML",
        id: "scannerView"
      }
    }
  });
});
