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

        if (!user.isActive) {
            return res.redirect('/login?error=Account is not active yet. Please wait for admin approval.');
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

// Mobile API Auth
exports.apiLogin = async (req, res) => {
    try {
        const { username, password } = req.body;
        const user = await User.findOne({ username });

        if (!user || !(await user.comparePassword(password))) {
            return res.status(401).json({ success: false, message: 'Invalid username or password' });
        }

        if (!user.isActive) {
            return res.status(403).json({ success: false, message: 'Account is not active yet' });
        }

        req.session.userId = user._id;
        req.session.username = user.username;
        req.session.avatar = user.avatar || '👤';
        req.session.role = user.role || 'Self';

        res.json({
            success: true,
            user: {
                id: user._id,
                username: user.username,
                avatar: user.avatar || '👤',
                role: user.role || 'Self'
            }
        });
    } catch (error) {
        console.error('API Login error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
};

exports.apiLogout = (req, res) => {
    req.session.destroy();
    res.json({ success: true });
};

exports.getMe = async (req, res) => {
    if (!req.session.userId) {
        return res.status(401).json({ success: false, message: 'Not authenticated' });
    }
    try {
        const user = await User.findById(req.session.userId);
        if (!user) return res.status(401).json({ success: false, message: 'User not found' });
        res.json({
            success: true,
            user: {
                id: user._id,
                username: user.username,
                avatar: user.avatar || '👤',
                role: user.role || 'Self'
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Server error' });
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