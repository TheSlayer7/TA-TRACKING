const express = require('express');
const cors = require('cors');
require('dotenv').config();

const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const morgan = require('morgan');
const authRoutes = require('./routes/auth');
const claimsRoutes = require('./routes/claims');
const rbacRoutes = require('./routes/rbac');

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors()); // Allows your vanilla JS frontend to communicate with this backend
app.use(express.json()); // Allows the server to accept and read JSON data

// Basic security headers
app.use(helmet());

// Logging
app.use(morgan('combined'));

// Rate limiter for auth endpoints
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  standardHeaders: true,
  legacyHeaders: false,
});

// Standard response helper (register before routes)
app.use((req, res, next) => {
    res.success = (data) => {
        if (data && typeof data === 'object' && !Array.isArray(data)) {
            return res.json(Object.assign({ success: true }, data));
        }

        return res.json({ success: true, data });
    };

    res.error = (message, status = 500) => res.status(status).json({ success: false, error: message });
    next();
});

// A simple Health Check Route to test the server
app.get('/api/health', (req, res) => {
    res.status(200).json({ 
        status: 'OK', 
        message: 'TA Calculator API is running smoothly.' 
    });
});

// Auth routes issue and validate JWTs
app.use('/api/auth', authLimiter, authRoutes);

// Mount API routes
app.use('/api/claims', claimsRoutes);
app.use('/api/rbac', rbacRoutes);

// Generic error handler (last middleware)
app.use((err, req, res, next) => {
    console.error('Unhandled error:', err);
    if (res.headersSent) return next(err);
    res.status(500).json({ success: false, error: 'Internal server error' });
});

// Start the server with port-fallback if the desired port is in use
const startServer = async () => {
    const startPort = Number(process.env.PORT) || 5000;
    const maxAttempts = 10; // try up to startPort..startPort+9
    let port = startPort;

    for (let i = 0; i < maxAttempts; i++) {
        try {
            await new Promise((resolve, reject) => {
                const server = app.listen(port, () => {
                    console.log(`🚀 Server is running on http://localhost:${port}`);
                    resolve(server);
                });

                server.on('error', (err) => {
                    reject(err);
                });
            });
            return; // started successfully
        } catch (err) {
            if (err && err.code === 'EADDRINUSE') {
                console.warn(`Port ${port} is in use, trying ${port + 1}...`);
                port += 1;
                continue;
            }

            console.error('Failed to start server:', err);
            process.exit(1);
        }
    }

    console.error(`Unable to bind server to a free port in range ${startPort}-${port}`);
    process.exit(1);
};

startServer();