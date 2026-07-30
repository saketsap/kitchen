// Object Page custom header action (§6.2 mechanism, applied to the Object
// Page instead of the List Report) - resolved the same way as
// ListReportExt.js's custom actions: a plain module path + function name,
// with `this` bound to the Object Page's ExtensionAPI at call time.
sap.ui.define([
  "sap/ui/core/Fragment",
  "sap/ui/model/json/JSONModel",
  "sap/m/MessageToast",
  "sap/m/MessageBox"
], function (Fragment, JSONModel, MessageToast, MessageBox) {
  "use strict";

  const DIALOG_ID = "kitchenInventoryEditItemDialog";

  return {
    onEditItem: function () {
      const oExtensionAPI = this;
      const oContext = oExtensionAPI.getBindingContext();
      const oData = oContext.getObject();

      const oFormModel = new JSONModel({
        name: oData.name,
        category: oData.category,
        barcode: oData.barcode,
        currentStockValue: oData.currentStockValue,
        baseUnit: oData.baseUnit,
        consumptionAmount: oData.consumptionAmount,
        consumptionUnit: oData.consumptionUnit,
        consumptionFreq: oData.consumptionFreq
      });

      Fragment.load({
        id: DIALOG_ID,
        name: "kitchen.inventory.ext.edititem.EditItem"
      }).then((oDialog) => {
        oDialog.setModel(oFormModel, "editItem");
        oDialog.attachAfterClose(() => oDialog.destroy());

        const oSaveButton = Fragment.byId(DIALOG_ID, "saveButton");
        const oCancelButton = Fragment.byId(DIALOG_ID, "cancelButton");

        oCancelButton.attachPress(() => oDialog.close());

        oSaveButton.attachPress(() => {
          const oValues = oFormModel.getData();

          // Bound action call, per §5: bind on the row's own context (not
          // the raw model), so this is a genuine bound operation, never a
          // hand-rolled REST PATCH.
          const oModel = oContext.getModel();
          const oOperation = oModel.bindContext("InventoryService.editItem(...)", oContext);
          oOperation.setParameter("name", oValues.name);
          oOperation.setParameter("category", oValues.category || null);
          oOperation.setParameter("barcode", oValues.barcode || null);
          oOperation.setParameter("currentStockValue", parseFloat(oValues.currentStockValue));
          oOperation.setParameter("baseUnit", oValues.baseUnit);
          oOperation.setParameter("consumptionAmount", parseFloat(oValues.consumptionAmount));
          oOperation.setParameter("consumptionUnit", oValues.consumptionUnit);
          oOperation.setParameter("consumptionFreq", oValues.consumptionFreq);

          oOperation.execute().then(() => {
            MessageToast.show("Item updated");
            oContext.refresh();
            oDialog.close();
          }).catch((oError) => {
            MessageBox.error("Could not update item: " + oError.message);
          });
        });

        oDialog.open();
      });
    }
  };
});
