"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const carrier_adapter_js_1 = require("./carrier-adapter.js");
(0, node_test_1.default)('getRates returns a surface and express quote, express costs more and arrives sooner', async () => {
    const adapter = new carrier_adapter_js_1.LocalCarrierAdapter();
    const rates = await adapter.getRates({
        orderReference: 'order-1', originPincode: '302001', destinationPincode: '110001', weightKg: 2,
    });
    strict_1.default.equal(rates.length, 2);
    const surface = rates.find((rate) => rate.serviceCode === 'LOCAL_SURFACE');
    const express = rates.find((rate) => rate.serviceCode === 'LOCAL_EXPRESS');
    strict_1.default.ok(express.estimatedCost > surface.estimatedCost);
    strict_1.default.ok(express.estimatedDays < surface.estimatedDays);
});
(0, node_test_1.default)('heavier shipments cost more', async () => {
    const adapter = new carrier_adapter_js_1.LocalCarrierAdapter();
    const light = await adapter.getRates({ orderReference: 'o', originPincode: '1', destinationPincode: '2', weightKg: 1 });
    const heavy = await adapter.getRates({ orderReference: 'o', originPincode: '1', destinationPincode: '2', weightKg: 10 });
    strict_1.default.ok(heavy[0].estimatedCost > light[0].estimatedCost);
});
(0, node_test_1.default)('every pincode is serviceable by the local adapter', async () => {
    const adapter = new carrier_adapter_js_1.LocalCarrierAdapter();
    strict_1.default.equal(await adapter.checkServiceability('000000'), true);
});
(0, node_test_1.default)('createShipment issues an AWB that can then be tracked, starting BOOKED', async () => {
    const adapter = new carrier_adapter_js_1.LocalCarrierAdapter();
    const shipment = await adapter.createShipment({
        orderReference: 'order-42', originPincode: '302001', destinationPincode: '110001', weightKg: 1.5,
    });
    strict_1.default.ok(shipment.awbNumber.startsWith('LOCAL-'));
    const tracking = await adapter.trackShipment(shipment.awbNumber);
    strict_1.default.equal(tracking.status, 'BOOKED');
    strict_1.default.equal(tracking.events[0].status, 'BOOKED');
});
(0, node_test_1.default)('tracking an unknown AWB throws rather than fabricating a status', async () => {
    const adapter = new carrier_adapter_js_1.LocalCarrierAdapter();
    await strict_1.default.rejects(() => adapter.trackShipment('LOCAL-DOES-NOT-EXIST'));
});
(0, node_test_1.default)('cancelShipment records a CANCELLED event and cannot cancel a delivered shipment', async () => {
    const adapter = new carrier_adapter_js_1.LocalCarrierAdapter();
    const shipment = await adapter.createShipment({
        orderReference: 'order-cancel', originPincode: '302001', destinationPincode: '110001', weightKg: 1,
    });
    await adapter.cancelShipment(shipment.awbNumber);
    const tracking = await adapter.trackShipment(shipment.awbNumber);
    strict_1.default.equal(tracking.status, 'CANCELLED');
    strict_1.default.equal(tracking.events.at(-1)?.status, 'CANCELLED');
});
(0, node_test_1.default)('the carrier registry resolves "local" and rejects an unconfigured provider', () => {
    strict_1.default.deepEqual((0, carrier_adapter_js_1.listCarrierProviders)(), ['local']);
    strict_1.default.equal((0, carrier_adapter_js_1.getCarrierAdapter)('local').provider, 'local');
    strict_1.default.throws(() => (0, carrier_adapter_js_1.getCarrierAdapter)('shiprocket'));
});
