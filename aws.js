const AWS = require('aws-sdk');

AWS.config.update({region: "us-west-2"});
AWS.config.loadFromPath("./credentials/aws.json");

module.exports = AWS;
