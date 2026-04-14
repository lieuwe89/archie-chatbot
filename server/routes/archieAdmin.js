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
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const extOk = /\.(txt|md|pdf)$/i.test(file.originalname)
    if (extOk) cb(null, true)
    else cb(new Error('Only .txt, .md, and .pdf files are allowed'))
  }
})

// Track files currently being indexed (in-memory; resets on restart)
const indexingFiles = new Set()

function requireAdmin(req, res, next) {
  if (req.session?.archieAdmin) return next()
  res.redirect('/archie/admin')
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
    <form method="POST" action="/archie/admin/login">
      <input type="password" name="password" placeholder="Admin password" autofocus>
      <button type="submit">Log in</button>
    </form>
  </div>
</body>
</html>`
}

function dashboardPage(docs, pendingFiles = []) {
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
          <form method="POST" action="/archie/admin/documents/${encodeURIComponent(doc.source)}/delete" style="display:inline">
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
    .upload-section { display: flex; gap: 0.5rem; margin-bottom: 2rem; }
    input[type=file] { flex: 1; border: 1px solid #ddd; border-radius: 4px; padding: 0.4rem; }
    button.primary { background: #d97706; color: white; border: none; padding: 0.5rem 1rem; border-radius: 4px; cursor: pointer; }
    button.primary:disabled { background: #f59e0b; cursor: not-allowed; }
    table { width: 100%; border-collapse: collapse; }
    th { text-align: left; border-bottom: 2px solid #eee; padding: 0.5rem 0; font-size: 0.875rem; color: #666; }
  </style>
</head>
<body>
  <div class="card">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.25rem">
      <h1>Archie Admin — Knowledge Base</h1>
      <form method="POST" action="/archie/admin/logout" style="display:inline">
        <button type="submit" style="background:none;border:none;color:#666;cursor:pointer;font-size:0.875rem">Log out</button>
      </form>
    </div>
    <p class="subtitle">Upload documents to expand Archie's knowledge. Accepts .txt, .md, .pdf (max 10 MB)</p>
    <form id="upload-form" method="POST" action="/archie/admin/documents" enctype="multipart/form-data" class="upload-section">
      <input type="file" name="file" accept=".txt,.md,.pdf" required>
      <button type="submit" class="primary" id="upload-btn">Upload</button>
    </form>
    <table>
      <thead><tr><th>Document</th><th></th></tr></thead>
      <tbody>${pendingRows}${docRows}</tbody>
    </table>
  </div>
  <script>
    document.getElementById('upload-form').addEventListener('submit', function() {
      document.getElementById('upload-btn').disabled = true
      document.getElementById('upload-btn').textContent = 'Uploading…'
    })
  </script>
</body>
</html>`
}

// GET / — login form or redirect
router.get('/', (req, res) => {
  if (req.session?.archieAdmin) return res.redirect('/archie/admin/documents')
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
    res.redirect('/archie/admin/documents')
  } else {
    res.send(loginPage('Incorrect password.'))
  }
})

// POST /logout
router.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/archie/admin'))
})

// GET /documents
router.get('/documents', requireAdmin, async (req, res) => {
  const docs = await listDocuments()
  res.send(dashboardPage(docs, [...indexingFiles]))
})

// POST /documents — upload, then extract/chunk/embed entirely in background
router.post('/documents', requireAdmin, (req, res, next) => {
  upload.single('file')(req, res, (err) => {
    if (err) return res.status(400).send(escapeHtml(err.message))
    next()
  })
}, (req, res) => {
  if (!req.file) return res.status(400).send('No file uploaded.')

  const filename = req.file.originalname
  const buffer = req.file.buffer

  // Respond immediately — all processing happens in background
  indexingFiles.add(filename)
  res.redirect('/archie/admin/documents')

  // Extract, chunk, and embed in background (PDF parsing can be slow)
  ;(async () => {
    try {
      let text
      if (filename.endsWith('.pdf')) {
        text = await extractPdfText(buffer)
      } else {
        text = buffer.toString('utf8')
      }

      if (!text.trim()) {
        console.error(`Admin upload: "${filename}" appears to be empty or unreadable.`)
        return
      }

      const textChunks = chunkText(text)
      const chunks = textChunks.map((chunk, i) => ({
        id: `${filename}-${i}-${crypto.randomUUID()}`,
        source: filename,
        title: filename,
        chunk_text: chunk
      }))

      await addChunks(chunks)
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
  res.redirect('/archie/admin/documents')
})

export default router
