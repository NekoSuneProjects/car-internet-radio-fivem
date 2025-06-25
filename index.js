require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { Sequelize, DataTypes } = require('sequelize');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const axios = require('axios');
const path = require('path');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const crypto = require('crypto');
const app = express();
const port = process.env.PORT || 3000;

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
    must_change_password: {
        type: DataTypes.BOOLEAN,
        defaultValue: false
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
    }
}, {
    tableName: 'radio_stations',
    timestamps: false
});

// Initialize database and create default admin
async function initializeDatabase() {
    try {
        await sequelize.sync({ force: true }); // Create tables, drop if exist
        const adminCount = await User.count();
        if (adminCount === 0) {
            const tempPassword = crypto.randomBytes(8).toString('hex'); // Generate random 16-char password
            const hashedPassword = await bcrypt.hash(tempPassword, 12);
            await User.create({
                username: 'admin',
                password: hashedPassword,
                must_change_password: true,
                enabled: true
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

// Security middleware
app.use(helmet()); // Add security headers
app.use(cors({ origin: 'http://localhost:3000', credentials: true }));
app.use(express.json());
app.use('/admin', express.static(path.join(__dirname, 'admin')));

// Rate limiter for login attempts
const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 5, // Limit to 5 requests per window
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
        req.user = decoded;
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
                await user.update({ lockout_until: new Date(Date.now() + 15 * 60 * 1000) }); // Lock for 15 minutes
            }
            return res.status(401).json({ error: 'Invalid credentials' });
        }
        await user.update({ failed_attempts: 0, lockout_until: null });
        const token = jwt.sign({ username, mustChangePassword: user.must_change_password }, JWT_SECRET, { expiresIn: '7d' });
        res.json({ token, mustChangePassword: user.must_change_password });
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

// Get all radio stations (only enabled for clients)
app.get('/radios', async (req, res) => {
    try {
        const radios = await RadioStation.findAll({
            where: { enabled: true },
            attributes: ['name', ['stream_url', 'url'], ['now_playing_api', 'api']]
        });
        res.json(radios);
    } catch (error) {
        console.error('Error fetching radio stations:', error);
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

// Admin: Get all radio stations
app.get('/admin/radios', authenticateJWT, async (req, res) => {
    try {
        const radios = await RadioStation.findAll({
            attributes: ['id', 'name', 'stream_url', 'now_playing_api', 'enabled']
        });
        res.json(radios);
    } catch (error) {
        console.error('Error fetching admin radio stations:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Admin: Add radio station
app.post('/admin/radios', authenticateJWT, async (req, res) => {
    const { name, stream_url, now_playing_api, enabled } = req.body;
    try {
        const radio = await RadioStation.create({
            name,
            stream_url,
            now_playing_api: now_playing_api || null,
            enabled: enabled !== undefined ? enabled : true
        });
        res.status(201).json(radio);
    } catch (error) {
        console.error('Error adding radio station:', error);
        res.status(400).json({ error: 'Invalid data or duplicate stream URL' });
    }
});

// Admin: Update radio station
app.put('/admin/radios/:id', authenticateJWT, async (req, res) => {
    const { id } = req.params;
    const { name, stream_url, now_playing_api, enabled } = req.body;
    try {
        const radio = await RadioStation.findByPk(id);
        if (!radio) {
            return res.status(404).json({ error: 'Radio not found' });
        }
        await radio.update({
            name,
            stream_url,
            now_playing_api: now_playing_api || null,
            enabled
        });
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
        await radio.destroy();
        res.status(204).send();
    } catch (error) {
        console.error('Error deleting radio station:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Admin: Get all users
app.get('/admin/users', authenticateJWT, async (req, res) => {
    try {
        const users = await User.findAll({
            attributes: ['id', 'username', 'enabled', 'must_change_password']
        });
        res.json(users);
    } catch (error) {
        console.error('Error fetching users:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Admin: Add user
app.post('/admin/users', authenticateJWT, async (req, res) => {
    const { username, password, enabled } = req.body;
    if (password.length < 8) {
        return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }
    try {
        const hashedPassword = await bcrypt.hash(password, 12);
        const user = await User.create({
            username,
            password: hashedPassword,
            must_change_password: true,
            enabled: enabled !== undefined ? enabled : true
        });
        res.status(201).json(user);
    } catch (error) {
        console.error('Error adding user:', error);
        res.status(400).json({ error: 'Invalid data or duplicate username' });
    }
});

// Admin: Update user
app.put('/admin/users/:id', authenticateJWT, async (req, res) => {
    const { id } = req.params;
    const { username, password, enabled, must_change_password } = req.body;
    try {
        const user = await User.findByPk(id);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }
        if (user.username === 'admin' && req.user.username !== 'admin') {
            return res.status(403).json({ error: 'Cannot modify default admin' });
        }
        const updates = { username, enabled, must_change_password };
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