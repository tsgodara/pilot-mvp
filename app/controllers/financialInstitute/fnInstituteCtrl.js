var _ = require("underscore");
var moment = require("moment");
var randomString = require('randomatic');
var config = require("../../config/config.json");
var unAuthorizedAccessError = require("../../errors/unAuthorizedAccessError.js");
var notFoundError = require("../../errors/notFoundError.js");
var utils = require("../../utils/utils.js");


function REST_ROUTER(router, redisClient) {
    var self = this;
    self.handleRoutes(router, redisClient);
}

REST_ROUTER.prototype.handleRoutes = function(router, redisClient) {
    var multi = redisClient.multi();
    var self = this;
    router.get("/", function(req, res) {
        res.json({ Message: "Customer OnBoarding Portal is connected!!" });
    });

    router.post("/login", function (req, res) {
        var key = config.username_field + ":" + req.body.username + ":" + config.password_field + ":" + req.body.password;
        redisClient.hget(config.table, key, function(error, result) {
            if (!error && result!==null) {
                var jsonObj = JSON.parse(result);
                res.json({
                    "full_name": jsonObj.full_name,
                    "mobile": req.body.mobile_number,
                    "gender": jsonObj.gender 
                });
            } else {
                res.status(500).json({ error: "login failed!!" });
            }
        });
    });

    router.post("/customer", function(req, res) {
        var mobile = req.body.mobile_number;
        var KYC = req.body.kyc;
        var partnerId = req.body.partner_id;
        var productId = req.body.product_id;
        var name = (req.body.full_name=="" || req.body.full_name==null)?"-":req.body.full_name;
        if (mobile == undefined || mobile == 'undefined') {
            res.status(400).json({ error: config.customer_invalid_payload });
            return
        }
        redisClient.hget(config.table, config.customerMobile_field + ":" + mobile, function(err, reply) {
            if (err) {
                res.status(500).json({ error: config.customer_registration_error });
            } else if (reply==null) {
                var randomCustomerId = randomString('A0', 8);
                multi
                    .hset(config.table, config.customerMobile_field + ":" + mobile, randomCustomerId)
                    .hget(config.table, config.customerMobile_field + ":" + mobile)
                    .exec(function(error, result) {
                        if (error) {
                            res.status(500).json({ error: config.customer_registration_error });
                        } else {
                            updateUserDetails(req, res, partnerId, productId, result[1], KYC, false, name);
                        }
                    });
            } else {
                updateUserDetails(req, res, partnerId, productId, reply, KYC, true, name);
            }
        });
    });

    function updateUserDetails(req, res, partnerId, productId, customerId, KYC, existingCustomer, name) {
        var partnerKey = config.partner_field + ":" + partnerId + ":" + config.product_field + ":" + productId;
        var limit = (KYC == '0' ||KYC == 0) ? 10000 : 100000;
        multi
            .hset(config.table, config.customerID_field + ":" + customerId, KYC)
            .hset(partnerKey, config.customerID_field + ":" + customerId, KYC)
            .hset(config.table, config.customerID_field + ":" + customerId + ":" + config.customerName_field, name)
            .hset(config.table, config.customerID_field + ":" + customerId + ":" + config.customerLimit_field, limit)
            .hget(config.table, config.customerID_field + ":" + customerId + ":" + config.customerBalance_field)
            .exec(function(error, response) {
                if (error) {
                    res.status(500).json({
                        "error": config.customer_update_error,
                        "partner_id": partnerId,
                        "product_id": productId,
                        "customer_id": customerId
                        
                    });
                } else {
                    var balanceObj = ((response[4] == null) ? "" : JSON.parse(response[4]));
                    res.json({
                        "partner_id": partnerId,
                        "product_id": productId,
                        "customer_id": customerId,
                        "full_name": name,
                        "balance": (balanceObj == "") ? 0 : balanceObj.balance,
                        "limit": limit,
                        "kyc":KYC
                    });
                }

            });
    }


    router.post("/limit", function (req, res) {
        
        var KYC = req.body.kyc;
        var limit = (req.body.kyc == 0) ? 10000 : 100000;
        var mobile = req.body.mobile_number;
        if (mobile == undefined || mobile == 'undefined') {
            res.status(400).json({ error: config.customer_invalid_payload });
            return
        }
        redisClient.hget(config.table, config.customerMobile_field + ":" + mobile, function (err, reply) {
            if (reply) {
                multi
                    .hset(config.table, config.customerID_field + ":" + reply, KYC)    
                    .hset(config.table, config.customerID_field + ":" + reply + ":" + config.customerLimit_field, limit)
                    .hget(config.table, config.customerID_field + ":" + reply + ":" + config.customerBalance_field)
                    .exec(function(error, result) {
                        if (error) {
                            res.status(500).json({ error: config.error_update_limit });
                        } else {
                            var balanceObj = ((result[2] == null) ? "" : JSON.parse(result[2]));
                            res.json({
                                "balance": (balanceObj == "") ? 0 : balanceObj.balance,
                                "limit":limit
                            });
                        }
                    });
            } else {
                res.status(500).json({ error: config.customer_fetch_error });
            }
        });
    });


    router.get("/customer/:mobile_number", function(req, res) {
        var mobile = req.params.mobile_number;
        if (mobile == undefined || mobile == 'undefined') {
            res.status(400).json({ error: config.customer_invalid_payload });
            return
        }
        redisClient.hget(config.table, config.customerMobile_field + ":" + mobile, function (err, reply) { 
            if (reply) {
                multi
                    .hget(config.table, config.customerID_field + ":" + reply)
                    .hget(config.table, config.customerID_field + ":" + reply + ":" + config.customerBalance_field)
                    .hget(config.table, config.customerID_field + ":" + reply + ":" + config.customerName_field)
                    .hget(config.table, config.customerID_field + ":" + reply + ":" + config.customerLimit_field)
                    .exec(function (error, result) {
                        if (!error) {
                            var balanceObj = ((result[1] == null) ? "" : JSON.parse(result[1]));
                            res.json({
                                "full_name":((result[2] == null) ? "" : result[2]),
                                "customer_id": reply,
                                "balance": (balanceObj == "") ? 0 : balanceObj.balance,
                                "limit": ((result[3] == null) ? "" : result[3]),
                                "kyc":((result[0] == null) ? "" : result[0])
                            });
                        } else {
                            res.status(500).json({ error: config.customer_fetch_error });
                        }
                    });
            } else {
                res.status(500).json({ error: config.customer_fetch_error }); 
            }    
        })
    });

    router.post("/transaction/:type", function(req, res) {
        var type = req.params.type;
        var mobile = req.body.mobile_number;
        var transactionId = req.body.transaction_id;
        // var transactionId = randomString('0', 7);
        var partnerId = req.body.partner_id;
        var productId = req.body.product_id;
        var amount = req.body.amount;
        if (mobile == undefined || mobile == 'undefined') {
            res.status(400).json({ error: config.customer_invalid_payload });
            return
        }
        redisClient.hget(config.table, config.customerMobile_field + ":" + mobile, function(err, reply) {
            if (reply != null) {
                var customerId = reply;
                multi
                    .hget(config.table, config.customerID_field + ":" +   customerId   + ":" + config.customerLimit_field)
                    .hget(config.table, config.customerID_field + ":" + customerId + ":" + config.customerBalance_field)
                    .exec(function(error, result) {
                        var currentBalance;
                        if (error) {
                            res.status(500).json({ error: config.transaction_error});
                        } else {
                            if (type == "credit") {
                                var balanceObj = ((result[1] == null) ? "" : JSON.parse(result[1]));
                                var balance = ((balanceObj == "") ? 0 : balanceObj.balance);
                                if ((result[0] == null) || (parseInt(balance) + parseInt(amount)) > parseInt(result[0])) {
                                    res.status(400).json({
                                        msg: config.exceed_limit,
                                        balance: balance,
                                        status: config.error_msg
                                    });
                                } else {
                                    currentBalance = parseInt(balance) + parseInt(amount);
                                    var transObj = JSON.stringify({
                                        partner_id: partnerId,
                                        product_id: productId,
                                        transaction_id: transactionId,
                                        prev_balance: (balanceObj == "") ? 0 : balanceObj.balance,
                                        balance: currentBalance,
                                        transaction_amount: amount,
                                        time: new Date().getTime(),
                                        type: type,
                                        audit_status: "APPROVED"
                                    });
                                    redisClient.hset(config.table, config.customerID_field + ":" + customerId + ":" + config.customerBalance_field, transObj, function(err, response) {
                                        if (!err) {
                                            updateTransactionLog(req, res, customerId, transObj, type, currentBalance)
                                        } else {
                                            res.status(400);
                                            res.json({
                                                status: config.failure_msg,
                                                customer_id: customerId,
                                                balance: (result[1] == null) ? 0 : result[1]
                                            });
                                        }
                                    });
                                }
                            } else if (type == "debit") {
                                var balanceObj = ((result[1] == null) ? "" : JSON.parse(result[1]));
                                var balance = ((balanceObj == "") ? 0 : balanceObj.balance);
                                if ((result[0] == null) || (parseInt(amount) > parseInt(balance))) {
                                    res.status(400).json(
                                        {
                                            msg: config.not_enough_amount,
                                            balance: balance,
                                            status: config.error_msg
                                        }
                                    );
                                } else {
                                    currentBalance = parseInt(balance) - parseInt(amount);
                                    var transObj = JSON.stringify({
                                        partner_id: partnerId,
                                        product_id: productId,
                                        transaction_id: transactionId,
                                        prev_balance: (balanceObj == "") ? 0 : balanceObj.balance,
                                        balance: currentBalance,
                                        transaction_amount: amount,
                                        time: new Date().getTime(),
                                        type: type,
                                        audit_status: "APPROVED"
                                    });
                                    redisClient.hset(config.table, config.customerID_field + ":" + customerId + ":" + config.customerBalance_field, transObj, function(err, response) {
                                        if (!err) {
                                            updateTransactionLog(req, res, customerId, transObj, type, currentBalance)
                                        } else {
                                            res.status(400);
                                            res.json({
                                                status: config.failure_msg,
                                                customer_id: customerId,
                                                balance: (result[1] == null) ? 0 : result[1]
                                            });
                                        }
                                    });
                                }
                            }
                        }
                    });
            } else {
                res.status(500).json({ error: config.customer_fetch_error });
            }
        });
    });

    function updateTransactionLog(req, res, customerId, transObj, type, currentBalance) {
        var currentTimestamp = new Date().getTime();
        redisClient.zadd(config.customerID_field + ":" + customerId + ":" + config.customerTransaction_field, currentTimestamp, transObj, function(err, reply) {
            if (!err) {
                res.json(
                    {
                        msg: config.transaction_msg+type+"ed!!",
                        balance: currentBalance,
                        status: config.success_msg
                    }
                );
            } else {
                res.json({
                    status: config.success_msg,
                    balance: JSON.parse(transObj).balance,
                    error: config.transaction_log_error
                });
            }
        });
    }

    router.get("/transactions/:mobile_number", function (req, res) {
        var mobile = req.params.mobile_number;
        if (mobile == undefined || mobile == 'undefined') {
            res.status(400).json({ error: config.customer_invalid_payload });
            return
        }
        redisClient.hget(config.table, config.customerMobile_field + ":" + mobile, function (err, reply) {
            if (reply) {
                redisClient.zrevrange(config.customerID_field + ":" + reply + ":" + config.customerTransaction_field, 0, -1, function (err, result) {
                    if (result) {
                        res.json({ transactions: result.map(JSON.parse) });
                    } else {
                        res.status(500).json({ error: config.transaction_fetch_error });
                    }
                });
            } else {
                res.status(500).json({ error: config.customer_fetch_error });
            } 
         })
    });

    router.get("/balance/:mobile_number", function (req, res) {
        var mobile = req.params.mobile_number;
        if (mobile == undefined || mobile == 'undefined') {
            res.status(400).json({ error: config.customer_invalid_payload });
            return
        }
        redisClient.hget(config.table, config.customerMobile_field + ":" + mobile, function (err, reply) {
            if (reply) {
                redisClient.hget(config.table, config.customerID_field + ":" + reply + ":" + config.customerBalance_field, function (err, result) {
                    if (result) {
                        var balanceObj = ((result == null) ? "" : JSON.parse(result));
                        res.json({
                            balance: ((balanceObj == "") ? 0 : balanceObj.balance)
                        });

                    } else {
                        res.status(500).json({ error: config.fetch_balance_error });
                    }
                });
            } else {
                res.status(500).json({ error: config.customer_fetch_error });
            } 
         })
    });


};

module.exports = REST_ROUTER;