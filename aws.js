const AWS = require('aws-sdk');
const fs = require('fs');
const config_aws = JSON.parse(fs.readFileSync('./config/aws.json', 'utf8'));
const memoize = require('memoizee');

AWS.config.update({region: config_aws.region});
AWS.config.loadFromPath("./config/aws.json");

s3 = new AWS.S3({apiVersion: '2006-03-01'});

// Promise-ify and memoize AWS API

let memoizeOpts = { promise: true, max: 10000, maxAge: 1000000, preFetch: true };

// the stringify->memoize->parse construction of these _cached functions is a workaround for https://github.com/medikoo/memoizee/issues/120

let listObjects = (params) => new Promise((resolve, reject) => s3.listObjects(typeof(params) === "string" ? JSON.parse(params) : params, (err, data) => err ? reject(err) : resolve(data)));
let listObjects_cached_str = memoize(listObjects, memoizeOpts);
let listObjects_cached = (params) => listObjects_cached_str(JSON.stringify(params));

let getObject = (params) => new Promise((resolve, reject) => s3.getObject(typeof(params) === "string" ? JSON.parse(params) : params, (err, data) => err ? reject(err) : resolve(data)));
let getObject_cached_str = memoize(getObject, memoizeOpts);
let getObject_cached = (params) => getObject_cached_str(JSON.stringify(params));

module.exports = {
    s3: s3,
    config_aws: config_aws,
    listObjects: listObjects,
    getObject: getObject,
    listObjects_cached: listObjects_cached,
    getObject_cached: getObject_cached,
};
