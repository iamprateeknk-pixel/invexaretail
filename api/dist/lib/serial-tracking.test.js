"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const serial_tracking_js_1 = require("./serial-tracking.js");
(0, node_test_1.default)('a serial can be in only one state - legal transitions are allowed', () => {
    strict_1.default.doesNotThrow(() => (0, serial_tracking_js_1.assertValidSerialTransition)('IN_STOCK', 'RESERVED'));
    strict_1.default.doesNotThrow(() => (0, serial_tracking_js_1.assertValidSerialTransition)('RESERVED', 'SOLD'));
    strict_1.default.doesNotThrow(() => (0, serial_tracking_js_1.assertValidSerialTransition)('SOLD', 'RETURNED'));
    strict_1.default.doesNotThrow(() => (0, serial_tracking_js_1.assertValidSerialTransition)('RETURNED', 'IN_STOCK'));
});
(0, node_test_1.default)('rejects transitions that would let a serial skip an invariant state', () => {
    strict_1.default.throws(() => (0, serial_tracking_js_1.assertValidSerialTransition)('SOLD', 'RESERVED'), serial_tracking_js_1.SerialTransitionError);
    strict_1.default.throws(() => (0, serial_tracking_js_1.assertValidSerialTransition)('LOST', 'SOLD'), serial_tracking_js_1.SerialTransitionError);
    strict_1.default.throws(() => (0, serial_tracking_js_1.assertValidSerialTransition)('DAMAGED', 'SOLD'), serial_tracking_js_1.SerialTransitionError);
});
(0, node_test_1.default)('planSerialMovement shapes a movement row and rejects illegal transitions before anything is persisted', () => {
    const movement = (0, serial_tracking_js_1.planSerialMovement)({
        currentStatus: 'IN_STOCK',
        toStatus: 'SOLD',
        movementType: 'SALE',
        fromLocationId: 'loc-1',
        reference: 'order-42',
        actorId: 'user-1',
    });
    strict_1.default.deepEqual(movement, {
        movementType: 'SALE',
        fromLocationId: 'loc-1',
        toLocationId: null,
        fromStatus: 'IN_STOCK',
        toStatus: 'SOLD',
        reference: 'order-42',
        actorId: 'user-1',
    });
    strict_1.default.throws(() => (0, serial_tracking_js_1.planSerialMovement)({ currentStatus: 'LOST', toStatus: 'SOLD', movementType: 'SALE' }), serial_tracking_js_1.SerialTransitionError);
});
(0, node_test_1.default)('buildRecallTrace orders movements chronologically with a human-readable event per row', () => {
    const trace = (0, serial_tracking_js_1.buildRecallTrace)([
        { id: 'm2', movementType: 'SALE', fromLocationId: 'loc-1', toLocationId: null, fromStatus: 'IN_STOCK', toStatus: 'SOLD', reference: 'order-42', actorId: 'user-1', createdAt: '2026-09-10T00:00:00.000Z' },
        { id: 'm1', movementType: 'RECEIVE', fromLocationId: null, toLocationId: 'loc-1', fromStatus: null, toStatus: 'IN_STOCK', reference: 'grn-1', actorId: 'user-2', createdAt: '2026-09-01T00:00:00.000Z' },
        { id: 'm3', movementType: 'RETURN', fromLocationId: null, toLocationId: 'loc-1', fromStatus: 'SOLD', toStatus: 'RETURNED', reference: 'rma-9', actorId: 'user-1', createdAt: '2026-09-15T00:00:00.000Z' },
    ]);
    strict_1.default.equal(trace.length, 3);
    strict_1.default.deepEqual(trace.map((step) => step.event), ['Received from supplier', 'Sold', 'Returned']);
    strict_1.default.equal(trace[0].reference, 'grn-1');
    strict_1.default.ok(trace[0].at < trace[1].at && trace[1].at < trace[2].at);
});
