sap.ui.define(["sap/fe/core/AppComponent"], function (AppComponent) {
  "use strict";

  // Fiori Elements root component - the generated List Report / Object Page
  // routing below (manifest.json) is layered on top of this, per §6.
  return AppComponent.extend("kitchen.inventory.Component", {
    metadata: {
      manifest: "json"
    }
  });
});
