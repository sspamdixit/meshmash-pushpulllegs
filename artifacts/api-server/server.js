import "dotenv/config";
import express from "express";
import cors from "cors";
import { createClient } from "@libsql/client";

const PORT = Number(process.env.PORT || 3000);
const API_KEY = process.env.API_KEY;
const TURSO_DATABASE_URL = process.env.TURSO_DATABASE_URL;
const TURSO_AUTH_TOKEN = process.env.TURSO_AUTH_TOKEN;

if (!Number.isInteger(PORT) || PORT <= 0) {
  throw new Error("PORT must be a positive integer.");
}
if (!API_KEY) {
  throw new Error("API_KEY is required.");
}
if (!TURSO_DATABASE_URL || !TURSO_AUTH_TOKEN) {
  throw new Error(
    "TURSO_DATABASE_URL and TURSO_AUTH_TOKEN are required.",
  );
}

const db = createClient({
  url: TURSO_DATABASE_URL,
  authToken: TURSO_AUTH_TOKEN,
});

const CREATE_PACKETS_TABLE = `
  CREATE TABLE IF NOT EXISTS sos_packets (
    id TEXT PRIMARY KEY,
    sender_id TEXT,
    message_type TEXT,
    latitude REAL,
    longitude REAL,
    payload_json TEXT,
    hops INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`;

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));

app.get(["/", "/api", "/api/"], (_req, res) => {
  res.json({
    name: "SOS Packet Relay API",
    status: "ok",
    health: "/health",
    endpoints: {
      meshRequests: "POST /api/v1/mesh/requests",
      packetPush: "POST /api/packets/push",
      packetPull: "GET /api/packets/pull",
    },
  });
});

app.get(["/health", "/api/health"], (_req, res) => {
  res.json({ status: "ok" });
});

function requireApiKey(req, res, next) {
  const providedKey = req.get("x-api-key") || req.query.api_key;
  if (providedKey !== API_KEY) {
    return res.status(401).json({
      status: "error",
      message: "Unauthorized",
    });
  }
  next();
}

app.use("/api", requireApiKey);

