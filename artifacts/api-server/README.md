# SOS Packet Relay API

Small Express REST API that stores SOS packets in Turso/libSQL.

## Environment

Create a `.env` file or configure these variables in the environment:

```dotenv
PORT=3000
API_KEY=replace-with-a-private-api-key
TURSO_DATABASE_URL=libsql://your-database.turso.io
TURSO_AUTH_TOKEN=your-turso-token
```

`GET /health` is public. All `/api/*` routes require the API key in either the
`x-api-key` header or the `api_key` query parameter.

## Test with curl

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