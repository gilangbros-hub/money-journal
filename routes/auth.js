const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const { asyncHandler } = require('../middleware/errorHandler');

router.get('/login', authController.getLogin);
router.get('/register', authController.getRegister);
router.get('/welcome', authController.getWelcome);
router.get('/profile', asyncHandler(authController.getProfile));
router.post('/profile', asyncHandler(authController.postProfile));

router.post('/auth/register', asyncHandler(authController.postRegister));
router.post('/auth/login', asyncHandler(authController.postLogin));
router.get('/logout', authController.logout);

// Mobile API Auth
router.post('/api/auth/login', asyncHandler(authController.apiLogin));
router.post('/api/auth/logout', asyncHandler(authController.apiLogout));
router.get('/api/auth/me', asyncHandler(authController.getMe));

module.exports = router;