function requireString(value, fieldName) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${fieldName} must be a non-empty string.`);
  }
  return value;
}

function requireInteger(value, fieldName) {
  if (!Number.isInteger(value)) {
    throw new Error(`${fieldName} must be an integer.`);
  }
  return value;
}

function asNullableNumber(value, fieldName) {
  if (value === undefined || value === null || value === "") return null;
  const number = Number(value);
  if (!Number.isFinite(number)) {
    throw new Error(`${fieldName} must be a finite number.`);
  }
  return number;
}

function asNullableInteger(value, fieldName) {
  if (value === undefined || value === null || value === "") return null;
  const number = Number(value);
  if (!Number.isInteger(number)) {
    throw new Error(`${fieldName} must be an integer.`);
  }
  return number;
}

function normalizePacket(packet) {
  if (!packet || typeof packet !== "object" || Array.isArray(packet)) {
    throw new Error("Each packet must be a JSON object.");
  }
  if (typeof packet.id !== "string" || packet.id.trim() === "") {
    throw new Error("Each packet requires a non-empty string id.");
  }

  let payloadJson = packet.payload_json;
  if (payloadJson !== undefined && typeof payloadJson !== "string") {
    payloadJson = JSON.stringify(payloadJson);
  }
  if (payloadJson === undefined) {
    payloadJson = JSON.stringify(packet.payload ?? packet);
  }

  return {
    id: packet.id,
    sender_id: packet.sender_id ?? null,
    message_type: packet.message_type ?? null,
    latitude: asNullableNumber(packet.latitude, "latitude"),
    longitude: asNullableNumber(packet.longitude, "longitude"),
    payload_json: payloadJson,
    hops: asNullableInteger(packet.hops, "hops"),
    created_at: packet.created_at ?? null,
  };
}

app.post("/api/v1/mesh/requests", async (req, res, next) => {
  try {
    const body = req.body;
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return res.status(400).json({
        status: "error",
        message: "Request body must be a JSON object.",
      });
    }
    const requestId = requireString(body?.requestId, "requestId");
    const idempotencyKey = requireString(
      req.get("Idempotency-Key"),
      "Idempotency-Key header",
    );
    if (idempotencyKey !== requestId) {
      return res.status(400).json({
        status: "error",
        message: "Idempotency-Key must match requestId.",
      });
    }

    requireInteger(body.schemaVersion, "schemaVersion");
    requireString(body.originDeviceId, "originDeviceId");
    requireString(body.category, "category");
    requireString(body.priority, "priority");
    requireInteger(body.createdAtMillis, "createdAtMillis");
    if (!body.requester || !body.location || body.payload === undefined) {
      return res.status(400).json({
        status: "error",
        message: "requester, location, and payload are required.",
      });
    }
    requireString(body.requester.fullName, "requester.fullName");
    requireString(body.requester.phoneNumber, "requester.phoneNumber");
    requireInteger(body.location.latitudeE7, "location.latitudeE7");
    requireInteger(body.location.longitudeE7, "location.longitudeE7");

    const existing = await db.execute({
      sql: "SELECT id FROM sos_packets WHERE id = ? LIMIT 1",
      args: [requestId],
    });
    if (existing.rows.length > 0) {
      return res.json({ requestId, accepted: true, duplicate: true });
    }

    const result = await db.execute({
      sql: `
        INSERT OR IGNORE INTO sos_packets
          (id, sender_id, message_type, latitude, longitude, payload_json, hops, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `,
      args: [
        requestId,
        body.originDeviceId,
        body.category,
        Number(body.location.latitudeE7) / 10_000_000,
        Number(body.location.longitudeE7) / 10_000_000,
        JSON.stringify(body),
        Number(body.relayMetadata?.forwardCount ?? 0),
        new Date(body.createdAtMillis).toISOString(),
      ],
    });

    res.json({
      requestId,
      accepted: true,
      duplicate: result.rowsAffected === 0,
    });
  } catch (error) {
    next(error);
  }
});

app.post("/api/packets/push", async (req, res, next) => {
  try {
    const packets = Array.isArray(req.body) ? req.body : [req.body];
    if (packets.length === 0) {
      return res.status(400).json({
        status: "error",
        message: "Request body must contain at least one packet.",
      });
    }

    const statements = packets.map((packet) => {
      const normalized = normalizePacket(packet);
      const columns = [
        "id",
        "sender_id",
        "message_type",
        "latitude",
        "longitude",
        "payload_json",
        "hops",
      ];
      const args = [
        normalized.id,
        normalized.sender_id,
        normalized.message_type,
        normalized.latitude,
        normalized.longitude,
        normalized.payload_json,
        normalized.hops,
      ];
      if (normalized.created_at !== null) {
        columns.push("created_at");
        args.push(normalized.created_at);
      }

      return {
        sql: `INSERT OR REPLACE INTO sos_packets (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`,
        args,
      };
    });

    await db.batch(statements, "write");
    res.json({ status: "success", count: statements.length });
  } catch (error) {
    next(error);
  }
});

app.get("/api/packets/pull", async (req, res, next) => {
  try {
    const parsedLimit = Number(req.query.limit ?? 100);
    if (
      !Number.isInteger(parsedLimit) ||
      parsedLimit < 1 ||
      parsedLimit > 1000
    ) {
      return res.status(400).json({
        status: "error",
        message: "limit must be an integer between 1 and 1000.",
      });
    }

    const since = req.query.since;
    if (since !== undefined && typeof since !== "string") {
      return res.status(400).json({
        status: "error",
        message: "since must be a timestamp string.",
      });
    }

    const result = since
      ? await db.execute({
          sql: "SELECT * FROM sos_packets WHERE created_at >= ? ORDER BY created_at ASC LIMIT ?",
          args: [since, parsedLimit],
        })
      : await db.execute({
          sql: "SELECT * FROM sos_packets ORDER BY created_at ASC LIMIT ?",
          args: [parsedLimit],
        });

    res.json({
      status: "success",
      count: result.rows.length,
      data: result.rows,
    });
  } catch (error) {
    next(error);
  }
});

app.use((error, _req, res, _next) => {
  console.error(error);
  res.status(500).json({
    status: "error",
    message: "Internal server error.",
  });
});

async function start() {
  await db.execute(CREATE_PACKETS_TABLE);
  app.listen(PORT, () => {
    console.log(`SOS relay API listening on port ${PORT}`);
  });
}

start().catch((error) => {
  console.error("Failed to initialize Turso database:", error);
  process.exit(1);
});