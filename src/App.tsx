import { useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import './App.css'

type Page = 'overview' | 'inventory' | 'taken' | 'refills' | 'users'
type Modal = 'inventory' | 'edit-inventory' | 'remove-inventory' | 'remove-taken' | 'handover' | 'refill' | 'user' | 'remove-user' | 'reset-password' | 'notifications' | 'help' | null
type InventoryItem = { name: string; category: string; stock: number; minimum: number; unit: string; status: string }
type TakenItem = { _id?: string; item: string; person: string; initials: string; quantity: number; purpose: string; date: string; time: string; status: string }
type Refill = { _id?: string; item: string; person: string; initials: string; quantity: number; date: string; time: string; source: string; note: string }
type User = { initials: string; name: string; username: string; password: string; role: string; access: string; active: boolean }

const navItems: { id: Page; label: string; icon: string }[] = [
  { id: 'overview', label: 'Home', icon: '01' }, { id: 'inventory', label: 'Stock', icon: '02' },
  { id: 'taken', label: 'Items used by people', icon: '03' }, { id: 'refills', label: 'Restocking', icon: '04' }, { id: 'users', label: 'People and access', icon: '05' },
]
const initialInventory: InventoryItem[] = []
const initialTaken: TakenItem[] = []
const initialRefills: Refill[] = []
const initialUsers: User[] = [
  { initials: 'AL', name: 'Ali', username: 'ali', password: '123', role: 'Administrator', access: 'Full access', active: true },
  { initials: 'SH', name: 'Shahid', username: 'shahid', password: '123', role: 'Helper', access: 'Take items', active: true },
  { initials: 'OW', name: 'Owais', username: 'owais', password: '123', role: 'Administrator', access: 'Full access', active: true },
]
const formatNumber = (value: number) => new Intl.NumberFormat('en-PK').format(value)
const stamp = () => ({ date: '24 Sep 2026', time: '12:06 PM' })
const initials = (name: string) => name.split(' ').map((part) => part[0]).join('').slice(0, 2).toUpperCase()
const downloadTakenCsv = (rows: TakenItem[]) => { const header = ['Item', 'Person', 'Quantity', 'Purpose', 'Date', 'Time', 'Status']; const values = rows.map((row) => [row.item, row.person, String(row.quantity), row.purpose, row.date, row.time, row.status]); const csv = [header, ...values].map((line) => line.map((value) => `"${value.replaceAll('"', '""')}"`).join(',')).join('\n'); const link = document.createElement('a'); link.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' })); link.download = 'items-with-people.csv'; link.click(); URL.revokeObjectURL(link.href) }

function App() {
  const [currentUser, setCurrentUser] = useState<User | null>(null)
  const [authError, setAuthError] = useState('')
  const [page, setPage] = useState<Page>('overview')
  const [modal, setModal] = useState<Modal>(null)
  const [search, setSearch] = useState('')
  const [menuOpen, setMenuOpen] = useState(false)
  const [notice, setNotice] = useState('')
  const [inventory, setInventory] = useState(initialInventory)
  const [taken, setTaken] = useState(initialTaken)
  const [refills, setRefills] = useState(initialRefills)
  const [users, setUsers] = useState(initialUsers)
  const [userToRemove, setUserToRemove] = useState<User | null>(null)
  const [inventoryToManage, setInventoryToManage] = useState<InventoryItem | null>(null)
  const [takenToRemove, setTakenToRemove] = useState<TakenItem | null>(null)
  const pageTitle = navItems.find((item) => item.id === page)?.label ?? 'Overview'
  const filteredInventory = useMemo(() => inventory.filter((item) => `${item.name} ${item.category}`.toLowerCase().includes(search.toLowerCase())), [inventory, search])
  const openModal = (next: Modal) => { setModal(next); setNotice('') }
  const actionDone = (message: string) => { setModal(null); setNotice(message); window.setTimeout(() => setNotice(''), 3200) }
  const go = (next: Page) => { if (next === 'users' && currentUser?.role !== 'Administrator') { setNotice('Only administrators can manage users'); return } setPage(next); setMenuOpen(false) }

  useEffect(() => {
    if (!currentUser) return
    const token = sessionStorage.getItem('northstar-token')
    const headers = token ? { Authorization: `Bearer ${token}` } : {}
    // Load all data from server (Atlas) on login
    fetch('/api/inventory', { headers }).then(async (r) => { if (r.ok) setInventory(await r.json()) }).catch(() => {})
    fetch('/api/handovers', { headers }).then(async (r) => { if (r.ok) setTaken(await r.json()) }).catch(() => {})
    fetch('/api/refills', { headers }).then(async (r) => { if (r.ok) setRefills(await r.json()) }).catch(() => {})
  }, [currentUser])

  const apiHeaders = () => {
    const token = sessionStorage.getItem('northstar-token')
    return { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }
  }

  if (!currentUser) return <LoginPage error={authError} onLogin={async (username, password) => { try { const response = await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }) }); if (!response.ok) throw new Error('Invalid username or password'); const result = await response.json(); sessionStorage.setItem('northstar-token', result.token); const user = result.user as Omit<User, 'initials' | 'password' | 'access'>; setCurrentUser({ ...user, initials: initials(user.name), password: '', access: user.role === 'Administrator' ? 'Full access' : user.role === 'Helper' ? 'Take items' : 'Manage inventory' }); setAuthError('') } catch { setAuthError('Invalid username or password') } }} />

  return <div className="app-shell">
    <aside className={`sidebar ${menuOpen ? 'open' : ''}`}>
      <div className="brand"><span className="brand-mark">N</span><span>Northstar<br /><small>inventory control</small></span></div><div className="workspace-label">MENU</div>
      <nav>{navItems.map((item) => <button key={item.id} className={page === item.id ? 'active' : ''} onClick={() => go(item.id)}><span className="nav-icon">{item.icon}</span>{item.label}</button>)}</nav>
      <div className="sidebar-bottom"><div className="timezone"><span className="live-dot" /> All times<br /><strong>Asia/Karachi (PKT)</strong></div><div className="account"><span className="avatar avatar-olive">{currentUser.initials}</span><span><strong>{currentUser.name}</strong><small>{currentUser.role}</small></span><button className="more" onClick={() => { sessionStorage.removeItem('northstar-token'); setCurrentUser(null) }} aria-label="Log out">↗</button></div></div>
    </aside>
    <main className="main-content"><header className="topbar"><button className="menu-button" onClick={() => setMenuOpen(!menuOpen)} aria-label="Open menu">=</button><div className="breadcrumbs"><span>Northstar</span><b>/</b><strong>{pageTitle}</strong></div><div className="top-actions"><button className="icon-button" onClick={() => openModal('notifications')} aria-label="Show notifications">!</button><button className="help-button" onClick={() => openModal('help')}>Help <span>?</span></button></div></header>
      {notice && <div className="toast" role="status">✓ {notice}</div>}<section className="page-content">
        {page === 'overview' && <OverviewPage inventory={inventory} taken={taken} onNavigate={go} onAdd={() => openModal('inventory')} />}
        {page === 'inventory' && <InventoryPage items={filteredInventory} search={search} setSearch={setSearch} isAdmin={currentUser.role === 'Administrator'} onAdd={() => openModal('inventory')} onEdit={(item) => { setInventoryToManage(item); openModal('edit-inventory') }} onRemove={(item) => { setInventoryToManage(item); openModal('remove-inventory') }} />}
        {page === 'taken' && <ActivityPage rows={taken} isAdmin={currentUser.role === 'Administrator'} onAdd={() => openModal('handover')} onRemove={(row) => { setTakenToRemove(row); openModal('remove-taken') }} />}
        {page === 'refills' && <RefillPage rows={refills} onAdd={() => openModal('refill')} />}
        {page === 'users' && currentUser.role === 'Administrator' && <UsersPage users={users} onAdd={() => openModal('user')} onRemove={(user) => { setUserToRemove(user); openModal('remove-user') }} onReset={(user) => { setUserToRemove(user); openModal('reset-password') }} />}
      </section>
    </main>
    {modal && <ModalShell modal={modal} close={() => { setModal(null); setUserToRemove(null); setInventoryToManage(null); setTakenToRemove(null) }} inventory={inventory} inventoryToManage={inventoryToManage} userToRemove={userToRemove} takenToRemove={takenToRemove}
      onInventory={async (item) => {
        const full = { ...item, status: item.stock < item.minimum ? 'Low stock' : 'In stock' }
        setInventory((c) => [...c, full])
        await fetch('/api/inventory', { method: 'POST', headers: apiHeaders(), body: JSON.stringify(item) }).catch(() => {})
        actionDone('Inventory item added')
      }}
      onEditInventory={async (item) => {
        setInventory((c) => c.map((e) => e.name === inventoryToManage?.name ? item : e))
        await fetch(`/api/inventory/${encodeURIComponent(inventoryToManage!.name)}`, { method: 'PUT', headers: apiHeaders(), body: JSON.stringify(item) }).catch(() => {})
        actionDone('Inventory item updated')
      }}
      onRemoveInventory={async () => {
        if (inventoryToManage) {
          setInventory((c) => c.filter((item) => item.name !== inventoryToManage.name))
          await fetch(`/api/inventory/${encodeURIComponent(inventoryToManage.name)}`, { method: 'DELETE', headers: apiHeaders() }).catch(() => {})
        }
        actionDone('Inventory item removed')
      }}
      onRemoveTaken={async () => {
        if (takenToRemove) {
          setTaken((c) => c.filter((row) => row !== takenToRemove))
          await fetch(`/api/handovers/${encodeURIComponent(takenToRemove._id ?? '')}`, { method: 'DELETE', headers: apiHeaders() }).catch(() => {})
        }
        actionDone('Item record deleted')
      }}
      onHandover={async (row) => {
        setTaken((c) => [row, ...c])
        setInventory((c) => c.map((item) => item.name === row.item ? { ...item, stock: item.stock - row.quantity, status: item.stock - row.quantity < item.minimum ? 'Low stock' : item.status } : item))
        await fetch('/api/handovers', { method: 'POST', headers: apiHeaders(), body: JSON.stringify(row) }).catch(() => {})
        await fetch(`/api/inventory/${encodeURIComponent(row.item)}/deduct`, { method: 'POST', headers: apiHeaders(), body: JSON.stringify({ quantity: row.quantity }) }).catch(() => {})
        actionDone('Handover recorded')
      }}
      onRefill={async (row) => {
        setRefills((c) => [row, ...c])
        setInventory((c) => c.map((item) => item.name === row.item ? { ...item, stock: item.stock + row.quantity, status: item.stock + row.quantity < item.minimum ? 'Low stock' : 'In stock' } : item))
        await fetch('/api/refills', { method: 'POST', headers: apiHeaders(), body: JSON.stringify(row) }).catch(() => {})
        await fetch(`/api/inventory/${encodeURIComponent(row.item)}/restock`, { method: 'POST', headers: apiHeaders(), body: JSON.stringify({ quantity: row.quantity }) }).catch(() => {})
        actionDone('Refill recorded')
      }}
      onUser={(user) => { setUsers((c) => [...c, user]); actionDone('User invited successfully') }}
      onRemoveUser={() => { if (userToRemove) setUsers((c) => c.filter((user) => user.username !== userToRemove.username)); actionDone('User removed') }}
      onResetPassword={(password) => { if (userToRemove) setUsers((c) => c.map((user) => user.username === userToRemove.username ? { ...user, password } : user)); actionDone('Password reset successfully') }}
    />}
  </div>
}

