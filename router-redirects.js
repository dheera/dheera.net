const log = require('pino')({prettyPrint: true, level: 'debug'});
const router = require('express').Router();

const redirects = {
  "/photos/places/calnight": "/photos/calnight",
  "/photos/places/icelandthermal": "/photos/icelandthermal",
  "/photos/abstract/dancelight": "/photos/dancelight",
  "/photos/journeys/jinghangyunhe": "/photos/jinghangyunhe",
  "/photos/journeys/lashioroad": "/photos/lashioroad",
  "/photos/journeys/timetravelchina": "/photos/timetravelchina",
  "/projects/blur": "/posts/blur",
};

for(const [url_from, url_to] of Object.entries(redirects)) {
  router.get(url_from, (req, res) => res.redirect(url_to));
}

module.exports = router;
