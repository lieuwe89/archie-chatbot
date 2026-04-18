import * as dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

try {
  dotenv.config({ path: path.join(__dirname, '../.env') });
} catch (e) {
  console.warn('Error loading .env file:', e.message);
}

import express from 'express';
import http from 'http';
import cors from 'cors';
import session from 'express-session';
import { SQLiteSessionStore } from './middleware/sessionStore.js';
import archieAdminRoutes from './routes/archieAdmin.js';
import archieRoutes from './routes/archie.js';
import authRoutes from './routes/auth.js';
import { initializeDatabase, userDb, db } from './database/db.js';
import bcrypt from 'bcrypt';

const app = express();
const server = http.createServer(app);

app.use(cors());
app.use(express.json());
app.use(session({
  store: new SQLiteSessionStore(),
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

const PORT = process.env.PORT || 4008;

// Initialize database and start server
async function startServer() {
  try {
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

startServer();
