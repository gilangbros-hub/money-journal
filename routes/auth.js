const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');

router.get('/login', authController.getLogin);
router.get('/register', authController.getRegister);
router.get('/welcome', authController.getWelcome);
router.get('/profile', authController.getProfile);
router.post('/profile', authController.postProfile);
const rateLimit = require('express-rate-limit');

const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 20, // Limit each IP to 20 requests per windowMs
    message: "Too many login/register attempts from this IP, please try again after 15 minutes"
});

router.post('/auth/register', authLimiter, authController.postRegister);
router.post('/auth/login', authLimiter, authController.postLogin);
router.get('/logout', authController.logout);

module.exports = router;
