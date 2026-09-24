import 'dotenv/config'
import cors from 'cors'
import express from 'express'
import crypto from 'node:crypto'
import { MongoClient } from 'mongodb'

const app = express()
app.use(cors())
app.use(express.json())

// ── MongoDB: cached connection (survives warm Vercel invocations) ──
let _client = null
let _db = null

async function getDb() {
  if (_db) return _db                          // already connected
  if (!process.env.MONGODB_URI) return null    // no URI → use memory

  if (!_client) {
    _client = new MongoClient(process.env.MONGODB_URI, {
      serverSelectionTimeoutMS: 5000,
      connectTimeoutMS: 5000,
    })
  }

  try {
    await _client.connect()
    _db = _client.db(process.env.MONGODB_DB || 'northstar_inventory')
    console.log('MongoDB connected:', _db.databaseName)
  } catch (err) {
    console.error('MongoDB connect failed:', err.message)
    _db = null
  }
  return _db
}

// ── In-memory fallback (for local dev without .env) ──
const memory = { inventory: [], handovers: [], refills: [] }

// ── Auth credentials ──
async function readCredentials() {
  return [
    { username: 'ali',    password: '123', name: 'Ali',    role: 'Administrator', active: true },
    { username: 'shahid', password: '123', name: 'Shahid', role: 'Helper',        active: true },
    { username: 'owais',  password: '123', name: 'Owais',  role: 'Administrator', active: true },
  ]
}

function publicUser(u) {
  return { username: u.username, name: u.name, role: u.role, active: u.active !== false }
}

// ── Sessions (in-memory; Vercel resets these but token login re-creates) ──
const sessions = new Map()

function requireAuth(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '')
  const session = token && sessions.get(token)
  if (!session) return res.status(401).json({ message: 'Please sign in again.' })
  req.user = session
  next()
}

function requireAdmin(req, res, next) {
  if (req.user.role !== 'Administrator') return res.status(403).json({ message: 'Administrator access is required.' })
  next()
}

function strip(doc) {
  if (!doc) return doc
  const { _id, ...rest } = doc
  return rest
}

// ── Health ──
app.get('/api/health', async (_req, res) => {
  const db = await getDb()
  res.json({ ok: true, storage: db ? 'mongodb' : 'memory' })
})

// ── Auth ──
app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body ?? {}
  if (!username || !password) return res.status(400).json({ message: 'Username and password are required.' })
  const users = await readCredentials()
  const user = users.find((c) => c.username === username && c.password === password)
  if (!user) return res.status(401).json({ message: 'Invalid username or password.' })
  const token = crypto.randomBytes(32).toString('hex')
  sessions.set(token, publicUser(user))
  res.json({ token, user: publicUser(user) })
})

app.post('/api/auth/logout', requireAuth, (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '')
  sessions.delete(token)
  res.status(204).end()
})

// Verify stored token and return user (used on page refresh)
app.get('/api/auth/verify', requireAuth, (req, res) => {
  res.json(req.user)
})

// ── Inventory ──
app.get('/api/inventory', requireAuth, async (_req, res) => {
  const db = await getDb()
  const items = db
    ? await db.collection('inventory').find({}).sort({ name: 1 }).toArray()
    : memory.inventory
  res.json(items.map(strip))
})

app.post('/api/inventory', requireAuth, async (req, res) => {
  const db = await getDb()
  const item = {
    ...req.body,
    stock: Number(req.body.stock),
    minimum: Number(req.body.minimum || 0),
    status: Number(req.body.stock) < Number(req.body.minimum || 0) ? 'Low stock' : 'In stock',
  }
  if (db) await db.collection('inventory').insertOne(item)
  else memory.inventory.push(item)
  res.status(201).json(strip(item))
})

app.put('/api/inventory/:name', requireAuth, async (req, res) => {
  const db = await getDb()
  const name = decodeURIComponent(req.params.name)
  const item = {
    ...req.body,
    stock: Number(req.body.stock),
    minimum: Number(req.body.minimum || 0),
    status: Number(req.body.stock) < Number(req.body.minimum || 0) ? 'Low stock' : 'In stock',
  }
  if (db) await db.collection('inventory').replaceOne({ name }, item, { upsert: true })
  else { const i = memory.inventory.findIndex((e) => e.name === name); if (i >= 0) memory.inventory[i] = item }
  res.json(item)
})

