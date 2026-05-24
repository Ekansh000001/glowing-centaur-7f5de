import { getDatabase } from "@netlify/database";

const db = getDatabase();
const staleAfter = "45 seconds";

const json = (body, init = {}) =>
  Response.json(body, {
    ...init,
    headers: {
      "cache-control": "no-store",
      ...(init.headers || {}),
    },
  });

const cleanName = (value) => String(value || "").trim().slice(0, 32);

export default async function handler(request) {
  if (request.method === "GET") {
    const users = await db.sql`
      SELECT
        username,
        CASE
          WHEN online = TRUE AND last_seen > NOW() - ${staleAfter}::interval THEN TRUE
          ELSE FALSE
        END AS online,
        last_seen
      FROM presence
      ORDER BY
        CASE
          WHEN online = TRUE AND last_seen > NOW() - ${staleAfter}::interval THEN 0
          ELSE 1
        END,
        username ASC
    `;

    return json({
      users: users.map((user) => ({
        username: user.username,
        online: user.online,
        lastSeen: user.last_seen,
      })),
    });
  }

  if (request.method === "POST") {
    let payload;

    try {
      payload = await request.json();
    } catch {
      return json({ error: "Invalid JSON" }, { status: 400 });
    }

    const username = cleanName(payload.username);
    const online = payload.online !== false;

    if (!username) {
      return json({ error: "Username is required" }, { status: 400 });
    }

    const [user] = await db.sql`
      INSERT INTO presence (username, online, last_seen, updated_at)
      VALUES (${username}, ${online}, NOW(), NOW())
      ON CONFLICT (username) DO UPDATE SET
        online = EXCLUDED.online,
        last_seen = CASE WHEN EXCLUDED.online THEN NOW() ELSE presence.last_seen END,
        updated_at = NOW()
      RETURNING
        username,
        CASE
          WHEN online = TRUE AND last_seen > NOW() - ${staleAfter}::interval THEN TRUE
          ELSE FALSE
        END AS online,
        last_seen
    `;

    return json({
      user: {
        username: user.username,
        online: user.online,
        lastSeen: user.last_seen,
      },
    });
  }

  return json({ error: "Method not allowed" }, { status: 405 });
}

export const config = {
  path: "/api/presence",
};