function LoginPage({ error, onLogin }: { error: string; onLogin: (username: string, password: string) => void }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  return <main className="auth-page"><section className="auth-card"><div className="brand auth-brand"><span className="brand-mark">N</span><span>Northstar<br /><small>inventory control</small></span></div><div className="eyebrow">SECURE WORKSPACE</div><h1>Welcome back.</h1><p className="auth-copy">Sign in to manage stock, handovers, and team access.</p><form onSubmit={(event) => { event.preventDefault(); onLogin(username, password) }}><Field label="Username" value={username} onChange={setUsername} placeholder="Enter username" required /><Field label="Password" type="password" value={password} onChange={setPassword} placeholder="Enter password" required />{error && <p className="auth-error" role="alert">{error}</p>}<button className="primary-button auth-submit" type="submit">Sign in</button></form><div className="auth-note">Demo administrator: <strong>admin</strong> / <strong>admin123</strong></div></section><div className="auth-aside"><span>OPERATIONS / 01</span><h2>Every item<br />accounted for.</h2><p>One place for your team to take, refill, and return what keeps the day moving.</p></div></main>
}

function OverviewPage({ inventory, taken, onNavigate, onAdd }: { inventory: InventoryItem[]; taken: TakenItem[]; onNavigate: (page: Page) => void; onAdd: () => void }) {
  const low = inventory.filter((item) => item.stock < item.minimum)
  return <><div className="page-heading"><div><div className="eyebrow">THURSDAY, 24 SEPTEMBER 2026 / 12:06 PM PKT</div><h1>Overview</h1><p>Here is what is happening across your inventory today.</p></div><button className="primary-button" onClick={onAdd}><span>+</span> Add inventory</button></div><div className="stat-grid"><StatCard label="Total items" value={formatNumber(inventory.reduce((sum, item) => sum + item.stock, 0))} detail={`Across ${inventory.length} items`} tone="ink" onClick={() => onNavigate('inventory')} /><StatCard label="Low stock" value={String(low.length)} detail="Needs attention" tone="amber" alert onClick={() => onNavigate('inventory')} /><StatCard label="With team members" value={String(taken.filter((row) => row.status === 'With user').reduce((s, row) => s + row.quantity, 0))} detail={`${taken.filter((row) => row.status === 'With user').length} handovers shown`} tone="green" onClick={() => onNavigate('taken')} /><StatCard label="Pending refills" value={String(taken.length)} detail="Refill requests" tone="peach" onClick={() => onNavigate('refills')} /></div><div className="content-grid"><section className="panel chart-panel"><div className="panel-header"><div><div className="eyebrow">STOCK MOVEMENT</div><h2>Inventory activity</h2></div><button className="select-button" onClick={() => onNavigate('taken')}>Last 7 days <span>⌄</span></button></div><div className="chart"><div className="chart-y"><span>500</span><span>400</span><span>300</span><span>200</span><span>100</span><span>0</span></div><div className="chart-area"><div className="grid-lines" /><svg viewBox="0 0 650 230" preserveAspectRatio="none" aria-label="Stock movement chart"><path d="M0 178 C50 170 62 180 105 145 S160 165 205 120 S264 145 310 95 S370 132 412 72 S470 105 515 55 S580 96 650 28" fill="none" stroke="#dc7c57" strokeWidth="4" strokeLinecap="round" /><path d="M0 204 C58 198 80 185 120 194 S180 188 224 166 S275 177 315 153 S370 180 414 133 S475 158 520 120 S580 135 650 98" fill="none" stroke="#245c53" strokeWidth="4" strokeLinecap="round" /></svg><div className="chart-x"><span>18 Sep</span><span>19 Sep</span><span>20 Sep</span><span>21 Sep</span><span>22 Sep</span><span>23 Sep</span><span>24 Sep</span></div></div></div><div className="chart-legend"><span><i className="legend-line dispatched" /> Items taken</span><span><i className="legend-line restocked" /> Restocked</span></div></section><section className="panel attention-panel"><div className="panel-header"><div><div className="eyebrow">NEEDS ATTENTION</div><h2>Stock watch</h2></div><button className="text-button" onClick={() => onNavigate('inventory')}>View all <span>→</span></button></div>{low.map((item) => <div className="stock-watch" key={item.name}><div className="stock-icon">!</div><div><strong>{item.name}</strong><span>{item.stock} {item.unit} left / minimum {item.minimum}</span></div><span className="status status-amber">Low</span></div>)}{low.length === 0 && <div className="empty-state">All inventory is above minimum levels.</div>}</section></div><div className="section-heading"><div><div className="eyebrow">LATEST ACTIVITY</div><h2>Recent handovers</h2></div><button className="text-button" onClick={() => onNavigate('taken')}>See full log <span>→</span></button></div><section className="panel table-panel"><ActivityTable rows={taken.slice(0, 3)} compact /></section></>
}

