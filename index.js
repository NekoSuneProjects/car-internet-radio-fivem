require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { Sequelize, DataTypes } = require('sequelize');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const axios = require('axios');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const app = express();
const port = process.env.PORT || 3415;

// Enable trust proxy to handle X-Forwarded-For header
app.set('trust proxy', 1);

// Ensure .env file exists and generate JWT_SECRET if not set
const envFilePath = path.join(__dirname, '.env');
let JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
    JWT_SECRET = crypto.randomBytes(32).toString('hex');
    const envContent = fs.existsSync(envFilePath) ? fs.readFileSync(envFilePath, 'utf8') : '';
    const updatedEnvContent = envContent.includes('JWT_SECRET')
        ? envContent.replace(/JWT_SECRET=.*/g, `JWT_SECRET=${JWT_SECRET}`)
        : `${envContent}\nJWT_SECRET=${JWT_SECRET}\n`;
    fs.writeFileSync(envFilePath, updatedEnvContent.trim() + '\n', 'utf8');
    console.log(`Generated new JWT_SECRET and saved to ${envFilePath}`);
}

// PostgreSQL connection configuration
const sequelize = new Sequelize(process.env.DATABASE_URL, {
    dialect: 'postgres',
    logging: false
});

// Define User model
const User = sequelize.define('User', {
    username: {
        type: DataTypes.STRING,
        allowNull: false,
        unique: true,
        validate: { len: [3, 50] }
    },
    password: {
        type: DataTypes.STRING,
        allowNull: false,
        validate: { len: [8, 100] }
    },
    role: {
        type: DataTypes.ENUM('admin', 'user'),
        allowNull: false,
        defaultValue: 'user'
    },
    must_change_password: {
        type: DataTypes.BOOLEAN,
        defaultValue: true
    },
    enabled: {
        type: DataTypes.BOOLEAN,
        defaultValue: true
    },
    failed_attempts: {
        type: DataTypes.INTEGER,
        defaultValue: 0
    },
    lockout_until: {
        type: DataTypes.DATE
    },
    global_radios_enabled: {
        type: DataTypes.BOOLEAN,
        defaultValue: true
    }
}, {
    tableName: 'users',
    timestamps: false
});

// Define RadioStation model
const RadioStation = sequelize.define('RadioStation', {
    name: {
        type: DataTypes.STRING,
        allowNull: false,
        validate: { len: [1, 255] }
    },
    stream_url: {
        type: DataTypes.STRING,
        allowNull: false,
        unique: true,
        validate: { isUrl: true }
    },
    now_playing_api: {
        type: DataTypes.STRING,
        allowNull: true,
        validate: { isUrl: true, notEmpty: false }
    },
    enabled: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true
    },
    user_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: {
            model: User,
            key: 'id'
        }
    },
    is_global: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false
    }
}, {
    tableName: 'radio_stations',
    timestamps: false
});

// Define relationships
User.hasMany(RadioStation, { foreignKey: 'user_id' });
RadioStation.belongsTo(User, { foreignKey: 'user_id' });

// Initialize database and create default admin if it doesn't exist
async function initializeDatabase() {
    try {
        await sequelize.sync();
        const adminUser = await User.findOne({ where: { username: 'admin' } });
        if (!adminUser) {
            const tempPassword = crypto.randomBytes(8).toString('hex');
            const hashedPassword = await bcrypt.hash(tempPassword, 12);
            await User.create({
                username: 'admin',
                password: hashedPassword,
                role: 'admin',
                must_change_password: true,
                enabled: true,
                global_radios_enabled: true
            });
            console.log(`Default admin account created:
                Username: admin
                Temporary Password: ${tempPassword}
                Please log in at http://localhost:${port}/admin and change the password immediately.`);
        }
    } catch (error) {
        console.error('Error initializing database:', error);
        process.exit(1);
    }
}

// Security middleware with custom CSP
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'", 'https://cdn.jsdelivr.net'],
            scriptSrc: [
                "'self'",
                "'unsafe-inline'",
                'https://cdn.jsdelivr.net/npm/react@17.0.2',
                'https://cdn.jsdelivr.net/npm/react-dom@17.0.2',
                'https://cdn.jsdelivr.net/npm/axios@1.4.0',
                'https://cdn.jsdelivr.net/npm/@babel/standalone@7.25.7'
            ],
            imgSrc: ["'self'", 'data:'],
            connectSrc: ["'self'", `http://localhost:${port}`, 'https://cdn.jsdelivr.net'],
            fontSrc: ["'self'", 'https://cdn.jsdelivr.net'],
            objectSrc: ["'none'"],
            upgradeInsecureRequests: []
        }
    }
}));
app.use(cors({ origin: `http://localhost:${port}`, credentials: true }));
app.use(express.json());

