const log = require('./log');
const router = require('express').Router();
const contentFetcher = require('./content-fetcher');

router.get('/', (req, res) => {
    contentFetcher.getPosts()
    .then((posts) =>{
          res.render("posts/index.html", { posts: posts, userInfo: req.userInfo })
        },
	reason => {
          log.error(["posts_index", reason]);
          res.sendStatus(500);
        }
    );
});

router.get('/:postName', (req, res) => {
    contentFetcher.getPost(req.params["postName"])
    .then(
        post => res.render('posts/post.html', { post: post, userInfo: req.userInfo }),
        reason => {
            log.error(["posts", reason]);
            if(reason && reason.code === "NoSuchKey") return res.sendStatus(404);
            res.sendStatus(500);
        },
    );
});

module.exports = router;
