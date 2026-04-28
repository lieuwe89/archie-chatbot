import * as dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// MUST load .env before importing any other modules that use process.env
try {
  dotenv.config({ path: path.join(__dirname, '../.env') });
} catch (e) {
  console.warn('Error loading .env file:', e.message);
}

import express from 'express';
import http from 'http';
import cors from 'cors';
import session from 'express-session';
import { initSessionStore } from './middleware/sessionStoreFactory.js';
import bcrypt from 'bcrypt';
// Delay imports that depend on process.env being set
let archieAdminRoutes, archieRoutes, authRoutes, initializeDatabase, userDb, db;

const app = express();
const server = http.createServer(app);

app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 4008;

// Initialize database and start server
async function startServer() {
  try {
    // Dynamic imports - now that dotenv.config() has run, process.env is populated
    const imports = await Promise.all([
      import('./routes/archieAdmin.js'),
      import('./routes/archie.js'),
      import('./routes/auth.js'),
      import('./database/db.js')
    ]);
    archieAdminRoutes = imports[0].default;
    archieRoutes = imports[1].default;
    authRoutes = imports[2].default;
    ({ initializeDatabase, userDb, db } = imports[3]);

    const sessionStore = await initSessionStore();
    app.use(session({
      store: sessionStore,
      secret: process.env.ARCHIE_SESSION_SECRET || 'archie-dev-secret',
      resave: false,
      saveUninitialized: false,
      cookie: { httpOnly: true, maxAge: 24 * 60 * 60 * 1000 }
    }));

    // Authentication routes (public)
    app.use('/api/auth', authRoutes);

    // Archie front-end API Routes
    app.use('/api/archie', archieRoutes);
    app.use('/archie/api/archie', archieRoutes);

    // Archie knowledge base admin panel
    app.use('/archie/admin', archieAdminRoutes);

    // Root redirect to /archie/
    app.get('/', (req, res) => res.redirect('/archie/'));

    // Static files
    app.use('/archie', express.static(path.join(__dirname, '../dist'), { redirect: true }));
    app.get('/archie*', (req, res, next) => {
      if (req.url.startsWith('/api')) return next();
      res.sendFile(path.join(__dirname, '../dist/index.html'));
    });

    // Serve React app for all other routes
    app.get('*', (req, res) => {
      res.sendFile(path.join(__dirname, '../dist/index.html'));
    });

    initializeDatabase();
    
    // Auto-create/update admin user logic
    if (process.env.ARCHIE_ADMIN_PASSWORD && process.env.ADMIN_USERNAME) {
      const hash = await bcrypt.hash(process.env.ARCHIE_ADMIN_PASSWORD, 10);
      const user = userDb.getUserByUsername(process.env.ADMIN_USERNAME);
      if (!user) {
        userDb.createUser(process.env.ADMIN_USERNAME, hash);
        console.log(`Admin user "${process.env.ADMIN_USERNAME}" created.`);
      } else {
        db.prepare('UPDATE archie_users SET password_hash = ? WHERE username = ?').run(hash, process.env.ADMIN_USERNAME);
        console.log(`Admin user "${process.env.ADMIN_USERNAME}" password updated.`);
      }
    }
    
    server.listen(PORT, '0.0.0.0', () => {
      console.log(`🚀 Archie Chatbot server running on port ${PORT}`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

startServer().catch(err => {
  console.error('Fatal error starting server:', err);
  process.exit(1);
});