// Serve admin panel files, except index.html
app.use('/admin', express.static(path.join(__dirname, 'admin'), {
    setHeaders: (res, filePath) => {
        if (filePath.endsWith('.js')) {
            res.set('Cache-Control', 'no-store');
        }
    }
}));

// Serve favicon
app.get('/favicon.ico', (req, res) => {
    const faviconPath = path.join(__dirname, 'favicon.ico');
    if (fs.existsSync(faviconPath)) {
        res.sendFile(faviconPath);
    } else {
        res.status(204).end();
    }
});

// Serve admin index.html with dynamic timestamp
app.get('/admin', (req, res) => {
    const indexPath = path.join(__dirname, 'admin', 'index.html');
    const timestamp = Math.floor(Date.now() / 1000);
    fs.readFile(indexPath, 'utf8', (err, data) => {
        if (err) {
            console.error('Error reading index.html:', err);
            return res.status(500).send('Internal server error');
        }
        const updatedHtml = data.replace(
            '<script type="text/babel" src="script.js?v1"></script>',
            `<script type="text/babel" src="script.js?v=${timestamp}"></script>`
        );
        res.set('Content-Type', 'text/html');
        res.set('Cache-Control', 'no-store');
        res.send(updatedHtml);
    });
});

// Rate limiter for login attempts
const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 5,
    message: 'Too many login attempts, please try again later.'
});

// Middleware to verify JWT
const authenticateJWT = async (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ error: 'Token required' });

    const token = authHeader.split(' ')[1];
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        const user = await User.findOne({ where: { username: decoded.username } });
        if (!user || !user.enabled || (user.lockout_until && user.lockout_until > new Date())) {
            return res.status(403).json({ error: 'Access denied' });
        }
        req.user = { ...decoded, id: user.id, role: user.role, global_radios_enabled: user.global_radios_enabled };
        next();
    } catch (error) {
        res.status(403).json({ error: 'Invalid token' });
    }
};

