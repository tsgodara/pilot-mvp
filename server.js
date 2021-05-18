var express = require("express");
var redis = require("redis");
var bodyParser = require("body-parser");
var rest = require("./app/controllers/financialInstitute/fnInstituteCtrl.js");
var config = require("./app/config/config");
const { Pool, Client } = require('pg')

var app = express();
var env = config.env;

function REST() {
    var self = this;
    self.configureExpress();
}

app.disable("etag");

app.use(function(req, res, next) {
    res.setHeader("Access-Control-Allow-Origin", "*");
    // Request methods allowed
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, OPTIONS, PATCH, DELETE");
    // Request headers allowed
    res.setHeader("Access-Control-Allow-Headers", "X-Requested-With, content-type, Authorization, x-access-token");
    // in case session is used
    res.setHeader("Access-Control-Allow-Credentials", true);
    if (req.method === "OPTIONS") {
        return res.sendStatus(200);
    }
    next();
});

REST.prototype.connectToRedis = function(router) {
    var self = this;
    var redisClient = redis.createClient(config[env].redis);
    redisClient.on("ready", function() {
        console.log("Redis is ready");
        self.connectToDB(router, redisClient);
    });

    redisClient.on("error", function(error) {
        console.log("Error in Redis", error);
        self.stop();
    });
};

REST.prototype.connectToDB = function(router, redisClient) {
    var self = this;
    var pool = new Pool(config[env].pgConfig)
    pool.connect(function (err, client, done) {
        var rest_router = new rest(router, redisClient, client);
        self.startServer();
        console.log('postgres is ready');
    });

};

REST.prototype.configureExpress = function() {
    var self = this;
    app.use(bodyParser.urlencoded({ extended: true }));
    app.use(bodyParser.json());
    var router = express.Router();
    app.use("/", router);
    self.connectToRedis(router);
};

REST.prototype.startServer = function() {
    var port = process.env.PORT || config.port_number;
    app.set("port", port);
    app.listen(port, function() {
        console.log("Server is running at port " + port);
    });
};

REST.prototype.stop = function() {
    process.exit(1);
};

new REST(); 
