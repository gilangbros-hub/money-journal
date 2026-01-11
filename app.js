const express = require('express');
const dotenv = require('dotenv');
const bcrypt = require('bcrypt');
const session = require('express-session'); 
const connectDB = require('./database');  // Add this
const User = require('./models/user');    // Add this
const Transaction = require('./models/transaction');

dotenv.config({ path: './.env'});

// Connect to database
connectDB();  

const app = express();

// Add this line to serve static files
app.use(express.static('public'));

app.use(express.urlencoded({extended: false}));
app.use(express.json());

app.use(session({
    secret: process.env.SESSION_SECRET || 'moneyjournal-secret-key',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 24 * 60 * 60 * 1000 }
}));


app.set('view engine', 'hbs');

app.get("/", (req, res) => {
    res.send("Welcome to Login App");
});

app.get("/login", (req, res) => {
    res.render("login");
});

app.get("/register", (req, res) => {
    res.render("register");
});

app.post("/auth/register", async (req, res) => {
    try {
        const { name, username, email, password } = req.body;
        
        // Check if user already exists
        const existingUser = await User.findOne({ $or: [{ email }, { username }] });
        if (existingUser) {
            return res.status(400).send("User already exists!");
        }
        
        // Create new user
        const user = new User({
            username: username,
            email: email,
            password: password  // Will be hashed automatically
        });
        
        await user.save();
        console.log(`User registered: ${username}, ${email}`);
        res.send("Registration successful! You can now login.");
        
    } catch (error) {
        console.error('Registration error:', error);
        res.status(500).send("Error during registration");
    }
});


app.post("/auth/login", async (req, res) => {
    try {
        const { username, password } = req.body;
        
        const user = await User.findOne({ username });
        if (!user) {
            return res.status(400).send("Invalid username or password");
        }
        
        const isPasswordValid = await user.comparePassword(password);
        if (!isPasswordValid) {
            return res.status(400).send("Invalid username or password");
        }
        
        // Save user session
        req.session.userId = user._id;
        req.session.username = user.username;
        
        console.log(`Login successful: ${username}`);
        res.redirect('/transaction');
        
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).send("Error during login");
    }
});

// Transaction page route
app.get("/transaction", (req, res) => {
    if (!req.session.userId) {
        return res.redirect('/login');
    }
    res.render("transaction", { username: req.session.username });
});

// Submit transaction route
app.post("/api/transaction", async (req, res) => {
    try {
        if (!req.session.userId) {
            return res.status(401).send("Please login first");
        }
        
        const { date, type, ngapain, amount } = req.body;  // Add ngapain here
        
        const transaction = new Transaction({
            date: new Date(date),
            type: type,
            ngapain: ngapain,  // Add this line
            by: req.session.username,
            amount: parseFloat(amount)
        });
        
        await transaction.save();
        console.log(`Transaction saved: ${type} - ${ngapain} - Rp${amount} by ${req.session.username}`);
        res.json({ success: true, message: "Transaction saved successfully!" });
        
    } catch (error) {
        console.error('Transaction error:', error);
        res.status(500).json({ success: false, message: "Error saving transaction" });
    }
});


// Logout route
app.get("/logout", (req, res) => {
    req.session.destroy();
    res.redirect('/login');
});

// View all transactions page
app.get("/transactions", (req, res) => {
    if (!req.session.userId) {
        return res.redirect('/login');
    }
    res.render("transactions", { username: req.session.username });
});

// API to get transactions with filters
app.get("/api/transactions", async (req, res) => {
    try {
        if (!req.session.userId) {
            return res.status(401).json({ error: "Please login first" });
        }
        
        const { month, by, type } = req.query;
        
        // Build filter object
        let filter = {};
        
        // Month filter (required)
        if (month) {
            const [year, monthNum] = month.split('-');
            const startDate = new Date(year, monthNum - 1, 1);
            const endDate = new Date(year, monthNum, 0, 23, 59, 59);
            filter.date = { $gte: startDate, $lte: endDate };
        }
        
        // Optional filters
        if (by && by !== 'all') filter.by = by;
        if (type && type !== 'all') filter.type = type;
        
        const transactions = await Transaction.find(filter).sort({ date: -1 });
        res.json(transactions);
        
    } catch (error) {
        console.error('Error fetching transactions:', error);
        res.status(500).json({ error: "Error fetching transactions" });
    }
});

// API to get single transaction for editing
app.get("/api/transaction/:id", async (req, res) => {
    try {
        if (!req.session.userId) {
            return res.status(401).json({ error: "Please login first" });
        }
        
        const transaction = await Transaction.findById(req.params.id);
        if (!transaction) {
            return res.status(404).json({ error: "Transaction not found" });
        }
        
        res.json(transaction);
    } catch (error) {
        console.error('Error fetching transaction:', error);
        res.status(500).json({ error: "Error fetching transaction" });
    }
});

// API to update transaction
app.put("/api/transaction/:id", async (req, res) => {
    try {
        if (!req.session.userId) {
            return res.status(401).json({ error: "Please login first" });
        }
        
        const { date, type, ngapain, amount } = req.body;
        
        const transaction = await Transaction.findByIdAndUpdate(
            req.params.id,
            {
                date: new Date(date),
                type: type,
                ngapain: ngapain,
                amount: parseFloat(amount)
            },
            { new: true }
        );
        
        if (!transaction) {
            return res.status(404).json({ success: false, message: "Transaction not found" });
        }
        
        console.log(`Transaction updated: ${transaction._id}`);
        res.json({ success: true, message: "Transaction updated successfully!" });
        
    } catch (error) {
        console.error('Error updating transaction:', error);
        res.status(500).json({ success: false, message: "Error updating transaction" });
    }
});

// API to delete transaction
app.delete("/api/transaction/:id", async (req, res) => {
    try {
        if (!req.session.userId) {
            return res.status(401).json({ error: "Please login first" });
        }
        
        const transaction = await Transaction.findByIdAndDelete(req.params.id);
        
        if (!transaction) {
            return res.status(404).json({ success: false, message: "Transaction not found" });
        }
        
        console.log(`Transaction deleted: ${req.params.id}`);
        res.json({ success: true, message: "Transaction deleted successfully!" });
        
    } catch (error) {
        console.error('Error deleting transaction:', error);
        res.status(500).json({ success: false, message: "Error deleting transaction" });
    }
});

// API to get unique submitters
app.get("/api/submitters", async (req, res) => {
    try {
        if (!req.session.userId) {
            return res.status(401).json({ error: "Please login first" });
        }
        
        const submitters = await Transaction.distinct('by');
        res.json(submitters);
        
    } catch (error) {
        console.error('Error fetching submitters:', error);
        res.status(500).json({ error: "Error fetching submitters" });
    }
});

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
    console.log(`Server started on port ${PORT}`);
});
