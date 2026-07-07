const rateLimit = require('express-rate-limit');

/**
 * Rate limiter for authentication endpoints
 * Limits each IP to 20 requests per 15-minute window
 */
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 20, // Limit each IP to 20 requests per windowMs
    message: { 
        success: false, 
        message: 'Too many login/register attempts from this IP, please try again after 15 minutes' 
    },
    standardHeaders: true,
    legacyHeaders: false,
});

module.exports = {
    authLimiter
};
