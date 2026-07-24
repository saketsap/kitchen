sap.ui.define([
  "sap/ui/core/mvc/Controller",
  "sap/ui/core/Component",
  "sap/ui/model/json/JSONModel",
  "sap/m/MessageToast",
  "sap/m/MessageBox"
], function (Controller, Component, JSONModel, MessageToast, MessageBox) {
  "use strict";

  // This Custom Page is nested one level below the sap.fe app shell - its own
  // getOwnerComponent() is itself (routerless), not the app's root component,
  // so UIComponent.getRouterFor (which only checks the direct owner) comes up
  // empty. Walk the ownership chain until a component actually has a router.
  function getAppRouter(oControl) {
    let oComponent = Component.getOwnerComponentFor(oControl);
    while (oComponent) {
      const oRouter = typeof oComponent.getRouter === "function" && oComponent.getRouter();
      if (oRouter) return oRouter;
      oComponent = Component.getOwnerComponentFor(oComponent);
    }
    return undefined;
  }

  return Controller.extend("kitchen.inventory.ext.addlooseitem.Controller", {
    onInit: function () {
      // Plain JSONModel for the form's draft input - the real Items entity
      // is only created once, via the createItem action (see onSave).
      this.getView().setModel(new JSONModel({
        name: "",
        category: "",
        currentStockValue: null,
        baseUnit: "G",
        consumptionAmount: null,
        consumptionUnit: "G",
        consumptionFreq: "DAILY"
      }));
    },

    onNavBack: function () {
      getAppRouter(this.getView()).navTo("ItemsList");
    },

    onSave: function () {
      const oData = this.getView().getModel().getData();

      // Unbound action call, per §5: bind on the shared ODataModel (inherited
      // from the sap.fe app shell, see Component.js) and .execute() it -
      // never a hand-rolled REST POST.
      const oModel = this.getOwnerComponent().getModel();
      const oOperation = oModel.bindContext("/createItem(...)");

      oOperation.setParameter("name", oData.name);
      oOperation.setParameter("barcode", null);
      oOperation.setParameter("isLooseItem", true);
      oOperation.setParameter("currentStockValue", parseFloat(oData.currentStockValue));
      oOperation.setParameter("baseUnit", oData.baseUnit);
      oOperation.setParameter("consumptionAmount", parseFloat(oData.consumptionAmount));
      oOperation.setParameter("consumptionUnit", oData.consumptionUnit);
      oOperation.setParameter("consumptionFreq", oData.consumptionFreq);
      oOperation.setParameter("category", oData.category || null);

      oOperation.execute().then(() => {
        const oCreatedContext = oOperation.getBoundContext();
        MessageToast.show("Item added: " + oCreatedContext.getObject().name);
        getAppRouter(this.getView()).navTo("ItemsList");
      }).catch((oError) => {
        MessageBox.error("Could not create item: " + oError.message);
      });
    }
  });
});
