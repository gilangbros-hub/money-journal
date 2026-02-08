const User = require('../models/user');

exports.getLogin = (req, res) => {
    res.render('login', { error: req.query.error, success: req.query.success });
};

exports.getRegister = (req, res) => {
    res.render('register', { error: req.query.error });
};

exports.postRegister = async (req, res) => {
    try {
        const { username, email, password } = req.body;
        const existingUser = await User.findOne({ $or: [{ email }, { username }] });
        
        if (existingUser) {
            return res.redirect('/register?error=User already exists');
        }
        
        const user = new User({ username, email, password });
        await user.save();
        
        res.redirect('/login?success=Registration successful! Please login.');
    } catch (error) {
        console.error('Registration error:', error);
        res.redirect('/register?error=Error during registration');
    }
};

exports.postLogin = async (req, res) => {
    try {
        const { username, password } = req.body;
        const user = await User.findOne({ username });
        
        if (!user || !(await user.comparePassword(password))) {
            return res.redirect('/login?error=Invalid username or password');
        }
        
        req.session.userId = user._id;
        req.session.username = user.username;
        
        res.redirect('/transaction');
    } catch (error) {
        console.error('Login error:', error);
        res.redirect('/login?error=Error during login');
    }
};

exports.logout = (req, res) => {
    req.session.destroy();
    res.redirect('/login');
};
