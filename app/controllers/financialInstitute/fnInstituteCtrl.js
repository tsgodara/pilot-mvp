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

    router.post("/customerOnboard", function(req, res) {
        var aadhar = req.body.aadhar;
        var KYC = req.body.kyc;
        var partnerKey = config.partner_field + ":" + req.body.partner_id + ":" + config.product_field + ":" + req.body.product_id;
        redisClient.hget(config.table, config.customerAadhar_field + ":" + req.body.aadhar, function(err, reply) {
            if (err) {
                res.status(500).json({ error: "error registring new customer!!" });
            } else if (!reply) {
                var randomCustomerId = randomString('A0', 8);
                multi
                    .hset(config.table, config.customerAadhar_field + ":" + req.body.aadhar, randomCustomerId)
                    .hget(config.table, config.customerAadhar_field + ":" + req.body.aadhar)
                    .exec(function(error, result) {
                        if (error) {
                            res.status(500).json({ error: "error registring new customer!!" });
                        } else {
                            updateKYC(req, res, partnerKey, result[1], KYC);
                        }
                    });
            } else {
                updateKYC(req, res, partnerKey, reply, KYC);
            }
        });
    });

    function updateKYC(req, res, partnerKey, customerID, KYC) {
        multi
            .hset(config.table, config.customerID_field + ":" + customerID, KYC)
            .hset(config.table, config.customerID_field + ":" + customerID + ":" + partnerKey, KYC)
            .exec(function(error, response) {
                if (error) {
                    res.status(500).json({ error: "error registring new customer!!" });
                } else {
                    res.json({ customer_id: customerID });
                }

            });
    }


    router.post("/updateLimit", function(req, res) {
        var aadhar = req.body.aadhar;
        var KYC = req.body.kyc;
        var limit = (req.body.kyc == 0) ? 10000 : 100000;
        redisClient.hget(config.table, config.customerAadhar_field + ":" + req.body.aadhar, function(err, reply) {
            if (reply) {
                multi
                    .hset(config.table, config.customerID_field + ":" + reply + ":" + config.customerLimit_field, limit)
                    .hset(config.table, config.customerID_field + ":" + reply + ":" + config.customerBalance_field, 0)
                    .exec(function(error, result) {
                        if (error) {
                            res.status(500).json({ error: "error updating limit!! " });
                        } else {
                            res.json({ success: true });
                        }
                    });
            } else {
                res.status(500).json({ error: "customer is not registered at financial intitutions!!" });
            }
        });
    });


    router.post("/checkCustomerExists", function(req, res) {
        var aadhar = req.body.aadhar;
        redisClient.hget(config.table, config.customerAadhar_field + ":" + req.body.aadhar, function(err, reply) {
            if (reply) {
                res.json({ customer_id: reply });
            } else {
                res.status(500).json({ error: "customer is not registered at financial intitutions!!" });
            }
        });
    });

    router.post("/doTransaction/:type", function(req, res) {
        var type = req.params.type;
        var aadhar = req.body.aadhar;
        var amount = req.body.amount;
        redisClient.hget(config.table, config.customerAadhar_field + ":" + req.body.aadhar, function(err, reply) {
          if (reply) {
            var customerId = reply;
                multi
                    .hget(config.table, config.customerID_field + ":" + reply + ":" + config.customerLimit_field)
                    .hget(config.table, config.customerID_field + ":" + reply + ":" + config.customerBalance_field)
                    .exec(function(error, result) {
                        var currentBalance;
                        if (error) {
                            res.status(500).json({ error: "error while performing transaction!! " });
                        } else {
                            if (type == "credit") {
                                if ((result[0]==null) || (parseInt(result[1]) + parseInt(amount)) > parseInt(result[0])) {
                                    res.status(304).json({ error: "limit can not be updated!! " });
                                } else {
                                    currentBalance = parseInt(result[1]) + parseInt(amount);
                                    redisClient.hset(config.table, config.customerID_field + ":" + customerId + ":" + config.customerBalance_field, currentBalance, function(err, response) {
                                        if (!err) {
                                            updateTransactionLog(req, res, customerId, currentBalance, parseInt(amount), type)
                                        } else {
                                            res.status(500).json({ error: "customer is not registered at financial intitutions!!" });
                                        }
                                    });
                                }
                            } else if (type == "debit") {
                                if ((result[0]==null) || (parseInt(amount) > parseInt(result[1]))) {
                                    res.status(304).json({ error: "Not enough amount to perform transaction!! " });
                                } else {
                                    currentBalance = parseInt(result[1]) - parseInt(amount);
                                    redisClient.hset(config.table, config.customerID_field + ":" + customerId + ":" + config.customerBalance_field, currentBalance, function(err, response) {
                                        if (!err) {
                                          updateTransactionLog(req, res, customerId, currentBalance, parseInt(amount), type)
                                        } else {
                                            res.status(500).json({ error: "customer is not registered at financial intitutions!!" });
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

    function updateTransactionLog(req, res, customerId, currentBalance, amount, type) {
        var currentTimestamp = new Date().getTime();
        var date = moment(currentTimestamp).format("DD-MMM-YYYY");
        var time = moment(currentTimestamp).format("hh:mm:ss A");
        redisClient.zadd(config.customerID_field + ":" + customerId + ":" + config.customerTransaction_field, currentTimestamp, "rupees "+amount+" "+ type+"ed on "+date+" at "+time, function(err, reply) {
            if (!err) {
                res.json({ transaction_id: "", available_Balance: currentBalance });
            } else {
                res.status(500).json({ error: "error while updating transaction log!!" });
            }
        });
    }

    router.post("/getTransactions", function(req, res) {
        var customerId = req.body.customer_id;
        redisClient.zrevrange(config.customerID_field + ":" + customerId + ":" + config.customerTransaction_field, 0, -1, function(err, result) {
            if (result) {
                res.json({ transactions: result });
            } else {
                res.status(500).json({ error: "error in fetching transactions!!" });
            }
        });
    });


};

module.exports = REST_ROUTER;