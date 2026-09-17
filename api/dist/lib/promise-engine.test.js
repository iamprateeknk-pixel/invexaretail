"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const promise_engine_js_1 = require("./promise-engine.js");
(0, node_test_1.default)('a marketplace channel gets a larger safety buffer than the website', () => {
    strict_1.default.ok((0, promise_engine_js_1.channelSafetyBufferHours)('AMAZON') > (0, promise_engine_js_1.channelSafetyBufferHours)('WEBSITE'));
    strict_1.default.ok((0, promise_engine_js_1.channelSafetyBufferHours)('FLIPKART') > (0, promise_engine_js_1.channelSafetyBufferHours)('WEBSITE'));
});
(0, node_test_1.default)('an unknown channel falls back to the default buffer, not zero', () => {
    strict_1.default.equal((0, promise_engine_js_1.channelSafetyBufferHours)('SOME_NEW_CHANNEL'), (0, promise_engine_js_1.channelSafetyBufferHours)('DEFAULT'));
});
(0, node_test_1.default)('dispatch time = reservedAt + pick/pack lead + channel buffer', () => {
    const reservedAt = new Date('2026-09-16T00:00:00.000Z');
    const result = (0, promise_engine_js_1.estimateDispatchAndDelivery)({ reservedAt, deliverySlaHours: null, channel: 'WEBSITE' });
    const expectedHours = promise_engine_js_1.PICK_PACK_LEAD_HOURS + (0, promise_engine_js_1.channelSafetyBufferHours)('WEBSITE');
    strict_1.default.equal(result.estimatedDispatchAt, new Date(reservedAt.getTime() + expectedHours * 60 * 60 * 1000).toISOString());
    strict_1.default.equal(result.safetyBufferHours, (0, promise_engine_js_1.channelSafetyBufferHours)('WEBSITE'));
});
(0, node_test_1.default)('delivery time is dispatch + the location delivery SLA when known', () => {
    const reservedAt = new Date('2026-09-16T00:00:00.000Z');
    const result = (0, promise_engine_js_1.estimateDispatchAndDelivery)({ reservedAt, deliverySlaHours: 24, channel: 'WEBSITE' });
    const dispatch = new Date(result.estimatedDispatchAt);
    strict_1.default.equal(result.estimatedDeliveryAt, new Date(dispatch.getTime() + 24 * 60 * 60 * 1000).toISOString());
});
(0, node_test_1.default)('an unknown delivery SLA yields no delivery estimate rather than fabricating one', () => {
    const result = (0, promise_engine_js_1.estimateDispatchAndDelivery)({ reservedAt: new Date(), deliverySlaHours: null, channel: 'WEBSITE' });
    strict_1.default.equal(result.estimatedDeliveryAt, null);
});
(0, node_test_1.default)('a marketplace order dispatches later than the same order placed on the website', () => {
    const reservedAt = new Date('2026-09-16T00:00:00.000Z');
    const website = (0, promise_engine_js_1.estimateDispatchAndDelivery)({ reservedAt, deliverySlaHours: 24, channel: 'WEBSITE' });
    const amazon = (0, promise_engine_js_1.estimateDispatchAndDelivery)({ reservedAt, deliverySlaHours: 24, channel: 'AMAZON' });
    strict_1.default.ok(new Date(amazon.estimatedDispatchAt).getTime() > new Date(website.estimatedDispatchAt).getTime());
});
