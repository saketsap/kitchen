sap.ui.define(["sap/ui/core/UIComponent"], function (UIComponent) {
  "use strict";

  // Custom Page (§6.3/§6.4) - a small, freestyle UIComponent that Fiori
  // Elements mounts as a normal routing target. It still shares the same
  // sap.fe shell, back-navigation, and ODataModel instance as the generated
  // List Report / Object Page - this is the documented extension point for
  // genuinely non-templated UI, not a reason to eject from sap.fe routing.
  return UIComponent.extend("kitchen.inventory.ext.addlooseitem.Component", {
    metadata: {
      rootView: {
        viewName: "kitchen.inventory.ext.addlooseitem.View",
        type: "XML",
        id: "addLooseItemView"
      }
    }
  });
});
