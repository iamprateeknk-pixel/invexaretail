"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const connectors_js_1 = require("./connectors.js");
const node_crypto_1 = require("node:crypto");
(0, node_test_1.default)('mapMarketplaceOrder understands Amazon OrderItems + SellerSKU', () => {
    const mapped = (0, connectors_js_1.mapMarketplaceOrder)('AMAZON', {
        AmazonOrderId: 'AMZ-1001',
        BuyerName: 'Asha',
        OrderItems: [{ SellerSKU: 'SKU-1001', QuantityOrdered: 2 }, { SellerSKU: 'SKU-1001', QuantityOrdered: 1 }],
    });
    strict_1.default.equal(mapped.channel, 'AMAZON');
    strict_1.default.equal(mapped.externalReference, 'AMZ-1001');
    strict_1.default.deepEqual(mapped.lines, [{ sku: 'SKU-1001', quantity: 3 }]);
});
(0, node_test_1.default)('mapMarketplaceOrder understands Flipkart orderItems', () => {
    const mapped = (0, connectors_js_1.mapMarketplaceOrder)('FLIPKART', {
        orderId: 'FK-9',
        customerName: 'Ravi',
        orderItems: [{ sku: 'SKU-1002', quantity: 4 }],
    });
    strict_1.default.equal(mapped.channel, 'FLIPKART');
    strict_1.default.equal(mapped.externalReference, 'FK-9');
    strict_1.default.deepEqual(mapped.lines, [{ sku: 'SKU-1002', quantity: 4 }]);
});
(0, node_test_1.default)('mapMarketplaceOrder understands a first-party website payload', () => {
    const mapped = (0, connectors_js_1.mapMarketplaceOrder)('WEBSITE', {
        orderId: 'WEB-22',
        customerName: 'Site Customer',
        lines: [{ sku: 'SKU-1003', quantity: 1 }],
    });
    strict_1.default.equal(mapped.channel, 'WEBSTORE');
    strict_1.default.equal((0, connectors_js_1.validateNormalizedOrder)(mapped), null);
});
(0, node_test_1.default)('validateNormalizedOrder rejects empty references and empty lines', () => {
    strict_1.default.ok((0, connectors_js_1.validateNormalizedOrder)({ channel: 'AMAZON', externalReference: '', customerName: null, notes: null, lines: [{ sku: 'A', quantity: 1 }] }));
    strict_1.default.ok((0, connectors_js_1.validateNormalizedOrder)({ channel: 'AMAZON', externalReference: 'X', customerName: null, notes: null, lines: [] }));
});
(0, node_test_1.default)('verifyConnectorSignature accepts a matching HMAC and rejects a mismatch', () => {
    (0, connectors_js_1.resetConnectors)();
    const connector = (0, connectors_js_1.createConnector)({ name: 'Amazon IN', platform: 'AMAZON', webhookSecret: 'top-secret', tenantId: 'default-company' });
    const body = '{"AmazonOrderId":"1"}';
    const signature = `sha256=${(0, node_crypto_1.createHmac)('sha256', connector.webhookSecret).update(body).digest('hex')}`;
    strict_1.default.equal((0, connectors_js_1.verifyConnectorSignature)(connector.webhookSecret, body, signature), true);
    strict_1.default.equal((0, connectors_js_1.verifyConnectorSignature)(connector.webhookSecret, body, 'sha256=deadbeef'), false);
});
