namespace kitchen.inventory;

using { cuid, managed } from '@sap/cds/common';

type UnitOfMeasure : String enum {
  GRAM        = 'G';
  MILLILITRE  = 'ML';
  TABLESPOON  = 'TBSP';
  PIECE       = 'PC';
}

type ConsumptionFrequency : String enum {
  DAILY  = 'DAILY';
  WEEKLY = 'WEEKLY';
}

type StockStatus : String enum {
  RED    = 'RED';     // < 7 days left
  YELLOW = 'YELLOW';  // 7-14 days left
  GREEN  = 'GREEN';   // > 14 days left (3+ weeks, comfortable zone)
}

entity Items : cuid, managed {
  name                 : String(100) not null;
  barcode              : String(50);               // null for loose items
  isLooseItem          : Boolean default false;
  currentStockValue    : Decimal(10,2) not null;    // stored in base unit (g/ml/pc)
  baseUnit             : UnitOfMeasure not null;
  consumptionAmount    : Decimal(10,2) not null;    // as entered by user
  consumptionUnit      : UnitOfMeasure not null;    // unit the user typed in (g/ml/tbsp/pc)
  consumptionFreq      : ConsumptionFrequency not null;
  dailyConsumptionBase : Decimal(10,2) not null;    // normalized: per day, in baseUnit - computed on create/update
  virtual daysRemaining : Decimal(10,2);            // computed in an `after READ` handler, not persisted
  virtual status        : StockStatus;              // computed in an `after READ` handler, not persisted
  virtual criticality   : Integer;                  // numeric mirror of `status` (RED=1/YELLOW=2/GREEN=3), computed alongside it -
                                                     // Fiori Elements' @UI.Criticality needs a numeric UI.CriticalityType value, not the enum directly
  category             : String(40);                // e.g. Spice, Dairy, Grain - optional, for grouping
}
