import 'dotenv/config'
import cors from 'cors'
import express from 'express'
import crypto from 'node:crypto'
import { MongoClient } from 'mongodb'

const app = express()
app.use(cors())
app.use(express.json())

// ── MongoDB Atlas connection ──
// Use mongodb+srv:// format — required for Vercel serverless TLS compatibility
const MONGODB_URI =
  process.env.MONGODB_URI ||
  'mongodb+srv://mehmoodali1603_db_user:jpCRUXOLFemQHRLn@cluster0.n5qjjir.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0'

const MONGODB_DB = process.env.MONGODB_DB || 'inventory'

let _client = null
let _db = null
let _connectingPromise = null

async function getDb() {
  if (_db) return _db
  if (_connectingPromise) return _connectingPromise

  _connectingPromise = (async () => {
    if (!_client) {
      _client = new MongoClient(MONGODB_URI, {
        maxPoolSize: 10,
        minPoolSize: 1,
        serverSelectionTimeoutMS: 8000,
        connectTimeoutMS: 8000,
        socketTimeoutMS: 20000,
      })
    }

    try {
      await _client.connect()
      _db = _client.db(MONGODB_DB)
      console.log('MongoDB connected:', _db.databaseName)
      return _db
    } catch (err) {
      console.error('MongoDB connect error:', err.message)
      _db = null
      _connectingPromise = null
      return null
    }
  })()

  return _connectingPromise
}

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

// ── Stateless HMAC-signed Tokens ──
const TOKEN_SECRET = process.env.TOKEN_SECRET || 'northstar-jwt-secret-key-production-2026'

function createToken(payload) {
  const data = Buffer.from(JSON.stringify(payload)).toString('base64url')
  const sig = crypto.createHmac('sha256', TOKEN_SECRET).update(data).digest('base64url')
  return `${data}.${sig}`
}

function verifyToken(token) {
  if (!token || !token.includes('.')) return null
  const [data, sig] = token.split('.')
  const expectedSig = crypto.createHmac('sha256', TOKEN_SECRET).update(data).digest('base64url')
  if (sig !== expectedSig) return null
  try {
    return JSON.parse(Buffer.from(data, 'base64url').toString('utf8'))
  } catch {
    return null
  }
}

function requireAuth(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '')
  const user = verifyToken(token)
  if (!user) return res.status(401).json({ message: 'Please sign in again.' })
  req.user = user
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

// ── In-memory fallback (only if Atlas is temporarily unreachable) ──
const memory = { inventory: [], handovers: [], refills: [] }

// ── Health ──
app.get('/api/health', async (_req, res) => {
  const db = await getDb()
  res.json({
    ok: true,
    storage: db ? 'mongodb-atlas' : 'memory',
    db: db ? db.databaseName : null,
    uriPrefix: MONGODB_URI ? MONGODB_URI.slice(0, 35) : 'not-set',
  })
})

// ── Auth ──
app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body ?? {}
  if (!username || !password) return res.status(400).json({ message: 'Username and password are required.' })
  const users = await readCredentials()
  const user = users.find((c) => c.username === username && c.password === password)
  if (!user) return res.status(401).json({ message: 'Invalid username or password.' })
  const userInfo = publicUser(user)
  const token = createToken(userInfo)
  res.json({ token, user: userInfo })
})

app.post('/api/auth/logout', requireAuth, (_req, res) => {
  res.status(204).end()
})

// Verify stored token and return user (used on page refresh)
app.get('/api/auth/verify', requireAuth, (req, res) => {
  res.json(req.user)
})

// ── Inventory ──
app.get('/api/inventory', requireAuth, async (_req, res) => {
  try {
    const db = await getDb()
    if (!db) {
      console.warn('Atlas DB not connected on GET /api/inventory, using memory')
      return res.json(memory.inventory.map(strip))
    }
    const items = await db.collection('inventory').find({}).sort({ name: 1 }).toArray()
    res.json(items.map(strip))
  } catch (err) {
    console.error('Error in GET /api/inventory:', err)
    res.status(500).json({ message: err.message })
  }
})

