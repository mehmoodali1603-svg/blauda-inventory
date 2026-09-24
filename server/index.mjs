import 'dotenv/config'
import cors from 'cors'
import express from 'express'
import fs from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
import { MongoClient } from 'mongodb'

const app = express()
const port = Number(process.env.PORT || 4000)
const credentialsPath = path.join(process.cwd(), 'server', 'credentials.local.json')
const sessions = new Map()
const memory = {
  inventory: [
    { name: 'Thermal labels', category: 'Packing supplies', stock: 1420, minimum: 500, unit: 'rolls', status: 'In stock' },
    { name: 'Cardboard boxes · M', category: 'Packing supplies', stock: 184, minimum: 250, unit: 'pieces', status: 'Low stock' },
    { name: 'Safety gloves', category: 'Safety equipment', stock: 96, minimum: 80, unit: 'pairs', status: 'In stock' },
    { name: 'Packing tape', category: 'Packing supplies', stock: 38, minimum: 60, unit: 'rolls', status: 'Low stock' },
  ],
  handovers: [],
  refills: [],
}
let database = null

app.use(cors())
app.use(express.json())

async function readCredentials() {
  return [
    { username: "admin", password: "admin123", name: "Sarah Ali", role: "Administrator", active: true },
    { username: "omar", password: "demo123", name: "Omar Farooq", role: "Warehouse manager", active: true },
    { username: "ayesha", password: "demo123", name: "Ayesha Khan", role: "Helper", active: true },
    { username: "bilal", password: "demo123", name: "Bilal Ahmed", role: "Helper", active: true }
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

function collection(name) {
  return database ? database.collection(name) : null
}

app.get('/api/health', (_req, res) => res.json({ ok: true, storage: database ? 'mongodb' : 'memory' }))

app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body ?? {}
  if (!username || !password) return res.status(400).json({ message: 'Username and password are required.' })
  const users = await readCredentials()
  const user = users.find((candidate) => candidate.username === username && candidate.password === password)
  if (!user) return res.status(401).json({ message: 'Invalid username or password.' })
  const token = crypto.randomBytes(32).toString('hex')
  const safeUser = publicUser(user)
  sessions.set(token, safeUser)
  res.json({ token, user: safeUser })
})

app.get('/api/inventory', requireAuth, async (_req, res) => {
  const items = collection('inventory') ? await collection('inventory').find({}).sort({ name: 1 }).toArray() : memory.inventory
  res.json(items.map(({ _id, ...item }) => item))
})

app.post('/api/inventory', requireAuth, async (req, res) => {
  const item = { ...req.body, status: Number(req.body.stock) < Number(req.body.minimum) ? 'Low stock' : 'In stock' }
  if (collection('inventory')) await collection('inventory').insertOne(item)
  else memory.inventory.push(item)
  res.status(201).json(item)
})

app.put('/api/inventory/:name', requireAuth, async (req, res) => {
  const item = { ...req.body, status: Number(req.body.stock) < Number(req.body.minimum) ? 'Low stock' : 'In stock' }
  const name = decodeURIComponent(req.params.name)
  if (collection('inventory')) await collection('inventory').replaceOne({ name }, item)
  else {
    const index = memory.inventory.findIndex((entry) => entry.name === name)
    if (index >= 0) memory.inventory[index] = item
  }
  res.json(item)
})

app.delete('/api/inventory/:name', requireAuth, requireAdmin, async (req, res) => {
  const name = decodeURIComponent(req.params.name)
  if (collection('inventory')) await collection('inventory').deleteOne({ name })
  else memory.inventory = memory.inventory.filter((item) => item.name !== name)
  res.status(204).end()
})

app.get('/api/users', requireAuth, requireAdmin, async (_req, res) => {
  const users = await readCredentials()
  res.json(users.map(publicUser))
})

app.post('/api/auth/logout', requireAuth, (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '')
  sessions.delete(token)
  res.status(204).end()
})

if (process.env.NODE_ENV !== 'production') {
  app.listen(port, () => console.log(`Inventory API listening on http://localhost:${port}`))
}
export default app

if (process.env.MONGODB_URI) {
  const client = new MongoClient(process.env.MONGODB_URI)
  client.connect().then(() => {
    database = client.db(process.env.MONGODB_DB || 'northstar_inventory')
    console.log(`MongoDB connected: ${database.databaseName}`)
  }).catch((error) => console.error('MongoDB connection failed; using memory storage:', error.message))
}
