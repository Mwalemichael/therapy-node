// middleware/auth.js
function requireLogin(req, res, next) {
  if (!req.session.user_id) {
    return res.status(401).json({ success: false, message: 'Not authenticated' });
  }
  next();
}

function requireRole(role) {
  return (req, res, next) => {
    if (!req.session.user_id) {
      return res.status(401).json({ success: false, message: 'Not authenticated' });
    }
    if (req.session.role !== role) {
      return res.status(403).json({ success: false, message: 'Forbidden' });
    }
    next();
  };
}

module.exports = { requireLogin, requireRole };