app.post('/api/inventory', requireAuth, async (req, res) => {
  try {
    const db = await getDb()
    const now = new Date()
    const dateStr = now.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
    const timeStr = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
    
    const item = {
      ...req.body,
      stock: Number(req.body.stock),
      minimum: Number(req.body.minimum || 0),
      status: Number(req.body.stock) < Number(req.body.minimum || 0) ? 'Low stock' : 'In stock',
      updatedBy: req.user.name || req.user.username,
      updatedByUsername: req.user.username,
      updatedAt: `${dateStr} · ${timeStr}`,
    }
    if (db) {
      await db.collection('inventory').updateOne({ name: item.name }, { $set: item }, { upsert: true })
      console.log('Saved to Atlas collection inventory:', item.name)
    } else {
      console.warn('Atlas not connected on POST /api/inventory, saved to memory:', item.name)
      const existing = memory.inventory.findIndex(i => i.name === item.name)
      if (existing >= 0) memory.inventory[existing] = item
      else memory.inventory.push(item)
    }
    res.status(201).json(strip(item))
  } catch (err) {
    console.error('Error in POST /api/inventory:', err)
    res.status(500).json({ message: err.message })
  }
})

app.put('/api/inventory/:name', requireAuth, async (req, res) => {
  const db = await getDb()
  const name = decodeURIComponent(req.params.name)
  const now = new Date()
  const dateStr = now.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
  const timeStr = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })

  const item = {
    ...req.body,
    stock: Number(req.body.stock),
    minimum: Number(req.body.minimum || 0),
    status: Number(req.body.stock) < Number(req.body.minimum || 0) ? 'Low stock' : 'In stock',
    updatedBy: req.user.name || req.user.username,
    updatedByUsername: req.user.username,
    updatedAt: `${dateStr} · ${timeStr}`,
  }
  if (db) await db.collection('inventory').replaceOne({ name }, item, { upsert: true })
  else { const i = memory.inventory.findIndex((e) => e.name === name); if (i >= 0) memory.inventory[i] = item }
  res.json(strip(item))
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
  const now = new Date()
  const dateStr = now.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
  const timeStr = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
  const updater = req.user.name || req.user.username

  if (db) {
    await db.collection('inventory').updateOne({ name }, {
      $inc: { stock: -qty },
      $set: { updatedBy: updater, updatedByUsername: req.user.username, updatedAt: `${dateStr} · ${timeStr}` }
    })
    const doc = await db.collection('inventory').findOne({ name })
    if (doc) await db.collection('inventory').updateOne({ name }, { $set: { status: doc.stock < doc.minimum ? 'Low stock' : 'In stock' } })
  } else {
    const item = memory.inventory.find((e) => e.name === name)
    if (item) {
      item.stock -= qty
      item.status = item.stock < item.minimum ? 'Low stock' : 'In stock'
      item.updatedBy = updater
      item.updatedByUsername = req.user.username
      item.updatedAt = `${dateStr} · ${timeStr}`
    }
  }
  res.status(204).end()
})

app.post('/api/inventory/:name/restock', requireAuth, async (req, res) => {
  const db = await getDb()
  const name = decodeURIComponent(req.params.name)
  const qty = Number(req.body.quantity)
  const now = new Date()
  const dateStr = now.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
  const timeStr = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
  const updater = req.user.name || req.user.username

  if (db) {
    await db.collection('inventory').updateOne({ name }, {
      $inc: { stock: qty },
      $set: { updatedBy: updater, updatedByUsername: req.user.username, updatedAt: `${dateStr} · ${timeStr}` }
    })
    const doc = await db.collection('inventory').findOne({ name })
    if (doc) await db.collection('inventory').updateOne({ name }, { $set: { status: doc.stock < doc.minimum ? 'Low stock' : 'In stock' } })
  } else {
    const item = memory.inventory.find((e) => e.name === name)
    if (item) {
      item.stock += qty
      item.status = item.stock < item.minimum ? 'Low stock' : 'In stock'
      item.updatedBy = updater
      item.updatedByUsername = req.user.username
      item.updatedAt = `${dateStr} · ${timeStr}`
    }
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
  const row = {
    ...req.body,
    quantity: Number(req.body.quantity),
    loggedBy: req.user.name || req.user.username,
  }
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
  const row = {
    ...req.body,
    quantity: Number(req.body.quantity),
    loggedBy: req.user.name || req.user.username,
  }
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
