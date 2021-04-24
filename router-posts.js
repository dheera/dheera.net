const log = require('pino')({prettyPrint: true, level: 'debug'});
const router = require('express').Router();
const aws = require('./aws');
const fs = require('fs');
const config_posts = JSON.parse(fs.readFileSync('./config/posts.json', 'utf8'));
const md5 = require('md5');

let getPosts = () => new Promise((resolve, reject) => {
    aws.listObjects_cached({Bucket: config_posts.bucket, Prefix: config_posts.prefix, Delimiter: "/"})
    .then(
        result => {
             let postNames = result.CommonPrefixes.map(item => item.Prefix.replace(config_posts.prefix, "").replace("/", ""));
             let promises = [];
             for(i in postNames) {
                 promises.push(getPost(postNames[i]));
             }
             Promise.allSettled(promises).then(results => {
		 let posts = [];
                 for(i in results) {
                     if(results[i].status === "fulfilled") {
                         post = results[i].value;
                         post.name = postNames[i];
                         posts.push(post);
                     }
                 }
                 resolve(posts);
             });
        },
        reason => reject(reason)
    );
});

let getPost = (postName) => new Promise((resolve, reject) => {
    aws.getObject_cached({Bucket: config_posts.bucket, Key: config_posts.prefix + postName + "/index.html"})
    .then(
        data => {
            let index = {};
            let body = data.Body.toString('utf-8');
            let infoMatch = body.match(/<!--(.*?)-->/s);
	    if(infoMatch) {
                try {
                    index = JSON.parse(infoMatch[1]);
                } catch(e) {
                    log.error(["getPost", e]);
                    index = { "title": postName };
                }
            } else {
                index = { "title": postName };
            }

            let baseUrl = "https://" + config_posts.domain + "/" + config_posts.prefix + postName + "/";

            body = body.replace(/src="(.*?)"/g, 'src="' + baseUrl + "$1" + '"');

            resolve({
                title: index.title || "",
                subtitle: index.subtitle || "",
                image: postName + "/" + index.image,
                body: body,
            });
        },
        reason => reject(reason)
    );
});

let getSignedImageURL = (imageFile, params) => {
    let path = imageFile + "?" + params;
    let checksum = md5(config_posts.imgixSecureToken + "/" + config_posts.prefix + path); // imgix uses MD5, not my choice
    let url = "https://" + config_posts.imgixDomain + "/" + config_posts.prefix + path + "&s=" + checksum;
    return url;
}

router.get('/', (req, res) => {
    getPosts()
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
    console.log(req.params);
    getPost(req.params["postName"])
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
