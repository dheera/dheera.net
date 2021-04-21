const AWS = require('aws-sdk');
const fs = require('fs');
const config_aws = JSON.parse(fs.readFileSync('./config/aws.json', 'utf8'));

AWS.config.update({region: config_aws.region});
AWS.config.loadFromPath("./config/aws.json");

s3 = new AWS.S3({apiVersion: '2006-03-01'});

// Promise-ify AWS API

module.exports = {
    s3: s3,
    config_aws: config_aws,
    listObjects: (params) => new Promise((resolve, reject) => s3.listObjects(params, (err, data) => err ? reject(err) : resolve(data))),
    getObject: (params) => new Promise((resolve, reject) => s3.getObject(params, (err, data) => err ? reject(err) : resolve(data))),
};
