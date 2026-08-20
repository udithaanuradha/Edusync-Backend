const verifyToken = (req, res, next) => {
    const token = req.headers.authorization?.split(' ')[1];
    
    if (!token) {
        return res.status(401).json({ success: false, message: 'No token provided' });
    }

    // Token validation logic (you can integrate JWT here)
    req.token = token;
    if (req.body) {
        req.userId = req.body.created_by; // Get user ID from request
    }
    next();
};

const authorizeRole = (allowedRoles) => {
    return (req, res, next) => {
        const userRole = req.body.user_role;

        if (!userRole) {
            return res.status(400).json({ 
                success: false, 
                message: 'User role is required' 
            });
        }

        if (!allowedRoles.includes(userRole)) {
            return res.status(403).json({ 
                success: false, 
                message: `Access denied. Only ${allowedRoles.join(', ')} can perform this action` 
            });
        }

        next();
    };
};

module.exports = { verifyToken, authorizeRole };
