sap.ui.define([
  "sap/ui/core/mvc/Controller",
  "sap/ui/core/Component",
  "sap/ui/model/json/JSONModel",
  "sap/m/MessageToast",
  "sap/m/MessageBox"
], function (Controller, Component, JSONModel, MessageToast, MessageBox) {
  "use strict";

  // This Custom Page is nested one level below the sap.fe app shell - see
  // the identical helper in ext/addlooseitem/Controller.controller.js for
  // why getOwnerComponent().getRouter() alone doesn't find the real router.
  function getAppRouter(oControl) {
    let oComponent = Component.getOwnerComponentFor(oControl);
    while (oComponent) {
      const oRouter = typeof oComponent.getRouter === "function" && oComponent.getRouter();
      if (oRouter) return oRouter;
      oComponent = Component.getOwnerComponentFor(oComponent);
    }
    return undefined;
  }

  // JS barcode-library fallback (§6.3) - loaded only inside this component,
  // never added to the global UI5 bootstrap (index.html).
  const HTML5_QRCODE_CDN = "https://unpkg.com/html5-qrcode/minified/html5-qrcode.min.js";

  return Controller.extend("kitchen.inventory.ext.scanner.Controller", {
    onInit: function () {
      this._oModel = new JSONModel({
        scanning: true,
        cameraStatus: "Starting camera...",
        showConfirmForm: false,
        barcode: "",
        suggestedName: "",
        name: "",
        category: "",
        currentStockValue: null,
        baseUnit: "G",
        consumptionAmount: null,
        consumptionUnit: "G",
        consumptionFreq: "DAILY"
      });
      this.getView().setModel(this._oModel);

      // Defer so the <video> element (core:HTML) is in the DOM before we
      // wire the camera up to it.
      setTimeout(() => this._startScanning(), 0);
    },

    onExit: function () {
      this._stopStream();
    },

    _stopStream: function () {
      if (this._stream) {
        this._stream.getTracks().forEach((track) => track.stop());
        this._stream = null;
      }
      if (this._detectInterval) {
        clearInterval(this._detectInterval);
        this._detectInterval = null;
      }
      if (this._html5Qrcode) {
        this._html5Qrcode.stop().catch(() => {});
        this._html5Qrcode = null;
      }
    },

    _startScanning: async function () {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        this._oModel.setProperty("/cameraStatus", "Camera not available - enter the barcode manually below.");
        return;
      }
      try {
        this._stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
      } catch (e) {
        this._oModel.setProperty("/cameraStatus", "Camera access denied - enter the barcode manually below.");
        return;
      }

      const oVideo = document.getElementById("barcodeVideo");
      if (!oVideo) return;
      oVideo.srcObject = this._stream;

      // Feature-detect the native BarcodeDetector API (§6.3); fall back to a
      // small JS library only when it's unavailable.
      if (window.BarcodeDetector) {
        this._oModel.setProperty("/cameraStatus", "Point the camera at a barcode...");
        const oDetector = new window.BarcodeDetector({ formats: ["ean_13", "ean_8", "upc_a", "upc_e"] });
        this._detectInterval = setInterval(async () => {
          try {
            const aCodes = await oDetector.detect(oVideo);
            if (aCodes.length > 0) this._onBarcodeDetected(aCodes[0].rawValue);
          } catch (e) { /* transient detect errors are expected between frames */ }
        }, 500);
      } else {
        this._oModel.setProperty("/cameraStatus", "Loading barcode scanner library...");
        try {
          await this._loadHtml5Qrcode();
          this._startHtml5QrcodeFallback();
        } catch (e) {
          this._oModel.setProperty("/cameraStatus", "Barcode scanner library unavailable - enter the barcode manually below.");
        }
      }
    },

    _loadHtml5Qrcode: function () {
      if (window.Html5Qrcode) return Promise.resolve();
      return new Promise((resolve, reject) => {
        const oScript = document.createElement("script");
        oScript.src = HTML5_QRCODE_CDN;
        oScript.onload = resolve;
        oScript.onerror = reject;
        document.head.appendChild(oScript);
      });
    },

    _startHtml5QrcodeFallback: function () {
      this._oModel.setProperty("/cameraStatus", "Point the camera at a barcode...");
      this._html5Qrcode = new window.Html5Qrcode("barcodeVideo");
      this._html5Qrcode.start(
        { facingMode: "environment" },
        { fps: 10, qrbox: 250 },
        (decodedText) => this._onBarcodeDetected(decodedText)
      ).catch(() => {
        this._oModel.setProperty("/cameraStatus", "Could not start scanner - enter the barcode manually below.");
      });
    },

    _onBarcodeDetected: function (sBarcode) {
      this._stopStream();
      this._oModel.setProperty("/scanning", false);
      this._oModel.setProperty("/barcode", sBarcode);
      this._lookupBarcode(sBarcode);
    },

    onManualLookup: function () {
      const sBarcode = this._oModel.getProperty("/barcode");
      if (!sBarcode) {
        MessageBox.error("Enter a barcode first.");
        return;
      }
      this._stopStream();
      this._oModel.setProperty("/scanning", false);
      this._lookupBarcode(sBarcode);
    },

    _lookupBarcode: function (sBarcode) {
      // Unbound action call, per §5: bind on the model and .execute() it -
      // never a hand-rolled REST call from the browser (§4.4).
      const oModel = this.getOwnerComponent().getModel();
      const oOperation = oModel.bindContext("/lookupBarcode(...)");
      oOperation.setParameter("barcode", sBarcode);
      oOperation.execute().then(() => {
        const oResult = oOperation.getBoundContext().getObject();
        this._oModel.setProperty("/suggestedName", oResult.suggestedName || "");
        this._oModel.setProperty("/name", oResult.suggestedName || "");
        this._oModel.setProperty("/showConfirmForm", true);
        if (!oResult.found) {
          MessageToast.show("Barcode not found - enter the product name manually.");
        }
      }).catch((oError) => {
        MessageBox.error("Barcode lookup failed: " + oError.message);
        this._oModel.setProperty("/showConfirmForm", true);
      });
    },

    onNavBack: function () {
      this._stopStream();
      getAppRouter(this.getView()).navTo("ItemsList");
    },

    onSave: function () {
      const oData = this._oModel.getData();
      const oModel = this.getOwnerComponent().getModel();
      const oOperation = oModel.bindContext("/createItem(...)");

      oOperation.setParameter("name", oData.name);
      oOperation.setParameter("barcode", oData.barcode);
      oOperation.setParameter("isLooseItem", false);
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
