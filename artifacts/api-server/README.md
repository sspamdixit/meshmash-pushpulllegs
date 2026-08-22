# SOS Packet Relay API

Small Express REST API that stores SOS packets in Turso/libSQL. It accepts
single packets or batches, replaces existing packets with the same `id`, and
supports pulling packets by page size and timestamp.

## Run locally

From the repository root:

```bash
pnpm install
pnpm --filter @workspace/api-server start
```

The server listens on `PORT`, defaulting to `3000`.

## Configuration

Create a `.env` file in `artifacts/api-server/`, or configure these variables
in the hosting provider:

```dotenv
PORT=3000
API_KEY=replace-with-a-private-api-key
TURSO_DATABASE_URL=libsql://your-database.turso.io
TURSO_AUTH_TOKEN=your-turso-token
```

On startup, the API connects to Turso and creates the `sos_packets` table if it
does not already exist. The API will not start without `API_KEY`,
`TURSO_DATABASE_URL`, and `TURSO_AUTH_TOKEN`.

Do not commit `.env`, `API_KEY`, or `TURSO_AUTH_TOKEN` to source control. Set
them as secrets in production.

## Deploy on Render

For this pnpm workspace, configure the Render service as follows:

- **Root Directory:** repository root
- **Build Command:** `pnpm install --frozen-lockfile`
- **Start Command:** `pnpm --filter @workspace/api-server start`

Set `API_KEY`, `TURSO_DATABASE_URL`, and `TURSO_AUTH_TOKEN` in Render's
environment settings. Render supplies `PORT` automatically; the server uses it
when present.

## Authentication

`GET /health` is public. Every `/api/*` route requires the API key. Prefer the
header form:

```http
x-api-key: replace-with-a-private-api-key
```

The key can also be passed as `?api_key=...`, but query parameters may appear
in logs and browser history, so use the header whenever possible. Missing or
incorrect keys return `401 Unauthorized`.

Keep this key on a trusted backend. Do not embed it in a browser frontend or
mobile app, where users can extract it.

## Endpoints

### `GET /health`

Public liveness check:

```json
{
  "status": "ok"
}
```

### `POST /api/v1/mesh/requests`

Accepts a versioned mesh SOS request. This endpoint requires both the API key
and an `Idempotency-Key` header. The idempotency key must match `requestId`.
Repeated submissions with the same `requestId` are accepted as duplicates and
are not inserted again.

```bash
curl -X POST https://your-service.onrender.com/api/v1/mesh/requests \
  -H "Content-Type: application/json" \
  -H "x-api-key: replace-with-a-private-api-key" \
  -H "Idempotency-Key: 550e8400-e29b-41d4-a716-446655440000" \
  -d '{
    "schemaVersion": 1,
    "requestId": "550e8400-e29b-41d4-a716-446655440000",
    "originDeviceId": "70c16dae-eaca-4fa2-b1b4-51b69331e21c",
    "category": "medical",
    "priority": "EMERGENCY",
    "createdAtMillis": 1787449200000,
    "requester": {
      "fullName": "Asha Kumar",
      "phoneNumber": "+919876543210",
      "personalIdType": "hospital_id",
      "personalIdValue": "H-12345"
    },
    "location": {
      "latitudeE7": 129715987,
      "longitudeE7": 775945660,
      "accuracyMeters": 8.0,
      "capturedAtMillis": 1787449195000
    },
    "payloadEncoding": "base64",
    "payload": "TmVlZCBtZWRpY2FsIGFzc2lzdGFuY2U=",
    "relayMetadata": {
      "receivedAtMillis": 1787449200000,
      "lastForwardedAtMillis": 1787449260000,
      "forwardCount": 3,
      "status": "ACTIVE"
    }
  }'
```

Successful response:

```json
{
  "requestId": "550e8400-e29b-41d4-a716-446655440000",
  "accepted": true,
  "duplicate": false
}
```

The same request submitted again returns `"duplicate": true`. The full
versioned request is retained in `payload_json`; coordinates are also stored
in the packet table as decimal latitude and longitude.

### `POST /api/packets/push`

Accepts either one packet object or an array of packet objects. Every packet
must have a non-empty string `id`. Packets with an existing `id` are replaced.

