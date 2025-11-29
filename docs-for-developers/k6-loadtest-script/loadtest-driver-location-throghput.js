import http from 'k6/http';
import { check } from 'k6';
import exec from 'k6/execution';

// =========================
// Configuration
// =========================
const BASE_URL = `${__ENV.BASE_URL || 'http://localhost:3000/api/v1/gateway'}`.replace(/\/+$/, '');
const LOCATION_ENDPOINT = `${BASE_URL}/location/driver`;


const driverTokens =
    (__ENV.DRIVER_TOKENS &&
        __ENV.DRIVER_TOKENS.split(',').map((token) => token.trim()).filter(Boolean)) ||
    [];

if (driverTokens.length === 0) {
    throw new Error('DRIVER_TOKENS env var is required (comma-separated bearer tokens)');
}

function randomInRange(min, max) {
    return Math.random() * (max - min) + min;
}

function randomLocation() {
    return {
        longitude: randomInRange(106.7, 106.9),
        latitude: randomInRange(-6.25, -6.15),
        accuracyMeters: 10,
    };
}

function pickToken() {
    const index = Math.floor(Math.random() * driverTokens.length);
    return driverTokens[index];
}

function headers() {
    return {
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${pickToken()}`,
        },
    };
}

// =========================
// Test Options
// =========================
export const options = {
    scenarios: {
        ramp_test: {
            executor: 'ramping-arrival-rate',
            startRate: Number(__ENV.START_RPS || 20),
            timeUnit: '1s',
            preAllocatedVUs: Number(__ENV.PRE_VUS || 30),
            maxVUs: Number(__ENV.MAX_VUS || 200),
            stages: [
                { target: Number(__ENV.STAGE1_RPS || 50), duration: '1m30s' },
                { target: Number(__ENV.STAGE2_RPS || 100), duration: '1m30s' },
                { target: Number(__ENV.STAGE3_RPS || 150), duration: '1m30s' },
                { target: Number(__ENV.STAGE4_RPS || 200), duration: '2m' },
            ],
        },
    },
    thresholds: {
        http_req_failed: ['rate<0.01'], // <1% errors
        http_req_duration: [
            'p(50)<120',
            'p(95)<400',
            'p(99)<800',
        ],
    },
    discardResponseBodies: true,
};

// =========================
// Test Function
// =========================
export default function () {
    const res = http.post(LOCATION_ENDPOINT, JSON.stringify(randomLocation()), headers());
    check(res, {
        'status is 200': (r) => r.status === 200,
    }) ||
        exec.test.abort('Too many non-200 responses; aborting early to avoid noisy load');
}
