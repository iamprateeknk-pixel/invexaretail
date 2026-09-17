"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = __importDefault(require("node:test"));
const enterprise_repository_js_1 = require("./enterprise-repository.js");
const otp_auth_js_1 = require("./otp-auth.js");
function decodePayload(token) {
    return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
}
(0, node_test_1.default)('access tokens cannot be used as refresh tokens', () => {
    const access = (0, otp_auth_js_1.generateJWT)('user-1', 'company-1');
    strict_1.default.deepEqual((0, otp_auth_js_1.verifyJWT)(access, 'access'), { userId: 'user-1', companyId: 'company-1' });
    strict_1.default.equal((0, otp_auth_js_1.verifyJWT)(access, 'refresh'), null);
});
(0, node_test_1.default)('refresh tokens cannot be used as access tokens', () => {
    const refresh = (0, otp_auth_js_1.generateRefreshToken)('user-1', 'company-1');
    strict_1.default.deepEqual((0, otp_auth_js_1.verifyJWT)(refresh, 'refresh'), { userId: 'user-1', companyId: 'company-1' });
    strict_1.default.equal((0, otp_auth_js_1.verifyJWT)(refresh, 'access'), null);
});
(0, node_test_1.default)('tampered tokens are rejected', () => {
    const token = (0, otp_auth_js_1.generateJWT)('user-1', 'company-1');
    strict_1.default.equal((0, otp_auth_js_1.verifyJWT)(`${token}x`, 'access'), null);
});
(0, node_test_1.default)('refresh tokens issued in the same second are unique so logout can revoke one of them', () => {
    const first = (0, otp_auth_js_1.generateRefreshToken)('user-1', 'company-1');
    const second = (0, otp_auth_js_1.generateRefreshToken)('user-1', 'company-1');
    strict_1.default.notEqual(first, second);
});
(0, node_test_1.default)('expired access tokens are rejected while refresh tokens outlive a workday', () => {
    const expired = (0, otp_auth_js_1.generateJWT)('user-1', 'company-1', -10, 'access');
    strict_1.default.equal((0, otp_auth_js_1.verifyJWT)(expired, 'access'), null);
    const access = (0, otp_auth_js_1.generateJWT)('user-1', 'company-1');
    const refresh = (0, otp_auth_js_1.generateRefreshToken)('user-1', 'company-1');
    const accessExp = decodePayload(access).exp;
    const refreshExp = decodePayload(refresh).exp;
    strict_1.default.ok(accessExp - Math.floor(Date.now() / 1000) <= otp_auth_js_1.ACCESS_TOKEN_TTL_SECONDS);
    strict_1.default.ok(refreshExp - accessExp >= otp_auth_js_1.REFRESH_TOKEN_TTL_SECONDS - otp_auth_js_1.ACCESS_TOKEN_TTL_SECONDS - 5);
    strict_1.default.equal(decodePayload(refresh).tokenType, 'refresh');
});
function withOtpEnv(overrides, run) {
    const previous = {};
    const keys = ['NODE_ENV', 'ENABLE_DEV_OTP', 'SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASSWORD', 'SMTP_PASS', 'EMAIL_FROM'];
    for (const key of keys)
        previous[key] = process.env[key];
    try {
        for (const key of keys) {
            if (overrides[key] === undefined)
                delete process.env[key];
            else
                process.env[key] = overrides[key];
        }
        return run();
    }
    finally {
        for (const key of keys) {
            if (previous[key] === undefined)
                delete process.env[key];
            else
                process.env[key] = previous[key];
        }
        (0, otp_auth_js_1.setOtpSmtpSender)(null);
    }
}
(0, node_test_1.default)('OTP delivery fails closed when a provider is not configured', async () => {
    await withOtpEnv({ NODE_ENV: 'production' }, async () => {
        strict_1.default.equal((0, otp_auth_js_1.resolveOtpDeliveryChannel)(), 'none');
        strict_1.default.equal(await (0, otp_auth_js_1.sendOtpEmail)('admin@example.com', '123456'), false);
    });
});
(0, node_test_1.default)('OTP delivery stays fail-closed in production even when ENABLE_DEV_OTP is set', async () => {
    await withOtpEnv({ NODE_ENV: 'production', ENABLE_DEV_OTP: 'true' }, async () => {
        strict_1.default.equal((0, otp_auth_js_1.resolveOtpDeliveryChannel)(), 'none');
        strict_1.default.equal(await (0, otp_auth_js_1.sendOtpEmail)('admin@example.com', '123456'), false);
    });
});
(0, node_test_1.default)('OTP uses the development console transport when ENABLE_DEV_OTP is set', async () => {
    await withOtpEnv({ NODE_ENV: 'development', ENABLE_DEV_OTP: 'true' }, async () => {
        strict_1.default.equal((0, otp_auth_js_1.resolveOtpDeliveryChannel)(), 'development');
        strict_1.default.equal(await (0, otp_auth_js_1.sendOtpEmail)('admin@retail.local', '654321'), true);
    });
});
(0, node_test_1.default)('OTP prefers SMTP when SMTP_HOST is configured', async () => {
    await withOtpEnv({ NODE_ENV: 'production', SMTP_HOST: 'smtp.example.com', ENABLE_DEV_OTP: 'true' }, async () => {
        const sent = [];
        (0, otp_auth_js_1.setOtpSmtpSender)(async (email, otpCode) => {
            sent.push([email, otpCode]);
        });
        strict_1.default.equal((0, otp_auth_js_1.resolveOtpDeliveryChannel)(), 'smtp');
        strict_1.default.equal(await (0, otp_auth_js_1.sendOtpEmail)('admin@retail.local', '111222'), true);
        strict_1.default.deepEqual(sent, [['admin@retail.local', '111222']]);
    });
});
(0, node_test_1.default)('SMTP delivery failures do not leak an undelivered code', async () => {
    await withOtpEnv({ SMTP_HOST: 'smtp.example.com' }, async () => {
        (0, otp_auth_js_1.setOtpSmtpSender)(async () => {
            throw new Error('smtp down');
        });
        strict_1.default.equal(await (0, otp_auth_js_1.sendOtpEmail)('admin@retail.local', '111222'), false);
    });
});
(0, node_test_1.default)('a new OTP replaces the previous unused code for the same email', () => {
    (0, enterprise_repository_js_1.createOtpSession)('Admin@retail.local', '111111');
    (0, enterprise_repository_js_1.createOtpSession)('admin@retail.local', '222222');
    strict_1.default.equal((0, enterprise_repository_js_1.verifyOtpSession)('admin@retail.local', '111111'), false);
    strict_1.default.equal((0, enterprise_repository_js_1.verifyOtpSession)('admin@retail.local', '222222'), true);
    (0, enterprise_repository_js_1.clearOtpSession)('admin@retail.local');
});
(0, node_test_1.default)('production token generation requires an explicit JWT secret', () => {
    const previousNodeEnv = process.env.NODE_ENV;
    const previousSecret = process.env.JWT_SECRET;
    process.env.NODE_ENV = 'production';
    delete process.env.JWT_SECRET;
    try {
        strict_1.default.throws(() => (0, otp_auth_js_1.generateJWT)('user-1', 'company-1'), /JWT_SECRET/);
    }
    finally {
        if (previousNodeEnv === undefined)
            delete process.env.NODE_ENV;
        else
            process.env.NODE_ENV = previousNodeEnv;
        if (previousSecret === undefined)
            delete process.env.JWT_SECRET;
        else
            process.env.JWT_SECRET = previousSecret;
    }
});
