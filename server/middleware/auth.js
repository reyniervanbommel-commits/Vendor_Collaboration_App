'use strict';

const { ROLES } = require('../constants/roles');
const pagePermissions = require('../utils/pagePermissions');
const { time } = require('../utils/timing');

function requireSession(req, res, next) {
  if (req.session && req.session.userId) {
    req.user = req.session.user;
    return next();
  }
  return res.status(401).json({ error: 'Not authenticated' });
}

function requireRole(role) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
    if (req.user.role !== role && req.user.role !== ROLES.ADMIN) {
      return res.status(403).json({ error: 'Access denied — ' + role + ' role required' });
    }
    return next();
  };
}

function requireAnyRole(roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
    if (req.user.role === ROLES.ADMIN) return next();
    if (!Array.isArray(roles) || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Access denied — insufficient permissions' });
    }
    return next();
  };
}

// Granulaire toegang tot één Instellingen-onderdeel (#AB:326). Admin mag altijd; een employee
// alleen met de bijbehorende rij in dbo.user_permissions; overige rollen nooit.
function requirePagePermission(pageName) {
  return async (req, res, next) => {
    try {
      if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
      if (req.user.role === ROLES.ADMIN) return next();
      if (req.user.role !== ROLES.EMPLOYEE) {
        return res.status(403).json({ error: 'Access denied — insufficient permissions' });
      }
      const allowed = await time('perm_check', () => pagePermissions.hasPagePermission(req.user.id, pageName));
      if (!allowed) {
        return res.status(403).json({ error: `Access denied — '${pageName}' permission required` });
      }
      return next();
    } catch (err) {
      return next(err);
    }
  };
}

module.exports = { requireSession, requireRole, requireAnyRole, requirePagePermission };
