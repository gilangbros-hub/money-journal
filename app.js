const express = require('express');
const hbs = require('hbs');
const dotenv = require('dotenv');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const path = require('path');
const connectDB = require('./database');
const { authLimiter } = require('./middleware/auth');
const { createConfiguration } = require('./config');
const { errorHandler, requestIdMiddleware } = require('./middleware/errorHandler');
const { RecordNotFoundError } = require('./utils/domainErrors');

// Load environment values before validating startup configuration.
dotenv.config({ path: './.env' });

// Configuration is validated before connecting to MongoDB or starting a listener.
const configuration = createConfiguration();

// Routes
const authRoutes = require('./routes/auth');
const transactionRoutes = require('./routes/transactions');
const budgetRoutes = require('./routes/budget');
const pocketRoutes = require('./routes/pockets');
const expenseTypeRoutes = require('./routes/expenseTypes');
const telegramRoutes = require('./routes/telegram');

const { TRANSACTION_TYPES } = require('./utils/constants');

function registerViewHelpers() {
    // Register partials
    hbs.registerPartials(path.join(__dirname, 'views/partials'));

    // Register Helpers
    hbs.registerHelper('split', function (string) {
        return string.split(',').map(item => item.trim().replace(/\s+/g, ' '));
    });

    hbs.registerHelper('getEmoji', function (type) {
        return TRANSACTION_TYPES[type] || '📝';
    });

    hbs.registerHelper('eq', function (a, b) {
        return a === b;
    });
}

/**
 * Build the Express application with validated startup configuration.
 * Keeping this as a factory makes configuration an explicit dependency while
 * the default export below preserves the existing `require('./app')` contract.
 */
function createApp(config = createConfiguration()) {
    const app = express();

    // Correlate every response, including authentication and not-found errors.
    app.use(requestIdMiddleware);

    // Make validated configuration available to routes/controllers without
    // requiring them to read process.env directly.
    app.locals.configuration = config;
    app.locals.householdTimeZone = config.householdTimeZone;
    app.locals.featureFlags = config.featureFlags;

    // View Engine Setup
    app.set('views', path.join(__dirname, 'views'));
    app.set('view engine', 'hbs');
    registerViewHelpers();

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
    app.use(pocketRoutes);
    app.use(expenseTypeRoutes);
    app.use(telegramRoutes);

    // 404 handler
    app.use((req, res, next) => {
        if (req.path.startsWith('/api/') || req.xhr) {
            return next(new RecordNotFoundError('route'));
        }
        res.status(404).render('login', { error: 'Page not found' });
    });

    // Common API error adapter. It serializes only typed, safe fields.
    app.use(errorHandler);

    return app;
}

// Connect to database (preserves the existing startup behavior).
connectDB();

const app = createApp(configuration);
const PORT = process.env.PORT || 5000;

// Only start the server if running directly (not required/imported)
if (require.main === module) {
    app.listen(PORT, () => {
        console.log(`Server started on port ${PORT}`);
    });
}

// Preserve the existing Express-app export and expose explicit DI hooks.
module.exports = app;
module.exports.createApp = createApp;
module.exports.configuration = configuration;
