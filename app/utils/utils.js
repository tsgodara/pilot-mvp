"use strict";
var _ = require("underscore");
var config = require("../config/config.json");
var unAuthorizedAccessError = require("../errors/unAuthorizedAccessError.js");

module.exports.isEmptyVal = function(val) {
  if (val == undefined) {
    return true;
  }

  if (_.isNull(val)) {
    return true;
  }

  if (val instanceof Array) {
    return val.length === 0;
  }

  if (utils.isEmptyString(val)) {
    return true;
  }

  if (_.isNaN(val)) {
    return true;
  }

  return false;
};

module.exports.isNotEmptyVal = function(val) {
  return !module.exports.isEmptyVal(val);
};

/**
 * Find the authorization headers from the headers in the request
 *
 * @param headers
 * @returns {*}
 */
module.exports.fetch = function(headers) {
  if (headers && headers.authorization) {
    var authorization = headers.authorization;
    var part = authorization.split(" ");
    if (part.length === 2) {
      var token = part[1];
      return part[1];
    } else {
      return null;
    }
  } else {
    return null;
  }
};

/**
 * Creates a new token for the user that has been logged in
 *
 * @param user
 * @param req
 * @param res
 * @param next
 *
 * @returns {*}
 */
module.exports.create = function(user, req, res, next) {
  if (_.isEmpty(user)) {
    return next(new Error("User data cannot be empty."));
  }
  var data = {
    username: user.username,
    email: user.username,
    token: jwt.sign({ username: user.username }, config.secretKey, {
      expiresInMinutes: config.tokenExpiry
    })
  };
  var decoded = jwt.decode(data.token);
  data.token_exp = decoded.exp;
  data.token_iat = decoded.iat;
  return data;
};
/**
 *
 * @param req
 * @param res
 * @param next
 */
module.exports.verify = function(req, res, next) {
  var token = exports.fetch(req.headers);
  jwt.verify(token, config.secretKey, function(err, decode) {
    if (err) {
      req.user = undefined;
      return next(new UnauthorizedAccessError("invalid_token"));
    }
    req.user = data;
    next();
  });
};
/**
 * Middleware for getting the token into the user
 *
 * @param req
 * @param res
 * @param next
 */
module.exports.middleware = function() {
  var func = function(req, res, next) {
    var query = require("querystring").stringify(req.query);
    query = query != "" ? query.substring(0, query.length - 1) : "";
    var token = exports.fetch(req.headers) || query;
    // decode token
    if (token) {
      // verifies secret and checks exp
      jwt.verify(token, config.secretKey, function(err, decoded) {
        if (err) {
          return res.json({
            success: false,
            message: "Failed to authenticate token."
          });
        } else {
          req.decoded = decoded;
          next();
        }
      });
    } else {
      // if there is no token, return an error
      return res.status(403).send({
        success: false,
        message: "No token provided."
      });
    }
  };

  func.unless = require("express-unless");
  return func;
};

module.exports.TOKEN_EXPIRATION = config.tokenExpiry;
module.exports.TOKEN_EXPIRATION_SEC = config.tokenExpirySec;
