const log = require('pino')({prettyPrint: true, level: 'debug'});
const express = require('express');
const router = express.Router();
const routerPhotos = require('./router-photos');

router.use((req, res, next) => {
  var ip = req.headers['x-forwarded-for'] || req.headers['x-real-ip'] || req.connection.remoteAddress;
  log.info(['http_log', {
    'ip': ip,
    'hostname': req.hostname,
    'query': req.query,
    'body': req.body,
    'path': req.path,
    'headers': req.headers,
  }]);
  return next();
});

router.use('/', express.static(__dirname + '/static', {maxage: 1}));

router.get('/about', (req, res) => res.render('about.html'));
router.use('/photos', routerPhotos);
router.get('/projects', (req, res) => res.render('projects.html'));
router.get('/posts', (req, res) => res.render('posts.html'));
router.get('/contact', (req, res) => res.render('contact.html'));
router.get('/', (req, res) => res.render('index.html'));

router.all('*', (req, res) => {
  res.status(404).send({msg: "not found"});
});

module.exports = router;
