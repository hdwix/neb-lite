import http from 'k6/http';
import { check, group, sleep } from 'k6';

const BASE_URL = `${__ENV.BASE_URL || 'http://localhost:3000'}/api/v1/gateway`;
const RIDE_ID = '51';
const RIDER_TOKEN = '<token for driver>';
const DRIVER_TOKEN = '<token for driver>';

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
            'p(50)<300',
            'p(95)<800',
            'p(99)<1000',
        ],
    },
    discardResponseBodies: true,
};


function randomJakartaCoordinate() {
    const latitude = -6.3 + Math.random() * 0.2; // approx -6.3 to -6.1
    const longitude = 106.7 + Math.random() * 0.3; // approx 106.7 to 107.0
    return { latitude, longitude };
}

function buildLocationPayload() {
    const now = new Date().toISOString();
    const { latitude, longitude } = randomJakartaCoordinate();
    return {
        location: {
            coordinate: {
                longitude,
                latitude,
            },
            accuracyMeters: 5,
            recordedAt: now,
        },
    };
}

function sendLocation(role, token) {
    if (!token) {
        throw new Error(`Missing ${role} token (set __ENV.${role.toUpperCase()}_TOKEN)`);
    }

    const payload = buildLocationPayload();
    const headers = {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
    };

    const response = http.post(
        `${BASE_URL}/rides/${RIDE_ID}/tracking`,
        JSON.stringify(payload),
        { headers },
    );
    check(response, {
        [`${role} got accepted response`]: (res) => res.status === 202,
    });
}

export default function () {
    group('Rider tracking updates', () => {
        sendLocation('Rider', RIDER_TOKEN);
    });

    group('Driver tracking updates', () => {
        sendLocation('Driver', DRIVER_TOKEN);
    });
}