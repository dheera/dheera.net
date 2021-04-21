const log = require('pino')({prettyPrint: true, level: 'debug'});
const router = require('express').Router();
const aws = require('./aws');
const fs = require('fs');
const config_posts = JSON.parse(fs.readFileSync('./config/photos.json', 'utf8'));
const md5 = require('md5');

let getPosts = () => new Promise((resolve, reject) => {
    aws.listObjects({Bucket: config_posts.bucket, Prefix: config_posts.prefix, Delimiter: "/"})
    .then(
        result => {
             let albumNames = result.CommonPrefixes.map(item => item.Prefix.replace(config_posts.prefix, "").replace("/", ""));
             let albums = [];
             let promises = [];
             for(i in albumNames) {
                 promises.push(getAlbum(albumNames[i]));
             }
             Promise.allSettled(promises).then(results => {
                 for(i in results) {
                     if(results[i].status === "fulfilled") {
                         album = results[i].value;
                         album.name = albumNames[i];
                         albums.push(album);
                     }
                 }
                 resolve(albums);
             });
        },
        reason => reject(reason)
    );
});

let getPost = (postName) => new Promise((resolve, reject) => {
    aws.getObject({Bucket: config_posts.bucket, Key: config_posts.prefix + postName + "/index.html"})
    .then(
        data => {
            let index = {};
            body = data.Body.toString('utf-8');
            try {
                index = JSON.parse(body.match(/<!--(.*?)-->/)[1]);
            } catch(e) {
                log.error(["getPost", e]);
                index = {};
            }
            resolve({
                title: index.title || "",
                body: body,
            });
        },
        reason => reject(reason)
    );
});

router.get('/', (req, res) => {
    getPosts()
    .then(
        posts => res.render("posts/index.html", { posts: posts }),
        reason => {
            log.error(["posts_index", reason]);
            res.send(500);
        }
    );
});

router.get('/:postName', (req, res) => {
    getPost(req.params["postName"])
    .then(
        post => res.render('projecs/post.html', { post: post }),
        reason => {
            log.error(["posts", reason]);
            if(reason && reason.code === "NoSuchKey") return res.send(404);
            res.send(500);
        },
    );
});

module.exports = router;
