// server.js
// API REST que consumen tus servidores de Roblox vía HttpService.
// Ningún servidor de Roblox es "dueño" del mundo: todos leen y escriben aquí,
// así que sin importar cuál se abra, todos ven el mismo estado.

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const db = require('./db');

const app = express();
app.use(express.json({ limit: '2mb' }));
app.use(cors());

const API_KEY = process.env.API_KEY || 'CAMBIA-ESTA-CLAVE';
const PORT = process.env.PORT || 3000;

// ------------------------------------------------------------------
// Autenticación simple por API key.
// Roblox manda el header "x-api-key". Sin esto, cualquiera con la URL
// podría escribir/borrar en tu mundo.
// ------------------------------------------------------------------
app.use((req, res, next) => {
  if (req.path === '/health') return next();
  const key = req.header('x-api-key');
  if (!key || key !== API_KEY) {
    return res.status(401).json({ error: 'API key inválida o ausente' });
  }
  next();
});

app.get('/health', (req, res) => res.json({ ok: true }));

// ------------------------------------------------------------------
// Regiones / objetos del mundo
// ------------------------------------------------------------------

// Obtener todos los objetos de una región (para "streamear" el chunk)
app.get('/region/:regionId/objects', async (req, res) => {
  try {
    const objects = await db.getRegionObjects(req.params.regionId);
    res.json({ regionId: req.params.regionId, objects });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Error leyendo la región' });
  }
});

// Crear o actualizar un objeto (colocar algo, moverlo, editar su contenido)
app.post('/region/:regionId/objects', async (req, res) => {
  try {
    const body = req.body;
    if (!body.objectId || !body.objectType || !body.position || !body.ownerUserId) {
      return res.status(400).json({ error: 'Faltan campos: objectId, objectType, position, ownerUserId' });
    }
    const saved = await db.upsertObject({
      objectId: body.objectId,
      regionId: req.params.regionId,
      ownerUserId: body.ownerUserId,
      objectType: body.objectType,
      position: body.position,
      rotation: body.rotation || { x: 0, y: 0, z: 0 },
      data: body.data || {},
    });

    if (body.logEvent) {
      await db.logEvent(req.params.regionId, body.ownerUserId, 'object_placed', body.logEvent);
    }

    res.json({ object: saved });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Error guardando el objeto' });
  }
});

// Borrar un objeto (romper la tienda de alguien, etc)
app.delete('/region/:regionId/objects/:objectId', async (req, res) => {
  try {
    const deleted = await db.deleteObject(req.params.objectId);
    res.json({ deleted });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Error borrando el objeto' });
  }
});

// Todos los objetos que le pertenecen a un jugador (útil para "mis construcciones")
app.get('/player/:userId/objects', async (req, res) => {
  try {
    res.json({ objects: await db.getObjectsByOwner(req.params.userId) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Error leyendo objetos del jugador' });
  }
});

// ------------------------------------------------------------------
// Perfil de jugador
// ------------------------------------------------------------------

app.get('/player/:userId', async (req, res) => {
  try {
    const player = await db.getPlayer(req.params.userId);
    if (!player) return res.json({ userId: req.params.userId, data: {}, isNew: true });
    res.json({ ...player, isNew: false });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Error leyendo el jugador' });
  }
});

app.post('/player/:userId', async (req, res) => {
  try {
    const { username, data } = req.body;
    const saved = await db.savePlayer(req.params.userId, username, data || {});
    res.json(saved);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Error guardando el jugador' });
  }
});

// ------------------------------------------------------------------
// Eventos recientes (para tu idea de "crónica viva" del mundo)
// ------------------------------------------------------------------

app.get('/events', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
    res.json({ events: await db.getRecentEvents(limit) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Error leyendo eventos' });
  }
});

// ------------------------------------------------------------------
// Arranque: primero crea las tablas si no existen, luego levanta el server
// ------------------------------------------------------------------

db.initSchema()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Backend de mundo persistente escuchando en puerto ${PORT}`);
    });
  })
  .catch((e) => {
    console.error('No se pudo inicializar la base de datos:', e);
    process.exit(1);
  });
