const User = require('../models/User');

exports.getLogin = (req, res) => {
    res.render('login', { error: req.query.error, success: req.query.success });
};

exports.getRegister = (req, res) => {
    res.render('register', { error: req.query.error });
};

exports.postRegister = async (req, res) => {
    try {
        const { username, email, password } = req.body;

        if (!password || password.length < 8) {
            return res.redirect('/register?error=Password must be at least 8 characters long');
        }

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
        req.session.avatar = user.avatar || '👤'; // Cache avatar
        req.session.role = user.role || 'Self'; // Cache role

        res.redirect('/welcome');
    } catch (error) {
        console.error('Login error:', error);
        res.redirect('/login?error=Error during login');
    }
};

exports.getWelcome = (req, res) => {
    if (!req.session.userId) return res.redirect('/login');
    res.render('welcome', { username: req.session.username });
};

exports.getProfile = async (req, res) => {
    if (!req.session.userId) return res.redirect('/login');
    try {
        const user = await User.findById(req.session.userId);
        res.render('profile', {
            username: user.username,
            currentAvatar: user.avatar || '👤',
            currentRole: user.role || 'Self'
        });
    } catch (error) {
        res.redirect('/transaction');
    }
};

exports.postProfile = async (req, res) => {
    if (!req.session.userId) return res.redirect('/login');
    try {
        const { username, avatar, role } = req.body;
        const user = await User.findByIdAndUpdate(
            req.session.userId,
            { username, avatar, role },
            { new: true }
        );

        // Update session
        req.session.username = user.username;
        req.session.avatar = user.avatar;
        req.session.role = user.role;

        res.redirect('/transaction');
    } catch (error) {
        console.error('Profile update error:', error);
        res.redirect('/profile?error=Error updating profile');
    }
};

exports.logout = (req, res) => {
    req.session.destroy();
    res.redirect('/login');
};