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

dotenv.config({ path: './.env'});

// Connect to database
connectDB();  

const app = express();

// Register partials
hbs.registerPartials(__dirname + '/views/partials');

// Register Helpers
hbs.registerHelper('split', function(string) {
    return string.split(',');
});

hbs.registerHelper('getEmoji', function(type) {
    const emojis = {
        'Eat': '🍽️', 'Snack': '🍿', 'Groceries': '🛒', 'Laundry': '🧺',
        'Bensin': '⛽', 'Flazz': '💳', 'Home Appliance': '🏠', 'Jumat Berkah': '🤲',
        'Uang Sampah': '🗑️', 'Uang Keamanan': '👮', 'Medicine': '💊', 'Others': '📦'
    };
    return emojis[type] || '📝';
});

hbs.registerHelper('getPocketEmoji', function(pocket) {
    const emojis = {
        'Kwintals': '💰', 'Groceries': '🥦', 'Weekday Transport': '🚌',
        'Weekend Transport': '🚗', 'Investasi': '📈', 'Dana Darurat': '🆘', 'IPL': '🏘️'
    };
    return emojis[pocket] || '👛';
});

hbs.registerHelper('eq', function(a, b) {
    return a === b;
});

app.use(express.static('public'));
app.use(express.urlencoded({extended: false}));
app.use(express.json());

// Trust proxy (required for Render/Heroku secure cookies)
app.set('trust proxy', 1);

app.use(session({
    secret: process.env.SESSION_SECRET || 'moneyjournal-secret-key',
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({
        mongoUrl: process.env.MONGODB_URI || 'mongodb://localhost:27017/moneyjournal',
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
app.listen(PORT, () => {
    console.log(`Server started on port ${PORT}`);
});