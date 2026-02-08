const express = require('express');
const hbs = require('hbs');
const dotenv = require('dotenv');
const session = require('express-session');
let MongoStore = require('connect-mongo');
if (MongoStore.default) MongoStore = MongoStore.default;
const connectDB = require('./database');

// Routes
const authRoutes = require('./routes/auth');
const transactionRoutes = require('./routes/transactions');

dotenv.config({ path: './.env' });

// Connect to database
connectDB();

const app = express();

// Register partials
hbs.registerPartials(__dirname + '/views/partials');

// Register Helpers
hbs.registerHelper('split', function (string) {
    return string.split(',');
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

app.use(express.static('public'));
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

// Trust proxy (required for Render/Heroku secure cookies)
app.set('trust proxy', 1);

if (!process.env.SESSION_SECRET) {
    console.error('FATAL ERROR: SESSION_SECRET is not defined.');
    process.exit(1);
}

app.use(session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({
        mongoUrl: process.env.MONGODB_URI, // fallback handle in database.js or here? database.js handles connection, but store needs url too. 
        // Actually, MongoStore can reuse the existing connection if we pass the client, or we just pass the URL.
        // Let's rely on database.js to enforce the URL existence, but here we need it too.
        // Let's just use process.env.MONGODB_URI and assume it's checked elsewhere or fail here too.
        mongoUrl: process.env.MONGODB_URI,
        ttl: 14 * 24 * 60 * 60 // 14 days
    }),
    cookie: {
        maxAge: 24 * 60 * 60 * 1000,
        secure: process.env.NODE_ENV === 'production'
    }
}));

app.set('view engine', 'hbs');

// Root Route
app.get('/', (req, res) => {
    if (req.session.userId) {
        res.redirect('/transaction');
    } else {
        res.redirect('/login');
    }
});

// Use Routes
app.use(authRoutes);
app.use(transactionRoutes);

const PORT = process.env.PORT || 5000;

// Only start the server if running directly (not required/imported)
if (require.main === module) {
    app.listen(PORT, () => {
        console.log(`Server started on port ${PORT}`);
    });
}

module.exports = app;