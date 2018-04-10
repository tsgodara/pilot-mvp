var _ = require("underscore");
var moment = require("moment");
var randomString = require('randomatic');
var config = require("../../config/config.json");
var querystring = require('querystring');
var requestSt = require("../../config/requests.json");
var responseSt = require("../../config/response.json");
var unAuthorizedAccessError = require("../../errors/unAuthorizedAccessError.js");
var notFoundError = require("../../errors/notFoundError.js");
var utils = require("../../utils/utils.js");


function REST_ROUTER(router, redisClient, client) {
    var self = this;
    self.handleRoutes(router, redisClient, client);
}

REST_ROUTER.prototype.handleRoutes = function (router, redisClient, client) {
    var multi = redisClient.multi();
    var self = this;
    router.get("/", function (req, res) {
        res.json({ Message: "Customer OnBoarding Portal is connected!!" });
    });

    router.post("/account", function (req, res) {
        var mobile = req.body.Data.Account.Account.Identification;
        var KYC = req.body.Meta.kyc;
        var partnerId = req.body.Meta.partner;
        var productId = req.body.Meta.product;
        var name = (req.body.Data.Account.Account.Name == "" || req.body.Data.Account.Account.Name == null) ? "-" : req.body.Data.Account.Account.Name;
        if (mobile == undefined || mobile == 'undefined') {
            res.status(400).json({ error: config.customer_invalid_payload });
            return
        }
        redisClient.hget(config.table, config.customerMobile_field + ":" + mobile, function (err, reply) {
            if (err) {
                res.status(500).json({ error: config.customer_registration_error });
            } else if (reply == null) {
                var randomCustomerId = randomString('A0', 8);
                multi
                    .hset(config.table, config.customerMobile_field + ":" + mobile, randomCustomerId)
                    .hget(config.table, config.customerMobile_field + ":" + mobile)
                    .exec(function (error, result) {
                        if (error) {
                            res.status(500).json({ error: config.customer_registration_error });
                        } else {
                            updateUserDetails(req, res, partnerId, productId, result[1], KYC, false, name, mobile);
                        }
                    });
            } else {
                redisClient.hget(config.table, config.customerID_field + ":" + reply, function (err, result) {
                    console.log("result Inside");
                    if (err) {
                        res.status(500).json({ error: config.customer_kyc_fetch_error });
                    } else {
                        console.log("result", result);
                        KYC = (parseInt(result) >= parseInt(KYC) ? result : KYC);
                        updateUserDetails(req, res, partnerId, productId, reply, KYC, true, name, mobile);
                    }
                })
            }
        });
    });

    function updateUserDetails(req, res, partnerId, productId, customerId, KYC, existingCustomer, name, mobile) {
        console.log("resultKYC", KYC);
        var partnerKey = config.partner_field + ":" + partnerId + ":" + config.product_field + ":" + productId;
        var limit = (KYC == '0' || KYC == 0) ? 10000 : 100000;
        multi
            .hset(config.table, config.customerID_field + ":" + customerId, KYC)
            .hset(partnerKey, config.customerID_field + ":" + customerId, KYC)
            .hset(config.table, config.customerID_field + ":" + customerId + ":" + config.customerName_field, name)
            .hset(config.table, config.customerID_field + ":" + customerId + ":" + config.customerLimit_field, limit)
            .hget(config.table, config.customerID_field + ":" + customerId + ":" + config.customerBalance_field)
            .exec(function (error, response) {
                if (error) {
                    res.status(500).json({
                        "error": config.customer_update_error,
                        "partner_id": partnerId,
                        "product_id": productId,
                        "customer_id": customerId

                    });
                } else {
                    var balanceObj = ((response[4] == null) ? "" : JSON.parse(response[4]));
                    var customerResponse = responseSt.getAccount;
                    customerResponse.Data.Account[0].AccountId = customerId;
                    customerResponse.Data.Account[0].Account.Identification = mobile;
                    customerResponse.Data.Account[0].Account.Name = name;
                    customerResponse.Meta.Balance = ((balanceObj == "") ? 0 : balanceObj.Balance.Amount.Amount);
                    customerResponse.Meta.Kyc = KYC;
                    customerResponse.Meta.Limit = limit;
                    customerResponse.Meta.Partner = partnerId;
                    customerResponse.Meta.Product = productId;
                    res.json({ customer: customerResponse });
                    const query = {
                        text: 'INSERT INTO "STG_FINACLE_GAM"("CUST_ID", "ACCT_NAME", "PHONE_NUM", "CLR_BAL_AMT", "DR_BAL_LIM", "ACCT_CLASSIFICATION_FLG", "PRODUCT_GROUP", "SCHM_TYPE", "LAST_MODIFIED_DATE", "INSERT_UPDATE_FLAG") VALUES($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *',
                        values: [customerId, name, mobile, customerResponse.Meta.Balance, limit, KYC, productId, partnerId, new Date().getTime(), (existingCustomer) ? "UPDATE" : "INSERT"]
                    }
                    client.query(query, (err, res) => {
                        if (err) {
                            console.log("Error while updating customer details in Postgres!!")
                        } else {
                            console.log("Successfully updated customer details in Postgres!!")
                        }
                    })
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
                redisClient.hget(config.table, config.customerID_field + ":" + reply, function (err, kyc) {
                    if (err) {
                        res.status(500).json({ error: config.customer_kyc_fetch_error });
                    } else {
                        KYC = kyc;
                    }
                    multi
                        .hset(config.table, config.customerID_field + ":" + reply, KYC)
                        .hset(config.table, config.customerID_field + ":" + reply + ":" + config.customerLimit_field, limit)
                        .hget(config.table, config.customerID_field + ":" + reply + ":" + config.customerBalance_field)
                        .exec(function (error, result) {
                            if (error) {
                                res.status(500).json({ error: config.error_update_limit });
                            } else {
                                var balanceObj = ((result[2] == null) ? "" : JSON.parse(result[2]));
                                res.json({
                                    "balance": (balanceObj == "") ? 0 : balanceObj.Balance.Amount.Amount,
                                    "limit": limit,
                                    "KYC": KYC
                                });
                            }
                        });
                })
            } else {
                res.status(500).json({ error: config.customer_fetch_error });
            }
        });
    });


    router.get("/accounts/:mobile_number", function (req, res) {
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
                            var customerResponse = responseSt.getAccount;
                            customerResponse.Data.Account[0].AccountId = reply;
                            customerResponse.Data.Account[0].Account.Identification = mobile;
                            customerResponse.Data.Account[0].Account.Name = ((result[2] == null) ? "" : result[2]);
                            customerResponse.Meta.Balance = ((balanceObj == "") ? 0 : balanceObj.Balance.Amount.Amount);
                            customerResponse.Meta.Kyc = ((result[0] == null) ? "" : result[0]);
                            customerResponse.Meta.Limit = ((result[3] == null) ? "" : result[3]);
                            res.json({ customer: customerResponse });
                        } else {
                            res.status(500).json({ error: config.customer_fetch_error });
                        }
                    });
            } else {
                res.status(500).json({ error: config.customer_fetch_error });
            }
        })
    });

    router.post("/transaction/:type", function (req, res) {
        var type = req.params.type;
        var mobile = req.body.Data.Transaction.AccountId;
        var transactionId = req.body.Data.Transaction.TransactionId;
        // var transactionId = randomString('0', 7);
        var partnerId = req.body.Meta.partner;
        var productId = req.body.Meta.product;
        var amount = req.body.Data.Transaction.Amount.Amount;
        if (mobile == undefined || mobile == 'undefined') {
            res.status(400).json({ error: config.customer_invalid_payload });
            return
        }
        //Request Object
        requestSt.Transaction.TransactionId = transactionId;
        requestSt.Transaction.TransactionReference = transactionId;
        requestSt.Transaction.Amount.Amount = amount;
        requestSt.Transaction.CreditDebitIndicator = type;
        requestSt.Transaction.BookingDateTime = new Date().getTime();
        requestSt.Transaction.ValueDateTime = new Date().getTime();
        requestSt.Transaction.TransactionInformation = req.body.Data.Transaction.TransactionInformation;
        requestSt.Transaction.BankTransactionCode.Code = req.body.Data.Transaction.BankTransactionCode.Code;
        requestSt.Transaction.BankTransactionCode.SubCode = req.body.Data.Transaction.BankTransactionCode.SubCode;
        requestSt.Transaction.ProprietaryBankTransactionCode.Code = req.body.Data.Transaction.ProprietaryBankTransactionCode.Code;
        requestSt.Transaction.ProprietaryBankTransactionCode.Issuer = req.body.Data.Transaction.ProprietaryBankTransactionCode.Issuer;
        requestSt.Transaction.Meta = {
            partner: partnerId,
            product: productId
        };



        redisClient.hget(config.table, config.customerMobile_field + ":" + mobile, function (err, reply) {
            if (reply != null) {
                var customerId = reply;
                requestSt.Transaction.AccountId = customerId;
                var prod_part_key = config.partner_field + ":" + partnerId + ":" + config.product_field + ":" + productId;
                multi
                    .hget(config.table, config.customerID_field + ":" + customerId + ":" + config.customerLimit_field)
                    .hget(config.table, config.customerID_field + ":" + customerId + ":" + config.customerBalance_field)
                    .hget(prod_part_key, config.customerID_field + ":" + customerId)
                    .exec(function (error, result) {
                        var currentBalance;
                        if (error) {
                            res.status(500).json({ error: config.transaction_error });
                        } else {

                            if (result[2] == null) {
                                res.status(400).json({
                                    msg: config.part_prod_unregistered,
                                    balance: balance,
                                    status: config.error_msg
                                });
                            } else {
                                if (type == "credit") {
                                    var balanceObj = ((result[1] == null) ? "" : JSON.parse(result[1]));
                                    var balance = ((balanceObj == "") ? 0 : balanceObj.Balance.Amount.Amount);
                                    if ((result[0] == null) || (parseInt(balance) + parseInt(amount)) > parseInt(result[0])) {
                                        requestSt.Transaction.Audit_Status = config.audit_limit_error_msg;
                                        requestSt.Transaction.Status = "Rejected";
                                        requestSt.Transaction.Balance.Amount.Amount = balance;
                                        var transaction = JSON.stringify(requestSt.Transaction);
                                        updateTransactionLog(req, res, customerId, transaction, type, balance, true, config.exceed_limit, config.error_msg)
                                    } else {
                                        currentBalance = parseInt(balance) + parseInt(amount);
                                        requestSt.Transaction.Balance.Amount.Amount = currentBalance;
                                        var transaction = JSON.stringify(requestSt.Transaction);
                                        redisClient.hset(config.table, config.customerID_field + ":" + customerId + ":" + config.customerBalance_field, transaction, function (err, response) {
                                            if (!err) {
                                                requestSt.Transaction.Audit_Status = config.audit_successful_msg;
                                                requestSt.Transaction.Status = "Booked";
                                                requestSt.Transaction.Balance.Amount.Amount = currentBalance;
                                                var transaction = JSON.stringify(requestSt.Transaction);
                                                updateTransactionLog(req, res, customerId, transaction, type, currentBalance, false, "", "");
                                            } else {
                                                requestSt.Transaction.Audit_Status = config.audit_failure_msg;
                                                requestSt.Transaction.Status = "Failed";
                                                requestSt.Transaction.Balance.Amount.Amount = balance;
                                                var transaction = JSON.stringify(requestSt.Transaction);
                                                updateTransactionLog(req, res, customerId, transaction, type, balance, true, config.transaction_error, config.failure_msg)
                                            }
                                        });
                                    }
                                } else if (type == "debit") {
                                    var balanceObj = ((result[1] == null) ? "" : JSON.parse(result[1]));
                                    var balance = ((balanceObj == "") ? 0 : balanceObj.Balance.Amount.Amount);
                                    if ((result[0] == null) || (parseInt(amount) > parseInt(balance))) {
                                        requestSt.Transaction.Audit_Status = config.audit_insufficient_msg;
                                        requestSt.Transaction.Status = "Rejected";
                                        requestSt.Transaction.Balance.Amount.Amount = balance;
                                        var transaction = JSON.stringify(requestSt.Transaction);
                                        updateTransactionLog(req, res, customerId, transaction, type, balance, true, config.not_enough_amount, config.error_msg)
                                    } else {
                                        currentBalance = parseInt(balance) - parseInt(amount);
                                        requestSt.Transaction.Balance.Amount.Amount = currentBalance;
                                        var transaction = JSON.stringify(requestSt.Transaction);
                                        redisClient.hset(config.table, config.customerID_field + ":" + customerId + ":" + config.customerBalance_field, transaction, function (err, response) {
                                            if (!err) {
                                                requestSt.Transaction.Audit_Status = config.audit_successful_msg;
                                                requestSt.Transaction.Status = "Booked";
                                                requestSt.Transaction.Balance.Amount.Amount = currentBalance;
                                                var transaction = JSON.stringify(requestSt.Transaction);
                                                updateTransactionLog(req, res, customerId, transaction, type, currentBalance, false, "", "")
                                            } else {
                                                requestSt.Transaction.Audit_Status = config.audit_failure_msg;
                                                requestSt.Transaction.Status = "Failed";
                                                requestSt.Transaction.Balance.Amount.Amount = balance;
                                                var transaction = JSON.stringify(requestSt.Transaction);
                                                updateTransactionLog(req, res, customerId, transaction, type, balance, true, config.transaction_error, config.failure_msg)
                                            }
                                        });
                                    }
                                }
                            }
                        }
                    });
            } else {
                res.status(500).json({ error: config.customer_fetch_error });
            }
        });
    });

    function updateTransactionLog(req, res, customerId, transObj, type, currentBalance, errorTrans, msg, errorMsg) {
        var currentTimestamp = new Date().getTime();
        multi
            .zadd(config.customerID_field + ":" + customerId + ":" + config.customerTransaction_field, currentTimestamp, transObj)
            .zadd(config.transaction_table, currentTimestamp, transObj)
            .exec(function (error, result) {
                if (!error) {
                    if (errorTrans) {
                        res.json({
                            msg: msg,
                            balance: currentBalance,
                            status: errorMsg
                        });
                    } else {
                        msg = config.transaction_msg + type + "ed!!";
                        res.json({
                            msg: msg,
                            balance: currentBalance,
                            status: config.success_msg
                        });
                    }
                    const query = {
                        text: 'INSERT INTO "STG_FINACLE_HTD"("CUST_ID", "TRAN_DATE", "TRAN_AMT", "INSTRMNT_TYPE", "TRAN_TYPE", "TRAN_CRNCY_CODE", "TRAN_ID", "TRAN_RMKS") VALUES($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *',
                        values: [customerId, requestSt.Transaction.BookingDateTime, requestSt.Transaction.Amount.Amount, type, type, "INR", requestSt.Transaction.TransactionId, (errorTrans)?"Exceeds Limit":msg]
                    }
                    client.query(query, (err, res) => {
                        if (err) {
                            console.log("Error while updating transaction details in Postgres!!")
                        } else {
                            console.log("Successfully updated transaction details in Postgres!!")
                        }
                    })

                } else {
                    res.json({
                        status: config.success_msg,
                        balance: JSON.parse(transObj).balance,
                        error: config.transaction_log_error
                    });
                }
            });
    }

    router.get("/accounts/:mobile_number/transactions", function (req, res) {
        var mobile = req.params.mobile_number;
        if (mobile == undefined || mobile == 'undefined') {
            res.status(400).json({ error: config.customer_invalid_payload });
            return
        }
        redisClient.hget(config.table, config.customerMobile_field + ":" + mobile, function (err, reply) {
            if (reply) {
                redisClient.zrevrange(config.customerID_field + ":" + reply + ":" + config.customerTransaction_field, 0, -1, function (err, result) {
                    if (result) {
                        var transactions = result.map(JSON.parse);
                        var links = {};
                        var meta = {};
                        links.Self = responseSt.transaction.Links.Self;
                        meta.TotalPages = responseSt.transaction.Meta.TotalPages;
                        meta.FirstAvailableDateTime = (transactions.length > 0) ? transactions[transactions.length - 1].BookingDateTime : "";
                        meta.LastAvailableDateTime = (transactions.length > 0) ? transactions[0].BookingDateTime : "";
                        res.json({ transaction: transactions, Link: links, Meta: meta });
                    } else {
                        res.status(500).json({ error: config.transaction_fetch_error });
                    }
                });
            } else {
                res.status(500).json({ error: config.customer_fetch_error });
            }
        })
    });


    router.get("/transactions", function (req, res) {
        redisClient.zrevrange(config.transaction_table, 0, -1, function (err, result) {
            if (result) {
                var transactions = result.map(JSON.parse);
                var links = {};
                var meta = {};
                links.Self = responseSt.transaction.Links.Self;
                meta.TotalPages = responseSt.transaction.Meta.TotalPages;
                meta.FirstAvailableDateTime = (transactions.length > 0) ? transactions[transactions.length - 1].BookingDateTime : "";
                meta.LastAvailableDateTime = (transactions.length > 0) ? transactions[0].BookingDateTime : "";
                res.json({ transaction: transactions, Link: links, Meta: meta });
            } else {
                res.status(500).json({ error: config.transaction_fetch_error });
            }
        });

    });

    router.get("/accounts/:mobile_number/balances", function (req, res) {
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
                        var balanceResponse = responseSt.balance;
                        balanceResponse.Data.Balance.AccountId = reply;
                        balanceResponse.Data.Balance.Amount.Amount = ((balanceObj == "") ? 0 : balanceObj.Balance.Amount.Amount);
                        balanceResponse.Data.Balance.CreditDebitIndicator = ((balanceObj == "") ? 0 : balanceObj.CreditDebitIndicator);
                        balanceResponse.Data.Balance.CreditLine.Amount.Amount = "Limit, add later";
                        res.json({ balanceResponse });

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