function StatCard({ label, value, detail, tone, alert = false, onClick }: { label: string; value: string; detail: string; tone: string; alert?: boolean; onClick?: () => void }) { return <div className={`stat-card tone-${tone} ${onClick ? 'clickable' : ''}`} onClick={onClick} style={onClick ? {cursor: 'pointer'} : {}}><div className="stat-top"><span>{label}</span>{alert && <span className="mini-alert">!</span>}</div><strong>{value}</strong><small>{detail}</small></div> }
function Person({ initials: value, name }: { initials: string; name: string }) { return <div className="person"><span className="avatar">{value}</span><strong>{name}</strong></div> }
function ActivityTable({ rows, compact = false, isAdmin = false, onRemove }: { rows: TakenItem[]; compact?: boolean; isAdmin?: boolean; onRemove?: (row: TakenItem) => void }) { return <table><thead><tr><th>ITEM</th><th>PERSON</th><th>NUMBER OF ITEMS</th>{!compact && <th>WHY</th>}<th>DATE AND TIME <small>PAKISTAN</small></th><th>STATUS</th>{isAdmin && !compact && <th>ACTION</th>}</tr></thead><tbody>{rows.map((row) => <tr key={`${row.item}-${row.time}-${row.person}`}><td><strong>{row.item}</strong>{compact && <span>{row.purpose}</span>}</td><td><Person initials={row.initials} name={row.person} /></td><td><strong>{row.quantity}</strong></td>{!compact && <td>{row.purpose}</td>}<td><strong>{row.date}</strong><span>{row.time} · Islamabad</span></td><td><span className={`status ${row.status === 'Returned' ? 'status-green' : 'status-blue'}`}>{row.status}</span></td>{isAdmin && !compact && <td><button className="remove-button" onClick={() => onRemove?.(row)}>Delete</button></td>}</tr>)}</tbody></table> }
function ActivityPage({ rows, isAdmin, onAdd, onRemove }: { rows: TakenItem[]; isAdmin: boolean; onAdd: () => void; onRemove: (row: TakenItem) => void }) { const [query, setQuery] = useState(''); const [status, setStatus] = useState('All'); const [date, setDate] = useState('All'); const filtered = rows.filter((row) => `${row.item} ${row.person} ${row.purpose}`.toLowerCase().includes(query.toLowerCase()) && (status === 'All' || row.status === status) && (date === 'All' || row.date === date)); return <><div className="page-heading"><div><div className="eyebrow">ITEMS USED BY PEOPLE</div><h1>Items used by people</h1><p>See who has an item, how many they have, and when it was given to them.</p></div><div className="heading-actions"><button className="secondary-button" onClick={() => downloadTakenCsv(filtered)}>Download Excel / CSV</button><button className="primary-button" onClick={onAdd}><span>+</span> Give out an item</button></div></div><div className="filter-row"><div className="search-field"><span>⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search item or person..." /></div><select className="select-button" aria-label="Filter by status" value={status} onChange={(event) => setStatus(event.target.value)}><option value="All">All statuses</option><option value="With user">With person</option><option>Returned</option></select><select className="select-button" aria-label="Filter by date" value={date} onChange={(event) => setDate(event.target.value)}><option value="All">All dates</option><option>24 Sep 2026</option><option>23 Sep 2026</option></select></div><section className="panel table-panel"><ActivityTable rows={filtered} isAdmin={isAdmin} onRemove={onRemove} /></section>{isAdmin && <div className="admin-note">Administrator: delete a record when that handout was entered by mistake.</div>}<div className="table-footer">Showing <strong>{filtered.length}</strong> of {rows.length} records <span>← &nbsp; 1 &nbsp; →</span></div></> }
function RefillPage({ rows, onAdd }: { rows: Refill[]; onAdd: () => void }) {
  const [query, setQuery] = useState('')
  const [period, setPeriod] = useState('All')
  const filtered = rows.filter((row) => `${row.item} ${row.person} ${row.source}`.toLowerCase().includes(query.toLowerCase()) && (period === 'All' || row.date === period))
  const totalUnits = filtered.reduce((sum, row) => sum + row.quantity, 0)
  return <>
    <div className="page-heading">
      <div><div className="eyebrow">INVENTORY / RESTOCKING</div><h1>Restocking</h1><p>Track every stock replenishment — who restocked it, how much came in, and from where.</p></div>
      <button className="primary-button" onClick={onAdd}><span>+</span> Log a refill</button>
    </div>
    <div className="refill-stats-grid">
      <div className="refill-stat-card refill-stat-ink">
        <div className="eyebrow" style={{color:'#a7c5b9',marginBottom:12}}>TOTAL REFILLS</div>
        <strong className="refill-stat-number">{filtered.length}</strong>
        <span className="refill-stat-label">entries in log</span>
      </div>
      <div className="refill-stat-card refill-stat-coral">
        <div className="eyebrow" style={{color:'#f5c4aa',marginBottom:12}}>UNITS RESTOCKED</div>
        <strong className="refill-stat-number">{formatNumber(totalUnits)}</strong>
        <span className="refill-stat-label">units added to stock</span>
      </div>
      <div className="refill-stat-card refill-stat-sage">
        <div className="eyebrow" style={{color:'#b5d0c5',marginBottom:12}}>LAST ACTIVITY</div>
        <strong className="refill-stat-number" style={{fontSize:22}}>{filtered[0]?.date ?? '—'}</strong>
        <span className="refill-stat-label">{filtered[0]?.time ? `at ${filtered[0].time}` : 'No refills yet'}</span>
      </div>
    </div>
    <div className="filter-row">
      <div className="search-field"><span>⌕</span><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search item, person, or source..." /></div>
      <select className="select-button" value={period} onChange={(e) => setPeriod(e.target.value)}>
        <option value="All">All dates</option>
        <option>24 Sep 2026</option><option>23 Sep 2026</option><option>22 Sep 2026</option>
      </select>
    </div>
    <section className="panel table-panel">
      <div className="panel-header" style={{padding:'20px 22px 0'}}>
        <div><div className="eyebrow">COMPLETE HISTORY</div><h2>Who refilled what</h2></div>
      </div>
      {filtered.length === 0
        ? <div className="refill-empty">
            <div className="refill-empty-icon">📦</div>
            <strong>No refills logged yet</strong>
            <p>Click "Log a refill" above to record a stock replenishment.</p>
            <button className="primary-button" onClick={onAdd}><span>+</span> Log first refill</button>
          </div>
        : <table><thead><tr><th>ITEM</th><th>REFILLED BY</th><th>QUANTITY ADDED</th><th>RECEIVED</th><th>SOURCE / NOTE</th></tr></thead>
            <tbody>{filtered.map((row) => <tr key={`${row.item}-${row.time}-${row.person}`}>
              <td><strong>{row.item}</strong></td>
              <td><Person initials={row.initials} name={row.person} /></td>
              <td><strong className="quantity-positive">+{formatNumber(row.quantity)}</strong></td>
              <td><strong>{row.date}</strong><span>{row.time} · Islamabad</span></td>
              <td><strong>{row.source}</strong><span>{row.note}</span></td>
            </tr>)}</tbody>
          </table>}
    </section>
  </>
}
function InventoryPage({ items, search, setSearch, isAdmin, onAdd, onEdit, onRemove }: { items: InventoryItem[]; search: string; setSearch: (value: string) => void; isAdmin: boolean; onAdd: () => void; onEdit: (item: InventoryItem) => void; onRemove: (item: InventoryItem) => void }) { const [category, setCategory] = useState('All'); const [status, setStatus] = useState('All'); const categories = ['All', ...new Set(items.map((item) => item.category))]; const filtered = items.filter((item) => (category === 'All' || item.category === category) && (status === 'All' || item.status === status)); return <><div className="page-heading"><div><div className="eyebrow">INVENTORY / ALL ITEMS</div><h1>Inventory</h1><p>Keep every item visible, counted, and ready for the next handover.</p></div><button className="primary-button" onClick={onAdd}><span>+</span> Add inventory</button></div><div className="filter-row"><div className="search-field"><span>⌕</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search inventory..." /></div><select className="select-button" value={category} onChange={(event) => setCategory(event.target.value)}>{categories.map((option) => <option key={option} value={option}>{option === 'All' ? 'All categories' : option}</option>)}</select><select className="select-button" value={status} onChange={(event) => setStatus(event.target.value)}><option value="All">All stock statuses</option><option>In stock</option><option>Low stock</option></select></div><section className="panel table-panel"><table><thead><tr><th>ITEM</th><th>CATEGORY</th><th>AVAILABLE</th><th>MINIMUM</th><th>STATUS</th><th>ACTION</th></tr></thead><tbody>{filtered.map((item) => <tr key={item.name}><td><strong>{item.name}</strong><span>Updated today</span></td><td>{item.category}</td><td><strong>{formatNumber(item.stock)}</strong> {item.unit}</td><td>{formatNumber(item.minimum)} {item.unit}</td><td><span className={`status ${item.status === 'Low stock' ? 'status-amber' : 'status-green'}`}>{item.status}</span></td><td><div className="inventory-actions"><button className="reset-button" onClick={() => onEdit(item)}>Edit</button>{isAdmin ? <button className="remove-button" onClick={() => onRemove(item)}>Remove</button> : <span className="protected-label">Edit only</span>}</div></td></tr>)}</tbody></table>{filtered.length === 0 && <div className="empty-state">No inventory matches the selected filters.</div>}</section></> }
function UsersPage({ users, onAdd, onRemove, onReset }: { users: User[]; onAdd: () => void; onRemove: (user: User) => void; onReset: (user: User) => void }) {
  const [query, setQuery] = useState('')
  const [role, setRole] = useState('All')
  const filtered = users.filter((user) => `${user.name} ${user.username}`.toLowerCase().includes(query.toLowerCase()) && (role === 'All' || user.role === role))
  const roleColor = (r: string) => r === 'Administrator' ? 'role-admin' : r === 'Helper' ? 'role-helper' : 'role-manager'
  return <>
    <div className="page-heading">
      <div><div className="eyebrow">ADMINISTRATION / PEOPLE</div><h1>People & Access</h1><p>Manage usernames, roles, and password access for every team member.</p></div>
      <button className="primary-button" onClick={onAdd}><span>+</span> Add user</button>
    </div>
    <div className="user-stats-bar">
      <div className="user-stat"><strong>{users.filter((u) => u.active).length}</strong><span>Active</span></div>
      <div className="user-stat-divider" />
      <div className="user-stat"><strong>{users.filter((u) => u.role === 'Administrator').length}</strong><span>Admins</span></div>
      <div className="user-stat-divider" />
      <div className="user-stat"><strong>{users.filter((u) => u.role === 'Helper').length}</strong><span>Helpers</span></div>
      <div className="user-stat-divider" />
      <div className="user-stat"><strong>{users.filter((u) => u.role.includes('manager')).length}</strong><span>Managers</span></div>
    </div>
    <div className="filter-row">
      <div className="search-field"><span>⌕</span><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search name or username..." /></div>
      <select className="select-button" value={role} onChange={(e) => setRole(e.target.value)}>
        <option value="All">All roles</option><option>Administrator</option><option>Warehouse manager</option><option>Helper</option>
      </select>
    </div>
    {filtered.length === 0
      ? <div className="panel" style={{padding:48,textAlign:'center',color:'#96a19b',fontSize:13}}>No users match the selected filters.</div>
      : <div className="user-card-grid">
          {filtered.map((user) => (
            <div className="user-card" key={user.username}>
              <div className="user-card-top">
                <div className="user-avatar-lg">{user.initials}</div>
                <span className={`role-badge ${roleColor(user.role)}`}>{user.role}</span>
              </div>
              <div className="user-card-name">{user.name}</div>
              <div className="user-card-username">@{user.username}</div>
              <div className="user-card-meta">
                <span className={`status ${user.active ? 'status-green' : 'status-amber'}`}>{user.active ? 'Active' : 'Inactive'}</span>
                <span className="user-card-access">{user.access}</span>
              </div>
              <div className="user-card-actions">
                {user.role === 'Administrator'
                  ? <span className="protected-label" style={{display:'block',textAlign:'center',padding:'8px 0'}}>⚙ Administrator — protected</span>
                  : <><button className="reset-button" style={{flex:1}} onClick={() => onReset(user)}>Reset password</button>
                     <button className="remove-button" style={{flex:1}} onClick={() => onRemove(user)}>Remove</button></>
                }
              </div>
            </div>
          ))}
        </div>
    }
  </>
}

function ModalShell({ modal, close, inventory, inventoryToManage, userToRemove, takenToRemove, onInventory, onEditInventory, onRemoveInventory, onRemoveTaken, onHandover, onRefill, onUser, onRemoveUser, onResetPassword }: { modal: Exclude<Modal, null>; close: () => void; inventory: InventoryItem[]; inventoryToManage: InventoryItem | null; userToRemove: User | null; takenToRemove: TakenItem | null; onInventory: (item: Omit<InventoryItem, 'status'>) => void; onEditInventory: (item: InventoryItem) => void; onRemoveInventory: () => void; onRemoveTaken: () => void; onHandover: (row: TakenItem) => void; onRefill: (row: Refill) => void; onUser: (user: User) => void; onRemoveUser: () => void; onResetPassword: (password: string) => void }) {
  const [form, setForm] = useState<Record<string, string>>((): Record<string, string> => inventoryToManage ? { name: inventoryToManage.name, category: inventoryToManage.category, stock: String(inventoryToManage.stock), minimum: String(inventoryToManage.minimum), unit: inventoryToManage.unit } : {})
  const set = (key: string, value: string) => setForm((current) => ({ ...current, [key]: value }))
  const submit = (event: FormEvent) => { event.preventDefault(); const now = stamp(); if (modal === 'inventory' && form.name && form.stock) onInventory({ name: form.name, category: form.category || 'General', stock: Number(form.stock), minimum: Number(form.minimum || 0), unit: form.unit || 'units' }); if (modal === 'edit-inventory' && form.name && form.stock && inventoryToManage) onEditInventory({ name: form.name, category: form.category || 'General', stock: Number(form.stock), minimum: Number(form.minimum || 0), unit: form.unit || 'units', status: Number(form.stock) < Number(form.minimum || 0) ? 'Low stock' : 'In stock' }); if (modal === 'handover' && form.item && form.person && form.quantity) onHandover({ item: form.item, person: form.person, initials: initials(form.person), quantity: Number(form.quantity), purpose: form.purpose || 'General use', ...now, status: 'With user' }); if (modal === 'refill' && form.item && form.person && form.quantity) onRefill({ item: form.item, person: form.person, initials: initials(form.person), quantity: Number(form.quantity), source: form.source || 'Manual entry', note: form.note || 'Stock refill', ...now }); if (modal === 'user' && form.name && form.username && form.password && form.role) onUser({ name: form.name, initials: initials(form.name), username: form.username, password: form.password, role: form.role, access: form.role === 'Administrator' ? 'Full access' : form.role === 'Helper' ? 'Take items' : 'Manage inventory', active: true }); if (modal === 'reset-password' && form.password) onResetPassword(form.password) }
  const title = modal === 'inventory' ? 'Add inventory' : modal === 'edit-inventory' ? 'Edit inventory' : modal === 'handover' ? 'Record handover' : modal === 'refill' ? 'Log a refill' : modal === 'user' ? 'Invite user' : modal === 'reset-password' ? 'Reset password' : modal === 'remove-user' ? 'Remove user' : modal === 'remove-inventory' ? 'Remove inventory' : modal === 'notifications' ? 'Notifications' : 'Help center'
  if (modal === 'edit-inventory' && inventoryToManage) return <div className="modal-backdrop" onClick={close}><section className="modal-card" onClick={(event) => event.stopPropagation()}><button className="modal-close" onClick={close}>×</button><div className="eyebrow">INVENTORY / EDIT ITEM</div><h2>Edit inventory</h2><form onSubmit={submit}><Field label="Item name" value={form.name} onChange={(value) => set('name', value)} required /><div className="form-row"><Field label="Quantity" type="number" value={form.stock} onChange={(value) => set('stock', value)} required /><Field label="Minimum level" type="number" value={form.minimum} onChange={(value) => set('minimum', value)} /></div><div className="form-row"><Field label="Category" value={form.category} onChange={(value) => set('category', value)} /><Field label="Unit" value={form.unit} onChange={(value) => set('unit', value)} required /></div><div className="modal-actions"><button type="button" className="secondary-button" onClick={close}>Cancel</button><button type="submit" className="primary-button">Save changes</button></div></form></section></div>
  if (modal === 'remove-user' && userToRemove) return <div className="modal-backdrop" onClick={close}><section className="modal-card small-modal" onClick={(event) => event.stopPropagation()}><button className="modal-close" onClick={close}>×</button><div className="eyebrow">ADMINISTRATION / CONFIRMATION</div><h2>Remove {userToRemove.name}?</h2><p className="modal-copy">This will revoke <strong>{userToRemove.username}</strong>'s access immediately. Their historical handover and refill records will remain.</p><div className="modal-actions"><button type="button" className="secondary-button" onClick={close}>Cancel</button><button type="button" className="danger-button" onClick={onRemoveUser}>Remove user</button></div></section></div>
  if (modal === 'remove-inventory' && inventoryToManage) return <div className="modal-backdrop" onClick={close}><section className="modal-card small-modal" onClick={(event) => event.stopPropagation()}><button className="modal-close" onClick={close}>×</button><div className="eyebrow">INVENTORY / CONFIRMATION</div><h2>Remove {inventoryToManage.name}?</h2><p className="modal-copy">This removes the item from active inventory. Existing handover and refill history will remain.</p><div className="modal-actions"><button type="button" className="secondary-button" onClick={close}>Cancel</button><button type="button" className="danger-button" onClick={onRemoveInventory}>Remove item</button></div></section></div>
  if (modal === 'remove-taken' && takenToRemove) return <div className="modal-backdrop" onClick={close}><section className="modal-card small-modal" onClick={(event) => event.stopPropagation()}><button className="modal-close" onClick={close}>×</button><div className="eyebrow">ITEMS USED BY PEOPLE / CONFIRMATION</div><h2>Delete this record?</h2><p className="modal-copy">Delete the record showing <strong>{takenToRemove.quantity} {takenToRemove.item}</strong> with {takenToRemove.person}? This cannot be undone.</p><div className="modal-actions"><button type="button" className="secondary-button" onClick={close}>Cancel</button><button type="button" className="danger-button" onClick={onRemoveTaken}>Delete record</button></div></section></div>
  if (modal === 'notifications' || modal === 'help') return <div className="modal-backdrop" onClick={close}><section className="modal-card small-modal" onClick={(event) => event.stopPropagation()}><button className="modal-close" onClick={close}>×</button><div className="eyebrow">NORTHSTAR</div><h2>{title}</h2>{modal === 'notifications' ? <><p className="modal-copy">You have 2 items below their minimum level and 4 pending refill requests.</p><button className="primary-button" onClick={close}>Mark as reviewed</button></> : <><p className="modal-copy">Need a hand? Contact your administrator or use the inventory pages to record each movement.</p><button className="primary-button" onClick={close}>Got it</button></>}</section></div>
  return <div className="modal-backdrop" onClick={close}><section className="modal-card" onClick={(event) => event.stopPropagation()}><button className="modal-close" onClick={close}>×</button><div className="eyebrow">NORTHSTAR / ADMINISTRATION</div><h2>{title}</h2><form onSubmit={submit}>{modal === 'reset-password' && <><p className="modal-copy">Set a new temporary password for <strong>{userToRemove?.name}</strong>. The existing password cannot be viewed.</p><Field label="New temporary password" type="password" value={form.password} onChange={(value) => set('password', value)} required /></>}{modal === 'inventory' && <><Field label="Item name" value={form.name} onChange={(value) => set('name', value)} required /><div className="form-row"><Field label="Quantity" type="number" value={form.stock} onChange={(value) => set('stock', value)} required /><Field label="Minimum level" type="number" value={form.minimum} onChange={(value) => set('minimum', value)} /></div><div className="form-row"><Field label="Category" value={form.category} onChange={(value) => set('category', value)} /><Field label="Unit" value={form.unit} onChange={(value) => set('unit', value)} placeholder="pieces, rolls..." /></div></>}{modal === 'handover' && <><SelectField label="Item" value={form.item} onChange={(value) => set('item', value)} options={inventory.map((item) => item.name)} /><Field label="Taken by" value={form.person} onChange={(value) => set('person', value)} placeholder="Full name" required /><div className="form-row"><Field label="Quantity" type="number" value={form.quantity} onChange={(value) => set('quantity', value)} required /><Field label="Purpose" value={form.purpose} onChange={(value) => set('purpose', value)} /></div></>}{modal === 'refill' && <><SelectField label="Item" value={form.item} onChange={(value) => set('item', value)} options={inventory.map((item) => item.name)} /><Field label="Refilled by" value={form.person} onChange={(value) => set('person', value)} placeholder="Full name" required /><div className="form-row"><Field label="Quantity added" type="number" value={form.quantity} onChange={(value) => set('quantity', value)} required /><Field label="Source" value={form.source} onChange={(value) => set('source', value)} /></div><Field label="Note" value={form.note} onChange={(value) => set('note', value)} /></>}{modal === 'user' && <><Field label="Full name" value={form.name} onChange={(value) => set('name', value)} required /><Field label="Username" value={form.username} onChange={(value) => set('username', value)} required /><Field label="Temporary password" type="password" value={form.password} onChange={(value) => set('password', value)} required /><SelectField label="Role" value={form.role} onChange={(value) => set('role', value)} options={['Administrator', 'Warehouse manager', 'Helper']} /></>}<div className="modal-actions"><button type="button" className="secondary-button" onClick={close}>Cancel</button><button type="submit" className="primary-button">{modal === 'reset-password' ? 'Reset password' : 'Save'}</button></div></form></section></div>
}
function Field({ label, value = '', onChange, type = 'text', placeholder, required = false }: { label: string; value?: string; onChange: (value: string) => void; type?: string; placeholder?: string; required?: boolean }) { return <label className="field"><span>{label}</span><input type={type} value={value} placeholder={placeholder} required={required} onChange={(event) => onChange(event.target.value)} /></label> }
function SelectField({ label, value = '', onChange, options }: { label: string; value?: string; onChange: (value: string) => void; options: string[] }) { return <label className="field"><span>{label}</span><select value={value} required onChange={(event) => onChange(event.target.value)}><option value="">Select...</option>{options.map((option) => <option key={option}>{option}</option>)}</select></label> }

export default App
