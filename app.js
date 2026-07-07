const express = require('express');
const hbs = require('hbs');
const dotenv = require('dotenv');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const path = require('path');
const connectDB = require('./database');
const { authLimiter } = require('./middleware/auth');

// Routes
const authRoutes = require('./routes/auth');
const transactionRoutes = require('./routes/transactions');
const budgetRoutes = require('./routes/budget');

dotenv.config({ path: './.env' });

// Connect to database
connectDB();

const app = express();

// View Engine Setup
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'hbs');

// Register partials
hbs.registerPartials(path.join(__dirname, 'views/partials'));

// Register Helpers
hbs.registerHelper('split', function (string) {
    return string.split(',').map(item => item.trim().replace(/\s+/g, ' '));
});

const { TRANSACTION_TYPES, POCKETS } = require('./utils/constants');

hbs.registerHelper('getEmoji', function (type) {
    return TRANSACTION_TYPES[type] || '📝';
});

hbs.registerHelper('getPocketEmoji', function (pocket) {
    return POCKETS[pocket] || '👛';
});

hbs.registerHelper('eq', function (a, b) {
    return a === b;
});

// Middleware
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

// Trust proxy (required for Render/Heroku secure cookies)
app.set('trust proxy', 1);

// Apply rate limiting globally for auth endpoints
app.use('/auth', authLimiter);
app.use('/api/auth', authLimiter);

if (!process.env.SESSION_SECRET) {
    console.error('FATAL ERROR: SESSION_SECRET is not defined.');
    process.exit(1);
}

app.use(session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({
        mongoUrl: process.env.MONGODB_URI,
        ttl: 14 * 24 * 60 * 60 // 14 days
    }),
    cookie: {
        maxAge: 24 * 60 * 60 * 1000,
        secure: process.env.NODE_ENV === 'production'
    }
}));

// Root Route
app.get('/', (req, res) => {
    if (req.session.userId) {
        res.redirect('/monthly-story');
    } else {
        res.redirect('/login');
    }
});

// Use Routes
app.use(authRoutes);
app.use(transactionRoutes);
app.use(budgetRoutes);

// 404 handler
app.use((req, res) => {
    res.status(404).render('login', { error: 'Page not found' });
});

// Error handler
app.use((err, req, res, next) => {
    console.error('Error:', err.message);
    res.status(err.status || 500).json({ 
        success: false, 
        message: process.env.NODE_ENV === 'production' ? 'Internal server error' : err.message 
    });
});

const PORT = process.env.PORT || 5000;

// Only start the server if running directly (not required/imported)
if (require.main === module) {
    app.listen(PORT, () => {
        console.log(`Server started on port ${PORT}`);
    });
}

module.exports = app;
