// db.js
// Capa de acceso a datos usando Turso (SQLite alojado en la nube, gratis
// y con persistencia real). La sintaxis SQL es prácticamente idéntica a
// SQLite normal, solo que ahora las llamadas son asíncronas (await).

const { createClient } = require('@libsql/client');

const db = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

// ------------------------------------------------------------------
// Esquema (se crea solo la primera vez que arranca el backend)
// ------------------------------------------------------------------

async function initSchema() {
  await db.execute(`
    CREATE TABLE IF NOT EXISTS world_objects (
      object_id     TEXT PRIMARY KEY,
      region_id     TEXT NOT NULL,
      owner_user_id TEXT NOT NULL,
      object_type   TEXT NOT NULL,
      pos_x REAL NOT NULL, pos_y REAL NOT NULL, pos_z REAL NOT NULL,
      rot_x REAL NOT NULL, rot_y REAL NOT NULL, rot_z REAL NOT NULL,
      data_json     TEXT NOT NULL DEFAULT '{}',
      created_at    INTEGER NOT NULL,
      updated_at    INTEGER NOT NULL
    )
  `);

  await db.execute(`CREATE INDEX IF NOT EXISTS idx_world_objects_region ON world_objects(region_id)`);
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_world_objects_owner ON world_objects(owner_user_id)`);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS players (
      user_id     TEXT PRIMARY KEY,
      username    TEXT,
      data_json   TEXT NOT NULL DEFAULT '{}',
      updated_at  INTEGER NOT NULL
    )
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS world_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      region_id   TEXT NOT NULL,
      user_id     TEXT,
      event_type  TEXT NOT NULL,
      description TEXT,
      created_at  INTEGER NOT NULL
    )
  `);
}

// ------------------------------------------------------------------
// Objetos del mundo
// ------------------------------------------------------------------

async function getRegionObjects(regionId) {
  const result = await db.execute({
    sql: 'SELECT * FROM world_objects WHERE region_id = ?',
    args: [regionId],
  });
  return result.rows.map(rowToObject);
}

async function upsertObject(obj) {
  const now = Date.now();
  const existing = await db.execute({
    sql: 'SELECT created_at FROM world_objects WHERE object_id = ?',
    args: [obj.objectId],
  });
  const createdAt = existing.rows.length > 0 ? existing.rows[0].created_at : now;

  await db.execute({
    sql: `
      INSERT INTO world_objects
        (object_id, region_id, owner_user_id, object_type, pos_x, pos_y, pos_z, rot_x, rot_y, rot_z, data_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(object_id) DO UPDATE SET
        region_id = excluded.region_id,
        object_type = excluded.object_type,
        pos_x = excluded.pos_x, pos_y = excluded.pos_y, pos_z = excluded.pos_z,
        rot_x = excluded.rot_x, rot_y = excluded.rot_y, rot_z = excluded.rot_z,
        data_json = excluded.data_json,
        updated_at = excluded.updated_at
    `,
    args: [
      obj.objectId,
      obj.regionId,
      String(obj.ownerUserId),
      obj.objectType,
      obj.position.x, obj.position.y, obj.position.z,
      obj.rotation?.x || 0, obj.rotation?.y || 0, obj.rotation?.z || 0,
      JSON.stringify(obj.data || {}),
      createdAt,
      now,
    ],
  });

  return getObject(obj.objectId);
}

async function getObject(objectId) {
  const result = await db.execute({
    sql: 'SELECT * FROM world_objects WHERE object_id = ?',
    args: [objectId],
  });
  return result.rows.length > 0 ? rowToObject(result.rows[0]) : null;
}

async function deleteObject(objectId) {
  const result = await db.execute({
    sql: 'DELETE FROM world_objects WHERE object_id = ?',
    args: [objectId],
  });
  return result.rowsAffected > 0;
}

async function getObjectsByOwner(userId) {
  const result = await db.execute({
    sql: 'SELECT * FROM world_objects WHERE owner_user_id = ?',
    args: [String(userId)],
  });
  return result.rows.map(rowToObject);
}

function rowToObject(row) {
  return {
    objectId: row.object_id,
    regionId: row.region_id,
    ownerUserId: row.owner_user_id,
    objectType: row.object_type,
    position: { x: row.pos_x, y: row.pos_y, z: row.pos_z },
    rotation: { x: row.rot_x, y: row.rot_y, z: row.rot_z },
    data: JSON.parse(row.data_json || '{}'),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ------------------------------------------------------------------
// Jugadores
// ------------------------------------------------------------------

async function getPlayer(userId) {
  const result = await db.execute({
    sql: 'SELECT * FROM players WHERE user_id = ?',
    args: [String(userId)],
  });
  if (result.rows.length === 0) return null;
  const row = result.rows[0];
  return {
    userId: row.user_id,
    username: row.username,
    data: JSON.parse(row.data_json || '{}'),
    updatedAt: row.updated_at,
  };
}

async function savePlayer(userId, username, data) {
  const now = Date.now();
  await db.execute({
    sql: `
      INSERT INTO players (user_id, username, data_json, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET
        username = excluded.username,
        data_json = excluded.data_json,
        updated_at = excluded.updated_at
    `,
    args: [String(userId), username || null, JSON.stringify(data || {}), now],
  });
  return getPlayer(userId);
}

// ------------------------------------------------------------------
// Eventos del mundo (crónica)
// ------------------------------------------------------------------

async function logEvent(regionId, userId, eventType, description) {
  await db.execute({
    sql: `
      INSERT INTO world_events (region_id, user_id, event_type, description, created_at)
      VALUES (?, ?, ?, ?, ?)
    `,
    args: [regionId, userId ? String(userId) : null, eventType, description || null, Date.now()],
  });
}

async function getRecentEvents(limit = 50) {
  const result = await db.execute({
    sql: 'SELECT * FROM world_events ORDER BY created_at DESC LIMIT ?',
    args: [limit],
  });
  return result.rows;
}

module.exports = {
  initSchema,
  getRegionObjects,
  upsertObject,
  getObject,
  deleteObject,
  getObjectsByOwner,
  getPlayer,
  savePlayer,
  logEvent,
  getRecentEvents,
};
