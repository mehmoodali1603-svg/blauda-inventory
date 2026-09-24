import 'dotenv/config'
import cors from 'cors'
import express from 'express'
import crypto from 'node:crypto'
import { MongoClient } from 'mongodb'

const app = express()
const sessions = new Map()
const memory = { inventory: [], handovers: [], refills: [] }
let database = null

// Connect to MongoDB Atlas first, then start listening
async function init() {
  if (process.env.MONGODB_URI) {
    try {
      const client = new MongoClient(process.env.MONGODB_URI)
      await client.connect()
      database = client.db(process.env.MONGODB_DB || 'northstar_inventory')
      console.log(`MongoDB connected: ${database.databaseName}`)
    } catch (error) {
      console.error('MongoDB connection failed; using memory storage:', error.message)
    }
  }
  const port = Number(process.env.PORT || 4000)
  if (process.env.NODE_ENV !== 'production') {
    app.listen(port, () => console.log(`Inventory API listening on http://localhost:${port}`))
  }
}

init()

app.use(cors())
app.use(express.json())

async function readCredentials() {
  return [
    { username: "ali", password: "123", name: "Ali", role: "Administrator", active: true },
    { username: "shahid", password: "123", name: "Shahid", role: "Helper", active: true },
    { username: "owais", password: "123", name: "Owais", role: "Administrator", active: true }
  ]
}

function publicUser(user) {
  return { username: user.username, name: user.name, role: user.role, active: user.active !== false }
}

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

function col(name) { return database ? database.collection(name) : null }
function strip(doc) { const { _id, ...rest } = doc; return rest }

app.get('/api/health', (_req, res) => res.json({ ok: true, storage: database ? 'mongodb' : 'memory' }))

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

// ── Inventory ──
app.get('/api/inventory', requireAuth, async (_req, res) => {
  const items = col('inventory') ? await col('inventory').find({}).sort({ name: 1 }).toArray() : memory.inventory
  res.json(items.map(strip))
})

app.post('/api/inventory', requireAuth, async (req, res) => {
  const item = { ...req.body, stock: Number(req.body.stock), minimum: Number(req.body.minimum || 0), status: Number(req.body.stock) < Number(req.body.minimum || 0) ? 'Low stock' : 'In stock' }
  if (col('inventory')) await col('inventory').insertOne(item)
  else memory.inventory.push(item)
  res.status(201).json(strip(item))
})

app.put('/api/inventory/:name', requireAuth, async (req, res) => {
  const item = { ...req.body, stock: Number(req.body.stock), minimum: Number(req.body.minimum || 0), status: Number(req.body.stock) < Number(req.body.minimum || 0) ? 'Low stock' : 'In stock' }
  const name = decodeURIComponent(req.params.name)
  if (col('inventory')) await col('inventory').replaceOne({ name }, item, { upsert: true })
  else { const i = memory.inventory.findIndex((e) => e.name === name); if (i >= 0) memory.inventory[i] = item }
  res.json(item)
})

app.delete('/api/inventory/:name', requireAuth, requireAdmin, async (req, res) => {
  const name = decodeURIComponent(req.params.name)
  if (col('inventory')) await col('inventory').deleteOne({ name })
  else memory.inventory = memory.inventory.filter((item) => item.name !== name)
  res.status(204).end()
})

// Deduct stock (handover)
app.post('/api/inventory/:name/deduct', requireAuth, async (req, res) => {
  const name = decodeURIComponent(req.params.name)
  const qty = Number(req.body.quantity)
  if (col('inventory')) {
    await col('inventory').updateOne({ name }, { $inc: { stock: -qty } })
    const doc = await col('inventory').findOne({ name })
    if (doc) { const newStatus = doc.stock < doc.minimum ? 'Low stock' : 'In stock'; await col('inventory').updateOne({ name }, { $set: { status: newStatus } }) }
  } else { const item = memory.inventory.find((e) => e.name === name); if (item) { item.stock -= qty; item.status = item.stock < item.minimum ? 'Low stock' : 'In stock' } }
  res.status(204).end()
})

// Restock (refill)
app.post('/api/inventory/:name/restock', requireAuth, async (req, res) => {
  const name = decodeURIComponent(req.params.name)
  const qty = Number(req.body.quantity)
  if (col('inventory')) {
    await col('inventory').updateOne({ name }, { $inc: { stock: qty } })
    const doc = await col('inventory').findOne({ name })
    if (doc) { const newStatus = doc.stock < doc.minimum ? 'Low stock' : 'In stock'; await col('inventory').updateOne({ name }, { $set: { status: newStatus } }) }
  } else { const item = memory.inventory.find((e) => e.name === name); if (item) { item.stock += qty; item.status = item.stock < item.minimum ? 'Low stock' : 'In stock' } }
  res.status(204).end()
})

// ── Handovers ──
app.get('/api/handovers', requireAuth, async (_req, res) => {
  const rows = col('handovers') ? await col('handovers').find({}).sort({ date: -1, time: -1 }).toArray() : memory.handovers
  res.json(rows.map(strip))
})

app.post('/api/handovers', requireAuth, async (req, res) => {
  const row = { ...req.body, quantity: Number(req.body.quantity) }
  if (col('handovers')) await col('handovers').insertOne(row)
  else memory.handovers.unshift(row)
  res.status(201).json(strip(row))
})

app.delete('/api/handovers/:id', requireAuth, requireAdmin, async (req, res) => {
  const { ObjectId } = await import('mongodb')
  const id = req.params.id
  if (col('handovers') && id && id.length === 24) await col('handovers').deleteOne({ _id: new ObjectId(id) })
  res.status(204).end()
})

// ── Refills ──
app.get('/api/refills', requireAuth, async (_req, res) => {
  const rows = col('refills') ? await col('refills').find({}).sort({ date: -1, time: -1 }).toArray() : memory.refills
  res.json(rows.map(strip))
})

app.post('/api/refills', requireAuth, async (req, res) => {
  const row = { ...req.body, quantity: Number(req.body.quantity) }
  if (col('refills')) await col('refills').insertOne(row)
  else memory.refills.unshift(row)
  res.status(201).json(strip(row))
})

// ── Users ──
app.get('/api/users', requireAuth, requireAdmin, async (_req, res) => {
  const users = await readCredentials()
  res.json(users.map(publicUser))
})

export default app
