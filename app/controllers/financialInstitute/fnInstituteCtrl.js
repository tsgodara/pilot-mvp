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
                    "aadhaar": jsonObj.aadhaar,
                    "gender": jsonObj.gender 
                });
            } else {
                res.status(500).json({ error: "login failed!!" });
            }
        });
    });

    router.post("/register", function (req, res) {
        var key = config.username_field + ":" + req.body.username + ":" + config.password_field + ":" + req.body.password;
        var userDetails = JSON.stringify({
            "full_name": req.body.full_name,
            "aadhaar": req.body.aadhaar,
            "gender": "Male"            
        })
        redisClient.hset(config.table, key, userDetails, function(error, result) {
            if (!error) {
                res.json({
                    "full_name": req.body.full_name,
                    "aadhaar": req.body.aadhaar,
                    "gender": "Male" 
                });
            } else {
                res.status(500).json({ error: "signup failed!!" });
            }
        });
    });

    router.post("/customer", function(req, res) {
        var aadhaar = req.body.aadhaar;
        var KYC = req.body.kyc;
        var partnerId = req.body.partner_id;
        var productId = req.body.product_id;
        redisClient.hget(config.table, config.customerAadhar_field + ":" + aadhaar, function(err, reply) {
            if (err) {
                res.status(500).json({ msg: "error registring new customer!!", error: err });
            } else if (!reply) {
                var randomCustomerId = randomString('A0', 8);
                multi
                    .hset(config.table, config.customerAadhar_field + ":" + aadhaar, randomCustomerId)
                    .hget(config.table, config.customerAadhar_field + ":" + aadhaar)
                    .exec(function(error, result) {
                        if (error) {
                            res.status(500).json({ error: "error registring new customer!!" });
                        } else {
                            updateKYC(req, res, partnerId, productId, result[1], KYC, false);
                        }
                    });
            } else {
                updateKYC(req, res, partnerId, productId, reply, KYC, true);
            }
        });
    });

    function updateKYC(req, res, partnerId, productId, customerId, KYC, existingCustomer) {
        var partnerKey = config.partner_field + ":" + partnerId + ":" + config.product_field + ":" + productId;
        multi
            .hset(config.table, config.customerID_field + ":" + customerId, KYC)
            .hset(config.table, config.customerID_field + ":" + customerId + ":" + partnerKey, KYC)
            .hget(config.table, config.customerID_field + ":" + customerId + ":" + config.customerBalance_field)
            .exec(function(error, response) {
                if (error) {
                    res.status(500).json({ error: "error registring new customer!!" });
                } else {
                    var balanceObj = ((response[2] == null) ? "" : JSON.parse(response[2]));
                    res.json({
                        "partner_id": partnerId,
                        "product_id": productId,
                        "customer_id": customerId,
                        "balance": (balanceObj == "") ? 0 : balanceObj.balance,
                        "kyc":KYC
                    });
                }

            });
    }


    router.post("/limit", function(req, res) {
        var customerId = req.body.customer_id;
        var KYC = req.body.kyc;
        var limit = (req.body.kyc == 0) ? 10000 : 100000;
        redisClient.hget(config.table, config.customerID_field + ":" + customerId, function(err, reply) {
            if (reply != null) {
                multi
                    .hset(config.table, config.customerID_field + ":" + customerId + ":" + config.customerLimit_field, limit)
                    .hget(config.table, config.customerID_field + ":" + customerId + ":" + config.customerBalance_field)
                    .exec(function(error, result) {
                        if (error) {
                            res.status(500).json({ error: "error updating limit!! " });
                        } else {
                            var balanceObj = ((result[1] == null) ? "" : JSON.parse(result[1]));
                            res.json({
                                "customer_id": customerId,
                                "balance": (balanceObj == "") ? 0 : balanceObj.balance,
                                "limit":limit
                            });
                        }
                    });
            } else {
                res.status(500).json({ error: "customer is not registered at financial intitutions!!" });
            }
        });
    });


    router.get("/customer/:customer_id", function(req, res) {
        var customerId = req.params.customer_id;
        multi
        .hget(config.table, config.customerID_field + ":" + customerId)
        .hget(config.table, config.customerID_field + ":" + customerId + ":" + config.customerBalance_field)
        .exec(function(error, result) {
            if (!error) {
                var balanceObj = ((result[1] == null) ? "" : JSON.parse(result[1]));
                res.json({
                    "customer_id": customerId,
                    "balance": (balanceObj == "") ? 0 : balanceObj.balance
                });
            } else {
                res.status(500).json({ error: "customer is not registered at financial intitutions!!" });
            }
        });
    });

    router.post("/transaction/:type", function(req, res) {
        var type = req.params.type;
        var customerId = req.body.customer_id;
        // var transactionId = req.body.transaction_id;
        var transactionId = randomString('0', 7);
        var partnerId = req.body.partner_id;
        var productId = req.body.product_id;
        var amount = req.body.amount;
        redisClient.hget(config.table, config.customerID_field + ":" + customerId, function(err, reply) {
            if (reply !=null) {
                multi
                    .hget(config.table, config.customerID_field + ":" + customerId + ":" + config.customerLimit_field)
                    .hget(config.table, config.customerID_field + ":" + customerId + ":" + config.customerBalance_field)
                    .exec(function(error, result) {
                        var currentBalance;
                        if (error) {
                            res.status(500).json({ error: "error while performing transaction!! " });
                        } else {
                            if (type == "credit") {
                                if ((result[0] == null) || (parseInt(result[1]) + parseInt(amount)) > parseInt(result[0])) {
                                    res.status(304).json({ error: "limit can not be updated!! " });
                                } else {
                                    var balanceObj = ((result[1] == null) ? "" : JSON.parse(result[1]));
                                    currentBalance = ((balanceObj == "") ? 0 : balanceObj.balance) + parseInt(amount);
                                    var transObj = JSON.stringify({
                                        partner_id: partnerId,
                                        product_id: productId,
                                        transaction_id: transactionId,
                                        prev_balance: (balanceObj == "") ? 0 : balanceObj.balance,
                                        balance: currentBalance,
                                        transaction_amount: amount,
                                        time: new Date().getTime(),
                                        type: type
                                    });
                                    redisClient.hset(config.table, config.customerID_field + ":" + customerId + ":" + config.customerBalance_field, transObj, function(err, response) {
                                        if (!err) {
                                            updateTransactionLog(req, res, customerId, transObj)
                                        } else {
                                            res.status(400);
                                            res.json({
                                                status: "FAILURE",
                                                customer_id: customerId,
                                                balance: (result[1] == null) ? 0 : result[1]
                                            });
                                        }
                                    });
                                }
                            } else if (type == "debit") {
                                if ((result[0] == null) || (parseInt(amount) > parseInt(result[1]))) {
                                    res.status(304).json({ error: "Not enough amount to perform transaction!! " });
                                } else {
                                    var balanceObj = ((result[1] == null) ? "" : JSON.parse(result[1]));
                                    currentBalance = ((balanceObj == "") ? 0 : balanceObj.balance) - parseInt(amount);
                                    var transObj = JSON.stringify({
                                        partner_id: partnerId,
                                        product_id: productId,
                                        transaction_id: transactionId,
                                        prev_balance: (balanceObj == "") ? 0 : balanceObj.balance,
                                        balance: currentBalance,
                                        transaction_amount: amount,
                                        time: new Date().getTime(),
                                        type: type
                                    });
                                    redisClient.hset(config.table, config.customerID_field + ":" + customerId + ":" + config.customerBalance_field, transObj, function(err, response) {
                                        if (!err) {
                                            updateTransactionLog(req, res, customerId, transObj)
                                        } else {
                                            res.status(400);
                                            res.json({
                                                status: "FAILURE",
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
                res.status(500).json({ error: "customer is not registered at financial intitutions!!" });
            }
        });
    });

    function updateTransactionLog(req, res, customerId, transObj) {
        var currentTimestamp = new Date().getTime();
        redisClient.zadd(config.customerID_field + ":" + customerId + ":" + config.customerTransaction_field, currentTimestamp, transObj, function(err, reply) {
            if (!err) {
                res.json({
                    status: "SUCCESS",
                    customer_id: customerId,
                    balance: JSON.parse(transObj).balance
                });
            } else {
                res.json({
                    status: "SUCCESS",
                    customer_id: customerId,
                    balance: JSON.parse(transObj).balance,
                    error: "error while updating transaction log!!"
                });
            }
        });
    }

    router.get("/transactions/:customer_id", function (req, res) {
        var customerId = req.params.customer_id;
        redisClient.zrevrange(config.customerID_field + ":" + customerId + ":" + config.customerTransaction_field, 0, -1, function(err, result) {
            if (result) {
                res.json({ transactions: result.map(JSON.parse) });
            } else {
                res.status(500).json({ error: "error in fetching transactions!!" });
            }
        });
    });


};

module.exports = REST_ROUTER;