"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createTransferRecord = void 0;
exports.listTransfersForContext = listTransfersForContext;
const inventory_js_1 = require("../inventory.js");
const repository_js_1 = require("../repository.js");
Object.defineProperty(exports, "createTransferRecord", { enumerable: true, get: function () { return repository_js_1.createTransferRecord; } });
const transfer_packing_js_1 = require("../transfer-packing.js");
const repository_js_2 = require("../repository.js");
/** Every transfer whose source or destination the caller's access context can see. */
function listTransfersForContext(ctx) {
    return (0, repository_js_1.listTransfers)()
        .filter((transfer) => (0, inventory_js_1.canAccessLocation)(ctx, transfer.sourceLocationId) || (0, inventory_js_1.canAccessLocation)(ctx, transfer.destinationLocationId))
        .map((transfer) => ({
        ...transfer,
        cartons: (0, transfer_packing_js_1.activeCartons)((0, repository_js_2.listTransferCartons)(transfer.id)).map((carton) => ({
            packageId: carton.packageId,
            quantity: carton.quantity,
            weightKg: carton.weightKg,
        })),
        delayed: (0, transfer_packing_js_1.isTransitDelayed)({ status: transfer.status, expectedArrivalAt: transfer.dispatch?.expectedArrivalAt }),
    }));
}