app.delete('/api/inventory/:name', requireAuth, requireAdmin, async (req, res) => {
  const db = await getDb()
  const name = decodeURIComponent(req.params.name)
  if (db) await db.collection('inventory').deleteOne({ name })
  else memory.inventory = memory.inventory.filter((e) => e.name !== name)
  res.status(204).end()
})

app.post('/api/inventory/:name/deduct', requireAuth, async (req, res) => {
  const db = await getDb()
  const name = decodeURIComponent(req.params.name)
  const qty = Number(req.body.quantity)
  if (db) {
    await db.collection('inventory').updateOne({ name }, { $inc: { stock: -qty } })
    const doc = await db.collection('inventory').findOne({ name })
    if (doc) await db.collection('inventory').updateOne({ name }, { $set: { status: doc.stock < doc.minimum ? 'Low stock' : 'In stock' } })
  } else {
    const item = memory.inventory.find((e) => e.name === name)
    if (item) { item.stock -= qty; item.status = item.stock < item.minimum ? 'Low stock' : 'In stock' }
  }
  res.status(204).end()
})

app.post('/api/inventory/:name/restock', requireAuth, async (req, res) => {
  const db = await getDb()
  const name = decodeURIComponent(req.params.name)
  const qty = Number(req.body.quantity)
  if (db) {
    await db.collection('inventory').updateOne({ name }, { $inc: { stock: qty } })
    const doc = await db.collection('inventory').findOne({ name })
    if (doc) await db.collection('inventory').updateOne({ name }, { $set: { status: doc.stock < doc.minimum ? 'Low stock' : 'In stock' } })
  } else {
    const item = memory.inventory.find((e) => e.name === name)
    if (item) { item.stock += qty; item.status = item.stock < item.minimum ? 'Low stock' : 'In stock' }
  }
  res.status(204).end()
})

// ── Handovers ──
app.get('/api/handovers', requireAuth, async (_req, res) => {
  const db = await getDb()
  const rows = db
    ? await db.collection('handovers').find({}).sort({ date: -1, time: -1 }).toArray()
    : memory.handovers
  res.json(rows.map(strip))
})

app.post('/api/handovers', requireAuth, async (req, res) => {
  const db = await getDb()
  const row = { ...req.body, quantity: Number(req.body.quantity) }
  if (db) await db.collection('handovers').insertOne(row)
  else memory.handovers.unshift(row)
  res.status(201).json(strip(row))
})

app.delete('/api/handovers/:id', requireAuth, requireAdmin, async (req, res) => {
  const db = await getDb()
  if (db && req.params.id && req.params.id.length === 24) {
    const { ObjectId } = await import('mongodb')
    await db.collection('handovers').deleteOne({ _id: new ObjectId(req.params.id) })
  }
  res.status(204).end()
})

// ── Refills ──
app.get('/api/refills', requireAuth, async (_req, res) => {
  const db = await getDb()
  const rows = db
    ? await db.collection('refills').find({}).sort({ date: -1, time: -1 }).toArray()
    : memory.refills
  res.json(rows.map(strip))
})

app.post('/api/refills', requireAuth, async (req, res) => {
  const db = await getDb()
  const row = { ...req.body, quantity: Number(req.body.quantity) }
  if (db) await db.collection('refills').insertOne(row)
  else memory.refills.unshift(row)
  res.status(201).json(strip(row))
})

// ── Users ──
app.get('/api/users', requireAuth, requireAdmin, async (_req, res) => {
  res.json((await readCredentials()).map(publicUser))
})

// ── Local dev server ──
if (process.env.NODE_ENV !== 'production') {
  const port = Number(process.env.PORT || 4000)
  app.listen(port, () => console.log(`API listening on http://localhost:${port}`))
}

export default app
