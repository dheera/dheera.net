const log = require('pino')({prettyPrint: true, level: 'debug'});
const router = require('express').Router();

router.get('/photos/places/calnight', (req, res) => res.redirect("/photos/calnight"));
router.get('/photos/places/icelandthermal', (req, res) => res.redirect("/photos/icelandthermal"));
router.get('/photos/abstract/dancelight', (req, res) => res.redirect("/photos/dancelight"));
router.get('/photos/journeys/jinghangyunhe', (req, res) => res.redirect("/photos/jinghangyunhe"));
router.get('/photos/journeys/lashioroad', (req, res) => res.redirect("/photos/lashioroad"));
router.get('/photos/journeys/timetravelchina', (req, res) => res.redirect("/photos/timetravelchina"));
router.get('/projects/blur', (req, res) => res.redirect("/posts/blur"));

module.exports = router;
