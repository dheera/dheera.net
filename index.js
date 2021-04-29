#!/usr/bin/env node
const express = require('express');
const minifyHTML = require('express-minify-html-2');
const nunjucks = require('nunjucks');
const fs = require('fs');
const log = require('./log');
const cookieParser = require('cookie-parser');
const router = require('./router');
const helmet = require('helmet');

var app = express();
var http = require('http').Server(app);

nunjucks.configure('views', {
    autoescape: true,
    express: app
});

app.use(cookieParser());

app.use(helmet.hidePoweredBy());
app.use(helmet.noSniff());
app.use(helmet.expectCt());
app.use(helmet.frameguard());

app.use(minifyHTML({
    override: true,
    exception_url: false,
    htmlMinifier: {
        removeComments: true,
        collapseWhitespace: true,
        collapseBolleanAttributes: true,
        removeAttributeQuotes: false,
        removeEmptyAttributes: false,
        minifyJS: true,
    },
}));

app.use('/', router);

http.listen(3000, () => {
  log.info(['http_server', 'listening on *:3000']);
});