Supported packet fields:

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `id` | string | yes | Unique packet identifier |
| `sender_id` | string | no | Device or sender identifier |
| `message_type` | string | no | Packet type, such as `SOS` |
| `latitude` | number | no | Latitude |
| `longitude` | number | no | Longitude |
| `payload_json` | string | no | Pre-serialized JSON payload |
| `payload` | object/value | no | Serialized automatically when `payload_json` is omitted |
| `hops` | integer | no | Number of relay hops |
| `created_at` | timestamp string | no | Custom creation timestamp |

Single-packet request:

```bash
curl -X POST https://your-service.onrender.com/api/packets/push \
  -H "Content-Type: application/json" \
  -H "x-api-key: replace-with-a-private-api-key" \
  -d '{
    "id": "packet-001",
    "sender_id": "device-42",
    "message_type": "SOS",
    "latitude": 12.9716,
    "longitude": 77.5946,
    "payload": {
      "severity": "critical",
      "battery": 71
    },
    "hops": 0
  }'
```

Response:

```json
{
  "status": "success",
  "count": 1
}
```

Batch request:

```bash
curl -X POST https://your-service.onrender.com/api/packets/push \
  -H "Content-Type: application/json" \
  -H "x-api-key: replace-with-a-private-api-key" \
  -d '[
    {
      "id": "packet-002",
      "sender_id": "device-42",
      "message_type": "SOS",
      "latitude": 12.9717,
      "longitude": 77.5947,
      "payload": { "severity": "high" },
      "hops": 1
    },
    {
      "id": "packet-003",
      "sender_id": "device-43",
      "message_type": "STATUS",
      "latitude": 12.9718,
      "longitude": 77.5948,
      "payload": { "online": true },
      "hops": 0
    }
  ]'
```

### `GET /api/packets/pull`

Returns stored packets in ascending creation-time order.

Query parameters:

- `limit` — optional number of packets to return; defaults to `100`, maximum
  `1000`
- `since` — optional timestamp; returns packets where `created_at` is greater
  than or equal to this value

```bash
curl "https://your-service.onrender.com/api/packets/pull?limit=100" \
  -H "x-api-key: replace-with-a-private-api-key"
```

With a timestamp filter:

```bash
curl "https://your-service.onrender.com/api/packets/pull?since=2026-08-23T00:00:00Z" \
  -H "x-api-key: replace-with-a-private-api-key"
```

Response:

```json
{
  "status": "success",
  "count": 1,
  "data": [
    {
      "id": "packet-001",
      "sender_id": "device-42",
      "message_type": "SOS",
      "latitude": 12.9716,
      "longitude": 77.5946,
      "payload_json": "{\"severity\":\"critical\",\"battery\":71}",
      "hops": 0,
      "created_at": "2026-08-23 10:30:00"
    }
  ]
}
```

## Calling the API from another application

Use the deployed Render URL as the base URL and send the same `API_KEY` in the
`x-api-key` header:

```js
const response = await fetch(
  "https://your-service.onrender.com/api/packets/push",
  {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": process.env.SOS_RELAY_API_KEY,
    },
    body: JSON.stringify({
      id: "packet-004",
      sender_id: "device-44",
      message_type: "SOS",
      latitude: 12.972,
      longitude: 77.595,
      payload: { severity: "critical" },
      hops: 0,
    }),
  },
);

const result = await response.json();
if (!response.ok) {
  throw new Error(`SOS relay request failed: ${result.message}`);
}
console.log(result);
```

For a browser or mobile application, send requests through your own backend
instead of exposing `SOS_RELAY_API_KEY` in client-side code.

## Quick local test

```bash
curl http://localhost:3000/health

curl -X POST http://localhost:3000/api/packets/push \
  -H "Content-Type: application/json" \
  -H "x-api-key: replace-with-a-private-api-key" \
  -d '{
    "id": "packet-001",
    "sender_id": "device-42",
    "message_type": "SOS",
    "latitude": 12.9716,
    "longitude": 77.5946,
    "payload": { "severity": "critical" },
    "hops": 0
  }'

curl "http://localhost:3000/api/packets/pull?limit=100" \
  -H "x-api-key: replace-with-a-private-api-key"

curl "http://localhost:3000/api/packets/pull?since=2026-08-23T00:00:00Z&api_key=replace-with-a-private-api-key"
```