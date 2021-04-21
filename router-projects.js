const log = require('pino')({prettyPrint: true, level: 'debug'});
const router = require('express').Router();
const aws = require('./aws');
const fs = require('fs');
const config_projects = JSON.parse(fs.readFileSync('./config/photos.json', 'utf8'));
const md5 = require('md5');

let getProjects = () => new Promise((resolve, reject) => {
    aws.listObjects({Bucket: config_projects.bucket, Prefix: config_projects.prefix, Delimiter: "/"})
    .then(
        result => {
             let albumNames = result.CommonPrefixes.map(item => item.Prefix.replace(config_projects.prefix, "").replace("/", ""));
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

let getProject = (projectName) => new Promise((resolve, reject) => {
    aws.getObject({Bucket: config_projects.bucket, Key: config_projects.prefix + projectName + "/index.html"})
    .then(
        data => {
            let index = {};
            body = data.Body.toString('utf-8');
            try {
                index = JSON.parse(body.match(/<!--(.*?)-->/)[1]);
            } catch(e) {
                log.error(["getProject", e]);
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
    getProjects()
    .then(
        projects => res.render("projects/index.html", { projects: projects }),
        reason => {
            log.error(["projects_index", reason]);
            res.sendStatus(500);
        }
    );
});

router.get('/:projectName', (req, res) => {
    getProject(req.params["projectName"])
    .then(
        project => res.render('projecs/project.html', { project: project }),
        reason => {
            log.error(["projects", reason]);
            if(reason && reason.code === "NoSuchKey") return res.sendStatus(404);
            res.sendStatus(500);
        },
    );
});

module.exports = router;
