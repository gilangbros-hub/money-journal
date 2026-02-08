const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');

router.get('/login', authController.getLogin);
router.get('/register', authController.getRegister);
router.get('/welcome', authController.getWelcome);
router.post('/auth/register', authController.postRegister);
router.post('/auth/login', authController.postLogin);
router.get('/logout', authController.logout);

module.exports = router;