// Admin login
app.post('/admin/login', loginLimiter, async (req, res) => {
    const { username, password } = req.body;
    try {
        const user = await User.findOne({ where: { username } });
        if (!user) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }
        if (user.lockout_until && user.lockout_until > new Date()) {
            return res.status(403).json({ error: 'Account locked, try again later' });
        }
        if (!user.enabled) {
            return res.status(403).json({ error: 'User disabled' });
        }
        if (!await bcrypt.compare(password, user.password)) {
            await user.increment('failed_attempts');
            if (user.failed_attempts >= 4) {
                await user.update({ lockout_until: new Date(Date.now() + 15 * 60 * 1000) });
            }
            return res.status(401).json({ error: 'Invalid credentials' });
        }
        await user.update({ failed_attempts: 0, lockout_until: null });
        const token = jwt.sign({
            username,
            mustChangePassword: user.must_change_password,
            role: user.role,
            id: user.id
        }, JWT_SECRET, { expiresIn: '7d' });
        res.json({ token, mustChangePassword: user.must_change_password, role: user.role });
    } catch (error) {
        console.error('Error logging in:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Change password
app.post('/admin/change-password', authenticateJWT, async (req, res) => {
    const { newPassword } = req.body;
    if (newPassword.length < 8) {
        return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }
    try {
        const user = await User.findOne({ where: { username: req.user.username } });
        if (!user) return res.status(404).json({ error: 'User not found' });
        const hashedPassword = await bcrypt.hash(newPassword, 12);
        await user.update({ password: hashedPassword, must_change_password: false });
        res.json({ message: 'Password changed successfully' });
    } catch (error) {
        console.error('Error changing password:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Update user settings (toggle global radios)
app.patch('/admin/settings', authenticateJWT, async (req, res) => {
    const { global_radios_enabled } = req.body;
    if (typeof global_radios_enabled !== 'boolean') {
        return res.status(400).json({ error: 'Invalid global_radios_enabled value' });
    }
    try {
        const user = await User.findByPk(req.user.id);
        if (!user) return res.status(404).json({ error: 'User not found' });
        await user.update({ global_radios_enabled });
        res.json({ message: 'Settings updated successfully', global_radios_enabled });
    } catch (error) {
        console.error('Error updating settings:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Get user settings
app.get('/admin/settings', authenticateJWT, async (req, res) => {
    try {
        const user = await User.findByPk(req.user.id);
        if (!user) return res.status(404).json({ error: 'User not found' });
        res.json({ global_radios_enabled: user.global_radios_enabled });
    } catch (error) {
        console.error('Error fetching settings:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Get all radio stations (global + user-specific if authenticated)
app.get('/radios', authenticateJWT, async (req, res) => {
    try {
        const whereClause = req.user.global_radios_enabled
            ? { enabled: true }
            : { enabled: true, user_id: req.user.id, is_global: false };
        const radios = await RadioStation.findAll({
            where: whereClause,
            attributes: ['name', ['stream_url', 'url'], ['now_playing_api', 'api'], 'user_id', 'is_global'],
            include: [{ model: User, attributes: ['username'], as: 'User' }]
        });
        res.json(radios.map(radio => ({
            name: radio.name,
            url: radio.url,
            api: radio.api,
            owner: radio.is_global ? 'Global' : (radio.user_id ? radio.User?.username : 'Unknown')
        })));
    } catch (error) {
        console.error('Error fetching radio stations:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Get radio stations for a specific user (public endpoint)
app.get('/radio/:username', async (req, res) => {
    const { username } = req.params;
    try {
        const user = await User.findOne({ where: { username, enabled: true } });
        if (!user) return res.status(404).json({ error: 'User not found or disabled' });
        const whereClause = user.global_radios_enabled
            ? { enabled: true }
            : { enabled: true, user_id: user.id, is_global: false };
        const radios = await RadioStation.findAll({
            where: whereClause,
            attributes: ['name', ['stream_url', 'url'], ['now_playing_api', 'api'], 'user_id', 'is_global'],
            include: [{ model: User, attributes: ['username'], as: 'User' }]
        });

        res.json(radios.map(radio => ({
            name: radio.name,
            url: radio.url,
            song: "Coming SOON!",
            owner: radio.is_global ? 'Global' : (radio.user_id ? radio.User?.username : 'Unknown')
        })));
    } catch (error) {
        console.error('Error fetching user radio stations:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Get song data for a specific radio URL
app.get('/radio', async (req, res) => {
    const url = req.query.url;
    try {
        const radio = await RadioStation.findOne({
            where: { stream_url: url, enabled: true },
            attributes: ['name', ['now_playing_api', 'api']]
        });
        if (!radio) {
            return res.status(404).json({ error: 'Radio not found or disabled' });
        }
        if (radio.api) {
            try {
                const response = await axios.get(radio.api);
                const song = response.data.song || 'Unknown Song';
                res.json({ song });
            } catch (apiError) {
                console.error(`Error fetching now playing from ${radio.api}:`, apiError.message);
                res.json({ song: `Now Playing on ${radio.name}` });
            }
        } else {
            res.json({ song: `Now Playing on ${radio.name}` });
        }
    } catch (error) {
        console.error('Error fetching song data:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Admin: Get all radio stations (filtered by user role)
app.get('/admin/radios', authenticateJWT, async (req, res) => {
    try {
        const whereClause = req.user.role === 'admin'
            ? {}
            : { user_id: req.user.id, is_global: false };
        const radios = await RadioStation.findAll({
            where: whereClause,
            attributes: ['id', 'name', 'stream_url', 'now_playing_api', 'enabled', 'user_id', 'is_global'],
            include: [{ model: User, attributes: ['username'], as: 'User' }]
        });
        res.json(radios.map(radio => ({
            id: radio.id,
            name: radio.name,
            stream_url: radio.stream_url,
            now_playing_api: radio.now_playing_api,
            enabled: radio.enabled,
            owner: radio.is_global ? 'Global' : (radio.user_id ? radio.User?.username : 'Unknown'),
            is_global: radio.is_global
        })));
    } catch (error) {
        console.error('Error fetching admin radio stations:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Admin: Add radio station
app.post('/admin/radios', authenticateJWT, async (req, res) => {
    const { name, stream_url, now_playing_api, enabled, is_global } = req.body;
    try {
        const radioData = {
            name,
            stream_url,
            now_playing_api: now_playing_api || null,
            enabled: enabled !== undefined ? enabled : true,
            is_global: req.user.role === 'admin' ? is_global : false
        };
        if (!radioData.is_global) {
            radioData.user_id = req.user.id;
        }
        const radio = await RadioStation.create(radioData);
        res.status(201).json(radio);
    } catch (error) {
        console.error('Error adding radio station:', error);
        res.status(400).json({ error: 'Invalid data or duplicate stream URL' });
    }
});

// Admin: Update radio station
app.put('/admin/radios/:id', authenticateJWT, async (req, res) => {
    const { id } = req.params;
    const { name, stream_url, now_playing_api, enabled, is_global } = req.body;
    try {
        const radio = await RadioStation.findByPk(id);
        if (!radio) {
            return res.status(404).json({ error: 'Radio not found' });
        }
        if (req.user.role === 'user' && (radio.user_id !== req.user.id || radio.is_global)) {
            return res.status(403).json({ error: 'Unauthorized to edit this radio' });
        }
        const radioData = {
            name,
            stream_url,
            now_playing_api: now_playing_api || null,
            enabled
        };
        if (req.user.role === 'admin') {
            radioData.is_global = is_global;
            radioData.user_id = is_global ? null : radio.user_id || req.user.id;
        }
        await radio.update(radioData);
        res.json(radio);
    } catch (error) {
        console.error('Error updating radio station:', error);
        res.status(400).json({ error: 'Invalid data or duplicate stream URL' });
    }
});

// Admin: Delete radio station
app.delete('/admin/radios/:id', authenticateJWT, async (req, res) => {
    const { id } = req.params;
    try {
        const radio = await RadioStation.findByPk(id);
        if (!radio) {
            return res.status(404).json({ error: 'Radio not found' });
        }
        if (req.user.role === 'user' && (radio.user_id !== req.user.id || radio.is_global)) {
            return res.status(403).json({ error: 'Unauthorized to delete this radio' });
        }
        await radio.destroy();
        res.status(204).send();
    } catch (error) {
        console.error('Error deleting radio station:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Admin: Get all users
app.get('/admin/users', authenticateJWT, async (req, res) => {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Admin access required' });
    }
    try {
        const users = await User.findAll({
            attributes: ['id', 'username', 'enabled', 'must_change_password', 'role', 'global_radios_enabled']
        });
        res.json(users);
    } catch (error) {
        console.error('Error fetching users:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Admin: Add user
app.post('/admin/users', authenticateJWT, async (req, res) => {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Admin access required' });
    }
    const { username, password, enabled, role } = req.body;
    if (password.length < 8) {
        return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }
    if (!['admin', 'user'].includes(role)) {
        return res.status(400).json({ error: 'Invalid role' });
    }
    try {
        const hashedPassword = await bcrypt.hash(password, 12);
        const user = await User.create({
            username,
            password: hashedPassword,
            must_change_password: true,
            enabled: enabled !== undefined ? enabled : true,
            role,
            global_radios_enabled: true
        });
        res.status(201).json(user);
    } catch (error) {
        console.error('Error adding user:', error);
        res.status(400).json({ error: 'Invalid data or duplicate username' });
    }
});

// Admin: Update user
app.put('/admin/users/:id', authenticateJWT, async (req, res) => {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Admin access required' });
    }
    const { id } = req.params;
    const { username, password, enabled, must_change_password, role, global_radios_enabled } = req.body;
    if (!['admin', 'user'].includes(role)) {
        return res.status(400).json({ error: 'Invalid role' });
    }
    try {
        const user = await User.findByPk(id);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }
        if (user.username === 'admin' && req.user.username !== 'admin') {
            return res.status(403).json({ error: 'Cannot modify default admin' });
        }
        const updates = { username, enabled, must_change_password, role, global_radios_enabled };
        if (password) {
            if (password.length < 8) {
                return res.status(400).json({ error: 'Password must be at least 8 characters' });
            }
            updates.password = await bcrypt.hash(password, 12);
        }
        await user.update(updates);
        res.json(user);
    } catch (error) {
        console.error('Error updating user:', error);
        res.status(400).json({ error: 'Invalid data or duplicate username' });
    }
});

// Admin: Delete user
app.delete('/admin/users/:id', authenticateJWT, async (req, res) => {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Admin access required' });
    }
    const { id } = req.params;
    try {
        const user = await User.findByPk(id);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }
        if (user.username === 'admin') {
            return res.status(403).json({ error: 'Cannot delete default admin' });
        }
        await user.destroy();
        res.status(204).send();
    } catch (error) {
        console.error('Error deleting user:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Start server after database initialization
initializeDatabase().then(() => {
    app.listen(port, () => {
        console.log(`API running on http://localhost:${port}`);
    });
});