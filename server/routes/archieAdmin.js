// server/routes/archieAdmin.js
import express from 'express'
import multer from 'multer'
import { PDFParse } from 'pdf-parse'
import crypto from 'crypto'
import { addChunks, deleteBySource, listDocuments, chunkText } from '../archieRag.js'

async function extractPdfText(buffer) {
  const parser = new PDFParse({ data: buffer })
  const result = await parser.getText()
  await parser.destroy()
  return result.text
}

const router = express.Router()

// Multer for individual chunks (max 512KB each)
const chunkUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 512 * 1024 }
})

// Track files currently being indexed (in-memory; resets on restart)
const indexingFiles = new Set()

// Pending chunked uploads: uploadId → { filename, total, chunks: Buffer[] }
const pendingUploads = new Map()

// Clean up stale incomplete uploads older than 1 hour
setInterval(() => {
  const cutoff = Date.now() - 60 * 60 * 1000
  for (const [id, upload] of pendingUploads) {
    if (upload.startedAt < cutoff) pendingUploads.delete(id)
  }
}, 10 * 60 * 1000)

function requireAdmin(req, res, next) {
  if (req.session?.archieAdmin) return next()
  res.redirect('/admin')
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function loginPage(error = '') {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Archie Admin — Login</title>
  <style>
    body { font-family: system-ui, sans-serif; background: #f5f5f5; display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0; }
    .card { background: white; padding: 2rem; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); width: 320px; }
    h1 { margin: 0 0 1.5rem; font-size: 1.25rem; }
    input[type=password] { width: 100%; padding: 0.5rem; box-sizing: border-box; margin-bottom: 1rem; border: 1px solid #ddd; border-radius: 4px; }
    button { background: #d97706; color: white; border: none; padding: 0.5rem 1rem; border-radius: 4px; cursor: pointer; width: 100%; }
    .error { color: #dc2626; font-size: 0.875rem; margin-bottom: 1rem; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Archie Admin</h1>
    ${error ? `<p class="error">${escapeHtml(error)}</p>` : ''}
    <form method="POST" action="/admin/login">
      <input type="password" name="password" placeholder="Admin password" autofocus>
      <button type="submit">Log in</button>
    </form>
  </div>
</body>
</html>`
}

function settingsPage() {
  const provider = process.env.LLM_PROVIDER || 'gemini'
  const geminiKey = process.env.GEMINI_API_KEY || ''
  const claudeKey = process.env.CLAUDE_API_KEY || ''
  const openrouterKey = process.env.OPENROUTER_API_KEY || ''

  const maskKey = (key) => key ? key.substring(0, 10) + '...' + key.substring(key.length - 4) : ''

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Archie Admin — Settings</title>
  <style>
    body { font-family: system-ui, sans-serif; background: #f5f5f5; margin: 0; padding: 2rem; }
    .card { background: white; padding: 2rem; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); max-width: 640px; margin: 0 auto; }
    h1 { margin: 0 0 0.25rem; font-size: 1.25rem; }
    .subtitle { color: #666; font-size: 0.875rem; margin-bottom: 1.5rem; }
    .setting-group { margin-bottom: 1.5rem; }
    label { display: block; font-size: 0.875rem; color: #666; margin-bottom: 0.5rem; font-weight: 500; }
    select, input[type=text], textarea { width: 100%; padding: 0.5rem; box-sizing: border-box; border: 1px solid #ddd; border-radius: 4px; font-family: monospace; }
    textarea { resize: vertical; min-height: 80px; font-family: monospace; }
    .current-key { font-size: 0.8rem; color: #999; margin-top: 0.25rem; }
    .button-group { display: flex; gap: 0.5rem; }
    button { background: #d97706; color: white; border: none; padding: 0.5rem 1rem; border-radius: 4px; cursor: pointer; }
    button:hover { background: #b45309; }
    a { color: #d97706; text-decoration: none; }
    a:hover { text-decoration: underline; }
    .success { color: #16a34a; font-size: 0.875rem; margin-bottom: 1rem; }
    .nav { margin-bottom: 1.5rem; display: flex; gap: 1rem; }
    .nav a { color: #666; font-size: 0.875rem; text-decoration: none; }
    .nav a:hover { color: #d97706; }
    .provider-info { font-size: 0.8rem; color: #999; margin-top: 0.25rem; }
  </style>
</head>
<body>
  <div class="card">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem">
      <h1>Archie Admin — Settings</h1>
      <form method="POST" action="/admin/logout" style="display:inline">
        <button type="submit" style="background:none;border:none;color:#666;cursor:pointer;font-size:0.875rem">Log out</button>
      </form>
    </div>
    <div class="nav">
      <a href="/admin/documents">← Back to Documents</a>
    </div>

    <form method="POST" action="/admin/settings" id="settingsForm" style="display:flex;flex-direction:column">
      <div class="setting-group">
        <label for="provider">LLM Provider</label>
        <select id="provider" name="provider" onchange="updateKeyDisplay()">
          <option value="gemini" ${provider === 'gemini' ? 'selected' : ''}>Gemini (Google)</option>
          <option value="claude" ${provider === 'claude' ? 'selected' : ''}>Claude (Anthropic)</option>
          <option value="openrouter" ${provider === 'openrouter' ? 'selected' : ''}>OpenRouter</option>
        </select>
        <div class="provider-info">Currently active: <strong>${provider}</strong></div>
      </div>

      <div class="setting-group">
        <label for="gemini-key">Gemini API Key</label>
        <textarea id="gemini-key" name="gemini_api_key" placeholder="Paste your Gemini API key here"></textarea>
        ${geminiKey ? `<div class="current-key">Current key: ${maskKey(geminiKey)}</div>` : ''}
      </div>

      <div class="setting-group">
        <label for="claude-key">Claude API Key</label>
        <textarea id="claude-key" name="claude_api_key" placeholder="Paste your Claude API key here"></textarea>
        ${claudeKey ? `<div class="current-key">Current key: ${maskKey(claudeKey)}</div>` : ''}
      </div>

      <div class="setting-group">
        <label for="openrouter-key">OpenRouter API Key</label>
        <textarea id="openrouter-key" name="openrouter_api_key" placeholder="Paste your OpenRouter API key here"></textarea>
        ${openrouterKey ? `<div class="current-key">Current key: ${maskKey(openrouterKey)}</div>` : ''}
      </div>

      <div class="button-group">
        <button type="submit">Save Settings</button>
      </div>
    </form>
  </div>
  <script>
    function updateKeyDisplay() {
      const provider = document.getElementById('provider')?.value || 'gemini';
      const gemini = document.getElementById('gemini-key');
      const claude = document.getElementById('claude-key');
      const openrouter = document.getElementById('openrouter-key');
      if (gemini) gemini.style.display = provider === 'gemini' ? 'block' : 'none';
      if (claude) claude.style.display = provider === 'claude' ? 'block' : 'none';
      if (openrouter) openrouter.style.display = provider === 'openrouter' ? 'block' : 'none';
    }
    document.addEventListener('DOMContentLoaded', updateKeyDisplay);
  </script>
</body>
</html>`
}

function dashboardPage(docs, pendingFiles = [], settingsUpdated = false) {
  const pendingRows = pendingFiles.map(f => `
    <tr>
      <td style="padding:0.5rem 0;border-bottom:1px solid #f0f0f0;color:#d97706">
        ${escapeHtml(f)} <span style="font-size:0.8rem">(indexing…)</span>
      </td>
      <td style="padding:0.5rem 0;border-bottom:1px solid #f0f0f0"></td>
    </tr>`).join('')

  const docRows = docs.length === 0 && pendingFiles.length === 0
    ? '<tr><td colspan="2" style="color:#999;text-align:center;padding:1rem">No documents uploaded yet.</td></tr>'
    : docs.map(doc => `
      <tr>
        <td style="padding:0.5rem 0;border-bottom:1px solid #f0f0f0">${escapeHtml(doc.title || doc.source)}</td>
        <td style="padding:0.5rem 0;border-bottom:1px solid #f0f0f0">
          <form method="POST" action="/admin/documents/${encodeURIComponent(doc.source)}/delete" style="display:inline">
            <button type="submit" style="background:#dc2626;color:white;border:none;padding:0.25rem 0.5rem;border-radius:4px;cursor:pointer;font-size:0.8rem" onclick="return confirm('Delete ${escapeHtml(doc.source)}?')">Delete</button>
          </form>
        </td>
      </tr>`).join('')

  const autoRefresh = pendingFiles.length > 0
    ? '<meta http-equiv="refresh" content="5">'
    : ''

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  ${autoRefresh}
  <title>Archie Admin — Knowledge Base</title>
  <style>
    body { font-family: system-ui, sans-serif; background: #f5f5f5; margin: 0; padding: 2rem; }
    .card { background: white; padding: 2rem; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); max-width: 640px; margin: 0 auto; }
    h1 { margin: 0 0 0.25rem; font-size: 1.25rem; }
    .subtitle { color: #666; font-size: 0.875rem; margin-bottom: 1.5rem; }
    .upload-section { display: flex; gap: 0.5rem; margin-bottom: 0.5rem; }
    input[type=file] { flex: 1; border: 1px solid #ddd; border-radius: 4px; padding: 0.4rem; }
    button.primary { background: #d97706; color: white; border: none; padding: 0.5rem 1rem; border-radius: 4px; cursor: pointer; white-space: nowrap; }
    button.primary:disabled { background: #f59e0b; cursor: not-allowed; }
    table { width: 100%; border-collapse: collapse; }
    th { text-align: left; border-bottom: 2px solid #eee; padding: 0.5rem 0; font-size: 0.875rem; color: #666; }
    #upload-progress { display: none; margin-bottom: 1rem; }
    #upload-progress progress { width: 100%; height: 6px; accent-color: #d97706; }
    #upload-error { display: none; color: #dc2626; font-size: 0.875rem; margin-bottom: 1rem; }
    .nav { display: flex; gap: 1rem; margin-bottom: 1.5rem; }
    .nav a { color: #d97706; font-size: 0.875rem; text-decoration: none; }
    .nav a:hover { text-decoration: underline; }
    .success { color: #16a34a; font-size: 0.875rem; margin-bottom: 1rem; background: #f0fdf4; padding: 0.75rem; border-radius: 4px; border-left: 3px solid #16a34a; }
  </style>
</head>
<body>
  <div class="card">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.25rem">
      <h1>Archie Admin — Knowledge Base</h1>
      <form method="POST" action="/admin/logout" style="display:inline">
        <button type="submit" style="background:none;border:none;color:#666;cursor:pointer;font-size:0.875rem">Log out</button>
      </form>
    </div>
    <div class="nav">
      <a href="/admin/settings">⚙️ Settings</a>
    </div>
    ${settingsUpdated ? '<div class="success">✓ Settings updated successfully</div>' : ''}
    <p class="subtitle">Upload documents to expand Archie's knowledge. Accepts .txt, .md, .pdf (max 10 MB)</p>
    <div class="upload-section">
      <input type="file" id="file-input" accept=".txt,.md,.pdf">
      <button class="primary" id="upload-btn" onclick="startUpload()">Upload</button>
    </div>
    <div id="upload-progress"><progress id="progress-bar" value="0" max="100"></progress> <span id="progress-label" style="font-size:0.8rem;color:#666"></span></div>
    <div id="upload-error"></div>
    <table>
      <thead><tr><th>Document</th><th></th></tr></thead>
      <tbody>${pendingRows}${docRows}</tbody>
    </table>
  </div>
  <script>
    const CHUNK_SIZE = 256 * 1024 // 256 KB per chunk — avoids proxy body-stream timeouts

    async function startUpload() {
      const fileInput = document.getElementById('file-input')
      const file = fileInput.files[0]
      if (!file) { alert('Please select a file first.'); return }

      const allowed = /\\.(txt|md|pdf)$/i.test(file.name)
      if (!allowed) { alert('Only .txt, .md, and .pdf files are allowed.'); return }
      if (file.size > 10 * 1024 * 1024) { alert('File exceeds 10 MB limit.'); return }

      const btn = document.getElementById('upload-btn')
      const progressEl = document.getElementById('upload-progress')
      const progressBar = document.getElementById('progress-bar')
      const progressLabel = document.getElementById('progress-label')
      const errorEl = document.getElementById('upload-error')

      btn.disabled = true
      errorEl.style.display = 'none'
      progressEl.style.display = 'block'

      const uploadId = Date.now().toString(36) + Math.random().toString(36).slice(2)
      const totalChunks = Math.max(1, Math.ceil(file.size / CHUNK_SIZE))

      try {
        for (let i = 0; i < totalChunks; i++) {
          const start = i * CHUNK_SIZE
          const chunk = file.slice(start, start + CHUNK_SIZE)

          progressBar.value = Math.round((i / totalChunks) * 100)
          progressLabel.textContent = totalChunks > 1
            ? \`Uploading… \${progressBar.value}%\`
            : 'Uploading…'

          const fd = new FormData()
          fd.append('chunk', chunk, file.name)
          fd.append('uploadId', uploadId)
          fd.append('chunkIndex', String(i))
          fd.append('totalChunks', String(totalChunks))
          fd.append('filename', file.name)

          const resp = await fetch('/admin/upload-chunk', { method: 'POST', body: fd })
          if (!resp.ok) {
            const msg = await resp.text()
            throw new Error(msg || resp.statusText)
          }
        }

        progressBar.value = 100
        progressLabel.textContent = 'Indexing in background…'
        setTimeout(() => { window.location.href = '/admin/documents' }, 800)
      } catch (err) {
        progressEl.style.display = 'none'
        errorEl.textContent = 'Upload failed: ' + err.message
        errorEl.style.display = 'block'
        btn.disabled = false
      }
    }
  </script>
</body>
</html>`
}

// GET / — login form or redirect
router.get('/', (req, res) => {
  if (req.session?.archieAdmin) return res.redirect('/admin/documents')
  res.send(loginPage())
})

// POST /login
router.post('/login', express.urlencoded({ extended: false }), (req, res) => {
  const { password } = req.body
  const adminPassword = process.env.ARCHIE_ADMIN_PASSWORD
  if (!adminPassword) {
    return res.send(loginPage('ARCHIE_ADMIN_PASSWORD is not set on the server.'))
  }
  if (password === adminPassword) {
    req.session.archieAdmin = true
    res.redirect('/admin/documents')
  } else {
    res.send(loginPage('Incorrect password.'))
  }
})

// POST /logout
router.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/admin'))
})

// GET /settings
router.get('/settings', requireAdmin, (req, res) => {
  res.send(settingsPage())
})

// POST /settings — save provider and API keys
router.post('/settings', requireAdmin, express.urlencoded({ extended: false }), async (req, res) => {
  const { provider, gemini_api_key, claude_api_key, openrouter_api_key } = req.body

  if (!provider) {
    return res.send(settingsPage())
  }

  try {
    const fs = await import('fs/promises')
    const path = await import('path')
    const { fileURLToPath } = await import('url')
    const { dirname } = await import('path')

    const __filename = fileURLToPath(import.meta.url)
    const __dirname = dirname(__filename)
    const envPath = path.join(__dirname, '../.env')

    // Read current .env
    let envContent = ''
    try {
      envContent = await fs.readFile(envPath, 'utf8')
    } catch (err) {
      if (err.code !== 'ENOENT') throw err
    }

    // Parse existing env variables
    const lines = envContent.split('\n').filter(line => line.trim())
    const envMap = new Map()

    for (const line of lines) {
      if (line.includes('=')) {
        const [key, ...valueParts] = line.split('=')
        envMap.set(key.trim(), valueParts.join('='))
      }
    }

    // Update with new values
    envMap.set('LLM_PROVIDER', provider.trim())

    if (gemini_api_key?.trim()) {
      envMap.set('GEMINI_API_KEY', gemini_api_key.trim())
    }
    if (claude_api_key?.trim()) {
      envMap.set('CLAUDE_API_KEY', claude_api_key.trim())
    }
    if (openrouter_api_key?.trim()) {
      envMap.set('OPENROUTER_API_KEY', openrouter_api_key.trim())
    }

    // Write back to .env
    const newEnvContent = Array.from(envMap.entries())
      .map(([key, value]) => `${key}=${value}`)
      .join('\n') + '\n'

    await fs.writeFile(envPath, newEnvContent, 'utf8')

    // Update process.env
    process.env.LLM_PROVIDER = provider.trim()
    if (gemini_api_key?.trim()) process.env.GEMINI_API_KEY = gemini_api_key.trim()
    if (claude_api_key?.trim()) process.env.CLAUDE_API_KEY = claude_api_key.trim()
    if (openrouter_api_key?.trim()) process.env.OPENROUTER_API_KEY = openrouter_api_key.trim()

    // Re-initialize LLM provider
    const archieModule = await import('../routes/archie.js')
    if (archieModule.reinitializeLLMProvider) {
      await archieModule.reinitializeLLMProvider()
    }

    // Redirect with success
    res.redirect('/admin/documents?settingsUpdated=1')
  } catch (err) {
    console.error('Error updating settings:', err)
    res.status(500).send(`Error updating settings: ${err.message}`)
  }
})

// GET /documents
router.get('/documents', requireAdmin, async (req, res) => {
  const docs = await listDocuments()
  const settingsUpdated = req.query.settingsUpdated === '1'
  res.send(dashboardPage(docs, [...indexingFiles], settingsUpdated))
})

// POST /upload-chunk — receives one 256 KB slice; reassembles and indexes when all arrive
router.post('/upload-chunk', requireAdmin, (req, res, next) => {
  chunkUpload.single('chunk')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message })
    next()
  })
}, (req, res) => {
  const { uploadId, chunkIndex, totalChunks, filename } = req.body
  const chunk = req.file

  if (!chunk) return res.status(400).json({ error: 'No chunk received.' })
  if (!uploadId || chunkIndex == null || !totalChunks || !filename) {
    return res.status(400).json({ error: 'Missing upload metadata.' })
  }

  const extOk = /\.(txt|md|pdf)$/i.test(filename)
  if (!extOk) return res.status(400).json({ error: 'Only .txt, .md, and .pdf files are allowed.' })

  const idx = parseInt(chunkIndex, 10)
  const total = parseInt(totalChunks, 10)

  if (!pendingUploads.has(uploadId)) {
    pendingUploads.set(uploadId, {
      filename,
      total,
      chunks: new Array(total).fill(null),
      startedAt: Date.now()
    })
  }

  const upload = pendingUploads.get(uploadId)
  upload.chunks[idx] = chunk.buffer

  const received = upload.chunks.filter(Boolean).length

  if (received < total) {
    return res.json({ status: 'partial', received, total })
  }

  // All chunks received — assemble and kick off background processing
  const completeBuffer = Buffer.concat(upload.chunks)
  pendingUploads.delete(uploadId)

  indexingFiles.add(filename)
  res.json({ status: 'indexing' })

  ;(async () => {
    try {
      let text
      if (filename.endsWith('.pdf')) {
        text = await extractPdfText(completeBuffer)
      } else {
        text = completeBuffer.toString('utf8')
      }

      if (!text.trim()) {
        console.error(`Admin upload: "${filename}" appears to be empty or unreadable.`)
        return
      }

      const textChunks = chunkText(text)
      const ragChunks = textChunks.map((c, i) => ({
        id: `${filename}-${i}-${crypto.randomUUID()}`,
        source: filename,
        title: filename,
        chunk_text: c
      }))

      await addChunks(ragChunks)
    } catch (err) {
      console.error('Background indexing error:', err)
    } finally {
      indexingFiles.delete(filename)
    }
  })()
})

// POST /documents/:source/delete
router.post('/documents/:source/delete', requireAdmin, async (req, res) => {
  const source = decodeURIComponent(req.params.source)
  await deleteBySource(source)
  res.redirect('/admin/documents')
})

export default router
